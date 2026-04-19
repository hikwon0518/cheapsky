-- 2026-04-19b Watcher max_price_krw floor 30K → 50K (parser/display floor 와 정합)
-- Run: psql "$SUPABASE_DB_URL" -f scripts/migrations/20260419b_watcher_price_floor.sql
--
-- Context: 1e27cbd 에서 parser/rules.ts + home-queries.ts 의 가격 floor 를 50K 로 올렸고,
-- ed55a13 에서 /api/watcher POST · scripts/watch.ts 까지 정렬.
-- 이 마이그레이션은 DB 레이어 CHECK 제약까지 같은 기준으로 맞춤 (방어적 다층화).

alter table watched_routes
  drop constraint if exists watched_routes_max_price_krw_check;

alter table watched_routes
  add constraint watched_routes_max_price_krw_check
  check (max_price_krw >= 50000 and max_price_krw <= 10000000);
