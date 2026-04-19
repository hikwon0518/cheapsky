/**
 * Claude Haiku 4.5 파싱 폴백 (Stretch 2, ADR-005).
 *
 * 역할:
 *   - 규칙 파서가 필수 필드(origin/destination/priceKrw) 하나라도 못 채운 RawPost
 *     만 caller 가 이 함수로 재시도.
 *   - 모델 고정: `claude-haiku-4-5-20251001` (CLAUDE.md 기술 스택). opus/sonnet 금지.
 *   - 입력 범위: 제목 + 본문 앞 500자만 prompt 에 포함 (ADR-005 / ADR-008 교차).
 *   - Tool use 로 JSON 필드 강제 추출.
 *   - 재시도: 1회 지수 백오프 (500ms + 50% 지터), 2회째 실패 skip, 429 즉시 중단.
 *   - 실패 시 예외 대신 빈 필드 DealDraft 반환 (fail-soft, 규칙 파서와 동일 계약).
 *   - budget.canSpend() 체크는 caller (scripts/crawl.ts) 책임이지만 방어적으로
 *     재확인하여 false 면 즉시 skip.
 */
import type Anthropic from '@anthropic-ai/sdk';

import type {
  CarrierClass,
  DealDraft,
  RawPost,
  TripType,
} from '@/types/deal';
import type { BudgetTracker } from '@/lib/llm-budget';
import { classOf } from '@/lib/airlines';

/** ADR-005 / ADR-008: LLM 에 보낼 본문 최대 길이 (제목 제외). */
export const LLM_BODY_CHAR_LIMIT = 500;

/** CLAUDE.md 기술 스택 고정. 다른 모델 사용 금지. */
export const LLM_MODEL = 'claude-haiku-4-5-20251001';

/** 토큰 상한 — 파싱은 짧은 JSON 만 반환하면 됨. */
const MAX_TOKENS = 256;

const TOOL_NAME = 'record_deal_fields';

const TOOL_INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    origin: {
      type: ['string', 'null'],
      description: '출발 공항 IATA 3-letter. 인천 출발이면 "ICN". 모르면 null.',
    },
    destination: {
      type: ['string', 'null'],
      description: '도착 공항 IATA 3-letter. 모르면 null.',
    },
    priceKrw: {
      type: ['integer', 'null'],
      description: '가격 원화 정수. "29만" → 290000. 모르면 null.',
    },
    tripType: {
      type: ['string', 'null'],
      enum: ['oneway', 'roundtrip', null],
      description: '편도/왕복. "편도" 키워드 있으면 oneway, 아니면 roundtrip.',
    },
    departFrom: {
      type: ['string', 'null'],
      description: '출발 가능 시작일 YYYY-MM-DD. 월만 있으면 월 1일. 모르면 null.',
    },
    departTo: {
      type: ['string', 'null'],
      description: '출발 가능 종료일 YYYY-MM-DD. 월만 있으면 월 말일. 모르면 null.',
    },
    carrierCode: {
      type: ['string', 'null'],
      description: '항공사 IATA 2-letter 코드 (예: KE, OZ, LJ, 7C). 모르면 null.',
    },
  },
  required: [
    'origin',
    'destination',
    'priceKrw',
    'tripType',
    'departFrom',
    'departTo',
    'carrierCode',
  ],
} as const;

const SYSTEM_PROMPT =
  '당신은 한국어 항공권 딜 게시글에서 구조화된 필드를 추출하는 파서입니다. ' +
  '오직 제공된 텍스트(제목+본문)에 명시된 정보만 사용하세요. ' +
  '외부 지식·계절·이벤트·공항 별명 추론을 금지합니다. ' +
  '확실하지 않으면 해당 필드는 null. ' +
  '반드시 record_deal_fields 툴을 1회 호출해 결과를 반환하세요.';

export type LlmConfig = {
  apiKey: string;
  model?: string;
  budget: BudgetTracker;
  /** 테스트 주입용 — 실제 API 를 쓰지 않는 mock client. */
  client?: Anthropic;
};

export type ExtractedFields = {
  origin: string | null;
  destination: string | null;
  priceKrw: number | null;
  tripType: TripType | null;
  departFrom: string | null;
  departTo: string | null;
  carrierCode: string | null;
};

/**
 * 제목 + 본문 앞 500자. 본문 전문 전송 방지 (ADR-008).
 */
export function buildUserPrompt(post: RawPost): string {
  const title = (post.title ?? '').trim();
  const body = (post.body ?? '').slice(0, LLM_BODY_CHAR_LIMIT);
  return `제목: ${title}\n\n본문(최대 500자):\n${body}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimit(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { status?: number; name?: string };
  return e.status === 429 || e.name === 'RateLimitError';
}

function emptyDraft(post: RawPost): DealDraft {
  return {
    source: post.source,
    sourceId: post.sourceId,
    sourceUrl: post.sourceUrl,
    title: post.title,
    origin: null,
    destination: null,
    tripType: null,
    departFrom: null,
    departTo: null,
    returnFrom: null,
    returnTo: null,
    priceKrw: null,
    carrierCode: null,
    carrierClass: 'mixed',
    postedAt: post.postedAt,
    parsedBy: 'llm',
  };
}

function parseIsoDate(value: string | null): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
    return null;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, mo - 1, d));
}

function normalizeFields(
  raw: unknown,
): ExtractedFields {
  const fallback: ExtractedFields = {
    origin: null,
    destination: null,
    priceKrw: null,
    tripType: null,
    departFrom: null,
    departTo: null,
    carrierCode: null,
  };
  if (typeof raw !== 'object' || raw === null) return fallback;
  const r = raw as Record<string, unknown>;

  const pickStr = (v: unknown): string | null =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
  const pickNum = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
    if (typeof v === 'string') {
      const n = Number(v.replace(/,/g, ''));
      return Number.isFinite(n) ? Math.round(n) : null;
    }
    return null;
  };
  const tripVal = pickStr(r.tripType);
  const tripType: TripType | null =
    tripVal === 'oneway' || tripVal === 'roundtrip' ? tripVal : null;

  const origin = pickStr(r.origin);
  const destination = pickStr(r.destination);
  const carrier = pickStr(r.carrierCode);

  return {
    origin: origin ? origin.toUpperCase() : null,
    destination: destination ? destination.toUpperCase() : null,
    priceKrw: pickNum(r.priceKrw),
    tripType,
    departFrom: pickStr(r.departFrom),
    departTo: pickStr(r.departTo),
    carrierCode: carrier ? carrier.toUpperCase() : null,
  };
}

/**
 * Anthropic messages API 1회 호출.
 * 반환: { fields, tokensIn, tokensOut }. 실패 시 throw.
 * 429 도 throw — caller 가 isRateLimit 로 식별해 즉시 중단.
 */
async function callOnce(
  client: Anthropic,
  model: string,
  userPrompt: string,
): Promise<{ fields: ExtractedFields; tokensIn: number; tokensOut: number }> {
  const resp = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: TOOL_NAME,
        description: '추출된 항공권 딜 필드를 기록합니다.',
        // SDK 의 input_schema 는 넓은 JSONSchema 타입. 우리 `as const` 스키마를
        // 구조적으로 그대로 받지 못해 `unknown` 경유로 단언.
        input_schema: TOOL_INPUT_SCHEMA as unknown as Record<string, unknown>,
      },
    ] as unknown as Parameters<Anthropic['messages']['create']>[0]['tools'],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: userPrompt }],
  });

  const usage = resp.usage ?? { input_tokens: 0, output_tokens: 0 };

  const toolBlock = resp.content.find(
    (b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use',
  );
  const fields = normalizeFields(toolBlock?.input ?? null);
  return {
    fields,
    tokensIn: Number(usage.input_tokens ?? 0),
    tokensOut: Number(usage.output_tokens ?? 0),
  };
}

/**
 * 파싱 폴백 entry.
 * - budget 초과 시 즉시 빈 draft 반환
 * - 429 감지 시 즉시 중단 (빈 draft 반환)
 * - 그 외 에러는 1회 지수 백오프 재시도 후 빈 draft 반환
 */
export async function parseLlm(
  post: RawPost,
  config: LlmConfig,
): Promise<DealDraft> {
  if (!(await config.budget.canSpend())) {
    return emptyDraft(post);
  }

  const model = config.model ?? LLM_MODEL;
  const userPrompt = buildUserPrompt(post);

  // Defensive: 본문 500자 초과 확인.
  const bodyPortion = (post.body ?? '').slice(0, LLM_BODY_CHAR_LIMIT);
  if ((post.body ?? '').length > LLM_BODY_CHAR_LIMIT) {
    // 길이 초과분은 userPrompt 생성 시 이미 cut. 이 경로는 관측용.
    void bodyPortion;
  }

  let client: Anthropic | undefined = config.client;
  if (!client) {
    // Dynamic import 로 Core 빌드에 Anthropic SDK 정적 import 유출 방지.
    const mod = await import('@anthropic-ai/sdk');
    const Ctor = mod.default;
    client = new Ctor({ apiKey: config.apiKey });
  }

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { fields, tokensIn, tokensOut } = await callOnce(
        client,
        model,
        userPrompt,
      );
      await config.budget.recordUsage(tokensIn, tokensOut);

      const carrierCode = fields.carrierCode;
      const carrierClass: CarrierClass = carrierCode
        ? classOf(carrierCode)
        : 'mixed';

      return {
        source: post.source,
        sourceId: post.sourceId,
        sourceUrl: post.sourceUrl,
        title: post.title,
        origin: fields.origin,
        destination: fields.destination,
        tripType: fields.tripType,
        departFrom: parseIsoDate(fields.departFrom),
        departTo: parseIsoDate(fields.departTo),
        returnFrom: null,
        returnTo: null,
        priceKrw: fields.priceKrw,
        carrierCode,
        carrierClass,
        postedAt: post.postedAt,
        parsedBy: 'llm',
      };
    } catch (err) {
      lastErr = err;
      if (isRateLimit(err)) {
        // 429 즉시 중단 (ADR-005).
        break;
      }
      if (attempt === 0) {
        const base = 500;
        const jitter = Math.floor(Math.random() * 250);
        await sleep(base + jitter);
        continue;
      }
      break;
    }
  }

  // 최종 실패 → 빈 draft. caller 가 로깅. stderr 1줄만 남김 (운영 디버깅).
  if (lastErr) {
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    console.warn(`[parser/llm] give up: ${msg}`);
  }
  return emptyDraft(post);
}
