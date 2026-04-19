# Step 1: supabase-schema-seed

## 읽어야 할 파일

- `docs/ARCHITECTURE.md` — "Supabase 스키마 (`scripts/migrate.sql` 요지)" 블록 전부 + "데이터 모델" 타입 정의
- `docs/ADR.md` — ADR-003 (Supabase), ADR-011 (Baseline 우선순위 5단계), ADR-017 (공항 표준화)
- `docs/methodology.md` — 시드 조사 범위 20 노선 표, 엔트리 구조, FSC/LCC 분리 원칙
- 이전 step 산출물:
  - `../app/package.json` · `../app/.env.example` (step 0 에서 생성)

이전 step 에서 만들어진 구조를 이해한 뒤 작업하라. 앱 루트는 `../app/`.

## 작업

### 1) `scripts/migrate.sql`

`../app/scripts/migrate.sql` 생성. `docs/ARCHITECTURE.md` "Supabase 스키마" 섹션 그대로 구현:

- 테이블 7개: `deals` · `route_market_data` · `price_observations` · `crawler_runs` · `deal_verifications` · `archive_snapshots` · `api_usage_daily`
- 인덱스: `deals_discount_idx`, `deals_posted_idx`, `deals_route_idx`, `deals_hot_idx`, `deals_verify_due_idx`, `obs_route_time_idx`, `crawler_runs_recent_idx`, `dv_recent_idx`
- RLS 정책: 모든 테이블 `enable row level security`, `anon_read_*` 정책만 (쓰기 정책 없음 → service_role 전용)
- `route_market_data.source` check 제약: `('seed','observed')` **만** 포함. `'amadeus'` / `'api'` 절대 넣지 마라 (ADR-022 Rejected 2026-04-19, 영구 제외)
- `api_usage_daily` 에 `amadeus_calls` 컬럼 넣지 마라 (ADR-022 Rejected)
- `crawler_runs.source` 은 text 로 두고 제약 없이 `'ppomppu','ruliweb','playwings','curator','verifier','archiver','cost_check'` 수용

멱등 실행을 위해 `create table if not exists ...`, `create index if not exists ...`, RLS 정책은 `drop policy if exists ... ; create policy ...` 순서로.

### 2) `src/data/baseline_seed.json`

`../app/src/data/baseline_seed.json` — 20 노선 × FSC/LCC/mixed 엔트리. `methodology.md` 의 엔트리 구조를 그대로 따른다:

```json
[
  {
    "origin": "ICN",
    "destination": "KIX",
    "carrierClass": "lcc",
    "baselineKrw": 180000,
    "p10Krw": 99000,
    "p50Krw": 180000,
    "p90Krw": 280000,
    "confidence": "medium",
    "sampledAt": "2026-04-18",
    "source": "seed"
  },
  ...
]
```

**범위** (methodology.md 표):
- 아시아 17: NRT, KIX, FUK, CTS, OKA, NGO, TPE, HKG, PVG, BKK, DAD, SGN, SIN, KUL, MNL, CEB, GUM
- 미국 3: LAX, JFK, HNL

**각 노선 엔트리 규칙**:
- 단거리 (아시아 17): `fsc`, `lcc`, `mixed` 3 엔트리 = 51
- 장거리 (LAX, JFK, HNL): `fsc`, `mixed` 2 엔트리 = 6
- 합 57 엔트리 (methodology.md "최대 60 엔트리" 근사)

**가격 산정**:
- 수동 조사가 실제로는 분기 1회 작업이므로, 이 step 에서는 **합리적 초기값**을 넣는다. 근사 기준:
  - 일본 FSC 왕복 30만~45만 / LCC 15만~28만
  - 동남아 FSC 35만~55만 / LCC 20만~38만
  - 중화권 FSC 30만~45만 / LCC 17만~28만
  - 괌 FSC/LCC 유사 40~55만 / 25~38만
  - LAX/JFK/HNL FSC 120만~160만 (mixed 는 약간 낮춤)
- 각 엔트리 `p10` = `baselineKrw × 0.55`, `p50` = `baselineKrw`, `p90` = `baselineKrw × 1.55` 로 근사 (정수로 반올림, 천 원 단위)
- `sampledAt` 은 오늘 날짜 (2026-04-18 권장)
- LCC 운항이 사실상 없는 장거리(LAX·JFK·HNL) 는 `lcc` 엔트리 **생성하지 않는다** (ADR-021 + methodology.md)

### 3) `src/data/airlines.json`

`../app/src/data/airlines.json` — `docs/ARCHITECTURE.md` "항공사 분류" 블록 예시를 기반으로 **최소 25개** 엔트리 (한국 LCC 전부 + 주요 FSC + 외항 LCC). 구조:

```json
{
  "KE": { "name": "대한항공", "class": "fsc", "country": "KR" },
  "OZ": { "name": "아시아나항공", "class": "fsc", "country": "KR" },
  "LJ": { "name": "진에어", "class": "lcc", "country": "KR" },
  ...
}
```

포함 필수 (파싱 커버리지용):
- 한국: KE, OZ, LJ, 7C, TW, BX, ZE(이스타), RS(에어서울), YP(에어프레미아)
- 일본: NH(ANA), JL(JAL), MM(피치), GK(젯스타재팬)
- 동남아/중화권: SQ, CX, VN, VJ, AK, 5J, CI(중화), BR(에바), CZ(남방), CA(에어차이나)
- 미국: UA, DL, AA, HA(하와이안)

### 4) `src/data/airports.json`

`../app/src/data/airports.json` — 20 노선 대상 공항 + 별명 (ADR-017). 구조:

```json
{
  "ICN": { "city": "서울", "country": "KR", "representative": "ICN" },
  "NRT": { "city": "도쿄", "country": "JP", "representative": "NRT" },
  "HND": { "city": "도쿄", "country": "JP", "representative": "NRT" },
  "KIX": { "city": "오사카", "country": "JP", "representative": "KIX" },
  "ITM": { "city": "오사카", "country": "JP", "representative": "KIX" },
  "JFK": { "city": "뉴욕", "country": "US", "representative": "JFK" },
  "EWR": { "city": "뉴욕", "country": "US", "representative": "JFK" },
  "LGA": { "city": "뉴욕", "country": "US", "representative": "JFK" },
  "LAX": { "city": "LA", "country": "US", "representative": "LAX" },
  ...
}
```

대상 공항 + 별명 최소 30개 (ADR-017 표 참조).

### 5) `scripts/seed.sql`

`../app/scripts/seed.sql` — `baseline_seed.json` 을 SQL INSERT 로 풀어쓴 형태. 실제 로드는 `scripts/backfill.ts --seed-reload` 가 더 편하지만, psql 환경에서도 돌게 SQL 버전도 만든다.

구조:
```sql
-- 멱등: 기존 seed 로우 삭제 후 재삽입
delete from route_market_data where source = 'seed';

insert into route_market_data
  (origin, destination, carrier_class, p5_krw, p10_krw, p25_krw, p50_krw, p90_krw,
   cheapest_today_krw, cheapest_today_carrier, sampled_at, ttl_hours, source)
values
  ('ICN','KIX','lcc', null, 99000, null, 180000, 280000, null, null, '2026-04-18T00:00:00Z', 720, 'seed'),
  ...
;
```

`p5_krw`, `p25_krw`, `cheapest_today_*` 는 이 step 단계에선 null. (관측 누적 시 `backfill.ts` 또는 `scripts/crawl.ts` 말미 집계가 채움.)

### 6) `scripts/backfill.ts`

`../app/scripts/backfill.ts` — CLI 스크립트. 실행:
```bash
pnpm tsx scripts/backfill.ts --seed-reload
```

동작:
1. `--seed-reload` 플래그 확인 (없으면 usage 출력 후 종료)
2. `src/data/baseline_seed.json` 을 읽음
3. Supabase service_role client 로 `route_market_data` 에서 `source='seed'` 행 delete
4. baseline_seed 엔트리를 upsert (primary key: origin+destination+carrier_class)
5. 성공·실패 카운트 stdout

환경변수: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. 없으면 에러 메시지 + exit(1).

### 7) 실제 DB 에 migrate + seed 적용

사용자가 Supabase 를 이미 준비해뒀음 (phase 설계 단계 확인됨). 다음 명령을 실행하라:

```bash
cd ../app
psql "$SUPABASE_DB_URL" -f scripts/migrate.sql
psql "$SUPABASE_DB_URL" -f scripts/seed.sql
```

둘 중 하나라도 에러 시 `blocked` 상태로 전환, `blocked_reason` 에 에러 메시지 + 필요한 조치 (예: `SUPABASE_DB_URL` 환경변수 누락, 연결 실패, 권한 문제) 를 기록하라.

## Acceptance Criteria

```bash
cd ../app
pnpm build                                    # 컴파일 에러 없음
psql "$SUPABASE_DB_URL" -f scripts/migrate.sql # 멱등 성공
psql "$SUPABASE_DB_URL" -f scripts/seed.sql    # 57 행 upsert
pnpm tsx scripts/backfill.ts --seed-reload    # 동일하게 돌아감
pnpm test                                     # vitest 여전히 통과
```

DB 확인:
```sql
select count(*) from route_market_data where source='seed';  -- 55~60 사이
select count(distinct (origin, destination)) from route_market_data;  -- 20
```

## 검증 절차

1. 위 AC 실행 전부 성공
2. `migrate.sql` 에 `'amadeus'` / `'api'` / `amadeus_calls` 문자열이 없음을 확인
3. `baseline_seed.json` 엔트리 수가 55~60 개 사이
4. 장거리 3 노선(LAX/JFK/HNL) 은 `lcc` 엔트리가 없음을 JSON 에서 확인
5. RLS 정책이 모든 테이블에 적용됐는지: `select tablename, policyname from pg_policies where schemaname='public'` 결과에 anon_read_* 가 7 테이블 모두 나옴
6. `phases/0-core-mvp/index.json` step 1 업데이트:
   - 성공 → `"status": "completed"`, `"summary": "migrate.sql 7 테이블 + RLS anon read 정책 생성. baseline_seed.json 57 엔트리 (20 노선 × FSC/LCC/mixed, 장거리 3 노선은 FSC+mixed). airlines.json 25+ 엔트리, airports.json ADR-017 별명 매핑 포함. seed.sql + backfill.ts 둘 다 멱등. Supabase 에 실제 적용 완료."`
   - Supabase 연결 실패 → `"status": "blocked"`, `"blocked_reason": "<실패 원인 + 필요한 조치>"`

## 금지사항

- **`route_market_data.source` 에 `'amadeus'` 또는 `'api'` 값 허용 금지** (ADR-022). 이유: Core 에 외부 시세 API 없음. Stretch 3 진입 시 ALTER로 추가
- **`api_usage_daily.amadeus_calls` 컬럼 생성 금지** (ADR-022). 이유: 위와 동일
- **LCC 가 사실상 없는 장거리(LAX/JFK/HNL) 노선에 `lcc` 엔트리 생성 금지** (methodology.md). 이유: 조사 불가 데이터로 baseline 을 만들면 과대 판정
- **쓰기 RLS 정책 생성 금지** (ADR-003). 이유: anon 에서 쓰기 가능하면 public repo 에서 즉시 악용. service_role 키만 쓰기 허용
- **`baseline_seed.json` 에 `high` confidence 엔트리 넣지 마라** (methodology.md 표). 이유: 수동 조사는 정의상 medium 상한. high 는 관측 ≥30 건 도달 시에만 자동 승격
