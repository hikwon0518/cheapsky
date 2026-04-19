import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';

import { buildUserPrompt, LLM_MODEL, parseLlm } from './llm';
import type { BudgetTracker } from '@/lib/llm-budget';
import type { RawPost } from '@/types/deal';

const FIXED_NOW = new Date('2026-04-19T00:00:00Z');

function makePost(overrides: Partial<RawPost> = {}): RawPost {
  return {
    source: 'ppomppu',
    sourceId: 't1',
    sourceUrl: 'https://www.ppomppu.co.kr/zboard/view.php?id=foo&no=1',
    title: '도쿄 왕복 29만',
    body: '대한항공 직항 5월 출발',
    postedAt: FIXED_NOW,
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

function toolUseResponse(input: Record<string, unknown>, usage = { input_tokens: 450, output_tokens: 85 }) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: LLM_MODEL,
    content: [
      {
        type: 'tool_use',
        id: 'toolu_test',
        name: 'record_deal_fields',
        input,
      },
    ],
    stop_reason: 'tool_use',
    usage,
  };
}

describe('buildUserPrompt', () => {
  it('본문 500자 초과 시 500자로 cut', () => {
    const body = 'x'.repeat(2000);
    const post = makePost({ body });
    const prompt = buildUserPrompt(post);
    // 제목 + 개행 + '본문(최대 500자):\n' 프리픽스 + 500자
    const bodyPortion = prompt.split('본문(최대 500자):\n')[1] ?? '';
    expect(bodyPortion.length).toBe(500);
    // 전체 프롬프트는 원본 body 전문(2000자)보다 훨씬 짧아야 한다.
    expect(prompt.length).toBeLessThan(body.length);
  });

  it('제목은 그대로, 본문만 500자 제한', () => {
    const title = '도쿄 왕복 99000원 대한항공';
    const body = 'a'.repeat(100);
    const prompt = buildUserPrompt(makePost({ title, body }));
    expect(prompt).toContain(title);
    expect(prompt).toContain('a'.repeat(100));
  });
});

describe('parseLlm', () => {
  it('정상 응답 → DealDraft(parsedBy=llm) 반환', async () => {
    const mock = makeMockClient(
      toolUseResponse({
        origin: 'ICN',
        destination: 'NRT',
        priceKrw: 290000,
        tripType: 'roundtrip',
        departFrom: '2026-05-01',
        departTo: '2026-05-31',
        carrierCode: 'KE',
      }),
    );
    const budget = makeBudget();

    const draft = await parseLlm(makePost(), {
      apiKey: 'test-key',
      budget,
      client: mock as unknown as Anthropic,
    });

    expect(draft.parsedBy).toBe('llm');
    expect(draft.origin).toBe('ICN');
    expect(draft.destination).toBe('NRT');
    expect(draft.priceKrw).toBe(290000);
    expect(draft.tripType).toBe('roundtrip');
    expect(draft.carrierCode).toBe('KE');
    expect(draft.carrierClass).toBe('fsc');
    expect(draft.departFrom).toEqual(new Date(Date.UTC(2026, 4, 1)));
    expect(draft.departTo).toEqual(new Date(Date.UTC(2026, 4, 31)));

    expect(budget.recordUsage).toHaveBeenCalledWith(450, 85);
  });

  it('모델은 정확히 claude-haiku-4-5-20251001 로 호출됨', async () => {
    const mock = makeMockClient(
      toolUseResponse({
        origin: 'ICN',
        destination: 'KIX',
        priceKrw: 150000,
        tripType: 'roundtrip',
        departFrom: null,
        departTo: null,
        carrierCode: null,
      }),
    );
    const budget = makeBudget();

    await parseLlm(makePost(), {
      apiKey: 'k',
      budget,
      client: mock as unknown as Anthropic,
    });

    expect(mock.messages.create).toHaveBeenCalledTimes(1);
    const call = mock.messages.create.mock.calls[0][0];
    expect(call.model).toBe('claude-haiku-4-5-20251001');
  });

  it('prompt 에 본문이 500자로 cut 되어 전송됨', async () => {
    const mock = makeMockClient(
      toolUseResponse({
        origin: null,
        destination: null,
        priceKrw: null,
        tripType: null,
        departFrom: null,
        departTo: null,
        carrierCode: null,
      }),
    );
    const budget = makeBudget();

    const longBody = 'Z'.repeat(2000);
    await parseLlm(makePost({ body: longBody }), {
      apiKey: 'k',
      budget,
      client: mock as unknown as Anthropic,
    });

    const sentMessages = mock.messages.create.mock.calls[0][0].messages;
    const userContent = sentMessages[0].content as string;
    // 2000자 원본이 아닌, 500자 cut 된 버전만 들어가야 함.
    const zCount = (userContent.match(/Z/g) ?? []).length;
    expect(zCount).toBe(500);
    expect(zCount).toBeLessThan(2000);
  });

  it('429 RateLimitError 는 즉시 중단 (재시도 없음) → 빈 draft', async () => {
    const err: Error & { status?: number; name: string } = Object.assign(
      new Error('rate limited'),
      { status: 429, name: 'RateLimitError' },
    );
    const mock: MockClient = {
      messages: {
        create: vi.fn(async () => {
          throw err;
        }),
      },
    };
    const budget = makeBudget();

    const draft = await parseLlm(makePost(), {
      apiKey: 'k',
      budget,
      client: mock as unknown as Anthropic,
    });

    expect(mock.messages.create).toHaveBeenCalledTimes(1);
    expect(draft.origin).toBeNull();
    expect(draft.destination).toBeNull();
    expect(draft.priceKrw).toBeNull();
    expect(draft.parsedBy).toBe('llm');
    expect(budget.recordUsage).not.toHaveBeenCalled();
  });

  it('일시 에러 1회 → 지수 백오프 후 재시도, 그 다음 성공', async () => {
    let call = 0;
    const mock: MockClient = {
      messages: {
        create: vi.fn(async () => {
          call++;
          if (call === 1) {
            throw Object.assign(new Error('server'), { status: 500 });
          }
          return toolUseResponse({
            origin: 'ICN',
            destination: 'BKK',
            priceKrw: 350000,
            tripType: 'roundtrip',
            departFrom: null,
            departTo: null,
            carrierCode: 'TG',
          });
        }),
      },
    };
    const budget = makeBudget();

    const draft = await parseLlm(makePost(), {
      apiKey: 'k',
      budget,
      client: mock as unknown as Anthropic,
    });

    expect(mock.messages.create).toHaveBeenCalledTimes(2);
    expect(draft.destination).toBe('BKK');
    expect(draft.priceKrw).toBe(350000);
  });

  it('2회 연속 실패 → 빈 draft 반환, throw 없음', async () => {
    const mock: MockClient = {
      messages: {
        create: vi.fn(async () => {
          throw Object.assign(new Error('server'), { status: 500 });
        }),
      },
    };
    const budget = makeBudget();

    const draft = await parseLlm(makePost(), {
      apiKey: 'k',
      budget,
      client: mock as unknown as Anthropic,
    });

    expect(mock.messages.create).toHaveBeenCalledTimes(2);
    expect(draft.origin).toBeNull();
    expect(draft.destination).toBeNull();
    expect(draft.priceKrw).toBeNull();
    expect(budget.recordUsage).not.toHaveBeenCalled();
  });

  it('budget.canSpend() === false 면 API 호출 자체를 skip', async () => {
    const mock = makeMockClient(null);
    const budget: BudgetTracker = {
      canSpend: vi.fn(async () => false),
      remaining: vi.fn(async () => 0),
      recordUsage: vi.fn(async () => {}),
    };

    const draft = await parseLlm(makePost(), {
      apiKey: 'k',
      budget,
      client: mock as unknown as Anthropic,
    });

    expect(mock.messages.create).not.toHaveBeenCalled();
    expect(budget.recordUsage).not.toHaveBeenCalled();
    expect(draft.parsedBy).toBe('llm');
    expect(draft.origin).toBeNull();
  });

  it('응답에 tool_use block 없으면 빈 필드(parsedBy=llm) 로 반환', async () => {
    const mock = makeMockClient({
      content: [{ type: 'text', text: '...' }],
      usage: { input_tokens: 300, output_tokens: 10 },
    });
    const budget = makeBudget();

    const draft = await parseLlm(makePost(), {
      apiKey: 'k',
      budget,
      client: mock as unknown as Anthropic,
    });

    expect(draft.origin).toBeNull();
    expect(draft.destination).toBeNull();
    expect(draft.priceKrw).toBeNull();
    // 응답은 받았으므로 토큰은 기록.
    expect(budget.recordUsage).toHaveBeenCalledWith(300, 10);
  });
});
