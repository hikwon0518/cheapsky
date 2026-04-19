/**
 * Cheapsky verify pipeline (ADR-018).
 *
 * 실행:
 *   pnpm tsx scripts/verify.ts              # Core — HEAD only (5s)
 *   CHEAPSKY_STAGE=stretch pnpm tsx scripts/verify.ts  # Stretch — GET + 20KB + ±10% 가격 패턴
 *
 * 흐름:
 *   1. crawler_runs INSERT (source='verifier')
 *   2. SELECT 100개: expires_at > now() AND posted_at < now()-24h
 *                    AND (verified_at IS NULL OR verified_at < now()-3h)
 *      ORDER BY verified_at NULLS FIRST
 *   3. 각 딜의 source_urls 중 첫 URL 에:
 *      - Core   → verifyUrl (HEAD, 5s)
 *      - Stretch → verifyUrlPrecise (GET, 10s, 20KB cap, ±10% 패턴)
 *   4. deal_verifications INSERT + deals UPDATE
 *      - active  → verification_status='active', fail_count=0
 *      - price_changed (Stretch) → verification_status='price_changed', fail_count 유지
 *      - snapshot → fail_count=prev+1, status='snapshot'
 *      - unchecked → verified_at 만 업데이트 (fail_count 유지)
 *   5. fail_count >= 3 → expires_at = now()
 *   6. 요청 간 500ms 간격
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { verifyUrl, verifyUrlPrecise } from '@/services/verifier';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..');
dotenvConfig({ path: resolve(appRoot, '.env.local') });

const BATCH_SIZE = 100;
const REQUEST_SPACING_MS = 500;
const FAIL_THRESHOLD = 3;

/** CHEAPSKY_STAGE=stretch 일 때 GET+가격 패턴 검증으로 분기 (ADR-018 Stretch). */
function isStretchStage(): boolean {
  return (process.env.CHEAPSKY_STAGE ?? '').toLowerCase() === 'stretch';
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set in .env.local`);
  return v;
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

type DealRow = {
  id: string;
  source_urls: string[];
  price_krw: number;
  verification_fail_count: number;
};

async function selectEligible(client: SupabaseClient): Promise<DealRow[]> {
  const now = new Date();
  const postedCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const verifiedCutoff = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();

  // 두 조건 (verified_at IS NULL OR verified_at < cutoff) 를 or 로 표현.
  const res = await client
    .from('deals')
    .select('id, source_urls, price_krw, verification_fail_count')
    .gt('expires_at', now.toISOString())
    .lt('posted_at', postedCutoff)
    .or(`verified_at.is.null,verified_at.lt.${verifiedCutoff}`)
    .order('verified_at', { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);

  if (res.error) {
    throw new Error(`deals select eligible: ${res.error.message}`);
  }
  return (res.data ?? []) as DealRow[];
}

async function main() {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const runIns = await client
    .from('crawler_runs')
    .insert({
      source: 'verifier',
      started_at: new Date().toISOString(),
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
  let processed = 0;
  let saved = 0;

  const stretch = isStretchStage();
  console.log(`[verify] mode=${stretch ? 'PRECISE (GET+patterns)' : 'HEAD'}`);

  try {
    const targets = await selectEligible(client);
    console.log(`[verify] eligible targets: ${targets.length}`);

    for (let i = 0; i < targets.length; i++) {
      const d = targets[i];
      processed++;
      if (i > 0) await sleep(REQUEST_SPACING_MS);

      const firstUrl = d.source_urls?.[0];
      if (!firstUrl) {
        errors.push(`deal ${d.id}: no source_urls`);
        continue;
      }

      try {
        // Stretch 모드: verifyUrlPrecise (GET + 20KB + ±10%) / priceSignal 기록.
        // Core 모드:  verifyUrl (HEAD only).
        let status: 'active' | 'snapshot' | 'price_changed' | 'unchecked';
        let httpStatus: number | null;
        let note: string | null = null;
        if (stretch) {
          const vr = await verifyUrlPrecise(firstUrl, d.price_krw);
          status = vr.status;
          httpStatus = vr.httpStatus;
          note = vr.priceSignal; // 'matched' | 'drifted' | 'missing'
        } else {
          const vr = await verifyUrl(firstUrl);
          status = vr.status;
          httpStatus = vr.httpStatus;
        }

        const now = new Date().toISOString();
        // Always INSERT a deal_verifications row.
        const dvIns = await client.from('deal_verifications').insert({
          deal_id: d.id,
          checked_at: now,
          http_status: httpStatus,
          status,
          note,
        });
        if (dvIns.error) throw new Error(`dv insert: ${dvIns.error.message}`);

        // UPDATE deals according to status.
        if (status === 'active') {
          const up = await client
            .from('deals')
            .update({
              verification_status: 'active',
              verified_at: now,
              verification_fail_count: 0,
            })
            .eq('id', d.id);
          if (up.error) throw new Error(`deals update: ${up.error.message}`);
        } else if (status === 'price_changed') {
          // Stretch only. fail_count 는 유지 (삭제가 아니라 가격 변경 신호).
          const up = await client
            .from('deals')
            .update({
              verification_status: 'price_changed',
              verified_at: now,
            })
            .eq('id', d.id);
          if (up.error) throw new Error(`deals update: ${up.error.message}`);
        } else if (status === 'snapshot') {
          const newFail = d.verification_fail_count + 1;
          const patch: Record<string, unknown> = {
            verification_status: 'snapshot',
            verified_at: now,
            verification_fail_count: newFail,
          };
          if (newFail >= FAIL_THRESHOLD) {
            patch.expires_at = now;
          }
          const up = await client.from('deals').update(patch).eq('id', d.id);
          if (up.error) throw new Error(`deals update: ${up.error.message}`);
        } else {
          // unchecked — only update verified_at
          const up = await client
            .from('deals')
            .update({ verified_at: now })
            .eq('id', d.id);
          if (up.error) throw new Error(`deals update: ${up.error.message}`);
        }

        saved++;
      } catch (err) {
        const msg = `deal ${d.id}: ${err instanceof Error ? err.message : String(err)}`;
        console.warn(`[verify] ${msg}`);
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
      console.warn('[verify] crawler_runs update failed:', fin.error.message);
    }
    console.log(
      `[verify] done — processed=${processed} saved=${saved} errors=${errors.length}`,
    );
    console.log(`[verify] crawler_runs.id = ${runId}`);
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[verify] FATAL:', msg);
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
  console.error('[verify] unhandled:', err);
  process.exit(1);
});
