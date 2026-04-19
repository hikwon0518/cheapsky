# Step 0: ruliweb-crawler

## 읽어야 할 파일

- `docs/ADR.md` — ADR-004 (데이터 소스 구조), ADR-008 (저작권·ToS 방어), ADR-024 (FSC/LCC 이중 baseline)
- `docs/ARCHITECTURE.md` — "데이터 흐름 (2) 딜 크롤" 의사코드
- 이전 Core 단계 산출물:
  - `app/src/services/crawlers/{types,ppomppu}.ts` (크롤러 인터페이스 + 뽐뿌 레퍼런스 구현)
  - `app/src/services/parser/rules.ts` (규칙 파서)
  - `app/scripts/crawl.ts` (파이프라인)
  - `app/src/types/deal.ts` (Source 유니온: ppomppu | ruliweb | playwings)

## 작업

앱 루트는 `cheapsky/app/`. 이 step 은 **루리웹 핫딜** 을 Cheapsky 파이프라인에 추가한다.

### 0) 사전: robots.txt 실사

먼저 `https://bbs.ruliweb.com/robots.txt` 를 `fetch` 로 확인하라. 루리웹의 허용 경로·차단 경로를 확인하고, 핫딜 게시판 경로(`/market/board/1020`)가 허용 범위인지 검증. 허용 안 되면 `BLOCKED` 반환.

### 1) `src/services/crawlers/ruliweb.ts`

`services/crawlers/ppomppu.ts` 를 **레퍼런스**로 삼되 루리웹 구조에 맞춰 새로 작성. 뽐뿌 코드 복붙이나 추상화 X — 3번 비슷한 코드 > 잘못된 추상화 원칙 (CLAUDE.md).

```ts
export const LIST_URL = 'https://bbs.ruliweb.com/market/board/1020';
export const ALLOWED_PATHS: readonly string[] = [
  '/market/board/1020',
  '/market/board/read/',  // 상세 페이지 패턴, 실사 후 정확한 경로 확인
] as const;

export const crawlRuliweb: Crawler = async (config) => { ... }
export function parseList(html: string, now: Date): ParsedListItem[]
export function parseDetail(html: string): { body: string }
export function isAllowedPath(urlOrPath: string): boolean
```

요구사항:
- **순수 함수** (CLAUDE.md red line). DB 접근·파일 IO 금지
- 요청 간격 ≥ 1000ms, 동시성 1 (ADR-008)
- UA 는 `config.userAgent` (위장 금지)
- 실제 루리웹 HTML 구조 조사는 `fetch` + 실사로 확인. `tr` class, 제목 anchor selector, 상세 URL 패턴이 뽐뿌와 다르다 (예상: `<tr>` 대신 `<div class="row">` 구조)
- 인코딩: UTF-8 대부분. 다만 `Content-Type` header 의 charset 에서 동적으로 추출하는 `decodeResponse` 헬퍼를 ppomppu.ts 와 동일 패턴으로 포함
- **작성자 필드 수집 금지** (ADR-008) — `RawPost` 는 author 없음
- **조회수·추천수·댓글수 같은 "사회적 신호" 는 `parseList` 단계에서 raw 하게 수집**해 `ParsedListItem` 선택 필드로 반환. `RawPost` 스키마 확장은 하지 말고, `ParsedListItem` 만 확장 (step 2 Community Picks 가 이걸 사용)
- 핫딜 카테고리 안에서 **"여행/항공" 태그·분류가 있으면 필터**해 항공권 글 비율 높임 (선택). 없으면 전체 긁기

### 2) `src/services/crawlers/types.ts` 확장

```ts
export type ParsedListItem = {
  sourceId: string;
  sourceUrl: string;
  title: string;
  postedAt: Date;
  // 신규 (Stretch 1): 사회적 신호 raw 수치. 소스 간 스케일이 달라 숫자 자체는 UI 표시 금지 (ADR-023/UI_GUIDE).
  views?: number | null;
  comments?: number | null;
  recommends?: number | null;
};
```

기존 ppomppu.ts 의 parseList 반환도 호환 유지 (undefined 허용). `RawPost` 에는 이 필드를 추가하지 않는다 — 사회적 신호는 크롤 시점의 일회성 수치이므로 `scripts/crawl.ts` 에서 `deals.social_signal` (enum) 로 변환하거나 이번 step 에선 `(origin,destination) → 조회수 상위` 를 판단하는 입력으로만 사용.

### 3) `scripts/crawl.ts` 확장

기존 ppomppu 전용 흐름에 ruliweb 을 추가한다:

```ts
const sources = [
  { source: 'ppomppu' as const, crawler: crawlPpomppu },
  { source: 'ruliweb' as const, crawler: crawlRuliweb },
] as const;

for (const { source, crawler } of sources) {
  // crawler_runs INSERT (source)
  // fetch + parse + normalize + dedupe + baseline + score + UPSERT + observations
  // 주의: dedupeKey 는 소스 무관 동일 해시 (ADR-009). 같은 딜을 두 소스에서 봤을 때
  //      deals.sources 배열에 union 으로 추가됨
}
```

`social_signal` 필드는 아직 set 하지 않음 — step 2 Community Picks UI 가 `deals.social_signal = 'hot' | 'trending' | null` 컬럼을 쿼리 시점에 판정하거나, 이 step 에서 ParsedListItem 의 views 를 기준으로 "상위 N%" 딜에 `social_signal='hot'` 을 UPSERT 시점에 붙이는 방식 중 택일. 이 step 에선 **후자 (UPSERT 시점에 상대 판정)** 로 구현: 이번 crawl 회차 내 루리웹 top 20% views → `social_signal='hot'`, 다음 20% → `'trending'`, 나머지 `null`. 기준은 단순 백분위.

### 4) 테스트

**`__fixtures__/ruliweb-list-2026-04-19.html`** — 실제 루리웹 핫딜 HTML 15건. 하나는 항공권 glob (예: `[대한항공] 인천-하노이 왕복 25만원`), 나머지는 일반 핫딜 (테크·패션 등). 작성자 닉네임은 `anon` 으로 anonymize.

**`__fixtures__/ruliweb-detail-sample.html`** — 상세 페이지 하나.

**`src/services/crawlers/ruliweb.test.ts`**:
- parseList 가 픽스처 15건에서 기대 개수 추출
- ALLOWED_PATHS 밖 URL skip
- 작성자 필드 미수집
- views/comments/recommends 파싱 (있으면 number, 없으면 null)
- 500/403 응답 → 빈 배열 (throw 금지)
- 요청 간격 1초 미만으로 조정 불가 (min-enforce)

### 5) 실제 스모크

```bash
cd C:/Users/hukyu/Project_Document/cheapsky/app
pnpm tsx scripts/crawl.ts
```

루리웹 분 `crawler_runs` 1 행 추가 확인. 실제 항공권 글 개수는 변동적이므로 "saved >= 0" 수용 — pipeline 동작만 검증.

## Acceptance Criteria

```bash
cd C:/Users/hukyu/Project_Document/cheapsky/app
pnpm build
pnpm test     # 기존 216 + 신규 ruliweb 관련 20+ 테스트
pnpm exec tsc --noEmit
pnpm lint
pnpm tsx scripts/crawl.ts    # ppomppu + ruliweb 둘 다 crawler_runs 기록
```

## 검증 절차

1. 위 AC 전부 성공
2. `src/services/crawlers/ruliweb.ts` 에 DB/Supabase import 없음 (순수 함수)
3. `ParsedListItem` 확장 필드가 optional — 기존 ppomppu.test.ts 깨지지 않음
4. robots.txt 실사 결과를 summary 에 기록 (허용 경로 / 차단 경로 요약)
5. DB 확인: `select source, count(*) from crawler_runs group by source` → ppomppu·ruliweb 둘 다 나옴
6. 상태 업데이트:
   - 성공 → `"status": "completed"`, `"summary": "ruliweb crawler (robots 허용 확인, UTF-8, 순수 함수, 1s 간격, 작성자 미수집) + ParsedListItem 에 views/comments/recommends 추가 + crawl.ts 확장. social_signal 백분위 판정. 실 crawl 샘플: <ppomppu saved> / <ruliweb saved>."`
   - robots 차단 → `"status": "blocked"`, `"blocked_reason": "루리웹 robots.txt 가 /market/board/1020 차단. 사용자 확인 필요."`

## 금지사항

- **루리웹 HTML 구조를 뽐뿌처럼 가정하지 마라. 이유: 실제 구조 다름 → 반드시 실사 fetch 로 확인**
- **크롤러 내부 DB 쿼리 금지** (CLAUDE.md). 이유: 순수 함수 원칙
- **작성자 닉네임·uid 저장 금지** (ADR-008). 이유: 프라이버시 + 저작권
- **UA 위장·rotation 금지** (ADR-008 red line). 이유: ToS 방어 철학
- **`RawPost` 스키마에 views/comments 필드 추가 금지**. 이유: DB 에 영구 저장 안 함 (사회적 신호는 일회성 판정에만). `ParsedListItem` 만 확장
- **Playwright / puppeteer / headless browser 도입 금지**. 이유: 이 프로젝트의 모든 크롤은 fetch + HTML 파싱 레벨
