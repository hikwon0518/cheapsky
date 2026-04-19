// 규칙 기반 파서 (Core — ADR-005 Stretch 전 LLM 금지).
//
// 원칙 (CLAUDE.md / ADR-008 교차):
// - fail-soft: 예외 throw 금지. 매칭 실패 필드는 null.
// - 입력 범위: 제목 + 본문 앞 500자. 이 함수는 `(title + body.slice(0,500))` 를 내부에서 자르지 않고
//   caller(`scripts/crawl.ts`) 가 자르는 것이 원칙이지만, 방어선으로 이 파일에서도 500자 cut 을 적용.
// - LLM SDK import 금지 (Core). 외부 네트워크 호출 금지.
// - parsedBy: 'rules' 고정.
// - 패키지·호텔 키워드(`패키지`, `호텔`, `숙박`) 포함 시 필터 아웃(호출측이 제외하도록 tripType=null).

import {
  DESTINATION_ALIASES,
  ORIGIN_ALIASES,
  normalizeRoute,
} from '@/lib/route-map';
import { isKnownAirport } from '@/lib/airport-aliases';
import { classOf, lookupCarrier } from '@/lib/airlines';
import airlinesData from '@/data/airlines.json';
import type {
  CarrierClass,
  DealDraft,
  RawPost,
  TripType,
} from '@/types/deal';

/** 본문 앞 N자만 파서에 노출 (ADR-005/008 교차). caller 가 주지만 방어적으로 한 번 더 cut. */
const BODY_CHAR_LIMIT = 500;

/** 항공권이 아닌 패키지/숙박 등을 알리는 키워드. 필터 아웃. */
const EXCLUDE_KEYWORDS = ['패키지', '호텔', '숙박', '3박', '4박', '5박', '2박'];

/**
 * 한글 항공사명 목록. 제목/본문에 등장하는지 빠르게 스캔.
 * (단순 이름 길이 내림차순 정렬 — "베트남항공" 이 "베트남" 보다 먼저 매치되도록.)
 */
const AIRLINE_NAMES: Array<{ name: string; code: string }> = Object.entries(
  airlinesData as Record<string, { name: string }>,
)
  .map(([code, v]) => ({ name: v.name, code }))
  .sort((a, b) => b.name.length - a.name.length);

/**
 * 한글 축약 별명. 뽐뿌에서 자주 `티웨이`·`아시아나` 식으로 축약 표기.
 * 정규 이름(`lib/airlines.ts` 사전)과 별도로 관리해 core 사전 오염을 피함.
 */
const AIRLINE_ALIASES: Array<{ name: string; code: string }> = [
  { name: '티웨이', code: 'TW' },
  { name: '아시아나', code: 'OZ' },
  { name: '비엣젯', code: 'VJ' },
  { name: '젯스타', code: 'GK' },
  { name: '피치', code: 'MM' },
  { name: '세부퍼시픽', code: '5J' },
].sort((a, b) => b.name.length - a.name.length);

/**
 * 별명 → IATA 사전의 key 리스트 (정규식 스캔용).
 * 주의: "서울"·"인천" 등 출발지 별명은 출발지에만 사용.
 */
const DEST_NAME_TOKENS = Object.keys(DESTINATION_ALIASES).sort(
  (a, b) => b.length - a.length,
);
const ORIGIN_NAME_TOKENS = Object.keys(ORIGIN_ALIASES).sort(
  (a, b) => b.length - a.length,
);

/**
 * 파서 내부 입력을 정규화 — `title + '\n' + body[0..500]`.
 * 제목·본문 사이 경계 강조를 위해 개행 유지. 개행/연속 공백은 그대로 둠
 * (패턴 매칭이 줄 단위 boundary 를 이용할 수 있음).
 */
function composeHaystack(post: RawPost): string {
  const title = post.title ?? '';
  const body = (post.body ?? '').slice(0, BODY_CHAR_LIMIT);
  return `${title}\n${body}`;
}

/**
 * 제목/본문에 제외 키워드가 포함되면 true (패키지·호텔 딜).
 */
function isExcludedByKeyword(text: string): boolean {
  return EXCLUDE_KEYWORDS.some((kw) => text.includes(kw));
}

/**
 * 가격 파싱.
 * 지원 패턴:
 *   `135,000원`, `99,000`, `450,000원부터`, `29만`, `29만원`, `29만원부터`, `135000원`,
 *   `60만`, `NN만대` (='NN0000'), `45만원`.
 * - `만` 또는 `만원` 이 붙은 수는 × 10000.
 * - 숫자만이거나 `KRW`/`원` 이 붙은 경우 그대로 (쉼표 제거).
 * - 두 건 이상 발견되면 **가장 작은** 값(특가 가능성).
 * - 30,000원 미만·5천만원 초과는 버림 (국제선 최저가 하한 — 그 이하는
 *   세금·공항세·편도 일부·환급액 같은 오매칭일 가능성 높음).
 */
export function parsePrice(text: string): number | null {
  if (!text) return null;
  const candidates: number[] = [];

  // 1) `N만` / `N만원` / `NN만대` / `N.N만` 패턴.
  //    `20만대` → 20만원대 ≒ 200000 으로 처리.
  const manRe = /(\d{1,3}(?:[.,]\d{1,2})?)\s*만(?:원|대)?(?:부터|대)?/g;
  let m: RegExpExecArray | null;
  while ((m = manRe.exec(text)) !== null) {
    const raw = m[1].replace(/,/g, '');
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    candidates.push(Math.round(n * 10000));
  }

  // 2) `135,000원` / `135000원` / `450,000원부터` 패턴.
  const wonRe =
    /(\d{1,3}(?:,\d{3})+|\d{4,8})\s*(?:원|KRW|krw|원부터|원~)/g;
  while ((m = wonRe.exec(text)) !== null) {
    const n = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    candidates.push(n);
  }

  // 3) fallback: 맨 쉼표 포함 큰 숫자 (단 위 패턴에 잡힌 것과 중복 OK, 최종 min 선택).
  const bareRe = /(\d{1,3}(?:,\d{3}){1,2})\b/g;
  while ((m = bareRe.exec(text)) !== null) {
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n >= 10000) candidates.push(n);
  }

  const valid = candidates.filter((v) => v >= 30_000 && v <= 50_000_000);
  if (valid.length === 0) return null;
  // 최솟값 채택 (가장 낮은 가격이 딜의 핵심일 가능성 높음).
  return Math.min(...valid);
}

/**
 * 왕복/편도 판정. 키워드가 없으면 기본 `roundtrip` (PRD 다수 케이스가 왕복).
 */
export function parseTripType(text: string): TripType {
  if (/편도/.test(text)) return 'oneway';
  if (/왕복/.test(text)) return 'roundtrip';
  return 'roundtrip';
}

/**
 * 출발 월/기간 파싱.
 * - `3~5월`, `5월 출발`, `5-6월`, `2026-05`, `2026-05-01~05-10`, `5월`.
 * 반환: `{ from, to }` (UTC Date). 매칭 실패 → `{ from: null, to: null }`.
 * 월만 있으면 해당 달 1일~말일. 현재 기준 "이미 지난 월" 은 내년으로 가정.
 */
export function parseDepartRange(
  text: string,
  now: Date,
): { departFrom: Date | null; departTo: Date | null } {
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;

  // 1) YYYY-MM-DD ~ MM-DD
  const iso = text.match(
    /(\d{4})-(\d{2})-(\d{2})\s*[~-]\s*(\d{2})-(\d{2})/,
  );
  if (iso) {
    const y = Number(iso[1]);
    const m1 = Number(iso[2]);
    const d1 = Number(iso[3]);
    const m2 = Number(iso[4]);
    const d2 = Number(iso[5]);
    if (isValidMonth(m1) && isValidMonth(m2)) {
      return {
        departFrom: dateUTC(y, m1, d1),
        departTo: dateUTC(y, m2, d2),
      };
    }
  }

  // 2) YYYY-MM(-DD?) 단독
  const isoSingle = text.match(/(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (isoSingle) {
    const y = Number(isoSingle[1]);
    const m = Number(isoSingle[2]);
    const d = isoSingle[3] ? Number(isoSingle[3]) : 1;
    if (isValidMonth(m)) {
      const from = dateUTC(y, m, d);
      const to = isoSingle[3] ? from : dateUTC(y, m, lastDayOfMonth(y, m));
      return { departFrom: from, departTo: to };
    }
  }

  // 3) `3~5월` 또는 `3-5월` (월 범위)
  //    범위가 현재 월을 포함·지난 후 끝나면 현재 연도. 범위 끝이 현재 월 이전이면 내년.
  const rangeMonth = text.match(/(\d{1,2})\s*[~\-–]\s*(\d{1,2})\s*월/);
  if (rangeMonth) {
    const m1 = Number(rangeMonth[1]);
    const m2 = Number(rangeMonth[2]);
    if (isValidMonth(m1) && isValidMonth(m2) && m1 <= m2) {
      // 기준: 범위 종료월 기준으로 연도 결정.
      const y =
        m2 < currentMonth ? currentYear + 1 : currentYear;
      return {
        departFrom: dateUTC(y, m1, 1),
        departTo: dateUTC(y, m2, lastDayOfMonth(y, m2)),
      };
    }
  }

  // 4) `5월 출발` / `5월~` / 단독 `N월`
  const single = text.match(/(\d{1,2})\s*월/);
  if (single) {
    const m = Number(single[1]);
    if (isValidMonth(m)) {
      const y = m < currentMonth ? currentYear + 1 : currentYear;
      return {
        departFrom: dateUTC(y, m, 1),
        departTo: dateUTC(y, m, lastDayOfMonth(y, m)),
      };
    }
  }

  return { departFrom: null, departTo: null };
}

function isValidMonth(m: number): boolean {
  return Number.isInteger(m) && m >= 1 && m <= 12;
}

function dateUTC(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, Math.min(Math.max(1, d), 31)));
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * origin / destination 을 텍스트에서 검출 → IATA 정규화.
 * 없으면 출발지는 기본 'ICN' (Cheapsky 는 인천 출발 전용 — ADR-021).
 */
export function parseRoute(
  text: string,
): { origin: string | null; destination: string | null } {
  // 목적지 우선 탐색 (긴 이름부터).
  let rawOrigin: string | null = null;
  let rawDest: string | null = null;

  // 출발지 스캔.
  for (const token of ORIGIN_NAME_TOKENS) {
    if (containsToken(text, token)) {
      rawOrigin = token;
      break;
    }
  }

  // 목적지 스캔. 출발지 토큰은 제외 (같은 단어는 1회만 쓰인 경우 충돌 방지).
  for (const token of DEST_NAME_TOKENS) {
    if (rawOrigin && token === rawOrigin) continue;
    if (containsToken(text, token)) {
      rawDest = token;
      break;
    }
  }

  // 3글자 IATA 직접 매칭 보완 (제목 안에 `ICN-NRT` 식).
  if (!rawOrigin) {
    const m = text.match(/\b([A-Z]{3})\s*[-–>→=]\s*[A-Z]{3}\b/);
    if (m) rawOrigin = m[1];
  }
  if (!rawDest) {
    const m = text.match(/\b[A-Z]{3}\s*[-–>→=]\s*([A-Z]{3})\b/);
    if (m) rawDest = m[1];
  }

  // 단독 IATA 코드(예: `LAX`, `JFK`) 스캔 — 알려진 공항만.
  if (!rawDest) {
    const codeRe = /\b([A-Z]{3})\b/g;
    let m: RegExpExecArray | null;
    while ((m = codeRe.exec(text)) !== null) {
      const code = m[1];
      if (code === 'ICN' || code === 'GMP') continue; // 출발 전용
      if (isKnownAirport(code)) {
        rawDest = code;
        break;
      }
    }
  }

  // 출발지 기본값: 인천 (ADR-021. 제목에 명시 안 되는 케이스 많음).
  const { origin: resolvedOrigin, destination: resolvedDest } = normalizeRoute(
    rawOrigin ?? 'ICN',
    rawDest,
  );

  return {
    origin: resolvedOrigin,
    destination: resolvedDest,
  };
}

/**
 * 특정 토큰이 문자열에 포함되는지. 영문 alias 는 단어 경계로 한 번 더 보호.
 */
function containsToken(text: string, token: string): boolean {
  if (/^[A-Za-z]+$/.test(token)) {
    // 영문 alias — 단어 경계 (좌우가 영문이 아니어야 함).
    const re = new RegExp(`(?<![A-Za-z])${escapeRegExp(token)}(?![A-Za-z])`, 'i');
    return re.test(text);
  }
  return text.includes(token);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 항공사 검출 — 텍스트에서 한글명 우선 → 영문 코드 보조.
 * 여러 개 등장하면 첫 매칭 사용.
 */
export function parseCarrier(
  text: string,
): { code: string | null; carrierClass: CarrierClass } {
  // 1) 정식 한글 항공사명 (긴 이름 우선).
  for (const { name, code } of AIRLINE_NAMES) {
    if (text.includes(name)) {
      return { code, carrierClass: classOf(code) };
    }
  }
  // 2) 축약 한글명 (`티웨이`, `아시아나` 등).
  for (const { name, code } of AIRLINE_ALIASES) {
    if (text.includes(name)) {
      return { code, carrierClass: classOf(code) };
    }
  }
  // 3) 영문 코드 (2~3자) — `\b[A-Z0-9]{2,3}\b` 중 lookup 되는 것.
  const codeRe = /\b([A-Z0-9]{2,3})\b/g;
  let m: RegExpExecArray | null;
  while ((m = codeRe.exec(text)) !== null) {
    const found = lookupCarrier(m[1]);
    if (found) {
      return { code: found.code, carrierClass: found.info.class };
    }
  }
  return { code: null, carrierClass: 'mixed' };
}

/**
 * 규칙 기반 파서 entry. 실패는 예외 대신 null.
 */
export function parseRules(post: RawPost): DealDraft {
  const haystack = composeHaystack(post);

  // 패키지/호텔 딜은 필수 필드 미완성으로 만들어 caller 가 제외하게 함.
  const excluded = isExcludedByKeyword(haystack);

  const priceKrw = excluded ? null : parsePrice(haystack);
  const tripType = excluded ? null : parseTripType(haystack);
  const { origin, destination } = excluded
    ? { origin: null, destination: null }
    : parseRoute(haystack);
  const { departFrom, departTo } = excluded
    ? { departFrom: null, departTo: null }
    : parseDepartRange(haystack, post.postedAt);
  const { code: carrierCode, carrierClass } = excluded
    ? { code: null, carrierClass: 'mixed' as CarrierClass }
    : parseCarrier(haystack);

  return {
    source: post.source,
    sourceId: post.sourceId,
    sourceUrl: post.sourceUrl,
    title: post.title,
    origin,
    destination,
    tripType,
    departFrom,
    departTo,
    returnFrom: null, // Core: 귀국편 범위는 추후(ADR-014 후반) 확장
    returnTo: null,
    priceKrw,
    carrierCode,
    carrierClass,
    postedAt: post.postedAt,
    parsedBy: 'rules',
  };
}
