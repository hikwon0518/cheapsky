/**
 * Claude Haiku 4.5 카드 한 줄 큐레이션 (Stretch 2, ADR-005).
 *
 * 역할 (ARCHITECTURE "데이터 흐름 (4) 큐레이션"):
 *   - hot_deal 로 올라온 딜에 정제된 숫자 필드만 묶어 LLM 에 넘긴다.
 *   - 모델 고정: `claude-haiku-4-5-20251001`. opus/sonnet 금지.
 *   - 제목·본문 원문 전송 금지 (ADR-005 / ADR-008 교차).
 *   - 시스템 프롬프트는 정적이므로 `cache_control: { type: 'ephemeral' }` 로
 *     prompt caching — 50 회 배치에서 캐시 히트율 49/50 기대.
 *   - 재시도: 1회 지수 백오프 (500ms + 지터). 429 즉시 중단. 2회 실패 → null.
 *   - 후처리 검증:
 *       1) 60자 초과 → cut
 *       2) 금칙어 (역대가 / Amadeus / Anthropic / Claude / LLM / API) 포함 → null
 *       3) 숫자 환각: 응답 문장 내 `N%` 가 input.discountRate 나 percentile 과
 *          ±1 오차 내에 매핑 안 되면 → null
 *   - 실패 시 예외 대신 text=null (fail-soft). caller 는 규칙 폴백 유지.
 */
import type Anthropic from '@anthropic-ai/sdk';

import { clampCurationText } from '@/lib/format';
import type { BudgetTracker } from '@/lib/llm-budget';
import type { CarrierClass } from '@/types/deal';

export const CURATION_MODEL = 'claude-haiku-4-5-20251001';

/** ADR-005: 60자 cut. */
export const CURATION_MAX_CHARS = 60;

/** 응답 토큰 상한 — 한 문장이면 충분. */
const MAX_TOKENS = 128;

/**
 * ADR-012 / ADR-005 금칙어.
 * 시스템 명칭·"역대가" 용어가 출력에 섞이면 규칙 폴백으로 대체.
 */
const FORBIDDEN = /역대가|Amadeus|Anthropic|Claude|LLM|API/i;

const SYSTEM_PROMPT =
  '주어진 숫자만 사용하여 한국어 60자 이내 한 문장을 생성하세요. ' +
  "'API', 'Claude', 'LLM', 'Amadeus', 'Anthropic' 같은 시스템 명칭 언급 금지. " +
  "'역대가' 표현 금지. " +
  '계절·이벤트·외부 지식·감성어·추측 금지. ' +
  '반드시 마침표로 끝낼 것. ' +
  '출력은 한 문장만, 다른 설명·머리말 없이 문장 자체만 반환.';

export type CurationInput = {
  origin: string;
  destination: string;
  carrierCode: string | null;
  carrierClass: CarrierClass;
  priceKrw: number;
  baselineP50Krw: number | null;
  baselineP10Krw: number | null;
  /** 할인율 (0~1, 음수 가능). null 이면 큐레이션 skip. */
  discountRate: number | null;
  /** 0~100. null 이면 percentile 문구는 생성하지 않음. */
  pricePercentile: number | null;
  last30dMinKrw: number | null;
};

export type CurationResult = {
  text: string | null;
  tokensIn: number;
  tokensOut: number;
};

export type CurationConfig = {
  apiKey: string;
  budget: BudgetTracker;
  /** 테스트 주입용 mock. */
  client?: Anthropic;
  /** 기본 CURATION_MODEL. 테스트에서만 override. */
  model?: string;
};

/** input → User prompt 텍스트 (숫자 필드만). 제목·본문 금지. */
export function buildCurationUserPrompt(input: CurationInput): string {
  const parts: string[] = [];
  parts.push(`노선: ${input.origin}-${input.destination}`);
  const classLabel =
    input.carrierClass === 'fsc'
      ? 'FSC'
      : input.carrierClass === 'lcc'
        ? 'LCC'
        : '혼합';
  if (input.carrierCode) {
    parts.push(`항공사 등급: ${classLabel} (${input.carrierCode})`);
  } else {
    parts.push(`항공사 등급: ${classLabel}`);
  }
  parts.push(`현재가: ${Math.round(input.priceKrw)}원`);
  if (input.baselineP50Krw != null) {
    parts.push(`시장 평균(p50): ${Math.round(input.baselineP50Krw)}원`);
  }
  if (input.baselineP10Krw != null) {
    parts.push(`하위 10% 기준(p10): ${Math.round(input.baselineP10Krw)}원`);
  }
  if (input.discountRate != null) {
    const pct = Math.round(input.discountRate * 100);
    parts.push(`할인율: ${pct}%`);
  }
  if (input.pricePercentile != null) {
    const p = Math.max(0, Math.min(100, Math.round(input.pricePercentile)));
    parts.push(`분위수: p${p}`);
  }
  if (input.last30dMinKrw != null) {
    parts.push(`지난 30일 이 노선 최저: ${Math.round(input.last30dMinKrw)}원`);
  }
  return parts.join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimit(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { status?: number; name?: string };
  return e.status === 429 || e.name === 'RateLimitError';
}

type AllowedNumbers = {
  discountPct: number | null;
  percentile: number | null;
};

/**
 * 응답 문장 내 "N%" 숫자가 input.discountRate 또는 pricePercentile 의
 * 정수값과 ±1 이내인지 검증. 응답에 %가 없으면 통과 (환각 없음으로 간주).
 * 어긋나는 숫자가 하나라도 있으면 false.
 */
export function validateNumberFidelity(
  text: string,
  allowed: AllowedNumbers,
): boolean {
  const matches = text.match(/\d+\s*%/g);
  if (!matches) return true;
  const allowedPcts: number[] = [];
  if (allowed.discountPct != null) allowedPcts.push(allowed.discountPct);
  if (allowed.percentile != null) allowedPcts.push(allowed.percentile);

  for (const raw of matches) {
    const n = Number(raw.replace(/\s|%/g, ''));
    if (!Number.isFinite(n)) return false;
    const ok = allowedPcts.some((a) => Math.abs(a - n) <= 1);
    if (!ok) return false;
  }
  return true;
}

/**
 * Anthropic messages.create 1회 호출. prompt caching 적용.
 */
async function callOnce(
  client: Anthropic,
  model: string,
  userPrompt: string,
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const resp = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    // System 블록에 cache_control 을 붙여 prompt caching 활성화.
    // SDK 타입은 string | TextBlockParam[] 두 형태 모두 허용하지만
    // cache_control 은 array 형태에서만 표현 가능.
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ] as unknown as Parameters<Anthropic['messages']['create']>[0]['system'],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const usage = resp.usage ?? { input_tokens: 0, output_tokens: 0 };

  const textBlock = resp.content.find(
    (b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text',
  );
  const text = textBlock?.text?.trim() ?? '';
  return {
    text,
    tokensIn: Number(usage.input_tokens ?? 0),
    tokensOut: Number(usage.output_tokens ?? 0),
  };
}

/**
 * 큐레이션 entry.
 * - discountRate == null → skip (비용 낭비 방지, text=null).
 * - budget.canSpend() == false → skip.
 * - 1회 재시도, 429 즉시 중단, 최종 실패 → text=null.
 * - 후처리: clamp 60 / 금칙어 / 숫자 환각 중 하나라도 위반 → text=null.
 */
export async function curateOne(
  input: CurationInput,
  config: CurationConfig,
): Promise<CurationResult> {
  if (input.discountRate == null) {
    return { text: null, tokensIn: 0, tokensOut: 0 };
  }
  if (!(await config.budget.canSpend())) {
    return { text: null, tokensIn: 0, tokensOut: 0 };
  }

  const model = config.model ?? CURATION_MODEL;
  const userPrompt = buildCurationUserPrompt(input);

  let client: Anthropic | undefined = config.client;
  if (!client) {
    // Dynamic import — Core 빌드에 Anthropic SDK 정적 import 유출 방지.
    const mod = await import('@anthropic-ai/sdk');
    const Ctor = mod.default;
    client = new Ctor({ apiKey: config.apiKey });
  }

  const allowed: AllowedNumbers = {
    discountPct:
      input.discountRate != null ? Math.round(input.discountRate * 100) : null,
    percentile:
      input.pricePercentile != null
        ? Math.max(0, Math.min(100, Math.round(input.pricePercentile)))
        : null,
  };

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { text, tokensIn, tokensOut } = await callOnce(
        client,
        model,
        userPrompt,
      );
      await config.budget.recordUsage(tokensIn, tokensOut);

      if (!text) {
        return { text: null, tokensIn, tokensOut };
      }

      if (FORBIDDEN.test(text)) {
        return { text: null, tokensIn, tokensOut };
      }

      const clamped = clampCurationText(text, CURATION_MAX_CHARS);
      if (!validateNumberFidelity(clamped, allowed)) {
        return { text: null, tokensIn, tokensOut };
      }

      return { text: clamped, tokensIn, tokensOut };
    } catch (err) {
      lastErr = err;
      if (isRateLimit(err)) break;
      if (attempt === 0) {
        const base = 500;
        const jitter = Math.floor(Math.random() * 250);
        await sleep(base + jitter);
        continue;
      }
      break;
    }
  }

  if (lastErr) {
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    console.warn(`[curator] give up: ${msg}`);
  }
  return { text: null, tokensIn: 0, tokensOut: 0 };
}
