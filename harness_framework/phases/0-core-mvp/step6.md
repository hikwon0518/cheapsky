# Step 6: middleware-api-readme

## 읽어야 할 파일

- `docs/ADR.md` — ADR-002 (GH Actions cron + public repo), ADR-008 (저작권·ToS 방어, noindex, UA), ADR-019 (Share Token + Basic Auth), ADR-028 (SHOW_CACHED_ONLY UI 전용)
- `docs/ARCHITECTURE.md` — "접근 제어", "환경 변수" 표, "관측/운영"
- `docs/PRD.md` — "Core" 체크리스트의 README 요구사항 (스크린샷 + 1분 DEMO 인라인)
- 이전 step 산출물:
  - `../app/src/lib/share-token.ts`
  - `../app/src/app/page.tsx` · `src/components/*`
  - `../app/scripts/{crawl,verify,cost_check}.ts`

## 작업

앱 루트는 `../app/`. 이 step 에서 **Core 가 완주**된다.

### 1) `src/middleware.ts` (ADR-019, ADR-008)

Next.js 15 App Router middleware. 모든 요청에 적용 (`matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']`).

흐름:
1. `?t=<token>` 쿼리 → `verifyShareToken(token, parseShareTokens(process.env.SHARE_TOKENS))`
   - 통과 → 쿠키 `cheapsky_auth=<token>` 설정 (HttpOnly, Secure, SameSite=Strict, 7일)
2. 쿠키에 유효한 토큰이 있으면 통과
3. 둘 다 실패 → Basic Auth 검증
   - `Authorization: Basic <b64>` 파싱
   - `bcrypt.compare(pass, process.env.BASIC_AUTH_PASS)` + user 일치
   - 실패 → `401 WWW-Authenticate: Basic realm="Cheapsky"` + HTML 안내 (1 KB 이내)
4. 통과 응답에 **항상** 추가:
   - `X-Robots-Tag: noindex, nofollow`
   - `Cache-Control: private, max-age=60` (ADR-028 revalidate 와 조화)

**보안 유의**:
- `bcryptjs` 는 edge runtime 비호환 가능 → middleware 는 `runtime = 'nodejs'` 명시 (Next.js 15 허용)
- timing-safe 비교는 `share-token.ts` 에서 이미 처리
- Basic Auth 실패 응답에는 **절대 토큰·해시 힌트를 포함하지 마라**

### 2) API 라우트

**`src/app/api/health/route.ts`** — GET

```ts
export async function GET() {
  const client = getAnonClient()
  const runs = await client
    .from('crawler_runs')
    .select('source, started_at, finished_at, success, saved_count')
    .order('started_at', { ascending: false })
    .limit(20)
  // group by source, take most recent
  return Response.json({
    sources: { ppomppu: { lastSuccess: '...', ageSeconds: ... }, ... },
    generatedAt: new Date().toISOString()
  })
}
```

- `Cache-Control: s-maxage=30, stale-while-revalidate=60`

**`src/app/api/deals/route.ts`** — GET (필터 적용 리스트, 클라이언트 폴링 대비 옵션)
- `searchParams` 에서 region / maxPrice / month / minDiscount / since / t 파싱
- `deals` 쿼리 + JSON 반환
- 필터는 `src/app/page.tsx` 와 동일한 해석 로직을 `src/lib/filters.ts` (이 step 에서 신설) 로 추출해 재사용

**`src/lib/filters.ts`** — searchParams → 쿼리 빌더 공통 함수

### 3) GitHub Actions 워크플로우

앱 루트가 `../app/` 이지만 GH Actions 는 repo root 기준. 이 repo 구조에서 repo root = `cheapsky/` 로 추정. 실제 repo 레이아웃에 따라 조정 필요하되 기본은:

**`../app/.github/workflows/crawl.yml`** (**주의**: GH Actions 는 repo root 의 `.github/` 만 본다. 이 경우 `cheapsky/.github/workflows/` 에 두는 것이 맞다. `../` 방향으로 생성할 것.):

실제 파일 경로:
- `../.github/workflows/crawl.yml` (= cheapsky/.github/workflows/)
- `../.github/workflows/verify.yml`
- `../.github/workflows/cost_check.yml`

각 workflow 내용:
- cron: crawl `*/15 * * * *`, verify `0 */3 * * *`, cost_check `0 0 * * *` (= KST 09:00)
- `working-directory: app` 으로 지정
- Node 20 + pnpm 설치
- env: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRAWLER_USER_AGENT`, `ALERT_WEBHOOK` 은 secrets 에서
- **`CHEAPSKY_STAGE` 는 설정하지 않음** (Core 워크플로우 — 훅 게이트가 `core` 로 취급하여 LLM SDK 설치 차단, ADR-005)

`on: workflow_dispatch` 도 포함 (수동 트리거).

**GH Actions 환경에서 workspace 구조 확인**: repo root 가 `cheapsky/` 라고 가정하고 진행. 사용자가 별도 repo 구조를 원하면 이후 조정.

### 4) README.md

**`../app/README.md`** (앱 루트). PRD Core 체크리스트: "스크린샷 + 1분 DEMO 시나리오 인라인, 별도 `DEMO_SCRIPT.md` 아님".

섹션:
1. **Cheapsky** — 한 줄 소개 (인천 출발 아시아·미국 20개 노선 저점 레이더)
2. **Why** — 3 불릿: 커뮤니티 지연·범위 편향 / 무료 시세 API 부재(ADR-022) / 관측+시드 하이브리드
3. **차별화 포인트** — FSC/LCC 이중 baseline / 규칙 기반 한 줄 맥락 (Stretch LLM 덮어쓰기) / Share Token 방식 친구 공유
4. **스크린샷** — `docs/screenshot-<date>.png` 경로 자리 확보 (이 step 에서 실제 스크린샷 캡처까지 할 수 있으면 `pnpm dev` + headless chrome / 수동 스샷. 없으면 placeholder)
5. **1분 DEMO 시나리오** — 인라인 번호 목록:
   - (0:00) `?t=<token>` 링크 접속, 히어로 TOP 3 로드
   - (0:15) 첫 카드의 🔥 배지 hover → 팝오버 4줄 (기준·현재·할인·분위수)
   - (0:30) 필터 `출발월 5월 + 최대가 30만` 조작 → URL 갱신·리스트 fade
   - (0:45) 카드 클릭 → 뽐뿌 원문 새 탭
   - (0:55) 공유 버튼 → 친구에게 링크 복사
6. **아키텍처 한 장** — ARCHITECTURE.md "한 눈에 보기" 블록 인용 + 링크
7. **Core 범위** — PRD Core 체크리스트 복사
8. **개발 명령어** — ARCHITECTURE.md "로컬 개발 절차"
9. **배치 운영** — crawl/verify/cost_check cron 표 + 헬스 대시보드 링크
10. **라이선스·고지** — 학습 프로젝트 · 원문 출처 링크로 접속 고지 (ADR-008)

Stretch 1/2/3 는 README 에 "진행 중" 플레이스홀더로 한 줄씩만.

### 5) 푸터 고지 문구 확인

step 5 에서 만든 Footer 에 `학습 프로젝트입니다. 구매·예약은 반드시 원본 출처 링크로 접속해주세요.` 가 들어가 있는지 확인. 없으면 추가.

### 6) 스모크: middleware + API 검증

```bash
cd ../app
pnpm dev  # 백그라운드

# SHARE_TOKENS 없는 요청 → 401
curl -I http://localhost:3000/
# → HTTP/1.1 401 Unauthorized
# → WWW-Authenticate: Basic realm="Cheapsky"

# 유효 토큰 → 200
curl -I "http://localhost:3000/?t=<valid_token>"
# → HTTP/1.1 200
# → X-Robots-Tag: noindex, nofollow
# → Set-Cookie: cheapsky_auth=...

# health API
curl -s "http://localhost:3000/api/health?t=<valid_token>" | head -c 400
```

### 7) 배치 한 번 더 수동 트리거 (선택)

GH Actions 에 push 안 하는 대신 로컬 재실행으로 파이프라인이 여전히 돌아가는지:
```bash
pnpm tsx scripts/crawl.ts
pnpm tsx scripts/verify.ts
pnpm tsx scripts/cost_check.ts
```

## Acceptance Criteria

```bash
cd ../app
pnpm build        # Next.js 15 middleware + runtime=nodejs 정상 컴파일
pnpm test
pnpm typecheck 2>/dev/null || pnpm exec tsc --noEmit
pnpm lint
pnpm dev  # 백그라운드
sleep 3
curl -I http://localhost:3000/ | grep -E "^HTTP|WWW-Authenticate" # 401 확인
curl -I "http://localhost:3000/?t=<token>" | grep -E "X-Robots-Tag|HTTP" # 200 + noindex 확인
```

(토큰은 `.env.local` SHARE_TOKENS 의 첫 번째 사용)

## 검증 절차

1. 위 AC 전부 성공 (401 → 200 + noindex)
2. middleware 가 모든 응답에 `X-Robots-Tag: noindex, nofollow` 를 붙임 (health·deals API 포함)
3. `../.github/workflows/crawl.yml` 에 `CHEAPSKY_STAGE` 설정이 **없음** (Core 는 미설정이어야 LLM SDK 차단 훅이 동작)
4. README 에 Amadeus 의존 문구가 없음 (ADR-022 반영 확인). `시세 API` 는 "Stretch 3 조건부" 로 명시
5. README 의 1분 DEMO 가 실제 Core 기능 범위 안에 있음 (Sparkline·Community Picks·히트맵 언급 없음)
6. middleware 응답 HTML 에 토큰·해시 노출 없음
7. `phases/index.json` 상위 인덱스: `0-core-mvp` 를 `"status": "completed"` 로
8. `phases/0-core-mvp/index.json` step 6 업데이트:
   - 성공 → `"status": "completed"`, `"summary": "middleware.ts (share_token → Basic Auth → noindex, runtime=nodejs). api/{deals,health}/route.ts. .github/workflows/{crawl,verify,cost_check}.yml (CHEAPSKY_STAGE 미설정). README 1분 DEMO 인라인 + 스크린샷 자리. Core 범위 전 항목 동작 확인."`

## 금지사항

- **middleware edge runtime 사용 금지** (bcryptjs 비호환). 이유: Basic Auth bcrypt 검증이 깨짐. `runtime = 'nodejs'` 명시
- **401 응답에 토큰 목록·해시·파일 경로 노출 금지** (ADR-019). 이유: 공개 URL 이므로 정보 유출 방지
- **GH Actions workflow 에 `CHEAPSKY_STAGE: stretch` 설정 금지** (ADR-005 Core). 이유: Core 워크플로우에서 LLM SDK 차단 훅이 게이트를 풀어줌
- **`ingest_market.yml` workflow 생성 금지** (ADR-022). 이유: Stretch 3 조건부
- **`SHOW_CACHED_ONLY=true` 환경변수를 GH Actions secrets 에 미러링 금지** (ADR-028, 기본 정책). 이유: UI 전용 플래그. 배치는 계속 운영해야 함
- **README 에 "AI 추천" / "Powered by Anthropic" / "Amadeus 시세" 문구 금지** (ADR-012, ADR-022). 이유: 이미 결정된 카피 규칙
- **원문 링크를 `target="_blank"` 없이 같은 탭에서 열기 금지** (ADR-008 트래픽 환원). 이유: 사용자가 원문으로 이동하지 않으면 저작권 방어 약해짐
