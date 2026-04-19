/**
 * Cheapsky archive_daily (Stretch 2 — ARCHITECTURE.md "데이터 흐름 (4) 큐레이션" 인접).
 *
 * 실행:
 *   pnpm tsx scripts/archive_daily.ts
 *
 * 흐름 (PRD "아카이브 페이지", ARCHITECTURE.md "아카이브 페이지 렌더 정책"):
 *   1. crawler_runs INSERT (source='archiver')
 *   2. 오늘 KST 날짜 산정 — toKstDateOnly(now)
 *   3. SELECT deals: hot_deal=true AND verification_status='active' AND
 *                    expires_at > now() ORDER BY discount_rate DESC LIMIT 5
 *   4. archive_snapshots UPSERT (date primary key, deal_ids 배열, captured_at 갱신)
 *   5. crawler_runs finalize
 *
 * 멱등 (재실행 안전):
 *   - 같은 KST 날짜에 재실행하면 기존 행 덮어씀 (date 가 PK).
 *   - hot_deal 0 건이어도 빈 배열로 스냅샷 INSERT — 그날 기록 자체는 남김.
 *
 * Hard red lines:
 *   - LLM 호출 없음. CHEAPSKY_STAGE 무관.
 *   - deal_ids 는 Postgres uuid[] 네이티브 — JSON.stringify 금지.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

import { toKstDateOnly } from '@/lib/tz';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..');
dotenvConfig({ path: resolve(appRoot, '.env.local') });

/** TOP 5 (PRD "아카이브 페이지"). */
const TOP_N = 5;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set in .env.local`);
  return v;
}

async function main() {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date();
  const dateKey = toKstDateOnly(now);

  // 1) crawler_runs INSERT
  const runIns = await client
    .from('crawler_runs')
    .insert({
      source: 'archiver',
      started_at: now.toISOString(),
      processed_count: 0,
      saved_count: 0,
      errors: [],
      success: false,
    })
    .select('id')
    .single();
  if (runIns.error || !runIns.data) {
    console.error('[archive] crawler_runs insert failed:', runIns.error?.message);
    process.exit(1);
  }
  const runId = (runIns.data as { id: number }).id;

  const errors: string[] = [];
  let processed = 0;
  let saved = 0;

  try {
    // 2) hot_deal TOP 5 SELECT
    const res = await client
      .from('deals')
      .select('id, discount_rate')
      .eq('hot_deal', true)
      .eq('verification_status', 'active')
      .gt('expires_at', now.toISOString())
      .order('discount_rate', { ascending: false, nullsFirst: false })
      .limit(TOP_N);
    if (res.error) {
      throw new Error(`deals select: ${res.error.message}`);
    }
    const rows = (res.data ?? []) as Array<{ id: string }>;
    processed = rows.length;
    const dealIds = rows.map((r) => r.id);
    console.log(`[archive] date=${dateKey} candidates=${processed}`);

    // 3) UPSERT archive_snapshots — date PK, captured_at 갱신.
    //    deal_ids 는 Postgres uuid[] 네이티브 — supabase-js 가 array 그대로 직렬화.
    const upPayload = {
      date: dateKey,
      deal_ids: dealIds,
      captured_at: new Date().toISOString(),
    };
    const up = await client
      .from('archive_snapshots')
      .upsert(upPayload, { onConflict: 'date' });
    if (up.error) {
      throw new Error(`archive_snapshots upsert: ${up.error.message}`);
    }
    saved = dealIds.length;

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
      console.warn('[archive] crawler_runs update failed:', fin.error.message);
    }
    console.log(
      `[archive] done — date=${dateKey} processed=${processed} saved=${saved}`,
    );
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[archive] FATAL:', msg);
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
  console.error('[archive] unhandled:', err);
  process.exit(1);
});
