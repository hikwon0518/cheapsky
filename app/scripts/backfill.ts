/**
 * Cheapsky backfill: baseline_seed.json → route_market_data (source='seed')
 *
 * 실행:
 *   pnpm tsx scripts/backfill.ts --seed-reload
 *
 * 동작:
 *   1. --seed-reload 플래그 필수
 *   2. src/data/baseline_seed.json 읽기
 *   3. Supabase service_role client 로 source='seed' 행 전부 삭제
 *   4. baseline_seed 엔트리를 UPSERT (primary key: origin+destination+carrier_class)
 *   5. 성공·실패 카운트 로깅
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..');

dotenvConfig({ path: resolve(appRoot, '.env.local') });

type SeedEntry = {
  origin: string;
  destination: string;
  carrierClass: 'fsc' | 'lcc' | 'mixed';
  baselineKrw: number;
  p10Krw: number;
  p50Krw: number;
  p90Krw: number;
  confidence: 'low' | 'medium';
  sampledAt: string;
  source: 'seed';
};

function usage() {
  console.error('Usage: pnpm tsx scripts/backfill.ts --seed-reload');
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--seed-reload')) {
    usage();
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      'ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local',
    );
    process.exit(1);
  }

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const seedPath = resolve(appRoot, 'src/data/baseline_seed.json');
  const entries: SeedEntry[] = JSON.parse(readFileSync(seedPath, 'utf-8'));

  console.log(`loaded ${entries.length} entries from baseline_seed.json`);

  // 1) 기존 seed 삭제
  //    neq('source','') 는 "source 컬럼이 있는 모든 행" — delete 의 filter 가 필수라 우회
  const del = await client
    .from('route_market_data')
    .delete()
    .eq('source', 'seed');
  if (del.error) {
    console.error('delete failed:', del.error.message);
    process.exit(1);
  }
  console.log('deleted existing source=seed rows');

  // 2) camelCase → snake_case 로 매핑하고 upsert
  const rows = entries.map((e) => ({
    origin: e.origin,
    destination: e.destination,
    carrier_class: e.carrierClass,
    p5_krw: null,
    p10_krw: e.p10Krw,
    p25_krw: null,
    p50_krw: e.p50Krw,
    p90_krw: e.p90Krw,
    cheapest_today_krw: null,
    cheapest_today_carrier: null,
    sampled_at: `${e.sampledAt}T00:00:00Z`,
    ttl_hours: 720,
    source: 'seed',
  }));

  const up = await client
    .from('route_market_data')
    .upsert(rows, { onConflict: 'origin,destination,carrier_class' });
  if (up.error) {
    console.error('upsert failed:', up.error.message);
    process.exit(1);
  }

  // 3) 검증 카운트
  const count = await client
    .from('route_market_data')
    .select('*', { count: 'exact', head: true })
    .eq('source', 'seed');
  if (count.error) {
    console.error('count failed:', count.error.message);
    process.exit(1);
  }

  console.log(`backfill ok: ${rows.length} entries upserted, ${count.count} rows with source='seed'`);
}

main().catch((err) => {
  console.error('backfill failed:', err);
  process.exit(1);
});
