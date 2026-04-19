/**
 * Cheapsky cost monitor (Core — ADR-022 / ARCHITECTURE.md "데이터 흐름 (5)").
 *
 * 실행:
 *   pnpm tsx scripts/cost_check.ts
 *
 * 흐름:
 *   1. crawler_runs INSERT (source='cost_check')
 *   2. api_usage_daily 오늘 (KST) 행 UPSERT
 *        - anthropic_tokens_in / _out → Core 에선 항상 0 (Stretch 2)
 *        - supabase_rows_total = count(deals) + count(price_observations)
 *   3. supabase_rows_total > 250_000 AND ALERT_WEBHOOK 있으면 POST
 *   4. 항상 success=true 로 기록 + exit 0 (webhook 실패도 no-op)
 *
 * Hard red lines:
 *   - anthropic / openai 등 LLM SDK 호출 / token 필드 Core 에서 0 외 값 금지.
 *   - amadeus / api 계열 키 참조 금지 (ADR-022).
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { toKstDateOnly } from '@/lib/tz';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..');
dotenvConfig({ path: resolve(appRoot, '.env.local') });

const ROW_TOTAL_THRESHOLD = 250_000; // Supabase free 500MB 의 약 50% 환산

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set in .env.local`);
  return v;
}

async function countRows(
  client: SupabaseClient,
  table: string,
): Promise<number> {
  const res = await client
    .from(table)
    .select('*', { count: 'exact', head: true });
  if (res.error) {
    throw new Error(`count ${table}: ${res.error.message}`);
  }
  return res.count ?? 0;
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
      source: 'cost_check',
      started_at: now.toISOString(),
      processed_count: 0,
      saved_count: 0,
      errors: [],
      success: false,
    })
    .select('id')
    .single();
  if (runIns.error || !runIns.data) {
    console.error('crawler_runs insert failed:', runIns.error?.message);
    process.exit(1);
  }
  const runId = (runIns.data as { id: number }).id;

  const errors: string[] = [];
  let supabaseRowsTotal = 0;

  try {
    // 2) counts — Core 에선 token 필드 0 고정.
    const dealsCount = await countRows(client, 'deals');
    const obsCount = await countRows(client, 'price_observations');
    supabaseRowsTotal = dealsCount + obsCount;

    const dateKey = toKstDateOnly(now);
    const payload = {
      date: dateKey,
      anthropic_tokens_in: 0,
      anthropic_tokens_out: 0,
      supabase_rows_total: supabaseRowsTotal,
    };
    const up = await client
      .from('api_usage_daily')
      .upsert(payload, { onConflict: 'date' });
    if (up.error) throw new Error(`api_usage_daily upsert: ${up.error.message}`);

    console.log(
      `[cost_check] date=${dateKey} deals=${dealsCount} obs=${obsCount} total=${supabaseRowsTotal}`,
    );

    // 3) 임계 초과 알림 — ALERT_WEBHOOK 있을 때만.
    if (
      supabaseRowsTotal > ROW_TOTAL_THRESHOLD &&
      process.env.ALERT_WEBHOOK
    ) {
      const message = `Cheapsky cost_check alert — supabase_rows_total=${supabaseRowsTotal} (threshold ${ROW_TOTAL_THRESHOLD}).`;
      try {
        await fetch(process.env.ALERT_WEBHOOK, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content: message }),
        });
        console.log('[cost_check] webhook alert posted');
      } catch (err) {
        const msg = `webhook: ${err instanceof Error ? err.message : String(err)}`;
        console.warn(`[cost_check] ${msg}`);
        errors.push(msg);
      }
    }

    // 4) crawler_runs UPDATE (success=true 항상)
    const fin = await client
      .from('crawler_runs')
      .update({
        finished_at: new Date().toISOString(),
        processed_count: 1,
        saved_count: 1,
        errors,
        success: true,
      })
      .eq('id', runId);
    if (fin.error) {
      console.warn('[cost_check] crawler_runs update failed:', fin.error.message);
    }
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cost_check] FATAL:', msg);
    errors.push(`fatal: ${msg}`);
    try {
      await client
        .from('crawler_runs')
        .update({
          finished_at: new Date().toISOString(),
          processed_count: 0,
          saved_count: 0,
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
  console.error('[cost_check] unhandled:', err);
  process.exit(1);
});
