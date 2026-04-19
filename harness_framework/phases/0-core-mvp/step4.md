# Step 4: baseline-scorer-pipeline

## 읽어야 할 파일

- `docs/ARCHITECTURE.md` — "데이터 흐름 (1) Baseline 공급" · "(2) 딜 크롤" · "(3) 실효성 검증" · "(5) 비용 모니터"
- `docs/ADR.md` — ADR-006 (🔥 판정), ADR-011 (Baseline 우선순위 5단계), ADR-018 (Core HEAD 검증), ADR-024 (FSC/LCC 이중)
- `docs/methodology.md` — 우선순위 요약 표
- 이전 step 산출물:
  - `../app/src/types/deal.ts` · `src/lib/*` · `src/data/*` · `scripts/migrate.sql` · `scripts/seed.sql`
  - `../app/src/services/crawlers/ppomppu.ts` · `src/services/parser/rules.ts` · `__fixtures__/*`

## 작업

앱 루트는 `../app/`. 이 step 은 **DB 쓰기를 포함**한다. 크롤 파이프라인이 실제로 `deals` · `price_observations` · `crawler_runs` 로 UPSERT/INSERT 한다.

### 1) `src/services/baseline.ts` (ADR-011)

```ts
import type { RouteMarketData, CarrierClass } from '@/types/deal'

export type ResolvedBaseline = {
  p10Krw: number | null
  p50Krw: number | null
  p90Krw: number | null
  source: 'observed' | 'seed' | 'mixed' | null
  confidence: 'low' | 'medium' | 'high' | null
  observationCount: number
}

export async function resolveBaseline(params: {
  origin: string
  destination: string
  carrierClass: CarrierClass
  now?: Date                     // 테스트 주입
  client?: SupabaseClient        // 테스트 주입 (기본: getAnonClient 쓰되, 여기선 service client 권장)
}): Promise<ResolvedBaseline>
```

**우선순위 (ADR-011)**:

1. `price_observations` 에서 `(origin, destination, carrier_class)` 최근 30 일 필터, COUNT. `>= 30` → 관측 단독, `percentile_cont(0.1, 0.5, 0.9)` 산출, `confidence: 'high'`, `source: 'observed'`
2. `10 <= count < 30` → 관측 분위수 × 0.6 + 시드 분위수 × 0.4 (시드는 `route_market_data` 에서 `(o,d,class,source='seed')` 조회). `confidence: 'medium'`, `source: 'mixed'`
3. `count < 10` 이고 시드 `(o,d,class in {'fsc','lcc'})` 존재 → 시드 단독. `confidence: 'medium'`, `source: 'seed'`
4. `carrier_class = 'mixed'` 시드만 존재 → 시드 mixed. `confidence: 'low'`, `source: 'seed'` (caller 가 🔥 배지 미부여로 처리)
5. 없음 → 전 필드 null, `confidence: null`, `source: null`

**관측 분위수 산출 방법**:
- 옵션 A: Supabase RPC 함수 (`percentile_cont` 사용). 이 step 에서는 간단히 옵션 B 로 가자
- **옵션 B** (선택): 관측 가격 배열을 client 로 내려받아 JS 에서 백분위 계산. 30 일 × 노선·class 당 많아야 수백 건이라 부담 없음. 정렬 후 linear interpolation

**단위 테스트** (`src/services/baseline.test.ts`):
- mock Supabase 로 관측 5건 → 시드 단독 반환
- 관측 15건 → 혼합 (수학 검증)
- 관측 40건 → 관측 단독
- 시드 없음 + 관측 5건 → 전 null
- mixed 시드만 → confidence='low', source='seed'

### 2) `src/lib/scorer.ts` (ADR-006)

```ts
import type { CarrierClass } from '@/types/deal'
import type { ResolvedBaseline } from '@/services/baseline'

export type ScoreResult = {
  discountRate: number | null       // (baselineP50 - price) / baselineP50, 음수는 0으로 clamp? 아님, 음수도 그대로
  pricePercentile: number | null    // 0~100
  hotDeal: boolean
}

export function score(params: {
  priceKrw: number
  carrierClass: CarrierClass
  baseline: ResolvedBaseline
}): ScoreResult
```

규칙:
- `baseline.source === null || baseline.p10Krw === null` → 전 null + `hotDeal: false`
- `baseline.confidence === 'low'` (mixed 시드) → 할인율·분위수 계산은 하되 **`hotDeal: false`** 강제 (ADR-006 표)
- `pricePercentile`: linear interpolation 으로 대략 위치 (p10~p50~p90 세 포인트 기반). p10 이하는 `<=10`, p50 주변은 50, p90 초과는 `>=90`
- `discountRate = (baseline.p50Krw - price) / baseline.p50Krw`
- `hotDeal = pricePercentile <= 10 && confidence in ['medium', 'high']` (low 미포함)

**단위 테스트**:
- 가격 = p50 → percentile ≈ 50, discountRate ≈ 0
- 가격 < p10 → percentile ≤ 10, hotDeal=true (confidence high)
- 가격 < p10, confidence low → hotDeal=false
- baseline null → 전 null

### 3) `src/services/verifier.ts` (ADR-018 Core HEAD)

```ts
export async function verifyUrl(url: string, opts?: { timeoutMs?: number }):
  Promise<{ status: 'active' | 'snapshot' | 'unchecked'; httpStatus: number | null }>
// HEAD 요청, 5s timeout.
// 404/410 → 'snapshot'
// 200-399 → 'active'
// 그 외 (5xx, timeout, network error) → 'unchecked' (retry 여지)
```

**단위 테스트**: mock fetch 로 각 status 케이스.

### 4) `scripts/crawl.ts`

파이프라인 entry point. 실행:
```bash
pnpm tsx scripts/crawl.ts
```

흐름:
1. `crawler_runs` INSERT (`source='ppomppu'`, `started_at`)
2. `crawlPpomppu(config)` → `RawPost[]`
3. 각 `RawPost`:
   a. `parseRules(post)` → `DealDraft`
   b. `normalizeRoute` + `classOf(carrierCode)` 적용
   c. 필수 필드 (origin, destination, priceKrw) 하나라도 null 이면 skip (`savedCount++` 아님)
   d. `dedupeKey` 산출
   e. `resolveBaseline` 호출
   f. `score` 산출
   g. `deals` UPSERT (on `dedupe_key` conflict — `source_urls` 배열에 추가, `price_krw` 최저치 유지)
   h. `price_observations` INSERT (신규·갱신 관계없이 항상 1 행 추가)
   i. 본문 TTL (`body_expires_at = postedAt + 7days`) 계산하여 저장
5. **관측 재집계**: 루프 종료 후 `(origin, destination, carrier_class)` 조합마다 최근 30일 관측 ≥ 10건이면 `route_market_data` UPSERT (`source='observed'`)
6. `crawler_runs` UPDATE (`finished_at`, `processed_count`, `saved_count`, `success=true`)
7. 본문 TTL 청소: `update deals set body=null where body_expires_at < now() and body is not null`

에러 처리:
- 개별 post 실패 → `errors` 배열에 메시지 추가, 계속 진행
- 전체 크래시 → `crawler_runs` 를 `success=false` 로 UPDATE 후 exit(1)

### 5) `scripts/verify.ts`

실행:
```bash
pnpm tsx scripts/verify.ts
```

흐름:
1. `crawler_runs` INSERT (`source='verifier'`)
2. `SELECT` 100개: `expires_at > now() AND posted_at < now() - interval '24 hours' AND (verified_at IS NULL OR verified_at < now() - interval '3 hours')`, ORDER BY `verified_at NULLS FIRST`
3. 각 딜의 `source_urls` 중 첫 URL 에 `verifyUrl` (HEAD, 5s)
4. `deal_verifications` INSERT + `deals` UPDATE:
   - 성공 → `verification_status='active'`, `verification_fail_count=0`, `verified_at=now`
   - snapshot → `verification_fail_count = prev+1`, `verification_status='snapshot'`
   - unchecked → `verified_at=now` 만 업데이트 (fail_count 증가 X)
5. `verification_fail_count >= 3` → `expires_at=now()` (조기 만료)
6. 요청 간 500 ms 간격

### 6) `scripts/cost_check.ts`

실행:
```bash
pnpm tsx scripts/cost_check.ts
```

흐름 (Core 범위, `docs/ARCHITECTURE.md` "(5) 비용 모니터"):
1. `crawler_runs` INSERT (`source='cost_check'`)
2. `api_usage_daily` 오늘 (KST) 행 UPSERT
3. `select count(*) from deals` → `supabase_rows_total` 근사치 계산 (deals + observations + 주요 테이블 합)
4. 임계:
   - Supabase 총 rows 추정치가 250,000 초과 시 (대략 50% 한계) → webhook POST
   - Anthropic 토큰 필드는 **Core 에선 항상 0** 이므로 체크만 하고 알림 없음
5. `ALERT_WEBHOOK` 설정돼 있을 때만 POST (Discord/Slack 공통 JSON `{ content: "..." }`)
6. webhook 누락은 no-op (Core 에선 흔한 상황)

**`SHOW_CACHED_ONLY=true` 체크**: ARCHITECTURE.md 는 "GH Actions secrets 에 별도 미러 설정 시에만 적용" 이라 설명하므로, 이 스크립트는 env 가 있으면 스킵·없으면 진행. Vercel 전용 env 이므로 GH Actions 에선 보통 미설정.

### 7) 실제 배치 스모크

Supabase 준비되어 있으므로 한 번 돌려본다:
```bash
cd ../app
pnpm tsx scripts/crawl.ts       # 뽐뿌 1회 (실제 네트워크)
pnpm tsx scripts/verify.ts      # 초기엔 대상 0건일 것
pnpm tsx scripts/cost_check.ts
```

크롤이 실패하면 (사이트 접근 차단·HTML 구조 변경 등) `phases/0-core-mvp/index.json` 을 `blocked` 로 찍지 말고 **에러 메시지를 crawler_runs 에 기록하고 종료하되 step 은 `completed`** 로 처리하라 — 실제 환경 크롤 성공률은 유동적이고, 파이프라인 자체의 완성도가 이 step 의 기준이다. 다만 `summary` 에 "실제 크롤 1회 샘플 결과: saved <N>건 / errors <M>건" 형태로 명시.

## Acceptance Criteria

```bash
cd ../app
pnpm build
pnpm test        # baseline.test, scorer.test, verifier.test 전부 통과
pnpm typecheck 2>/dev/null || pnpm exec tsc --noEmit
pnpm lint
pnpm tsx scripts/crawl.ts        # crawler_runs 1 행 생성, exit 0
pnpm tsx scripts/cost_check.ts   # api_usage_daily 1 행, exit 0
```

DB 확인:
```sql
select source, success, processed_count, saved_count from crawler_runs order by started_at desc limit 5;
select count(*) from price_observations;
select count(*) from route_market_data where source='observed';  -- 관측 ≥10 노선 수
```

## 검증 절차

1. 위 AC 전부 성공
2. `resolveBaseline` 이 ADR-011 우선순위 5단계를 전부 통과하는 테스트가 있음
3. `score` 가 low confidence 에서 `hotDeal=false` 강제하는 테스트가 있음
4. `scripts/crawl.ts` 에서 필수 필드 null 딜이 UPSERT 되지 않음 (fail-soft)
5. `price_observations` INSERT 가 모든 저장 딜에 대해 발생 (count 매칭)
6. `baseline.ts`/`scorer.ts` 에 `'api'` 리터럴이 없음
7. `phases/0-core-mvp/index.json` step 4 업데이트:
   - 성공 → `"status": "completed"`, `"summary": "services/baseline.ts (ADR-011 5단계) + lib/scorer.ts (FSC/LCC 분기, p10) + services/verifier.ts (HEAD 5s). scripts/{crawl,verify,cost_check}.ts 파이프라인 + 관측 재집계. 실제 crawl 1회 샘플: saved <N> / errors <M>."`

## 금지사항

- **`baseline.ts` 에서 `source='api'` 또는 `'amadeus'` 분기 금지** (ADR-022). 이유: Core 스키마에 해당 값이 없음
- **`scorer.ts` 에서 confidence `low` 에 🔥 부여 금지** (ADR-006 표). 이유: mixed 시드는 정확도 낮음. UI 혼동 방지
- **크롤러를 `scripts/crawl.ts` 외에서 호출 금지** (CLAUDE.md). 이유: DB·로깅 경계 분리
- **`verifier.ts` 에서 GET 요청 사용 금지** (ADR-018 Core 는 HEAD 만). 이유: 본문 패턴 검출은 Stretch. IP 차단 방어 겸
- **`scripts/ingest_market.ts` 생성 금지** (ADR-022). 이유: Stretch 3 조건부
- **`crawler_runs.success=false` 인데 exit(0) 금지**. 이유: GH Actions 에서 에러 감지 못함. 파이프라인 최종 상태와 exit code 일치
