# Step 2: lib-foundations

## 읽어야 할 파일

- `docs/ARCHITECTURE.md` — 데이터 모델 (`types/deal.ts`), 디렉토리 구조
- `docs/ADR.md` — ADR-009 (dedupe 키), ADR-015 (UTC/KST), ADR-017 (공항 별명), ADR-019 (share token), ADR-027 (스카이스캐너 URL)
- `docs/UI_GUIDE.md` — 용어 정책 ("역대가" 금지 등)
- 이전 step 산출물:
  - `../app/src/data/baseline_seed.json` · `airlines.json` · `airports.json`
  - `../app/scripts/migrate.sql`

이전 step 에서 만들어진 데이터 파일 스키마를 먼저 읽고 타입을 맞춰라.

## 작업

앱 루트는 `../app/`. 이 step 은 **DB 쿼리를 실행하지 않는다** — 순수 함수 + 타입 + Supabase 클라이언트 초기화만.

### 1) `src/types/deal.ts`

`docs/ARCHITECTURE.md` "데이터 모델" 타입을 그대로 TypeScript 로 옮긴다. 주의:

- `Source` 는 `'ppomppu' | 'ruliweb' | 'playwings'` (amadeus 없음)
- `RouteMarketData.source` 는 `'seed' | 'observed'` (**`'api'` 금지**, ADR-022)
- `Deal.baselineSource` 는 `'observed' | 'seed' | 'mixed' | null`
- `CarrierClass = 'fsc' | 'lcc' | 'mixed'`
- `VerificationStatus = 'active' | 'snapshot' | 'price_changed' | 'unchecked'`
- `BaselineSeedEntry` 타입을 추가로 export (baseline_seed.json 엔트리 스키마)

### 2) `src/lib/db.ts`

Supabase 클라이언트 팩토리 두 개:

```ts
export function getAnonClient(): SupabaseClient          // NEXT_PUBLIC_* 키 사용. 읽기 전용 가정
export function getServiceClient(): SupabaseClient       // SUPABASE_SERVICE_ROLE_KEY 사용. 쓰기 전용
```

- 환경변수 누락 시 명확한 에러 (`throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for getServiceClient')`)
- `getServiceClient` 는 절대 클라이언트 코드에서 import 되지 않아야 함 → 파일 상단 주석: `// NEVER import from 'use client' components or app/api routes exposed to anon`
- 두 함수는 동일 호출에서 동일 인스턴스 반환하도록 module-level 캐시

### 3) `src/lib/tz.ts` (ADR-015)

```ts
export const KST = 'Asia/Seoul'
export function toKstIsoString(d: Date): string          // UTC Date → 'YYYY-MM-DD HH:mm' KST
export function toKstDateOnly(d: Date): string           // 'YYYY-MM-DD' KST
export function kstStartOfDay(d: Date): Date             // 해당 KST 자정을 나타내는 UTC Date
export function formatRelativeKst(d: Date, now?: Date): string  // '3분 전', '2시간 전', '어제 15:20' 등
```

Intl API 사용 (`Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', ... })`). 외부 라이브러리 금지.

**단위 테스트** (`src/lib/tz.test.ts`): 자정 전후(23:59 UTC vs 00:00 UTC KST 환산), 경과 시간 경계(59초, 60초, 3599초, 3600초).

### 4) `src/lib/airport-aliases.ts` + `src/lib/route-map.ts`

`airport-aliases.ts`:
```ts
import airports from '@/data/airports.json'
export function toRepresentative(iata: string): string   // 'HND' → 'NRT', unknown → 자기 자신 대문자
export function isKnownAirport(iata: string): boolean
export function cityOf(iata: string): string | null
```

`route-map.ts` — 제목 파싱 보조:
```ts
export const DESTINATION_ALIASES: Record<string, string>  // '도쿄'→'NRT', '오사카'→'KIX', '오키나와'→'OKA', ...
export const ORIGIN_ALIASES: Record<string, string>        // '인천'→'ICN', '서울'→'ICN', '김포'→'GMP'
export function normalizeRoute(rawOrigin?: string | null, rawDest?: string | null):
  { origin: string | null; destination: string | null }
  // 1. 별명 사전 조회 (한글/영문) → IATA
  // 2. toRepresentative 적용
  // 3. GMP 는 ICN 으로 병합하지 않음 (MVP 제외, ADR-017)
```

**단위 테스트**: 한글 도시명 → IATA, HND→NRT 변환, 미지 문자열 → null.

### 5) `src/lib/airlines.ts`

```ts
import airlinesData from '@/data/airlines.json'
export type AirlineInfo = { name: string; class: 'fsc' | 'lcc'; country: string }
export function lookupCarrier(codeOrName: string): { code: string; info: AirlineInfo } | null
export function classOf(code: string | null | undefined): 'fsc' | 'lcc' | 'mixed'
```

- `lookupCarrier` 는 코드(`KE`)와 한글명(`대한항공`) 모두 허용. 한글명 매칭은 `name` 필드 역방향 조회
- `classOf(null)` 또는 매칭 실패 → `'mixed'`

**단위 테스트**: `classOf('KE')` → `'fsc'`, `classOf('7C')` → `'lcc'`, `classOf('UNKNOWN')` → `'mixed'`, `lookupCarrier('대한항공')` → `{ code: 'KE', ... }`.

### 6) `src/lib/dedupe.ts` (ADR-009)

```ts
export function dedupeKey(params: {
  origin: string
  destination: string
  priceKrw: number
  departYear: number
  departMonth: number        // 1-12
  carrierClass: CarrierClass
}): string
// 반환: sha1(origin | destination | floor(price/1000)*1000 | YYYY-MM | carrier_class)
```

- Node `crypto` 모듈 사용 (`createHash('sha1')`)
- `posted_at`·정확 일자·시간 포함 **금지** (ADR-009)
- `departYear`·`departMonth` 는 `Deal.departFrom` 의 KST 월을 외부에서 꺼내 전달 (이 함수는 Date 처리 안 함)

**단위 테스트**: 가격 29,500 과 29,999 가 같은 키 (천 원 내림), 가격 30,000 은 다른 키, carrier_class 만 달라도 다른 키, 월만 달라도 다른 키.

### 7) `src/lib/format.ts`

```ts
export function formatKrw(n: number): string              // '135,000원'
export function formatDiscount(rate: number): string      // 0.52 → '-52%'
export function formatPercentile(p: number): string       // 7.3 → 'p7'
export function clampCurationText(s: string, maxLen: number = 60): string  // UTF-8 안전 cut
```

**단위 테스트**: 경계값 (0, 1, 0.30, 1.5), 소수점 반올림 규칙.

### 8) `src/lib/share-token.ts` (ADR-019)

```ts
export function parseShareTokens(env: string | undefined): string[]
  // 콤마 분리, 공백 trim, 12자 미만 필터링. 빈 배열 허용.
export function verifyShareToken(token: string | null | undefined, allowedTokens: string[]): boolean
  // timing-safe 비교 (crypto.timingSafeEqual).
```

**단위 테스트**: 빈 env → `[]`, `'a,b,longenoughtoken12'` → `['longenoughtoken12']` 만 포함, verify 는 대소문자 구분.

### 9) `src/lib/skyscanner-url.ts` (ADR-027)

```ts
export function buildSkyscannerSearchUrl(params: {
  origin: string
  destination: string
  departFrom?: Date | null
}): string
// 'https://www.skyscanner.co.kr/transport/flights/{origin}/{destination}/{YYMMDD}/'
// departFrom null → 오늘 + 7일 (KST 기준) fallback
// departFrom 은 KST 자정 기준으로 YYMMDD 포맷 (tz.ts kstStartOfDay 활용)
```

**단위 테스트**: null → 오늘+7일 YYMMDD, 2026-05-03 → `260503`, origin/destination 소문자 입력도 대문자로 정규화.

### 10) 모든 단위 테스트 통과

각 lib 파일 옆에 `*.test.ts` 동봉. vitest 로 전부 실행 가능해야 한다.

## Acceptance Criteria

```bash
cd ../app
pnpm build
pnpm test         # 전 단위 테스트 통과 (최소 30개+)
pnpm typecheck 2>/dev/null || pnpm exec tsc --noEmit
pnpm lint
```

## 검증 절차

1. 위 AC 전부 성공
2. `src/types/deal.ts` 에 `'api'` 또는 `'amadeus'` 리터럴이 없는지 확인
3. `src/lib/` 의 모든 함수가 **순수 함수** (DB·네트워크 호출 없음) 인지 확인. `db.ts` 만 예외
4. `import 'server-only'` 가 `db.ts` 상단에 있는지 (Next.js 15 client bundle 누수 방지)
5. `phases/0-core-mvp/index.json` step 2 업데이트:
   - 성공 → `"status": "completed"`, `"summary": "types/deal.ts (RouteMarketData.source='seed'|'observed' 전용), lib/{db,tz,airport-aliases,route-map,airlines,dedupe,format,share-token,skyscanner-url}.ts + 각 단위 테스트. DB 쿼리는 db.ts 팩토리만 제공하고 실제 쿼리는 후속 step."`

## 금지사항

- **`src/types/deal.ts` 의 `RouteMarketData.source` 에 `'api'` 유니온 포함 금지** (ADR-022). 이유: Core 스키마와 어긋남. Stretch 3 때 타입까지 동시 확장
- **`lib/*.ts` 에서 Supabase 쿼리 호출 금지** (책임 분리). 이유: 크롤·검증·UI 서브시스템이 각자 쿼리하고, lib 은 순수 변환에 집중
- **외부 라이브러리(`date-fns`, `dayjs`, `moment`) 설치 금지** (tz.ts). 이유: Intl 만으로 충분 + 번들 사이즈. **3번 비슷한 코드 > 잘못된 추상화 1개** 원칙
- **`sha1` 대신 다른 해시(`md5`, `sha256`) 사용 금지** (ADR-009). 이유: dedupe_key 는 DB 레벨 고정 키
- **`dedupeKey` 에 `postedAt`·시간·분 포함 금지** (ADR-009). 이유: 같은 딜 재게시 시 dedupe 가 안 먹힘
