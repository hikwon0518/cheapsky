# 아키텍처

> 이 문서의 한 줄 요지: Next.js 15 풀스택 + GH Actions 배치 + Supabase Postgres. 2-레이어 데이터 소스(블로그·커뮤니티) + Baseline(관측+수동 시드)을 FSC/LCC 이중 분위수로 평가. **ADR-022 Deprecated 반영 (Amadeus 계층 제거)**.

## 한 눈에 보기
```
┌─ baseline_seed.json (수동 조사, 20 노선 × FSC/LCC/mixed) ─┐
└──────────┬────────────────────────────────────────────────┘
           │ seed 로드 (seed.sql 실행 시, ADR-011 3순위 폴백)
           ▼
     route_market_data (source='seed')

┌─ 뽐뿌 (Core) / 루리웹·플레이윙즈 (Stretch 1) ─────────────┐
└──────────┬────────────────────────────────────────────────┘
           │ cron */15m (Public repo) 또는 */30m (private)
           ▼
     scripts/crawl.ts
           │
           ├─▶ parser/rules → (Stretch 2) parser/llm
           ├─▶ route-map + airport-aliases (IATA 표준화)
           ├─▶ airlines (carrier → FSC/LCC 분류)
           ├─▶ dedupe (1000원 내림 + 노선 + 월 + carrier_class 해시)
           ├─▶ baseline.resolve (관측 ≥30 → 관측 · 10~29 → 혼합 · <10 → 시드)
           ├─▶ scorer (해당 class 분위수 비교 → 🔥 판정)
           └─▶ Supabase UPSERT deals + price_observations INSERT

┌─ 검증(Core) · 비용체크(Core) · (Stretch 2) 큐레이션/아카이브 ┐
│  verify.ts (3h, HEAD only) · cost_check.ts (daily)            │
│  curate.ts (LLM 1h) · archive_daily.ts (00:05 KST)            │
└───────────────────────────────────────────────────────────────┘
                        │
                        ▼ (RLS anon read)
      ┌──────────────────────────────────────────┐
      │ Next.js 15 on Vercel                     │
      │ middleware: share_token → Basic Auth     │
      │ SHOW_CACHED_ONLY=true → UI 캐시 모드 배너│
      └────────────────┬─────────────────────────┘
                       ▼
                   Browser
```

> Stretch 3-stretch-market-api(외부 조건부)가 활성화되면 상단에 `┌─ 시세 API ─┐ → scripts/ingest_market.ts → route_market_data(source='api')` 레인이 추가된다. Core 에는 포함되지 않음.

## 디렉토리 구조
```
src/
├── app/
│   ├── page.tsx                    # Discovery 대시보드
│   ├── archive/[date]/page.tsx     # (Stretch)
│   ├── api/
│   │   ├── deals/route.ts
│   │   ├── market/route.ts         # (Stretch) 시세 히트맵용
│   │   ├── price-trace/[id]/route.ts  # (Stretch) 스파크라인
│   │   └── health/route.ts
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── Hero.tsx                    # TOP 3 딜 전용 (시세 카드 제외)
│   ├── DealCard.tsx                # 딜 카드 (원문 링크)
│   ├── MarketCard.tsx              # 시세 카드 (스카이스캐너 검색 링크)
│   ├── DealList.tsx
│   ├── CommunityPicks.tsx          # (Stretch)
│   ├── MarketHeatmap.tsx           # (Stretch)
│   ├── FilterBar.tsx               # 5개, 300ms debounce
│   ├── PriceBadge.tsx              # 🔥 저점 + 근거 팝오버
│   ├── Sparkline.tsx               # (Stretch)
│   ├── SourceTag.tsx
│   ├── RouteFrequency.tsx          # (Stretch)
│   ├── ShareButton.tsx
│   ├── CrawlerHealth.tsx           # 푸터 점 (뽐뿌 Core · 루리웹·플레이윙즈 Stretch 1)
│   ├── StaleBanner.tsx             # 수집 지연 경고
│   ├── CacheOnlyBanner.tsx         # SHOW_CACHED_ONLY 배너
│   └── EmptyState.tsx
├── lib/
│   ├── db.ts
│   ├── scorer.ts                   # FSC/LCC 분기 판정
│   ├── dedupe.ts                   # 해시 (carrier_class 포함)
│   ├── route-map.ts
│   ├── airport-aliases.ts          # (ADR-017)
│   ├── airlines.ts                 # 항공사 코드→한글명 + FSC/LCC 분류
│   ├── format.ts
│   ├── tz.ts                       # UTC ↔ KST
│   ├── share-token.ts
│   ├── llm-budget.ts               # (Stretch)
│   └── skyscanner-url.ts           # 검색 URL 생성 (시세 카드용)
├── services/
│   ├── crawlers/
│   │   ├── ppomppu.ts              # Core
│   │   ├── ruliweb.ts              # Stretch 1
│   │   ├── playwings.ts            # Stretch 1, ADR-025 절차 통과 후만
│   │   └── types.ts
│   ├── parser/
│   │   ├── rules.ts                # Core
│   │   └── llm.ts                  # Stretch 2
│   ├── baseline.ts                 # 관측(≥30/혼합/<10) → 시드 폴백, FSC/LCC 분리 (ADR-011)
│   ├── curator.ts                  # Stretch 2
│   └── verifier.ts                 # Core(HEAD), Stretch 2(GET+patterns)
│   # services/amadeus.ts: ADR-022 Deprecated — Core 미구현. Stretch 3 조건부 부활
├── data/
│   ├── baseline_seed.json          # 수동 조사 baseline 시드 (20 노선 × FSC/LCC/mixed, ADR-011)
│   ├── airports.json
│   └── airlines.json               # 코드·한글명·FSC/LCC 분류
├── types/
│   └── deal.ts
└── middleware.ts                   # share_token → Basic Auth → noindex

scripts/
├── crawl.ts                        # Core (15 또는 30분 주기)
├── verify.ts                       # Core (3h, HEAD)
├── cost_check.ts                   # Core (daily 09:00 KST, 웹훅 알림)
├── curate.ts                       # Stretch 2 (1h)
├── archive_daily.ts                # Stretch 2 (daily 00:05 KST)
├── backfill.ts                     # 수동 1회
├── migrate.sql
├── seed.sql                        # baseline_seed.json → route_market_data UPSERT 포함
└── restore_demo.sql
# scripts/ingest_market.ts: ADR-022 Deprecated — Core 미구현. Stretch 3 조건부 부활

docs/
├── PRD.md · ARCHITECTURE.md · ADR.md · UI_GUIDE.md
├── methodology.md · BACKLOG.md
└── (Stretch) GLOSSARY.md · OPERATIONS.md · LLM_PROMPTS.md · DEMO_SCRIPT.md

README.md (예정)
.env.example
```

## 레이어 책임
| # | 레이어 | 입력 | 출력 | 파일 | 단계 |
|---|--------|------|------|------|:----:|
| 1 | Baseline 공급 | 수동 조사 | `route_market_data` seed 엔트리 | `data/baseline_seed.json`, `scripts/seed.sql` | Core |
| 2 | 딜 수집 | 사이트 URL | `RawPost[]` | `services/crawlers/*` | Core |
| 3 | 파싱 (규칙) | `RawPost` | `DealDraft` | `services/parser/rules.ts` | Core |
| 3b | 파싱 (LLM) | 규칙 실패분 | `DealDraft` | `services/parser/llm.ts` | Stretch 2 |
| 4 | 경로·항공사 정규화 | `DealDraft` | IATA + carrier_class | `lib/route-map.ts`, `lib/airlines.ts` | Core |
| 5 | 중복 제거 | `DealDraft[]` | dedupe_key | `lib/dedupe.ts` | Core |
| 6 | Baseline 해석 | route + carrier_class | 분위수 + confidence | `services/baseline.ts` (관측·시드 우선순위, ADR-011) | Core |
| 7 | 🔥 판정 | 가격 vs 분위수 | hotDeal, discountRate, percentile | `lib/scorer.ts` | Core |
| 8 | 관측 기록 | 정제 `Deal` | `price_observations` INSERT | `scripts/crawl.ts` | Core |
| 9 | 큐레이션 | `Deal` | curationText | `services/curator.ts` | Stretch 2 |
| 10 | 실효성 검증 | 24h+ 딜 | verification_status | `services/verifier.ts` | Core(HEAD) |
| 11 | 저장 | `Deal`/run/verification | UPSERT | `lib/db.ts` | Core |
| 12 | 표현 | DB | HTML | `app/*` | Core |
| 13 | 접근제어 | 모든 요청 | share_token → Basic Auth | `middleware.ts` | Core |
| 14 | 비용 모니터 | Supabase 크기·Anthropic 토큰 | 웹훅 알림 | `scripts/cost_check.ts` | Core |
| — | 시세 API | (Stretch 3 조건부) | `route_market_data` api 엔트리 | `services/amadeus.ts`, `scripts/ingest_market.ts` | Stretch 3 |

## 데이터 모델

```ts
// types/deal.ts
export type Source = 'ppomppu' | 'ruliweb' | 'playwings';
export type CarrierClass = 'fsc' | 'lcc' | 'mixed';
export type VerificationStatus = 'active' | 'snapshot' | 'price_changed' | 'unchecked';

export type RawPost = {
  source: Source;
  sourceId: string;
  sourceUrl: string;
  title: string;
  body: string;              // 파싱 후 7일 유지 → NULL
  postedAt: Date;            // UTC
  // 작성자 식별자 저장 안 함 (PRD 프라이버시)
};

export type DealDraft = {
  source: Source;
  sourceId: string;
  sourceUrl: string;
  title: string;
  origin: string | null;
  destination: string | null;
  tripType: 'oneway' | 'roundtrip' | null;
  departFrom: Date | null;
  departTo: Date | null;
  returnFrom: Date | null;
  returnTo: Date | null;
  priceKrw: number | null;
  carrierCode: string | null;      // 'KE', 'LJ', '7C' ...
  carrierClass: CarrierClass | null;
  postedAt: Date;
  parsedBy: 'rules' | 'llm' | null;
};

export type Deal = {
  id: string;
  dedupeKey: string;
  sources: Source[];
  sourceUrls: string[];
  title: string;
  origin: string;
  destination: string;
  tripType: 'oneway' | 'roundtrip';
  departFrom: Date | null;
  departTo: Date | null;
  returnFrom: Date | null;
  returnTo: Date | null;
  priceKrw: number;
  carrierCode: string | null;
  carrierClass: CarrierClass;       // mixed = 미상
  baselineKrw: number | null;
  baselineSource: 'observed' | 'seed' | 'mixed' | null;  // mixed = 관측+시드 혼합 (ADR-011 2순위)
  baselineConfidence: 'low' | 'medium' | 'high' | null;
  discountRate: number | null;
  pricePercentile: number | null;   // 0~100, p값
  hotDeal: boolean;
  curationText: string | null;
  curationGeneratedAt: Date | null;
  verificationStatus: VerificationStatus;
  verifiedAt: Date | null;
  verificationFailCount: number;
  socialSignal: 'hot' | 'trending' | null;  // Stretch: Community Picks용
  postedAt: Date;
  expiresAt: Date;
  bodyExpiresAt: Date;
  createdAt: Date;
};

export type RouteMarketData = {
  origin: string;
  destination: string;
  carrierClass: CarrierClass;
  p5Krw: number | null;
  p10Krw: number | null;
  p25Krw: number | null;
  p50Krw: number | null;
  p90Krw: number | null;
  cheapestTodayKrw: number | null;  // observed·seed 모두 null 가능 (Stretch 3 API 진입 시 채움)
  cheapestTodayCarrier: string | null;
  sampledAt: Date;                  // seed 로드 시각 또는 관측 집계 시각
  ttlHours: number;                 // seed: 무제한(수동 갱신). observed: 재집계 주기 24h
  source: 'seed' | 'observed';      // Stretch 3 진입 시 'api' 추가
};

export type PriceObservation = {
  id: number;
  origin: string;
  destination: string;
  tripType: 'oneway' | 'roundtrip';
  carrierClass: CarrierClass;
  priceKrw: number;
  observedAt: Date;
  sourceDealId: string | null;      // null 이면 시드 또는 관측 재집계 유래 (실제 딜이 아닌 집계 행)
};

export type CrawlerRun = {
  id: number;
  source: Source | 'curator' | 'verifier' | 'archiver' | 'cost_check';
  startedAt: Date;
  finishedAt: Date | null;
  processedCount: number;
  savedCount: number;
  errors: string[];
  success: boolean;
};

export type DealVerification = {
  id: number;
  dealId: string;
  checkedAt: Date;
  httpStatus: number | null;
  status: VerificationStatus;
  note: string | null;
};

export type ArchiveSnapshot = {          // Stretch
  date: string;
  dealIds: string[];
  capturedAt: Date;
};

export type ApiUsageDaily = {            // Core (cost_check용)
  date: string;                           // YYYY-MM-DD KST
  anthropicTokensIn: number;              // Stretch 2 한정
  anthropicTokensOut: number;             // Stretch 2 한정
  supabaseRowsTotal: number | null;
  // amadeusCalls: Stretch 3 진입 시 컬럼 추가 (현재 Core 스키마에서 생략)
};
```

### Supabase 스키마 (`scripts/migrate.sql` 요지)
```sql
create table deals (
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
  price_percentile         numeric(5,2),          -- 0~100
  hot_deal                 boolean default false,
  curation_text            text,
  curation_generated_at    timestamptz,
  parsed_by                text check (parsed_by in ('rules','llm')),
  verification_status      text not null default 'unchecked',
  verified_at              timestamptz,
  verification_fail_count  integer not null default 0,
  social_signal            text,                  -- 'hot' | 'trending' | null
  posted_at                timestamptz not null,
  expires_at               timestamptz not null,
  body_expires_at          timestamptz not null,
  created_at               timestamptz default now()
);
create index deals_discount_idx   on deals (discount_rate desc)
  where expires_at > now() and verification_status != 'snapshot';
create index deals_posted_idx     on deals (posted_at desc) where expires_at > now();
create index deals_route_idx      on deals (origin, destination, trip_type, carrier_class);
create index deals_hot_idx        on deals (hot_deal, discount_rate desc)
  where expires_at > now() and verification_status != 'snapshot';
create index deals_verify_due_idx on deals (verified_at nulls first) where expires_at > now();

create table route_market_data (
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
  ttl_hours                integer not null default 720,   -- seed: 30일(수동 분기 갱신). observed: 24h 재집계
  source                   text not null check (source in ('seed','observed')),  -- Stretch 3 진입 시 'api' 추가
  primary key (origin, destination, carrier_class)
);

create table price_observations (
  id               bigserial primary key,
  origin           text not null,
  destination      text not null,
  trip_type        text not null,
  carrier_class    text not null default 'mixed',
  price_krw        integer not null,
  observed_at      timestamptz not null,
  source_deal_id   uuid references deals(id) on delete set null
);
create index obs_route_time_idx on price_observations (origin, destination, trip_type, carrier_class, observed_at desc);

create table crawler_runs (
  id               bigserial primary key,
  source           text not null,
  started_at       timestamptz not null,
  finished_at      timestamptz,
  processed_count  integer default 0,
  saved_count      integer default 0,
  errors           text[] default '{}',
  success          boolean default false
);
create index crawler_runs_recent_idx on crawler_runs (source, started_at desc);

create table deal_verifications (
  id           bigserial primary key,
  deal_id      uuid not null references deals(id) on delete cascade,
  checked_at   timestamptz not null default now(),
  http_status  integer,
  status       text not null,
  note         text
);
create index dv_recent_idx on deal_verifications (deal_id, checked_at desc);

create table archive_snapshots (        -- Stretch
  date         date primary key,
  deal_ids     uuid[] not null,
  captured_at  timestamptz not null default now()
);

create table api_usage_daily (
  date                  date primary key,         -- KST
  anthropic_tokens_in   bigint default 0,         -- Stretch 2 한정
  anthropic_tokens_out  bigint default 0,         -- Stretch 2 한정
  supabase_rows_total   integer
  -- amadeus_calls: Stretch 3 진입 시 ALTER TABLE 로 추가
);

-- RLS: anon 읽기만 / service_role 쓰기
alter table deals              enable row level security;
alter table route_market_data  enable row level security;
alter table price_observations enable row level security;
alter table crawler_runs       enable row level security;
alter table deal_verifications enable row level security;
alter table archive_snapshots  enable row level security;
alter table api_usage_daily    enable row level security;

create policy anon_read_deals   on deals              for select using (true);
create policy anon_read_market  on route_market_data  for select using (true);
create policy anon_read_obs     on price_observations for select using (true);
create policy anon_read_runs    on crawler_runs       for select using (true);
create policy anon_read_ver     on deal_verifications for select using (true);
create policy anon_read_arch    on archive_snapshots  for select using (true);
create policy anon_read_usage   on api_usage_daily    for select using (true);
-- 쓰기 정책 없음 → service_role만 가능
```

### 이중 저장 설명
- `deals.price_krw` = 카드 표시용 대표 가격
- `price_observations` = 노선 시계열 (스파크라인·관측 평균·baseline 계산용). 크롤 시 `carrier_class` 포함 INSERT
- `route_market_data` = 시드(수동) + 관측 집계 캐시 (분위수 산출·히트맵용)
- 관측 ≥ 10건 쌓이면 `baseline.ts` 가 **관측 + 시드 혼합** (가중 0.6 · 0.4, ADR-011). ≥ 30건이면 관측 단독

## 항공사 분류 (`lib/airlines.ts`)
```ts
// data/airlines.json 예시
{
  "KE": { "name": "대한항공", "class": "fsc", "country": "KR" },
  "OZ": { "name": "아시아나항공", "class": "fsc", "country": "KR" },
  "LJ": { "name": "진에어", "class": "lcc", "country": "KR" },
  "7C": { "name": "제주항공", "class": "lcc", "country": "KR" },
  "TW": { "name": "티웨이항공", "class": "lcc", "country": "KR" },
  "BX": { "name": "에어부산", "class": "lcc", "country": "KR" },
  "NH": { "name": "ANA", "class": "fsc", "country": "JP" },
  "JL": { "name": "JAL", "class": "fsc", "country": "JP" },
  "SQ": { "name": "싱가포르항공", "class": "fsc", "country": "SG" },
  "CX": { "name": "캐세이퍼시픽", "class": "fsc", "country": "HK" },
  "VN": { "name": "베트남항공", "class": "fsc", "country": "VN" },
  "VJ": { "name": "비엣젯항공", "class": "lcc", "country": "VN" },
  "AK": { "name": "에어아시아", "class": "lcc", "country": "MY" },
  "5J": { "name": "세부퍼시픽", "class": "lcc", "country": "PH" },
  "UA": { "name": "유나이티드", "class": "fsc", "country": "US" }
  // ... 20~30개 엔트리
}
```
파서는 제목에서 한글명 → 코드 → `lib/airlines.ts` 사전 조회로 `class` 결정. 매칭 실패 시 `class: 'mixed'`.

## 데이터 흐름

### (1) Baseline 공급 — Core, 수동 시드 + 관측 재집계
**시드 로드** (1회 + 분기 수동 갱신):
```
scripts/seed.sql 실행 시:
  data/baseline_seed.json → route_market_data UPSERT (source='seed')
  - 20 노선 × {FSC, LCC, mixed} ≈ 40~60 엔트리
  - p5/p10/p25/p50/p90, cheapest_today_krw=NULL, ttl_hours=720(30일)

수동 분기 갱신 (methodology.md 참조):
  1. baseline_seed.json 수정
  2. pnpm tsx scripts/backfill.ts --seed-reload → route_market_data UPSERT(source='seed')
```

**관측 재집계** (`scripts/crawl.ts` 말미 또는 `services/baseline.ts` 실시간):
```
for each (origin, destination, carrier_class) with recent price_observations (30일 window):
  count = COUNT(*)
  if count >= 10:
    p = percentile_cont([0.05, 0.10, 0.25, 0.50, 0.90]) over price_krw
    UPSERT route_market_data (source='observed', p5..p90, sampled_at=now, ttl_hours=24)
    # seed 엔트리는 덮어쓰지 않고 source='observed' 로우를 별도 유지
    # baseline.ts 는 ADR-011 우선순위에 따라 조회 시 선택
```

> Core 초안은 관측 재집계를 `scripts/crawl.ts` 말미에서 수행하여 추가 cron 을 줄임. Stretch 3 (시세 API 도입) 시 `scripts/ingest_market.ts` 를 새로 추가하고 `source='api'` 로우를 1순위 소스로 삽입.

**crawler_runs 기록**: seed 로드는 기록하지 않음 (migrate/수동 스크립트). 관측 재집계는 `scripts/crawl.ts` 의 run 에 포함.

### (2) 딜 크롤 — Core, 15분(또는 30분) 주기
```
GH Actions cron: */15 * * * *   # Public repo 전제. private면 */30
   └─ scripts/crawl.ts
         for source of [ppomppu, (Stretch 1) ruliweb, (Stretch 1) playwings]:
             rawPosts = crawlers[source].fetch()   # robots, 1s 간격
             for post of rawPosts:
                 draft = parser.rules.parse(post)
                 if (draft 불완전 and llm_budget.remaining > 0):   # Stretch 2
                     draft = parser.llm.parse(post)
                 if (draft 필수 필드 null) continue
                 draft = routeMap.normalize(draft)
                 draft.carrierClass = airlines.classOf(draft.carrierCode) ?? 'mixed'
                 drafts.push(draft)
             drafts = dedupe.group(drafts)   # carrier_class 포함
             for draft of drafts:
                 baseline = baseline.resolve(draft.origin, draft.destination, draft.carrierClass)
                    # ADR-011 우선순위: observed(≥30) → observed·seed 혼합(10~29) → seed FSC/LCC → seed mixed → null
                 score = scorer.score(draft, baseline)
                    # discountRate + pricePercentile + hotDeal 판정
                 db.upsertDeal(...)
                 db.insertObservation({
                   ...draft.route,
                   carrier_class: draft.carrierClass,
                   price, observed_at: now,
                   source_deal_id: deal.id
                 })
         본문 TTL cleanup
```

### (3) 실효성 검증 — Core (HEAD), 3시간 주기
```
GH Actions cron: 0 */3 * * *
   └─ scripts/verify.ts
         SELECT 100개: expires_at > now() AND posted_at < now() - 24h
                      AND (verified_at IS NULL OR verified_at < now() - 3h)
         for deal of targets:
             for url of deal.source_urls:
                 resp = fetch(url, { method: 'HEAD', timeout: 5s })  # Core는 HEAD만
                 if (404/410): status='snapshot'; break
                 else: status='active'
             # Stretch: GET + 본문에 원 가격 패턴 존재 여부
             deal_verifications INSERT
             UPDATE deals SET verification_status, verified_at,
                              verification_fail_count = ...
             if (fail_count >= 3): expires_at = now()
```

### (4) 큐레이션 — Stretch 2, 1시간 주기
규칙 실패 건에 LLM 한 줄. 프롬프트에 **시스템/API 이름 노출 금지**, 일반 용어만 허용:
```
System: 주어진 숫자만 사용하여 60자 이내 한국어 한 문장을 생성.
        "API", "Claude", "LLM" 같은 시스템 명칭 언급 금지.
        계절·이벤트·외부 지식 언급 금지.
        
User: 노선=ICN-KIX (인천-오사카), carrier=LJ (진에어, LCC),
      현재가=99000원, 시장 평균=220000원, 지난 30일 최저=95000원,
      하위 백분위=p8
```
출력 예: *"시장 평균 대비 55% 저렴. 지난 30일 이 노선 LCC 최저 수준."*

### (5) 비용 모니터 — Core, 매일 09:00 KST
```
GH Actions cron: 0 0 * * *   # UTC 00:00 = KST 09:00
   └─ scripts/cost_check.ts
         usage = db.query(api_usage_daily WHERE date > month_start)
         totals = {
           anthropic_tokens_in: sum(...),            # Stretch 2 한정, Core 에선 0
           supabase_rows: latest(supabase_rows_total),
           observation_this_month: count(price_observations inserted this month)
         }
         thresholds = {
           anthropic_cost_usd: 0.8 * 2.0,            # Stretch 2
           supabase_mb: 0.5 * 500                    # Supabase free 500MB 의 50%
         }
         if (any(totals[k] > thresholds[k])):
           fetch(ALERT_WEBHOOK, { POST, body: summary })
```
> Stretch 3 (시세 API 도입) 시 `amadeus_calls` 또는 대응 키 + `api_monthly_quota * 0.8` threshold 추가.

### (6) 렌더
```
GET /?region=JP&maxPrice=300000&month=2026-05&minDiscount=30&since=24h&t=<token>
  └─ middleware.ts
        if (share_token 검증 pass): pass
        else: Basic Auth 검증 → 실패 시 401
        X-Robots-Tag: noindex, nofollow 주입
  └─ app/page.tsx (Server Component)
        if (process.env.SHOW_CACHED_ONLY === 'true'):
            <CacheOnlyBanner />
            # 이 플래그는 UI 전용. DB 쿼리는 평소와 동일하게 진행
            # (anon RLS로 읽기). 차이는 Banner 표시와 "외부 호출 안내" 문구
        heroTop3   = db.query("hot_deal AND verification_status='active'
                               ORDER BY discount_rate DESC LIMIT 3")
        (heroTop3 비면) = 최근 7일 TOP 3 폴백
        list       = db.query(필터 적용)
        health     = db.query(crawler_runs 최근 각 source)
        if Stretch:
            communityPicks = db.query(social_signal IS NOT NULL LIMIT 6)
            marketHeatmap  = db.query(route_market_data 20개 노선)
```

**`SHOW_CACHED_ONLY` 정책 (ADR-028)**:
- **UI 전용 플래그**. Vercel env에만 설정 (환경변수 표 참조)
- 배치 cron (crawl / verify / cost_check / (Stretch 2) curate / archive)은 **영향 없음** — 백그라운드에서 계속 복구 시도
- 이유: 시연 중 UI에는 "최근 캐시 사용 중" 고지만 띄우고, 배치는 외부 API가 살아나면 자동 갱신하는 게 운영상 편함
- `cost_check.ts`만 예외로 `SHOW_CACHED_ONLY=true`일 때 비용 알림 스킵 (Vercel env가 GH Actions에 전파되지 않으므로 실제로는 GH Actions secrets에 별도 미러 설정 시에만 적용 — 기본적으로 스킵 아님)

## 접근 제어

### share_token 흐름 (`middleware.ts`)
```
incoming request
  ├─ ?t=<token>: lib/share-token.verify(t)
  │     ├─ match SHARE_TOKENS (comma-separated env): pass
  │     └─ mismatch: fall through
  ├─ Basic Auth header: bcrypt compare
  │     ├─ pass: pass
  │     └─ fail: 401 WWW-Authenticate
  └─ none: 401 + HTML 안내
```
- `SHARE_TOKENS` = `"friend_abc,backup_def,debug_ghi"` (최소 12자)
- 유출 의심 시 env rotate (만료 없음)

### 검색 노출 차단
모든 응답에 `X-Robots-Tag: noindex, nofollow` + HTML `<meta name="robots">`.

## 배포
| 컴포넌트 | 플랫폼 | 비용 |
|----------|--------|------|
| 웹 앱 | Vercel Hobby | 무료 |
| 배치 cron | GitHub Actions (**public repo 전제**) | 무료·무제한 |
| DB | Supabase free | 무료 (500MB) |
| LLM (Stretch 2) | Anthropic Haiku 4.5 | <$2/월 |
| 시세 API (Stretch 3) | TBD (ADR-022 부활 조건부) | TBD |

### 환경 변수
| 이름 | Vercel | GH Actions | 비고 |
|------|:------:|:----------:|------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✔ | ✔ | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✔ | | 읽기만 |
| `SUPABASE_SERVICE_ROLE_KEY` | | ✔ | 쓰기 전용. `.gitignore` 철저 |
| `ANTHROPIC_API_KEY` | | ✔ | Stretch 2 only |
| `CRAWLER_USER_AGENT` | | ✔ | `Cheapsky/0.1 (+mailto:...)` |
| `BASIC_AUTH_USER` | ✔ | | |
| `BASIC_AUTH_PASS` | ✔ | | bcrypt hash |
| `SHARE_TOKENS` | ✔ | | 콤마 분리 |
| `LLM_DAILY_BUDGET` | | ✔ | Stretch. 기본 300 |
| `ALERT_WEBHOOK` | | ✔ | Discord/Slack |
| `SHOW_CACHED_ONLY` | ✔ | | UI 전용 패닉 (기본 `false`). 배치에는 주입하지 않음 — ADR-028 |
| `CHEAPSKY_STAGE` | | ✔ | Stretch workflow에만 `stretch` 값 주입 (훅 게이트 해제). Core workflow는 미설정 |

**GH Actions workflow 예시 (Stretch 2 용)**:
```yaml
# .github/workflows/curate.yml
env:
  CHEAPSKY_STAGE: stretch
jobs:
  curate:
    runs-on: ubuntu-latest
    steps: ...
```
Core workflow(crawl.yml / verify.yml / cost_check.yml)는 `CHEAPSKY_STAGE` 미설정 → 훅이 `core`로 취급 → Anthropic SDK 설치 차단. `ingest_market.yml` 은 Stretch 3 진입 시 추가.

## 타임존 (ADR-015)
저장 UTC / 표시 `Asia/Seoul` (`lib/tz.ts`) / Cron UTC + KST 병기 주석

## 로컬 개발 절차

### 1회 셋업
```bash
cp .env.example .env.local
pnpm install
psql $SUPABASE_DB_URL -f scripts/migrate.sql
psql $SUPABASE_DB_URL -f scripts/seed.sql   # baseline_seed + airlines → route_market_data(source='seed')
pnpm tsx scripts/crawl.ts                    # 뽐뿌 1회
pnpm dev
```

### 일상 개발
```bash
pnpm dev
pnpm tsx scripts/crawl.ts
pnpm tsx scripts/verify.ts
pnpm tsx scripts/cost_check.ts
pnpm test
```

### 시연 전 백업
```bash
pg_dump $SUPABASE_DB_URL --data-only --table=deals \
  --table=route_market_data --table=price_observations \
  > scripts/restore_demo.sql
```
필요 시 `SHOW_CACHED_ONLY=true` 세팅으로 외부 호출 차단 상태에서 복구.

## 장애·복구

| 경로 | 증상 | 복구 |
|------|------|------|
| 크롤러 1개 실패 | 해당 source 헬스 빨강 | 다음 cron 자동 재시도 (UPSERT 멱등) |
| 크롤러 전체 2h+ | 딜 공급 단절 | `StaleBanner` 자동 표시. 기존 deals·baseline 은 계속 노출 |
| 관측 부족 (특정 노선 <10건) | 해당 노선 🔥 판정 confidence=medium | 시드 FSC/LCC 폴백. 관측 누적되면 자동 승격 |
| 관측 오염 (허위 가격 반복 UPSERT) | baseline 하락 | ADR-011: 해당 노선 시드 단독 강제 스위치 |
| LLM 장애 (Stretch 2) | LLM 큐레이션 중단 | 규칙 기반 정적 한 줄로 자동 폴백 — 빈 카드 없음 |
| Supabase 장애 | DB 쿼리 실패 | Vercel revalidate 60초 캐시로 1~2분 버팀. 이후 에러 페이지 |
| 원문 링크 대량 깨짐 | verification_status=snapshot 증가 | 3회 연속 실패 시 조기 만료. 아카이브 페이지는 표시 유지 |
| UI 전면 장애 대응 | 평가 직전 외부 API 불안정 의심 | `SHOW_CACHED_ONLY=true` Vercel env → UI 캐시 모드. 배치는 계속 복구 시도 |

## 아카이브 페이지 렌더 정책
- `/archive/[date]/page.tsx`는 `archive_snapshots.deal_ids`의 UUID들을 JOIN하여 해당 시점 TOP 5 표시
- 만료(`expires_at < now()`)·`snapshot`·`price_changed` 상태인 딜도 **아카이브 페이지에는 표시** (그날의 기록이므로)
- 각 카드 우상단에 `당시 가격` 라벨 추가 (현재 유효 여부 불확실을 명시)
- 원문 링크는 유지. 404면 `snapshot` 라벨만 덧붙임

## 테스트 전략
- **Baseline 서비스**: 시드 로드 + 관측 가중 혼합 + FSC/LCC 폴백 경로 단위 테스트 (ADR-011 우선순위 5단계)
- **크롤러**: `__fixtures__/<source>-list-YYYY-MM-DD.html` 네이밍 (예: `__fixtures__/ppomppu-list-2026-04-15.html`). 커뮤니티 레이아웃 변경 감지를 위해 월 1회 신규 캡처 append
- **규칙 파서**: 골든셋 50개 (`__fixtures__/parser-golden.json`: title·expected 페어). 목표 ≥ 60%
- **skyscanner-url.ts**: `depart_from` null 시 오늘+7일 기본값으로 URL 생성 (엣지 케이스 단위 테스트)
- **항공사 분류**: `lib/airlines.ts` 사전 커버리지 (골든셋 딜의 90%+ 분류 성공)
- **scorer**: FSC/LCC 분기, 분위수 경계값, baseline null 폴백
- **dedupe**: 가격 천 원·월 경계·carrier_class 차이
- **tz**: 자정 전후 KST/UTC
- **verifier**: 404/200 및 HEAD 타임아웃
- **share_token**: 유효/무효, Basic Auth 폴백
- **E2E**: 생략. 수동 시연

## 관측/운영
- 크롤러·(Stretch 2) 큐레이션·검증·비용체크 모두 `crawler_runs`에 통합 기록
- `/api/health` → `<CrawlerHealth/>` (각 source 최근 성공 시각)
- `api_usage_daily`로 월 누적 사용량 추적 (Supabase 크기 + Stretch 2 Anthropic 토큰)
- 상세 런북: `OPERATIONS.md` (Stretch 2 에서 작성)
