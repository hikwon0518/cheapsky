# Step 3: ppomppu-crawler-parser

## 읽어야 할 파일

- `docs/ARCHITECTURE.md` — "데이터 흐름 (2) 딜 크롤" 의사코드, 디렉토리 `services/crawlers/`, `services/parser/`
- `docs/ADR.md` — ADR-004 (뽐뿌 Core 단일), ADR-008 (ToS·저작권 방어), ADR-024 (FSC/LCC 이중 baseline)
- `docs/PRD.md` — "실효성 검증" "중복 제거" 섹션, 성공 지표의 파싱 커버리지 목표 (Core ≥60%)
- 이전 step 산출물:
  - `../app/src/types/deal.ts` (RawPost, DealDraft)
  - `../app/src/lib/{route-map,airlines,airport-aliases,dedupe}.ts`
  - `../app/src/data/airlines.json`

## 작업

앱 루트는 `../app/`. 이 step 은 **DB 쓰기 없이** 크롤러와 규칙 파서만 구현. 파이프라인(`scripts/crawl.ts`)은 step 4 에서.

### 1) `src/services/crawlers/types.ts`

```ts
import type { RawPost, Source } from '@/types/deal'

export type CrawlerConfig = {
  userAgent: string              // env CRAWLER_USER_AGENT
  maxPosts?: number              // 기본 40
  minDelayMs?: number            // 요청 간격, 기본 1000
  fetch?: typeof fetch           // 테스트 주입용
  now?: () => Date               // 테스트 주입용
}

export type Crawler = (config: CrawlerConfig) => Promise<RawPost[]>

export type ParsedListItem = {
  sourceId: string
  sourceUrl: string
  title: string
  postedAt: Date
}
```

### 2) `src/services/crawlers/ppomppu.ts`

**순수 함수 크롤러** (DB 접근 금지 — CLAUDE.md red line).

대상: 뽐뿌 해외여행 게시판 리스트. 실제 URL 패턴은 `https://www.ppomppu.co.kr/zboard/zboard.php?id=ppomppu4` 계열이나 실행 환경 제약으로 이 step 에서는 **리스트 파싱 로직 + 고정 픽스처 기반 파싱만 구현**하고 실제 네트워크 호출은 config.fetch 로 추상화한다.

```ts
import type { RawPost } from '@/types/deal'
import type { Crawler } from './types'

export const LIST_URL = 'https://www.ppomppu.co.kr/zboard/zboard.php?id=ppomppu4'
export const ALLOWED_PATHS = ['/zboard/zboard.php', '/zboard/view.php']  // robots 화이트리스트

export const crawlPpomppu: Crawler = async (config) => { ... }

// 내부 export (테스트용):
export function parseList(html: string, now: Date): ParsedListItem[]
export function parseDetail(html: string): { body: string }   // 본문 텍스트만
```

요구사항:
- `fetch` 로 리스트 1 페이지 → `parseList` → 각 항목 상세 페이지 → `parseDetail`
- 요청 간 1 초 sleep, 동시성 1, UA 는 config.userAgent
- **401/403/500** → 해당 항목 skip (throw 금지 — fail-soft)
- **게시글 제목이 없거나 링크가 `zboard/view.php` 패턴이 아니면** skip
- 반환 `RawPost[]` 는 `body` 포함 (이후 7일 TTL 로 NULL 처리될 데이터, 메모리 통과만)
- **작성자 필드 수집·반환 금지** (ADR-008)

HTML 파싱: `node-html-parser` 또는 순수 정규식. `cheerio` 는 무거워 피하되, 파싱 복잡도 때문에 필요하면 `node-html-parser` (devDependency 가 아닌 dependency 로 추가).

**robots 준수**: `ALLOWED_PATHS` 상수를 export. `fetch` 호출 전 URL 경로가 `ALLOWED_PATHS` 중 하나로 시작하는지 확인. 아니면 skip + 로그.

### 3) `src/services/parser/rules.ts`

```ts
import type { RawPost, DealDraft } from '@/types/deal'

export function parseRules(post: RawPost): DealDraft
```

파싱 목표 (제목 + 본문 앞 500자 제한 내에서):
- `origin` / `destination`: `lib/route-map.ts` 의 별명 사전으로 검출
- `priceKrw`: 숫자 + `원|만원|KRW` 패턴. `29만` → 290000, `135,000원` → 135000
- `tripType`: 키워드 `왕복|편도`. 없으면 기본 `roundtrip`
- `departFrom` / `departTo`: `3~5월`, `5월 출발`, `2026-05-01~05-10` 식 범위 패턴
- `returnFrom` / `returnTo`: 귀국편 패턴 (없으면 null)
- `carrierCode`: 한글 항공사명 (`대한항공`, `제주항공`) → `lib/airlines.ts` 역조회 → IATA 코드
- `carrierClass`: `classOf(carrierCode)` — 매칭 실패 시 `mixed`
- `parsedBy: 'rules'`

**fail-soft 원칙** (CLAUDE.md):
- 예외 던지지 않음
- 매칭 실패 필드는 `null`
- 필수 3 필드 (origin, destination, priceKrw) 중 하나라도 null 이면 호출측이 UPSERT 에서 제외할 것

**본문 전송 범위**: 제목 + 본문 앞 500자까지만 처리 (ADR-005/008 교차). 이 함수에서 직접 cut 하지 말고 caller 가 처리. 단, 함수 문서 주석에 원칙 명시.

### 4) 테스트 픽스처

**`__fixtures__/ppomppu-list-2026-04-18.html`**: 실제 뽐뿌 해외여행 리스트의 10~20개 게시글이 있는 HTML. 대표 케이스:
- `[대한항공] 인천-오사카 왕복 135,000원 (3~5월)` → FSC, 성공
- `[제주항공] 인천=후쿠오카 99,000 / 6월 출발` → LCC
- `인천 싱가포르 싱가포르항공 왕복 45만원` → FSC (한글명만)
- `미주 특가 LA 직항 편도 60만` → 편도, 가격 파싱 테스트
- `베트남 다낭 99,900원부터` → 모호 (항공사 없음, carrierClass=mixed)
- `세부 패키지 호텔 3박 포함` → **skip** (호텔 패키지는 항공권 아님 — body 또는 제목에 '패키지/호텔' 포함 시 제외 규칙)

직접 작성해도 되고, 실제 브라우저로 1회 저장해도 됨. **작성자 닉네임 필드는 익명화** (예: `<span class="author">anon</span>`).

**`__fixtures__/ppomppu-detail-sample.html`**: 위 중 1건의 상세 페이지 샘플. 본문 1~2 kB 포함.

**`__fixtures__/parser-golden.json`**: 30~50 개 (title, expected) 페어. 예:
```json
[
  {
    "title": "[대한항공] 인천-오사카 왕복 135,000원 3~5월",
    "expected": {
      "origin": "ICN",
      "destination": "KIX",
      "priceKrw": 135000,
      "tripType": "roundtrip",
      "carrierCode": "KE",
      "carrierClass": "fsc"
    }
  },
  ...
]
```

모호 케이스·실패 케이스도 포함 (`expected` 에 `origin: null` 등).

### 5) 단위 테스트

**`src/services/crawlers/ppomppu.test.ts`**:
- `parseList` 가 픽스처에서 기대 개수만큼 item 추출
- `ALLOWED_PATHS` 밖 URL 은 skip
- `config.fetch` mock 으로 요청 간 1 초 대기 검증 (fake timers)
- 500 응답 → 빈 배열 반환 (throw 금지)
- 작성자 필드가 `RawPost` 에 존재하지 않음 (`any` 캐스팅으로 확인)

**`src/services/parser/rules.test.ts`**:
- `parser-golden.json` 전체 loop 실행
- **목표 커버리지 ≥ 60%** (PRD Core 성공 지표). 성공 = 모든 expected 필드가 actual 과 일치. 실패는 각 케이스 이름 + diff 출력
- 60% 미만이면 테스트 `expect(coverage).toBeGreaterThanOrEqual(0.6)` 실패
- 경계값: 가격 `29만` vs `29,000원`, 편도/왕복 기본값, 별명 사전 (`동경`/`도쿄` 둘 다 NRT)

## Acceptance Criteria

```bash
cd ../app
pnpm build
pnpm test -- src/services
pnpm typecheck 2>/dev/null || pnpm exec tsc --noEmit
pnpm lint
```

커버리지 테스트가 60% 이상 반환해야 통과.

## 검증 절차

1. 위 AC 전부 성공 (파싱 커버리지 60%+)
2. `ppomppu.ts` 에 `supabase`·`createClient` import 가 없음 (순수 함수 원칙)
3. `RawPost` / `DealDraft` 반환값에 작성자 필드가 없음을 타입 레벨에서 확인
4. `parser-golden.json` 케이스 수가 30 이상
5. `ALLOWED_PATHS` 체크가 실제 `fetch` 호출 전 실행되는지 (mock 으로 검증)
6. `phases/0-core-mvp/index.json` step 3 업데이트:
   - 성공 → `"status": "completed"`, `"summary": "services/crawlers/ppomppu.ts (순수 함수, robots allowed-paths, 1s 간격, 작성자 미수집) + services/parser/rules.ts (fail-soft, 제목+본문500자 한정). __fixtures__/{ppomppu-list, ppomppu-detail, parser-golden}. 규칙 파싱 커버리지 <X>%."`

## 금지사항

- **크롤러 내부에서 DB 쿼리·로깅 호출 금지** (CLAUDE.md "크롤러는 순수 함수"). 이유: 테스트 주입이 안 되고 크롤·저장 실패가 뒤섞임
- **`RawPost` 에 작성자 필드 추가 금지** (ADR-008). 이유: 프라이버시·저작권 방어 선제
- **요청 간격 1 초 미만으로 조정 금지** (ADR-008). 이유: ToS·IP 차단 방어
- **`ruliweb.ts` / `playwings.ts` 건드리지 마라** (ADR-026). 이유: Stretch 1 트랙. Core 완성 전 금지
- **파서에서 LLM 호출 금지** (ADR-005 Core). 이유: Core 단계 훅이 차단. LLM 폴백은 Stretch 2 `parser/llm.ts`
- **상용 OTA(스카이스캐너·구글 플라이트) 크롤 금지** (ADR-008). 이유: ToS·봇 탐지. 스카이스캐너는 검색 URL 생성만
