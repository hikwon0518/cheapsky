# Step 1: playwings-crawler

## 읽어야 할 파일

- `docs/ADR.md` — ADR-025 (플레이윙즈 동의·차단 절차), ADR-004 (소스 구조), ADR-008 (저작권·ToS)
- 이전 step 산출물:
  - `app/src/services/crawlers/{types,ppomppu,ruliweb}.ts` (패턴 레퍼런스)
  - `app/src/services/parser/rules.ts`
  - `app/scripts/crawl.ts` (다중 소스 루프)

## 작업

앱 루트는 `cheapsky/app/`. 이 step 은 **플레이윙즈 항공권 특가 블로그** 를 Cheapsky 파이프라인에 추가한다.

### 전제: ADR-025 상태 기록

**사용자 확인됨 (2026-04-19)**: 플레이윙즈 콘텐츠 수집 **허락됨**. 단, ADR-025 의 방어 조항은 전부 유지:
- 제목·가격·노선·링크 메타만 저장 (본문 7일 TTL)
- 원문 링크로 트래픽 환원 (`target="_blank"`)
- 작성자 닉네임 저장 금지
- 운영자가 이의 제기 시 즉시 크롤러 비활성 + 24시간 내 저장 데이터 삭제

### 0) 사전: RSS 피드 우선 탐색 (ADR-025 절차)

ADR-025 원칙: **RSS 가 있으면 크롤링 대신 RSS 소비**. 다음 URL 순차 확인:
- `https://playwings.co.kr/feed`
- `https://playwings.co.kr/rss`
- `https://playwings.co.kr/feed/atom`
- 또는 실제 도메인이 다를 수 있으니 HTML `<head>` 의 `<link rel="alternate" type="application/rss+xml">` 도 확인

**RSS 가 발견되고 정상 응답** → RSS 기반 구현 (`parseRss(xml)` + fast-xml-parser 또는 수동 regex). 크롤러 전체 단순화.

**RSS 없음** → HTML 크롤링 구현 (robots.txt 확인 후).

### 1) `src/services/crawlers/playwings.ts`

RSS 경로와 HTML 경로를 **같은 `Crawler` 시그니처** 로 통일:

```ts
export const BASE_URL = 'https://playwings.co.kr';
export const RSS_URL = 'https://playwings.co.kr/feed';  // 실사 후 확정
export const LIST_URL = 'https://playwings.co.kr/category/airfare'; // HTML fallback
export const ALLOWED_PATHS: readonly string[] = [...]; // robots 실사 후

export const crawlPlaywings: Crawler = async (config) => { ... }

// 내부 헬퍼 (테스트용 export):
export function parseRssItems(xml: string, now: Date): ParsedListItem[]
export function parseListHtml(html: string, now: Date): ParsedListItem[]
export function parseDetailHtml(html: string): { body: string }
```

요구사항:
- **순수 함수** (CLAUDE.md)
- 요청 간격 ≥ 1000ms, 동시성 1
- UA = `config.userAgent` (위장 금지)
- RSS 우선. RSS 실패(404·empty) 시 HTML 폴백
- 본문은 상세 페이지 fetch 후 앞 500자만 반환 (ADR-005/008 범위 제한)
- 사회적 신호 없음 (블로그라 댓글수·조회수는 선택). `ParsedListItem.views` 등 optional 로 set 안 해도 OK
- 플레이윙즈는 항공권 전문이라 **거의 모든 글이 파싱 성공** 할 것 → 파서 입장에서 golden set 확장할 가치 있음 (선택)
- **작성자 필드 수집 금지** (ADR-008 / ADR-025)

### 2) `scripts/crawl.ts` 에 플레이윙즈 소스 추가

```ts
const sources = [
  { source: 'ppomppu' as const, crawler: crawlPpomppu },
  { source: 'ruliweb' as const, crawler: crawlRuliweb },
  { source: 'playwings' as const, crawler: crawlPlaywings },
] as const;
```

각 소스는 독립된 `crawler_runs` 행 생성. 에러는 소스별 격리 — 한 소스 실패해도 다른 소스 계속.

### 3) 테스트

**`__fixtures__/playwings-feed-sample.xml`** — RSS 피드 샘플 5~10건 (item 태그, title/link/description/pubDate 등). 항공권 제목 위주.

**`__fixtures__/playwings-list-sample.html`** — HTML 폴백 경로용 (RSS 없을 경우). 3~5건.

**`src/services/crawlers/playwings.test.ts`**:
- parseRssItems 가 item 태그에서 제목/URL/pubDate 추출
- 잘못된 XML → 빈 배열 (fail-soft, throw 금지)
- HTML fallback 경로도 별도 테스트
- 작성자 필드 미수집
- 요청 간격 min-enforce

### 4) `src/types/deal.ts` 은 손대지 마라

`Source = 'ppomppu' | 'ruliweb' | 'playwings'` 는 이미 Core 에서 정의됨. 신규 리터럴 없음.

### 5) 실제 스모크

```bash
cd C:/Users/hukyu/Project_Document/cheapsky/app
pnpm tsx scripts/crawl.ts
```

`crawler_runs` 에 `source='playwings'` 행이 생성되고 `success=true` 면 성공. saved 수는 실제 블로그 발행 빈도에 좌우.

## Acceptance Criteria

```bash
cd C:/Users/hukyu/Project_Document/cheapsky/app
pnpm build
pnpm test
pnpm exec tsc --noEmit
pnpm lint
pnpm tsx scripts/crawl.ts   # ppomppu + ruliweb + playwings 3개 모두 crawler_runs 기록
```

## 검증 절차

1. 위 AC 전부 성공
2. RSS 우선 탐색을 실제 수행했는지 (test 에서 검증 + summary 에 RSS 발견 여부 기록)
3. `src/services/crawlers/playwings.ts` 에 DB/Supabase import 없음
4. `scripts/crawl.ts` 의 sources 배열이 3개 소스 포함
5. DB: `select source, count(*) from crawler_runs group by source` → 3 소스 전부
6. 상태 업데이트:
   - 성공 → `"status": "completed"`, `"summary": "playwings crawler (RSS 발견 여부: <yes|no>, 경로 <URL>, UTF-8, 순수 함수, 1s 간격, 작성자 미수집, 본문 500자 cut) + crawl.ts 3-source 확장. 실 crawl 샘플 saved: <N>."`
   - RSS·HTML 모두 비정상 → `"status": "blocked"`, `"blocked_reason": "playwings 접근 실패. 실제 도메인/경로 확인 필요."`

## 금지사항

- **ADR-025 방어 조항 제거 금지**. 이유: 사용자 허락이 있어도 최소 방어는 유지 (본문 7일 TTL, 링크 환원, 작성자 미저장). 블로그 운영자 이의 제기 시 즉시 중단 조항 유지
- **RSS 건너뛰고 바로 HTML 크롤 금지** (ADR-025 원칙). 이유: RSS 가 크롤링보다 저작권 안전하고 서버 부하 낮음
- **작성자 닉네임 저장 금지** (ADR-008/025)
- **Playwright/puppeteer 도입 금지**
- **UA 위장 금지** (ADR-008)
- **본문 전문 저장 금지** (ADR-008). 이유: 7일 TTL 로 body 제한
