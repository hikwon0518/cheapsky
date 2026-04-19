-- Cheapsky Core MVP migration
-- ADR-003: Supabase Postgres (RLS: anon read / service_role write)
-- ADR-022 Deprecated (2026-04-18): route_market_data.source 는 ('seed','observed') 만.
--   'amadeus' / 'api' 금지. api_usage_daily 에 amadeus_calls 컬럼 금지.
-- 멱등 설계: create * if not exists + drop policy if exists 선행.

-- ============================================================
-- 1) deals
-- ============================================================
create table if not exists deals (
  id                       uuid primary key default gen_random_uuid(),
  dedupe_key               text unique not null,
  sources                  text[] not null,
  source_urls              text[] not null,
  title                    text not null,
  body                     text,
  origin                   text not null,
  destination              text not null,
  trip_type                text not null check (trip_type in ('oneway','roundtrip')),
  depart_from              date,
  depart_to                date,
  return_from              date,
  return_to                date,
  price_krw                integer not null,
  carrier_code             text,
  carrier_class            text not null default 'mixed'
                           check (carrier_class in ('fsc','lcc','mixed')),
  baseline_krw             integer,
  baseline_source          text check (baseline_source in ('observed','seed','mixed')),
  baseline_confidence      text check (baseline_confidence in ('low','medium','high')),
  discount_rate            numeric(4,3),
  price_percentile         numeric(5,2),
  hot_deal                 boolean default false,
  curation_text            text,
  curation_generated_at    timestamptz,
  parsed_by                text check (parsed_by in ('rules','llm')),
  verification_status      text not null default 'unchecked',
  verified_at              timestamptz,
  verification_fail_count  integer not null default 0,
  social_signal            text,
  posted_at                timestamptz not null,
  expires_at               timestamptz not null,
  body_expires_at          timestamptz not null,
  created_at               timestamptz default now()
);

-- NOTE: ARCHITECTURE.md 예시는 부분 인덱스에 `where expires_at > now()` 를 썼지만
-- Postgres 는 인덱스 predicate 에 IMMUTABLE 하지 않은 함수(now()) 를 허용하지 않는다.
-- predicate 를 제거하여 full index 로 생성. 쿼리 플래너는 WHERE 절에서 expires_at 을
-- 여전히 활용하므로 실질 성능 손실은 거의 없다. verification_status 필터는
-- deals_hot_idx 에서 정적 값 비교로 유지.
create index if not exists deals_discount_idx
  on deals (discount_rate desc);

create index if not exists deals_posted_idx
  on deals (posted_at desc);

create index if not exists deals_route_idx
  on deals (origin, destination, trip_type, carrier_class);

create index if not exists deals_hot_idx
  on deals (hot_deal, discount_rate desc)
  where verification_status != 'snapshot';

create index if not exists deals_verify_due_idx
  on deals (verified_at nulls first);

-- ============================================================
-- 2) route_market_data
--   ADR-022: source 는 ('seed','observed') 만. Stretch 3 진입 시 ALTER.
-- ============================================================
create table if not exists route_market_data (
  origin                   text not null,
  destination              text not null,
  carrier_class            text not null check (carrier_class in ('fsc','lcc','mixed')),
  p5_krw                   integer,
  p10_krw                  integer,
  p25_krw                  integer,
  p50_krw                  integer,
  p90_krw                  integer,
  cheapest_today_krw       integer,
  cheapest_today_carrier   text,
  sampled_at               timestamptz not null,
  ttl_hours                integer not null default 720,
  source                   text not null check (source in ('seed','observed')),
  primary key (origin, destination, carrier_class)
);

-- ============================================================
-- 3) price_observations
-- ============================================================
create table if not exists price_observations (
  id               bigserial primary key,
  origin           text not null,
  destination      text not null,
  trip_type        text not null,
  carrier_class    text not null default 'mixed',
  price_krw        integer not null,
  observed_at      timestamptz not null,
  source_deal_id   uuid references deals(id) on delete set null
);

create index if not exists obs_route_time_idx
  on price_observations (origin, destination, trip_type, carrier_class, observed_at desc);

-- ============================================================
-- 4) crawler_runs
--   source 는 text 로 두고 ppomppu/ruliweb/playwings/curator/verifier/archiver/cost_check 수용
-- ============================================================
create table if not exists crawler_runs (
  id               bigserial primary key,
  source           text not null,
  started_at       timestamptz not null,
  finished_at      timestamptz,
  processed_count  integer default 0,
  saved_count      integer default 0,
  errors           text[] default '{}',
  success          boolean default false
);

create index if not exists crawler_runs_recent_idx
  on crawler_runs (source, started_at desc);

-- ============================================================
-- 5) deal_verifications
-- ============================================================
create table if not exists deal_verifications (
  id           bigserial primary key,
  deal_id      uuid not null references deals(id) on delete cascade,
  checked_at   timestamptz not null default now(),
  http_status  integer,
  status       text not null,
  note         text
);

create index if not exists dv_recent_idx
  on deal_verifications (deal_id, checked_at desc);

-- ============================================================
-- 6) archive_snapshots (Stretch 2 에서 사용, 스키마는 Core 에 선반영)
-- ============================================================
create table if not exists archive_snapshots (
  date         date primary key,
  deal_ids     uuid[] not null,
  captured_at  timestamptz not null default now()
);

-- ============================================================
-- 7) api_usage_daily
--   ADR-022: amadeus_calls 컬럼 없음. Stretch 3 진입 시 ALTER 로 추가.
-- ============================================================
create table if not exists api_usage_daily (
  date                  date primary key,
  anthropic_tokens_in   bigint default 0,
  anthropic_tokens_out  bigint default 0,
  supabase_rows_total   integer
);

-- ============================================================
-- RLS: anon read-only. service_role 은 RLS 우회.
-- ============================================================
alter table deals              enable row level security;
alter table route_market_data  enable row level security;
alter table price_observations enable row level security;
alter table crawler_runs       enable row level security;
alter table deal_verifications enable row level security;
alter table archive_snapshots  enable row level security;
alter table api_usage_daily    enable row level security;

drop policy if exists anon_read_deals  on deals;
create policy anon_read_deals  on deals              for select using (true);

drop policy if exists anon_read_market on route_market_data;
create policy anon_read_market on route_market_data  for select using (true);

drop policy if exists anon_read_obs    on price_observations;
create policy anon_read_obs    on price_observations for select using (true);

drop policy if exists anon_read_runs   on crawler_runs;
create policy anon_read_runs   on crawler_runs       for select using (true);

-- 2026-04-19: 운영 메타데이터 (검증 이력 · LLM 비용) anon 접근 제거 (ADR-008 강화).
-- UI 는 /api/health 에서 service_role 또는 server-side 만 읽음.
drop policy if exists anon_read_ver    on deal_verifications;
-- anon 읽기 정책 생성 안 함 → anon 은 bulk export 불가

drop policy if exists anon_read_arch   on archive_snapshots;
create policy anon_read_arch   on archive_snapshots  for select using (true);

drop policy if exists anon_read_usage  on api_usage_daily;
-- anon 읽기 정책 생성 안 함

-- 쓰기 정책 없음 → service_role 만 가능

-- ============================================================
-- Column-level GRANT: deals.body 는 anon 에서 제외 (2026-04-19 ADR-008 강화).
-- 본문 7일 TTL 이라도 대량 덤프 금지.
-- ============================================================
revoke select (body) on deals from anon;
