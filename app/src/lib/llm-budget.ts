/**
 * LLM budget tracker (ADR-005 Stretch 2 — 파싱 폴백 일 300회 상한).
 *
 * 역할:
 *   - `api_usage_daily.anthropic_tokens_{in,out}` 에 토큰 누적 UPSERT (KST 일자 키)
 *   - 세션 내 호출 횟수 + 기존 누적 토큰(환산) 기준으로 `canSpend()` 게이트
 *
 * 주의:
 *   - 저장 컬럼은 토큰. 예산 단위는 "호출 수" (`LLM_DAILY_BUDGET`, 기본 300).
 *   - 호출 횟수 컬럼이 없으므로 시작 시 DB 에 기록된 `anthropic_tokens_in` 을
 *     `ESTIMATED_TOKENS_PER_CALL` 로 나눠 기존 호출 수를 보수적으로 추정한다.
 *     (cron 여러 번 돌아도 하루 300회 상한이 대충 지켜지도록.)
 *   - 사용자가 `recordUsage` 를 부르면 세션 카운터를 +1 하고 DB 에 토큰 가산.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { toKstDateOnly } from '@/lib/tz';

export const DEFAULT_BUDGET_CALLS = 300;

/**
 * 파싱 폴백 1회 평균 토큰 (시스템 + user + 응답 JSON 추정).
 * 보수적으로 낮게 잡아 "이미 한도 찼다" 판정이 쉽게 들도록 설정.
 * 150 토큰/call × 300 calls ≈ 45k tokens/day — 파싱 폴백 실측 하한.
 */
export const ESTIMATED_TOKENS_PER_CALL = 150;

export type BudgetTracker = {
  /** 이 세션에서 아직 예산이 남아 있는가? */
  canSpend(): Promise<boolean>;
  /** 남은 호출 수 (approx). 음수는 0 으로 클램프. */
  remaining(): Promise<number>;
  /** 토큰 사용량 기록 — DB UPSERT + 세션 카운터 +1. */
  recordUsage(tokensIn: number, tokensOut: number): Promise<void>;
};

export type CreateBudgetOptions = {
  /** 하루 호출 한도. 미지정 시 env `LLM_DAILY_BUDGET` 또는 기본 300. */
  dailyBudgetCalls?: number;
  /** 기준 Date (KST 일자 키 산출용). 미지정 시 호출 시점. */
  now?: Date;
};

type UsageRow = {
  date: string;
  anthropic_tokens_in: number;
  anthropic_tokens_out: number;
};

/**
 * Supabase 클라이언트를 주입해 BudgetTracker 를 생성.
 * 세션 동안 `api_usage_daily` 의 오늘 행만 사용 (KST 일자).
 */
export function createBudget(
  client: SupabaseClient,
  options: CreateBudgetOptions = {},
): BudgetTracker {
  const envBudget = Number(process.env.LLM_DAILY_BUDGET);
  const dailyBudget =
    options.dailyBudgetCalls ??
    (Number.isFinite(envBudget) && envBudget > 0
      ? envBudget
      : DEFAULT_BUDGET_CALLS);

  let sessionCalls = 0;
  let seededPriorCalls: number | null = null;

  const dateKey = () => toKstDateOnly(options.now ?? new Date());

  async function fetchTodayUsage(): Promise<UsageRow> {
    const res = await client
      .from('api_usage_daily')
      .select('date, anthropic_tokens_in, anthropic_tokens_out')
      .eq('date', dateKey())
      .maybeSingle();
    if (res.error) {
      throw new Error(`api_usage_daily select: ${res.error.message}`);
    }
    const row = (res.data ?? null) as UsageRow | null;
    return (
      row ?? {
        date: dateKey(),
        anthropic_tokens_in: 0,
        anthropic_tokens_out: 0,
      }
    );
  }

  async function seedPriorCallsOnce(): Promise<number> {
    if (seededPriorCalls != null) return seededPriorCalls;
    const row = await fetchTodayUsage();
    const tokensIn = Number(row.anthropic_tokens_in ?? 0);
    seededPriorCalls = Math.ceil(
      Math.max(0, tokensIn) / ESTIMATED_TOKENS_PER_CALL,
    );
    return seededPriorCalls;
  }

  async function callsUsed(): Promise<number> {
    const prior = await seedPriorCallsOnce();
    return prior + sessionCalls;
  }

  return {
    async canSpend(): Promise<boolean> {
      const used = await callsUsed();
      return used < dailyBudget;
    },

    async remaining(): Promise<number> {
      const used = await callsUsed();
      return Math.max(0, dailyBudget - used);
    },

    async recordUsage(tokensIn: number, tokensOut: number): Promise<void> {
      const prev = await fetchTodayUsage();
      const nextIn = Number(prev.anthropic_tokens_in ?? 0) + Math.max(0, tokensIn);
      const nextOut =
        Number(prev.anthropic_tokens_out ?? 0) + Math.max(0, tokensOut);

      const up = await client
        .from('api_usage_daily')
        .upsert(
          {
            date: dateKey(),
            anthropic_tokens_in: nextIn,
            anthropic_tokens_out: nextOut,
          },
          { onConflict: 'date' },
        );
      if (up.error) {
        throw new Error(`api_usage_daily upsert: ${up.error.message}`);
      }
      sessionCalls += 1;
    },
  };
}
