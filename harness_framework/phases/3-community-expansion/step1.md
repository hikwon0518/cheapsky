# Step 1: clien-crawler

**전제**: `step0-output.json` 에서 `clien.passed == true` 인 경우에만 실행. false 면 skip.

## 읽어야 할 파일

- `docs/ADR.md` — **ADR-004** (소스 구조, Phase 3 확장 테이블), **ADR-008** (저작권·ToS), **ADR-030** (커뮤니티 확장)
- `docs/ARCHITECTURE.md` — 크롤러 디렉토리 구조 · `crawler_runs` 스키마
- 참조 구현:
  - `app/src/services/crawlers/ppomppu.ts` (동일 패턴으로 작성)
  - `app/src/services/crawlers/ruliweb.ts` (`allowedPaths` · robots 준수 예시)
  - `app/src/services/parser/rules.ts` (규칙 기반 파싱 재사용)

## 작업

### 1) `app/src/services/crawlers/clien.ts`

**순수 함수 서명** (ADR: 크롤러는 caller 에서 DB 접근 · 로깅):
```ts
export type ClienConfig = {
  baseUrl: string;              // 'https://www.clien.net'
  boardPath: string;            // '/service/board/jirum'
  tagFilter?: string;           // 항공권 카테고리 필터 파라미터 (step0 조사 결과 반영)
  maxPages: number;             // 기본 3
  fetch?: typeof fetch;         // 테스트 주입용
};

export async function crawlClien(config: ClienConfig): Promise<RawPost[]>
```

**필수 규칙 (ADR-008 유지)**:
- `User-Agent`: `Cheapsky/0.2 (학습+개인 실사용 프로젝트, +mailto:<연락처>)`
- 요청 간격 **≥ 1초** (동시성 1)
- `allowedPaths` 상수 — `/service/board/jirum` 만 허용. 그 외 경로 요청 throw
- **저장 범위**: 제목 · 가격 · 링크 · 메타 (작성 시각 · 조회수 정규화 플래그). **닉네임/아이디 저장 금지**
- fail-soft: 상세 페이지 403/404 개별 skip, 리스트 fetch 실패는 상위 throw 하지 않고 부분 결과 반환

### 2) 파싱 통합

- 리스트 페이지에서 제목 + 가격 후보 문자열 추출 → `parseRules(title, body500)` 재사용
- `carrier_class` 판정: 기존 `lib/airlines.ts` 사전 그대로
- 필수 필드 (`origin`, `destination`, `priceKrw`) 중 하나라도 null → caller 에서 UPSERT 제외

### 3) `scripts/crawl.ts` 통합

```ts
const SOURCES: CrawlerSpec[] = [
  // ... 기존 ppomppu, ruliweb, playwings
  {
    name: 'clien',
    crawler: () => crawlClien({ baseUrl: '...', boardPath: '/service/board/jirum', maxPages: 3 }),
    timeoutMs: 60_000,
  },
];
```

- `crawler_runs.source='clien'` 기록
- 실패 시 다른 소스는 계속 진행 (현재 패턴 유지)

### 4) 회귀 테스트

`app/src/services/crawlers/clien.test.ts`:
- fixture `__fixtures__/clien-list.html` 기반 파싱 회귀 테스트 ≥ 8 케이스
- 항공권 태그 필터 정상 작동
- 노이즈 제목 (비항공권) skip 확인
- 가격 floor 50K 통과 확인 (ed55a13 정렬 반영)
- UA · allowedPaths · rate limit 상수 테스트

## Acceptance Criteria

```bash
cd app
pnpm test src/services/crawlers/clien.test.ts   # 신규 테스트 전부 green
pnpm typecheck
pnpm lint
pnpm tsx scripts/crawl.ts 2>&1 | grep clien     # 실 크롤 1회, crawler_runs 기록 확인
```

- 테스트 373 → +8 이상 (381+)
- 실 크롤에서 parsed > 0 이면 성공. 0 이어도 fail-soft 통과면 OK (크롤러 자체 문제 아닌 소스 상태)

## 금지사항

- **`'use client'` 금지** — 순수 Node.js 함수
- **DB 접근 금지** — caller (`scripts/crawl.ts`) 에서만
- **외부 라이브러리 추가 금지** — 기존 crawler 와 동일 패턴 (native fetch + 필요 시 cheerio 기존 사용분만)
- **작성자 정보 저장 금지** (ADR-008)
