# Step 0: project-bootstrap

## 읽어야 할 파일

먼저 아래 파일을 읽고 프로젝트의 기술 스택·디렉토리 규약을 파악하라:

- `docs/ARCHITECTURE.md` — 디렉토리 구조 (`src/app`, `src/components`, `src/lib`, `src/services`, `src/data`, `src/types`, `scripts/`, `__fixtures__/`)
- `docs/ADR.md` — ADR-001 (Next.js 15), ADR-003 (Supabase), ADR-022 (Amadeus Deprecated → 환경변수에 넣지 말 것)
- `harness_framework/CLAUDE.md` — 기술 스택 섹션

## 경로 규약 (이 프로젝트 전용)

- **앱 코드 루트**: `../app/` (harness cwd 기준 상대). 절대 경로로는 `cheapsky/app/`
- 이 step 이후 모든 step 문서는 `src/...`, `scripts/...` 처럼 **앱 루트(`../app/`) 기준 상대 경로**를 사용한다. 혼동되면 이 step 을 참조하라
- `harness_framework/` 디렉토리는 절대 건드리지 마라 (하네스 자기 자신)

## 작업

`../app/` 디렉토리를 새로 만들고 Next.js 15 프로젝트를 셋업하라.

### 1) 프로젝트 초기화

```bash
mkdir -p ../app && cd ../app
pnpm init
```

`../app/package.json` 의 `name` 은 `cheapsky`, `private: true`, `type: "module"`. 엔진은 `"node": ">=20"`.

### 2) 의존성 설치

**dependencies**:
- `next@^15` · `react@^19` · `react-dom@^19`
- `@supabase/supabase-js@^2`
- `bcryptjs@^2` (Basic Auth 해시 검증, ADR-019)

**devDependencies**:
- `typescript@^5` · `@types/node` · `@types/react` · `@types/react-dom` · `@types/bcryptjs`
- `tailwindcss@^3` (v4 아님! — `harness_framework/CLAUDE.md` 기술 스택 절대 규칙) · `postcss` · `autoprefixer`
- `tsx` (스크립트 실행)
- `vitest@^2` · `@vitest/ui`
- `eslint@^9` · `eslint-config-next@^15`
- `lucide-react` (아이콘, UI_GUIDE)

**절대 설치 금지**:
- `@anthropic-ai/sdk` / `openai` / `@google/generative-ai` / `cohere-ai` / `@mistralai/*` / `groq-sdk` / `langchain` / `ai` (Vercel AI SDK)
- Zustand / Redux / Jotai / Recoil / swr / @tanstack/react-query

### 3) 설정 파일 생성

**`tsconfig.json`** — `strict: true`, `target: "ES2022"`, `moduleResolution: "bundler"`, `jsx: "preserve"`, `paths: { "@/*": ["./src/*"] }`, `incremental: true`.

**`next.config.ts`** — 최소 설정. `typescript: { ignoreBuildErrors: false }`, `eslint: { ignoreDuringBuilds: false }`.

**`tailwind.config.ts`** — v3 문법. `content: ['./src/**/*.{ts,tsx}']`, `darkMode: 'class'`. `theme.extend.colors` 에 UI_GUIDE 팔레트 (`page: '#0a0a0a'`, `card: '#141414'`, `hero: '#1a1a1a'`, `filter: '#0f0f0f'`) 등록. `theme.extend.fontFamily` 에 `pretendard`, `inter` 정의.

**`postcss.config.mjs`** — `tailwindcss`, `autoprefixer` 플러그인.

**`vitest.config.ts`** — `test.environment: 'node'`, `test.include: ['src/**/*.test.ts', 'scripts/**/*.test.ts']`.

**`.eslintrc.json`** — `"extends": "next/core-web-vitals"`.

**`.gitignore`** — `.next/`, `node_modules/`, `.env.local`, `.env*.local`, `coverage/`, `*.log`, `__fixtures__/*.private.html`.

### 4) `.env.example` (Amadeus 제거 필수)

환경변수 표는 `docs/ARCHITECTURE.md` "환경 변수" 참조. 포함해야 할 키:

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=

# 접근제어 (ADR-019)
SHARE_TOKENS=friend_xxxxxxxxxxxx,backup_xxxxxxxxxxxx,debug_xxxxxxxxxxxx
BASIC_AUTH_USER=
BASIC_AUTH_PASS=

# 크롤러
CRAWLER_USER_AGENT=Cheapsky/0.1 (+mailto:your-email@example.com)

# 운영
ALERT_WEBHOOK=
SHOW_CACHED_ONLY=false

# Stretch 2 전용 (Core 에선 비워둠)
ANTHROPIC_API_KEY=
LLM_DAILY_BUDGET=300
```

**`AMADEUS_CLIENT_ID` / `AMADEUS_CLIENT_SECRET` 절대 추가하지 마라** (ADR-022 Rejected 2026-04-19 — 외부 시세 API 영구 제외).

### 5) 디렉토리 스캐폴딩

다음 디렉토리를 빈 `.gitkeep` 과 함께 생성:
```
src/app/
src/app/api/
src/components/
src/lib/
src/services/crawlers/
src/services/parser/
src/data/
src/types/
scripts/
__fixtures__/
```

### 6) 최소 런너블 앱

**`src/app/layout.tsx`** — Server Component. `<html lang="ko" className="dark">`, `<body className="bg-page text-neutral-200">`. metadata 에 `robots: 'noindex, nofollow'`, `title: 'Cheapsky'`. Pretendard/Inter 폰트 링크.

**`src/app/page.tsx`** — `async function Page()` placeholder. `<main>` 안에 `<h1>Cheapsky</h1>` + `인천 출발 항공권 저점 레이더` 서브라벨. 실제 데이터 연결은 step 5.

**`src/app/globals.css`** — `@tailwind base;`, `@tailwind components;`, `@tailwind utilities;` + `:root { font-family: 'Pretendard Variable', Inter, system-ui, sans-serif; }`.

### 7) 스모크 테스트

`src/lib/__smoke.test.ts` — `expect(1 + 1).toBe(2)` 한 줄. vitest 동작 확인용.

## Acceptance Criteria

`../app/` 에서:
```bash
pnpm install
pnpm build     # Next.js 컴파일 에러 없음
pnpm test      # vitest 스모크 통과
pnpm lint      # ESLint 에러 없음 (warning 은 허용)
```

## 검증 절차

1. 위 AC 커맨드가 전부 성공
2. `../app/.env.example` 에 `AMADEUS_*` 키가 없음을 확인 (`grep -i amadeus ../app/.env.example` → no match)
3. `../app/package.json` 의 dependencies 에 금지 LLM SDK / 전역상태 라이브러리가 없음을 확인
4. `tailwindcss` 버전이 `^3` 인지 확인 (`pnpm list tailwindcss`)
5. `phases/0-core-mvp/index.json` step 0 을 업데이트:
   - 성공 → `"status": "completed"`, `"summary": "Next.js 15 + TS strict + Tailwind v3 + pnpm + vitest 스캐폴딩 완료. ../app/ 루트에 src/{app,components,lib,services,data,types} + scripts/ + __fixtures__/ 디렉토리 생성. .env.example 은 Amadeus 제거 상태."`
   - 실패 → `"status": "error"`, `"error_message": "..."`

## 금지사항

- **Tailwind v4 설치 금지.** 이유: `CLAUDE.md` 기술 스택에 `Tailwind v3.x` 로 고정. v4 는 CSS-only config 방식이 달라 후속 step (UI_GUIDE 팔레트 주입) 과 깨진다
- **LLM SDK 설치 금지** (ADR-005 Core). 이유: Core 단계 훅 `block_llm_deps.py` 가 차단하지만 훅 실패 가능성 대비 설계 레벨 방어
- **전역 상태 라이브러리 설치 금지** (ADR-007). 이유: 필터는 URL 쿼리로만
- **`AMADEUS_*` 환경변수 추가 금지** (ADR-022 Rejected 2026-04-19). 이유: 외부 시세 API 영구 제외
- **`src/services/amadeus.ts` 등 시세 클라이언트 파일 생성 금지** (ADR-022 Rejected). 이유: 복원은 신규 ADR 로만 가능
- **`harness_framework/` 하위 파일 수정 금지**. 이유: 하네스 자기 자신
- **`app/` 안에 `.env.local` 커밋 금지** (ADR-002). 이유: public repo 전제, service_role 키 유출 방지
