// 실효성 검증 서비스 (ADR-018).
//
// 두 모드:
// - Core (verifyUrl): HEAD 만. 5s timeout. 404/410→snapshot, 200–399→active, 그 외→unchecked.
// - Stretch (verifyUrlPrecise): GET + 본문 20 KB cap + 가격 패턴 ±10%.
//   matched → active. drifted(다른 가격만) → price_changed. missing(가격 패턴 없음) → active(보수).
//
// Hard red lines:
// - 본문 전체 다운로드 금지 — 20 KB 에서 reader.cancel().
// - 본문을 DB 에 저장 금지 (여기서 읽고 버림).
// - UA 위장 금지 (CRAWLER_USER_AGENT 그대로 전송).
//
// `fetch` 는 주입 가능 (테스트). 기본값은 globalThis.fetch.

export type VerifyResult = {
  status: 'active' | 'snapshot' | 'unchecked';
  httpStatus: number | null;
};

export type VerifyOptions = {
  timeoutMs?: number;
  fetch?: typeof fetch;
};

export type PriceSignal = 'matched' | 'drifted' | 'missing';

export type VerifyPreciseResult = {
  status: 'active' | 'snapshot' | 'price_changed' | 'unchecked';
  httpStatus: number | null;
  priceSignal: PriceSignal;
};

export type VerifyPreciseOptions = {
  timeoutMs?: number;
  fetch?: typeof fetch;
  maxBodyBytes?: number;
};

const DEFAULT_TIMEOUT_MS = 5000;
const PRECISE_TIMEOUT_MS = 10000;
const BODY_CAP_BYTES = 20 * 1024; // 20 KB
const PRICE_TOLERANCE = 0.1; // ±10%

/**
 * URL 에 HEAD 요청을 보내고 상태 분류. (Core, ADR-018)
 *
 *  - 404 / 410 → 'snapshot' (원문 영구 삭제 추정)
 *  - 200–399  → 'active'
 *  - 그 외 (5xx, 401·403, 타임아웃, 네트워크 에러) → 'unchecked'
 */
export async function verifyUrl(
  url: string,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, fetch: injectedFetch } = opts;
  const fetchImpl = injectedFetch ?? globalThis.fetch;

  if (!fetchImpl) {
    return { status: 'unchecked', httpStatus: null };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    });
    const code = res.status;

    if (code === 404 || code === 410) {
      return { status: 'snapshot', httpStatus: code };
    }
    if (code >= 200 && code < 400) {
      return { status: 'active', httpStatus: code };
    }
    // 4xx(401/403/429 등) 및 5xx 는 일시적일 수 있음 → unchecked.
    return { status: 'unchecked', httpStatus: code };
  } catch {
    // AbortError / network error → 재시도 대상.
    return { status: 'unchecked', httpStatus: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 본문에서 원(₩) 가격으로 해석 가능한 숫자들을 추출.
 *
 *  - `135,000` (쉼표 구분, 5~7자리)
 *  - `135000원` (맨 숫자 + 원)
 *  - `135천원`  (단위 suffix; 1,000 배수 가중)
 *
 *  결과는 KRW 정수 배열. 10,000 ~ 10,000,000 범위로 필터 (항공권 현실 범위).
 *  중복 제거 없이 반환 (호출측에서 필요 시 Set 처리).
 */
export function extractPricesKrw(body: string): number[] {
  const prices: number[] = [];
  const MIN = 10_000;
  const MAX = 10_000_000;

  // 1) `135,000` (쉼표 그룹). 원/won suffix 유무 무관.
  const commaRe = /(\d{1,3}(?:,\d{3})+)/g;
  for (const m of body.matchAll(commaRe)) {
    const num = Number.parseInt(m[1].replace(/,/g, ''), 10);
    if (Number.isFinite(num) && num >= MIN && num <= MAX) prices.push(num);
  }

  // 2) 원 suffix 를 붙인 5~7자리 평문 숫자 (`135000원`).
  const plainWonRe = /(?<!\d)(\d{5,7})\s*원/g;
  for (const m of body.matchAll(plainWonRe)) {
    const num = Number.parseInt(m[1], 10);
    if (Number.isFinite(num) && num >= MIN && num <= MAX) prices.push(num);
  }

  // 3) `135천원` — 천원 suffix, × 1000 배수.
  const cheonWonRe = /(?<!\d)(\d{1,4})\s*천원/g;
  for (const m of body.matchAll(cheonWonRe)) {
    const num = Number.parseInt(m[1], 10) * 1000;
    if (Number.isFinite(num) && num >= MIN && num <= MAX) prices.push(num);
  }

  return prices;
}

/**
 * ReadableStream 본문을 maxBytes 까지만 decode 하고 나머지는 cancel.
 * ADR-008: 전체 본문 다운로드 금지. 20 KB cap 기본.
 */
async function readCappedText(
  res: Response,
  maxBytes: number,
): Promise<{ text: string; aborted: boolean }> {
  if (!res.body) {
    // Response 에 stream 이 없으면 text() fallback 은 안전상 금지 (전체 로드될 수 있음).
    // 대신 빈 문자열 반환.
    return { text: '', aborted: false };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let total = 0;
  let text = '';
  let aborted = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.byteLength >= maxBytes) {
        const room = Math.max(0, maxBytes - total);
        text += decoder.decode(value.subarray(0, room));
        total += room;
        aborted = true;
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        break;
      }
      total += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    // swallow — whatever we read is usable.
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
  return { text, aborted };
}

/**
 * URL 에 GET 요청을 보내고 본문에서 가격 패턴을 검출하여 상태 분류. (Stretch, ADR-018)
 *
 *  - 404 / 410 → { status: 'snapshot', priceSignal: 'missing' }
 *  - 200~399:
 *      - 본문 20 KB 내에 expectedPriceKrw ± 10% 매치 → { 'active', 'matched' }
 *      - 매치 없지만 다른 가격 패턴 존재 → { 'price_changed', 'drifted' }
 *      - 가격 패턴 없음 → { 'active', 'missing' } (보수적 active 유지)
 *  - 그 외 (5xx, 401·403, 타임아웃, 네트워크 에러) → { 'unchecked', 'missing' }
 */
export async function verifyUrlPrecise(
  url: string,
  expectedPriceKrw: number,
  opts: VerifyPreciseOptions = {},
): Promise<VerifyPreciseResult> {
  const {
    timeoutMs = PRECISE_TIMEOUT_MS,
    fetch: injectedFetch,
    maxBodyBytes = BODY_CAP_BYTES,
  } = opts;
  const fetchImpl = injectedFetch ?? globalThis.fetch;

  if (!fetchImpl) {
    return { status: 'unchecked', httpStatus: null, priceSignal: 'missing' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const ua = process.env.CRAWLER_USER_AGENT ?? 'Cheapsky/0.1';
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': ua },
    });
    const code = res.status;

    if (code === 404 || code === 410) {
      try {
        await res.body?.cancel();
      } catch {
        // ignore
      }
      return { status: 'snapshot', httpStatus: code, priceSignal: 'missing' };
    }
    if (code >= 200 && code < 400) {
      const { text } = await readCappedText(res, maxBodyBytes);
      const prices = extractPricesKrw(text);
      const low = expectedPriceKrw * (1 - PRICE_TOLERANCE);
      const high = expectedPriceKrw * (1 + PRICE_TOLERANCE);
      const matched = prices.some((p) => p >= low && p <= high);
      if (matched) {
        return { status: 'active', httpStatus: code, priceSignal: 'matched' };
      }
      if (prices.length > 0) {
        return { status: 'price_changed', httpStatus: code, priceSignal: 'drifted' };
      }
      return { status: 'active', httpStatus: code, priceSignal: 'missing' };
    }
    // 4xx(401/403/429 등) / 5xx → unchecked.
    try {
      await res.body?.cancel();
    } catch {
      // ignore
    }
    return { status: 'unchecked', httpStatus: code, priceSignal: 'missing' };
  } catch {
    return { status: 'unchecked', httpStatus: null, priceSignal: 'missing' };
  } finally {
    clearTimeout(timer);
  }
}
