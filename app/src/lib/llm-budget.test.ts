import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  createBudget,
  DEFAULT_BUDGET_CALLS,
  ESTIMATED_TOKENS_PER_CALL,
} from '@/lib/llm-budget';

const FIXED_NOW = new Date('2026-04-19T00:30:00Z'); // KST = 2026-04-19 09:30
const KST_DATE_KEY = '2026-04-19';

type Row = {
  date: string;
  anthropic_tokens_in: number;
  anthropic_tokens_out: number;
};

/**
 * Minimal Supabase client stub that stores one api_usage_daily row per date
 * in memory. Supports .from('api_usage_daily').select().eq().maybeSingle()
 * and .upsert({...}, { onConflict: 'date' }).
 */
function makeFakeClient(initial: Record<string, Row> = {}) {
  const rows = new Map<string, Row>(Object.entries(initial));
  let upsertCalls = 0;
  let selectCalls = 0;

  const client = {
    from(table: string): unknown {
      if (table !== 'api_usage_daily') {
        throw new Error(`unexpected table: ${table}`);
      }
      return {
        select() {
          return {
            eq(_col: string, value: string) {
              return {
                async maybeSingle() {
                  selectCalls++;
                  const r = rows.get(value) ?? null;
                  return { data: r, error: null };
                },
              };
            },
          };
        },
        async upsert(payload: Row, _opts: { onConflict: string }) {
          upsertCalls++;
          rows.set(payload.date, { ...payload });
          return { error: null };
        },
      };
    },
  };

  return {
    client: client as unknown as SupabaseClient,
    rows,
    stats: {
      get upserts() {
        return upsertCalls;
      },
      get selects() {
        return selectCalls;
      },
    },
  };
}

describe('createBudget', () => {
  it('env 미설정 시 DEFAULT_BUDGET_CALLS 사용', async () => {
    const prev = process.env.LLM_DAILY_BUDGET;
    delete process.env.LLM_DAILY_BUDGET;
    try {
      const { client } = makeFakeClient();
      const budget = createBudget(client, { now: FIXED_NOW });
      expect(await budget.remaining()).toBe(DEFAULT_BUDGET_CALLS);
    } finally {
      if (prev !== undefined) process.env.LLM_DAILY_BUDGET = prev;
    }
  });

  it('LLM_DAILY_BUDGET env 적용', async () => {
    const prev = process.env.LLM_DAILY_BUDGET;
    process.env.LLM_DAILY_BUDGET = '5';
    try {
      const { client } = makeFakeClient();
      const budget = createBudget(client, { now: FIXED_NOW });
      expect(await budget.remaining()).toBe(5);
      expect(await budget.canSpend()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.LLM_DAILY_BUDGET;
      else process.env.LLM_DAILY_BUDGET = prev;
    }
  });

  it('recordUsage 시 api_usage_daily 에 토큰 UPSERT, 세션 카운터 증가', async () => {
    const { client, rows, stats } = makeFakeClient();
    const budget = createBudget(client, {
      dailyBudgetCalls: 3,
      now: FIXED_NOW,
    });

    await budget.recordUsage(500, 100);
    await budget.recordUsage(400, 80);

    const row = rows.get(KST_DATE_KEY);
    expect(row).toBeDefined();
    expect(row!.anthropic_tokens_in).toBe(900); // 500 + 400 가산
    expect(row!.anthropic_tokens_out).toBe(180); // 100 + 80 가산
    expect(stats.upserts).toBe(2);
  });

  it('예산 경계값: 사용 < budget 이면 canSpend true, ≥ budget 이면 false', async () => {
    const { client } = makeFakeClient();
    const budget = createBudget(client, {
      dailyBudgetCalls: 2,
      now: FIXED_NOW,
    });

    expect(await budget.canSpend()).toBe(true);
    expect(await budget.remaining()).toBe(2);

    await budget.recordUsage(500, 100);
    expect(await budget.canSpend()).toBe(true);
    expect(await budget.remaining()).toBe(1);

    await budget.recordUsage(500, 100);
    // 2회째 호출 후 세션 카운터 == 2 == budget → 더 쓸 수 없음.
    expect(await budget.canSpend()).toBe(false);
    expect(await budget.remaining()).toBe(0);
  });

  it('오늘 DB 토큰이 이미 budget 초과 수준이면 canSpend false (cross-cron)', async () => {
    // 사전 조건: 오늘 이미 anthropic_tokens_in 이 budget × EST 이상 누적되어 있음.
    const priorTokens = 3 * ESTIMATED_TOKENS_PER_CALL;
    const { client } = makeFakeClient({
      [KST_DATE_KEY]: {
        date: KST_DATE_KEY,
        anthropic_tokens_in: priorTokens,
        anthropic_tokens_out: 0,
      },
    });
    const budget = createBudget(client, {
      dailyBudgetCalls: 3,
      now: FIXED_NOW,
    });
    expect(await budget.canSpend()).toBe(false);
    expect(await budget.remaining()).toBe(0);
  });

  it('다른 날짜 행은 참조하지 않음 (KST 일자 키)', async () => {
    const { client } = makeFakeClient({
      '2026-04-18': {
        date: '2026-04-18',
        anthropic_tokens_in: 999_999,
        anthropic_tokens_out: 0,
      },
    });
    const budget = createBudget(client, {
      dailyBudgetCalls: 5,
      now: FIXED_NOW, // KST 2026-04-19
    });
    expect(await budget.canSpend()).toBe(true);
    expect(await budget.remaining()).toBe(5);
  });
});
