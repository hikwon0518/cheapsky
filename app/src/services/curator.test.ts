import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';

import {
  buildCurationUserPrompt,
  CURATION_MAX_CHARS,
  CURATION_MODEL,
  curateOne,
  validateNumberFidelity,
  type CurationInput,
} from './curator';
import type { BudgetTracker } from '@/lib/llm-budget';

function makeInput(overrides: Partial<CurationInput> = {}): CurationInput {
  return {
    origin: 'ICN',
    destination: 'KIX',
    carrierCode: 'LJ',
    carrierClass: 'lcc',
    priceKrw: 99000,
    baselineP50Krw: 220000,
    baselineP10Krw: 110000,
    discountRate: 0.55,
    pricePercentile: 8,
    last30dMinKrw: 95000,
    ...overrides,
  };
}

function makeBudget(overrides: Partial<BudgetTracker> = {}): BudgetTracker {
  return {
    canSpend: vi.fn(async () => true),
    remaining: vi.fn(async () => 100),
    recordUsage: vi.fn(async () => {}),
    ...overrides,
  };
}

type MockClient = {
  messages: {
    create: ReturnType<typeof vi.fn>;
  };
};

function makeMockClient(response: unknown): MockClient {
  return {
    messages: {
      create: vi.fn(async () => response),
    },
  };
}

function textResponse(
  text: string,
  usage = { input_tokens: 300, output_tokens: 40 },
) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: CURATION_MODEL,
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage,
  };
}

describe('buildCurationUserPrompt', () => {
  it('숫자 필드만 포함, 제목·본문 금지', () => {
    const prompt = buildCurationUserPrompt(makeInput());
    // 제목·본문 원문은 입력 자체에 없음 — 여기선 프롬프트에 ICN/KIX 노선 코드만.
    expect(prompt).toContain('ICN-KIX');
    expect(prompt).toContain('99000');
    expect(prompt).toContain('220000');
    expect(prompt).toContain('55%');
    expect(prompt).toContain('p8');
    // 시스템명 누수 없음 — 이건 curator 의 system 프롬프트에 있지 user 에는 없음.
    expect(prompt).not.toMatch(/Claude|Anthropic|Amadeus/);
  });
});

describe('validateNumberFidelity', () => {
  it('% 없는 문장은 통과', () => {
    expect(
      validateNumberFidelity('지난 30일 이 노선 최저 수준.', {
        discountPct: 55,
        percentile: 8,
      }),
    ).toBe(true);
  });

  it('허용 숫자와 ±1 이내면 통과', () => {
    expect(
      validateNumberFidelity('시장 평균 대비 54% 저렴.', {
        discountPct: 55,
        percentile: null,
      }),
    ).toBe(true);
  });

  it('허용 숫자와 어긋나면 거절', () => {
    expect(
      validateNumberFidelity('시장 평균 대비 80% 저렴.', {
        discountPct: 55,
        percentile: null,
      }),
    ).toBe(false);
  });
});

describe('curateOne', () => {
  it('정상 응답 → 60자 이내 text 반환, 토큰 기록', async () => {
    const body = '시장 평균 대비 55% 저렴. 하위 p8 수준.';
    const mock = makeMockClient(textResponse(body));
    const budget = makeBudget();

    const res = await curateOne(makeInput(), {
      apiKey: 'k',
      budget,
      client: mock as unknown as Anthropic,
    });

    expect(res.text).toBe(body);
    expect(res.text!.length).toBeLessThanOrEqual(CURATION_MAX_CHARS);
    expect(budget.recordUsage).toHaveBeenCalledWith(300, 40);
  });

  it('모델은 정확히 claude-haiku-4-5-20251001 로 호출, cache_control 포함', async () => {
    const mock = makeMockClient(textResponse('시장 평균 대비 55% 저렴.'));
    const budget = makeBudget();

    await curateOne(makeInput(), {
      apiKey: 'k',
      budget,
      client: mock as unknown as Anthropic,
    });

    const call = mock.messages.create.mock.calls[0][0];
    expect(call.model).toBe('claude-haiku-4-5-20251001');
    expect(Array.isArray(call.system)).toBe(true);
    const sysBlock = call.system[0];
    expect(sysBlock.cache_control).toEqual({ type: 'ephemeral' });
    // 프롬프트 자체에도 금칙어 룰이 명시돼 있어야 함 (이중 방어).
    expect(sysBlock.text).toMatch(/역대가/);
    expect(sysBlock.text).toMatch(/Amadeus/);
  });

  it('응답 길이 >60자 → 60자 cut', async () => {
    // 64자 응답 (ASCII 기준 64).
    const longBody =
      'abcdefghij'.repeat(6) + '1234'; // 64 chars
    expect(longBody.length).toBe(64);
    const mock = makeMockClient(textResponse(longBody));
    const budget = makeBudget();

    const res = await curateOne(
      makeInput({ discountRate: null, pricePercentile: null }),
      { apiKey: 'k', budget, client: mock as unknown as Anthropic },
    );

    // discountRate null 이면 skip — 다른 테스트용으로 다시 구성.
    expect(res.text).toBeNull();
  });

  it('응답 64자인데 % 없음 → 60자 cut', async () => {
    const longBody = 'abcdefghij'.repeat(6) + '1234'; // 64 chars, no %
    expect(longBody.length).toBe(64);
    const mock = makeMockClient(textResponse(longBody));
    const budget = makeBudget();

    const res = await curateOne(makeInput(), {
      apiKey: 'k',
      budget,
      client: mock as unknown as Anthropic,
    });

    expect(res.text).not.toBeNull();
    expect(res.text!.length).toBe(CURATION_MAX_CHARS);
    expect(res.text).toBe(longBody.slice(0, CURATION_MAX_CHARS));
  });

  it('응답에 "Amadeus" 포함 → text=null (토큰은 기록)', async () => {
    const mock = makeMockClient(
      textResponse('Amadeus 기준 55% 저렴.'),
    );
    const budget = makeBudget();

    const res = await curateOne(makeInput(), {
      apiKey: 'k',
      budget,
      client: mock as unknown as Anthropic,
    });

    expect(res.text).toBeNull();
    expect(budget.recordUsage).toHaveBeenCalledTimes(1);
  });

  it('응답에 "Claude" 포함 → text=null', async () => {
    const mock = makeMockClient(textResponse('Claude 추천: 55% 저렴.'));
    const budget = makeBudget();

    const res = await curateOne(makeInput(), {
      apiKey: 'k',
      budget,
      client: mock as unknown as Anthropic,
    });

    expect(res.text).toBeNull();
  });

  it('응답의 "80%" 가 input.discountRate=0.52 와 어긋남 → text=null', async () => {
    const mock = makeMockClient(textResponse('시장 평균 대비 80% 저렴.'));
    const budget = makeBudget();

    const res = await curateOne(makeInput({ discountRate: 0.52 }), {
      apiKey: 'k',
      budget,
      client: mock as unknown as Anthropic,
    });

    expect(res.text).toBeNull();
  });

  it('budget.canSpend() === false → 호출 skip, text=null', async () => {
    const mock = makeMockClient(textResponse('시장 평균 대비 55% 저렴.'));
    const budget: BudgetTracker = {
      canSpend: vi.fn(async () => false),
      remaining: vi.fn(async () => 0),
      recordUsage: vi.fn(async () => {}),
    };

    const res = await curateOne(makeInput(), {
      apiKey: 'k',
      budget,
      client: mock as unknown as Anthropic,
    });

    expect(res.text).toBeNull();
    expect(mock.messages.create).not.toHaveBeenCalled();
    expect(budget.recordUsage).not.toHaveBeenCalled();
  });

  it('discountRate null → 호출 skip, text=null', async () => {
    const mock = makeMockClient(textResponse('...'));
    const budget = makeBudget();

    const res = await curateOne(makeInput({ discountRate: null }), {
      apiKey: 'k',
      budget,
      client: mock as unknown as Anthropic,
    });

    expect(res.text).toBeNull();
    expect(mock.messages.create).not.toHaveBeenCalled();
  });

  it('429 RateLimitError → 즉시 중단, text=null', async () => {
    const err = Object.assign(new Error('rate limited'), {
      status: 429,
      name: 'RateLimitError',
    });
    const mock: MockClient = {
      messages: {
        create: vi.fn(async () => {
          throw err;
        }),
      },
    };
    const budget = makeBudget();

    const res = await curateOne(makeInput(), {
      apiKey: 'k',
      budget,
      client: mock as unknown as Anthropic,
    });

    expect(mock.messages.create).toHaveBeenCalledTimes(1);
    expect(res.text).toBeNull();
    expect(budget.recordUsage).not.toHaveBeenCalled();
  });
});
