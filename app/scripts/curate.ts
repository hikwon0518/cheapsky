/**
 * Cheapsky curate pipeline (Stretch 2 — ADR-005 카드 한 줄 큐레이션).
 *
 * 실행 (Stretch gate 필수):
 *   export CHEAPSKY_STAGE=stretch
 *   pnpm tsx scripts/curate.ts
 *
 * 흐름 (ARCHITECTURE "데이터 흐름 (4) 큐레이션"):
 *   1. crawler_runs INSERT (source='curator')
 *   2. 후보 딜 SELECT — hot_deal=true AND
 *       (curation_text IS NULL OR curation_generated_at < now()-24h)
 *       AND expires_at > now(), LIMIT 50 (시간당 50회 상한 ADR-005).
 *   3. 각 딜마다 route_market_data 의 해당 carrier_class p50/p10 + 최근 30일
 *      price_observations 최저가를 곁들인 CurationInput 으로 curateOne 호출.
 *   4. 예산/환각/금칙어 통과한 text 만 deals.curation_text UPDATE.
 *   5. api_usage_daily 의 anthropic_tokens_{in,out} 은 BudgetTracker 가 UPSERT.
 *   6. crawler_runs finalize.
 *
 * Hard red lines:
 *   - CHEAPSKY_STAGE != 'stretch' → stage gate 로 즉시 종료 + crawler_runs.errors 에 사유 기록.
 *   - Haiku 4.5 외 모델 사용 금지 (services/curator 가 고정).
 *   - 제목·본문 LLM 전송 금지 (curator 가 정제 숫자 필드만 전송).
 *   - 환각 검증·금칙어 검증은 curator.curateOne 에서 수행. 여기선 결과 text 만 UPDATE.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { createBudget } from '@/lib/llm-budget';
import { curateOne, type CurationInput } from '@/services/curator';
import type { CarrierClass } from '@/types/deal';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..');
dotenvConfig({ path: resolve(appRoot, '.env.local') });

/** 시간당 50회 상한 (ADR-005). */
const BATCH_SIZE = 50;

/** 24시간 이내 이미 큐레이션된 딜은 재작업 skip. */
const REFRESH_WINDOW_HOURS = 24;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set in .env.local`);
  return v;
}

function isStretchStage(): boolean {
  return (process.env.CHEAPSKY_STAGE ?? '').toLowerCase() === 'stretch';
}

type DealRow = {
  id: string;
  origin: string;
  destination: string;
  carrier_code: string | null;
  carrier_class: CarrierClass;
  price_krw: number;
  baseline_krw: number | null;
  discount_rate: number | string | null;
  price_percentile: number | string | null;
};

function toNum(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * route_market_data 에서 carrier_class 우선, 없으면 mixed 폴백으로 p50/p10 조회.
 * 찾지 못하면 null.
 */
async function loadBaselinePoints(
  client: SupabaseClient,
  origin: string,
  destination: string,
  carrierClass: CarrierClass,
): Promise<{ p50: number | null; p10: number | null }> {
  const keys: CarrierClass[] =
    carrierClass === 'mixed' ? ['mixed'] : [carrierClass, 'mixed'];

  for (const k of keys) {
    const res = await client
      .from('route_market_data')
      .select('p50_krw, p10_krw')
      .eq('origin', origin)
      .eq('destination', destination)
      .eq('carrier_class', k)
      .maybeSingle();
    if (res.error) continue;
    if (res.data) {
      const row = res.data as { p50_krw: number | null; p10_krw: number | null };
      return {
        p50: toNum(row.p50_krw),
        p10: toNum(row.p10_krw),
      };
    }
  }
  return { p50: null, p10: null };
}

/** 최근 30일 이 (origin,destination,carrier_class) 관측치 중 최저 price. */
async function loadLast30dMin(
  client: SupabaseClient,
  origin: string,
  destination: string,
  carrierClass: CarrierClass,
  now: Date,
): Promise<number | null> {
  const windowStart = new Date(
    now.getTime() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const res = await client
    .from('price_observations')
    .select('price_krw')
    .eq('origin', origin)
    .eq('destination', destination)
    .eq('carrier_class', carrierClass)
    .gte('observed_at', windowStart)
    .order('price_krw', { ascending: true })
    .limit(1);
  if (res.error || !res.data || res.data.length === 0) return null;
  const row = res.data[0] as { price_krw: number };
  return toNum(row.price_krw);
}

async function main() {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date();

  // 1) crawler_runs INSERT
  const runIns = await client
    .from('crawler_runs')
    .insert({
      source: 'curator',
      started_at: now.toISOString(),
      processed_count: 0,
      saved_count: 0,
      errors: [],
      success: false,
    })
    .select('id')
    .single();
  if (runIns.error || !runIns.data) {
    console.error('[curate] crawler_runs insert failed:', runIns.error?.message);
    process.exit(1);
  }
  const runId = (runIns.data as { id: number }).id;

  // Stage gate — ADR-005. 비-stretch 면 즉시 종료하고 사유 기록.
  if (!isStretchStage()) {
    const msg =
      'stage gate: CHEAPSKY_STAGE != stretch — curator skipped (ADR-005).';
    console.warn(`[curate] ${msg}`);
    await client
      .from('crawler_runs')
      .update({
        finished_at: new Date().toISOString(),
        processed_count: 0,
        saved_count: 0,
        errors: [msg],
        success: false,
      })
      .eq('id', runId);
    process.exit(0);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const msg =
      'CHEAPSKY_STAGE=stretch 인데 ANTHROPIC_API_KEY 미설정 — curator 비활성.';
    console.warn(`[curate] ${msg}`);
    await client
      .from('crawler_runs')
      .update({
        finished_at: new Date().toISOString(),
        processed_count: 0,
        saved_count: 0,
        errors: [msg],
        success: false,
      })
      .eq('id', runId);
    process.exit(0);
  }

  const budget = createBudget(client, { now });
  console.log(
    `[curate] model=claude-haiku-4-5 remaining≈${await budget.remaining()}`,
  );

  const errors: string[] = [];
  let processed = 0;
  let saved = 0;

  try {
    // 2) 후보 SELECT — hot_deal 이고 최근 24h 내 큐레이션 안 된 행.
    const refreshCutoff = new Date(
      now.getTime() - REFRESH_WINDOW_HOURS * 60 * 60 * 1000,
    ).toISOString();
    const res = await client
      .from('deals')
      .select(
        'id, origin, destination, carrier_code, carrier_class, price_krw, baseline_krw, discount_rate, price_percentile',
      )
      .eq('hot_deal', true)
      .gt('expires_at', now.toISOString())
      .or(
        `curation_text.is.null,curation_generated_at.lt.${refreshCutoff}`,
      )
      .order('discount_rate', { ascending: false, nullsFirst: false })
      .limit(BATCH_SIZE);
    if (res.error) {
      throw new Error(`deals select: ${res.error.message}`);
    }
    const targets = (res.data ?? []) as DealRow[];
    processed = targets.length;
    console.log(`[curate] eligible targets: ${processed}`);

    // 3) loop — 예산 소진 즉시 break.
    for (const d of targets) {
      if (!(await budget.canSpend())) {
        console.log('[curate] budget exhausted — stopping');
        break;
      }

      try {
        const { p50, p10 } = await loadBaselinePoints(
          client,
          d.origin,
          d.destination,
          d.carrier_class,
        );
        const last30dMin = await loadLast30dMin(
          client,
          d.origin,
          d.destination,
          d.carrier_class,
          now,
        );

        const input: CurationInput = {
          origin: d.origin,
          destination: d.destination,
          carrierCode: d.carrier_code,
          carrierClass: d.carrier_class,
          priceKrw: Math.round(d.price_krw),
          baselineP50Krw: p50 ?? toNum(d.baseline_krw),
          baselineP10Krw: p10,
          discountRate: toNum(d.discount_rate),
          pricePercentile: toNum(d.price_percentile),
          last30dMinKrw: last30dMin,
        };

        const result = await curateOne(input, { apiKey, budget });
        if (result.text) {
          const up = await client
            .from('deals')
            .update({
              curation_text: result.text,
              curation_generated_at: new Date().toISOString(),
            })
            .eq('id', d.id);
          if (up.error) {
            throw new Error(`deals update: ${up.error.message}`);
          }
          saved++;
        }
      } catch (err) {
        const msg = `deal ${d.id}: ${err instanceof Error ? err.message : String(err)}`;
        console.warn(`[curate] ${msg}`);
        errors.push(msg);
      }
    }

    const fin = await client
      .from('crawler_runs')
      .update({
        finished_at: new Date().toISOString(),
        processed_count: processed,
        saved_count: saved,
        errors,
        success: true,
      })
      .eq('id', runId);
    if (fin.error) {
      console.warn('[curate] crawler_runs update failed:', fin.error.message);
    }
    console.log(
      `[curate] done — processed=${processed} saved=${saved} errors=${errors.length}`,
    );
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[curate] FATAL:', msg);
    errors.push(`fatal: ${msg}`);
    try {
      await client
        .from('crawler_runs')
        .update({
          finished_at: new Date().toISOString(),
          processed_count: processed,
          saved_count: saved,
          errors,
          success: false,
        })
        .eq('id', runId);
    } catch {
      // ignore
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[curate] unhandled:', err);
  process.exit(1);
});
