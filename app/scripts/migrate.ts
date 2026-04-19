/**
 * Cheapsky migration runner
 *
 * psql 이 없는 로컬 환경을 위한 TypeScript 러너.
 * scripts/migrate.sql 을 Supabase Postgres 에 idempotent 실행.
 *
 * 실행:
 *   pnpm tsx scripts/migrate.ts
 *
 * DSN 처리:
 *   .env.local 의 SUPABASE_DB_URL 이 `postgres:[pwd]@db.<ref>.supabase.co:5432/postgres`
 *   같은 템플릿 형태여도 자동 정규화 (브래킷 제거, '@' URL-encode, pooler 리라이트).
 *   IPv4 전용 네트워크에서 direct host 는 resolve 실패하므로 pooler 로 폴백.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import pg from 'pg';
import { resolveDbConfig } from './lib/db-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..');

dotenvConfig({ path: resolve(appRoot, '.env.local') });

const raw = process.env.SUPABASE_DB_URL;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!raw) {
  console.error('ERROR: SUPABASE_DB_URL is not set in .env.local');
  process.exit(1);
}

const dbConfig = resolveDbConfig(raw, url);

const sqlPath = resolve(appRoot, 'scripts/migrate.sql');
const sql = readFileSync(sqlPath, 'utf-8');

const statementCount = sql
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !s.startsWith('--')).length;

async function run() {
  const client = new pg.Client({
    ...dbConfig,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query(sql);
    console.log(`migrate ok: ${statementCount} statements`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('migrate failed:', msg);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
