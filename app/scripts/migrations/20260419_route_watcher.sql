-- 2026-04-19 Route watcher (C1 — 노선 감시 + 알림)
-- Run: psql "$SUPABASE_DB_URL" -f scripts/migrations/20260419_route_watcher.sql
--
-- 개인 사용 전제 (owner_email hardcoded). 다사용자 확장 시 Supabase Auth + user_id FK 교체.

create table if not exists watched_routes (
  id                  uuid primary key default gen_random_uuid(),
  owner_email         text not null,
  origin              text not null,
  destination         text not null,
  max_price_krw       integer not null check (max_price_krw > 0),
  carrier_class       text not null default 'mixed' check (carrier_class in ('fsc','lcc','mixed')),
  depart_month        text check (depart_month is null or depart_month ~ '^\d{4}-\d{2}$'),
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  last_notified_at    timestamptz,
  notify_cooldown_h   integer not null default 24
);

create index if not exists idx_watched_routes_owner on watched_routes(owner_email) where active;
create index if not exists idx_watched_routes_route on watched_routes(origin, destination) where active;

create table if not exists notification_log (
  id                  uuid primary key default gen_random_uuid(),
  watched_route_id    uuid not null references watched_routes(id) on delete cascade,
  deal_id             uuid references deals(id) on delete set null,
  sent_at             timestamptz not null default now(),
  price_krw           integer not null,
  channel             text not null default 'email',
  success             boolean not null default true,
  error               text
);

create index if not exists idx_notification_log_route on notification_log(watched_route_id, sent_at desc);

alter table watched_routes   enable row level security;
alter table notification_log enable row level security;

-- 정책: anon 읽기 금지. 본인 UI 는 서버 컴포넌트에서 service_role 로 읽음.
-- 향후 Supabase Auth 도입 시 row 별 owner 필터 추가.

-- 쓰기 정책: service_role 만 (RLS 우회).
