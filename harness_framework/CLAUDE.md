# 프로젝트: Cheapsky

인천 출발 아시아·미국 20개 노선 항공권을, 커뮤니티 관측 + 수동 시드 baseline 에 블로그·커뮤니티 큐레이션 딜을 교차하여 **"지금 저점인지"를 세 갈래 증거로 증명**하는 Discovery 대시보드. Core/Stretch 1/Stretch 2 완료 후 **개인 · 소수 지인 실사용 지속 개선 모드** 로 확장 (ADR-026 재작성, 2026-04-19). **ADR-022 Rejected(2026-04-19) — 외부 시세 API 영구 제외. Phase 3 = `3-community-expansion` (클리앙 · 디시 · 네이버 블로그 조건부, ADR-030)**.

## 유일한 진실 소스
- `docs/PRD.md` — 목표·기능·MVP Core/Stretch 범위·성공 지표
- `docs/ARCHITECTURE.md` — 디렉토리 구조·데이터 모델·흐름
- `docs/ADR.md` — 30개 결정 (각 ADR에 `[Core]` / `[Stretch]` 태그)
- `docs/UI_GUIDE.md` — 팔레트·컴포넌트·AI 슬롭 금지·접근성
- `docs/methodology.md` — 시드 baseline 조사 절차 (20 노선 × FSC/LCC/mixed, 관측 콜드 스타트)
- `docs/BACKLOG.md` — MVP 범위 밖 아이디어 격리

본 파일과 `docs/` 사이 모순이 발견되면 **docs를 따른다**. `/harness` 실행 시 이 파일과 `docs/*.md` 전체가 매 step 프롬프트에 주입된다.

## 기술 스택 (ADR-001, ADR-003)
- **Frontend**: Next.js 15 (App Router) + TypeScript strict
- **Styling**: **Tailwind CSS v3.x** (v4 아님 — CSS-only config 방식 차이로 안정성 선택). 다크 모드 고정
- **DB**: Supabase Postgres (RLS: anon 읽기 only, service_role 쓰기 only)
- **Baseline**: 수동 시드 (`baseline_seed.json`, 20 노선 × FSC/LCC/mixed) + 관측 재집계 (`price_observations`). ADR-011/024
- **LLM** (Stretch 2 전용): Anthropic Claude Haiku 4.5
- **시세 API**: ADR-022 **Rejected** 2026-04-19. 영구 미도입 (GDS ≠ 핫딜 소스). 복원은 신규 ADR 필요
- **배포**: Vercel Hobby + GitHub Actions cron (public repo 전제, ADR-002)
- **패키지 매니저**: pnpm
- **테스트**: vitest

## 아키텍처 규칙

### CRITICAL — 절대 어기면 안 됨

- **유일한 진실 소스는 `docs/`** — 코딩 전 반드시 `ADR.md`를 읽을 것. 본 파일은 요약
- **전역 상태 라이브러리 금지** (ADR-007) — Zustand / Redux / Jotai / Recoil / SWR / React Query. 필터·정렬은 URL 쿼리 파라미터로만 (`useSearchParams` + `router.replace` + 300ms debounce)
- **LLM 정책 분기** (ADR-005)
  - **Core 단계**: LLM API 호출 **전면 금지**. 파싱은 규칙 기반만 (`lib/route-map.ts`, `lib/airport-aliases.ts`, `lib/airlines.ts`)
  - **Stretch 2 단계**: **Claude Haiku 4.5만** 허용. 두 용도로만 — 파싱 폴백(규칙 실패분, 일 300회 상한) / 카드 한 줄 큐레이션(시간당 50회, 60자 이내, 금칙어 검증)
  - 환경변수 `CHEAPSKY_STAGE=stretch`로 훅 게이트 해제
  - **다른 LLM SDK 전부 금지**: OpenAI / Google GenAI / Cohere / Mistral / Groq / LangChain / Vercel AI SDK
  - **LLM 전송 범위**: 제목 + 본문 앞 500자까지만 (폴백) / 정제 숫자 필드만 (큐레이션). 본문 전문 전송 금지
- **외부 시세 API 영구 금지** (ADR-022 **Rejected** 2026-04-19) — Amadeus · Duffel · Kiwi · Travelpayouts · FlightAPI · Skyscanner Partner · SerpAPI 등 전부. `services/amadeus.ts` 또는 대체 시세 클라이언트는 **어떤 단계에서도 생성 금지**. 복원은 신규 ADR 로만 (ADR-022 Rollback 조건 참조)
- **크롤러 소스는 뽐뿌 · 루리웹 · 플레이윙즈** (Core/Stretch 1 완료). **Phase 3 착수 시 클리앙 · 디시 · (조건부) 네이버 블로그 추가 허용** (ADR-004 재작성 + ADR-030). 레드비쥬 · 해외 매체 등 나머지는 v2 Deferred 유지
- **상용 OTA 직접 크롤 금지** (ADR-008) — 스카이스캐너·구글 플라이트·카약 등. **스카이스캐너 검색 URL 생성만 허용** (`lib/skyscanner-url.ts`, ADR-027)
- **범위**: 인천 출발 아시아 17 + 미국 3 = **20개 노선 고정** (ADR-021). 유럽·오세아니아·중동·남미 금지
- **"역대가" 용어 금지** (ADR-012). 대체: 🔥 저점 / "시장 평균 대비 N% 할인" / "큰 폭 할인"
- **UI에서 내부 서비스명(Anthropic 등) 노출 금지** (ADR-012)
- **🔥 저점 판정은 FSC/LCC 이중 baseline** (ADR-006, ADR-024) — 단일 판정 금지. baseline 소스: ADR-011 우선순위(관측 ≥30 → 혼합 10~29 → 시드 FSC/LCC → 시드 mixed(🔥 미부여)). p10 이하 기준
- **출발일은 범위 허용** (ADR-014) — `depart_from`/`depart_to` 두 컬럼
- **저장 범위 제한** (ADR-008) — 제목·가격·링크·메타만 영구. 본문 7일 TTL. **작성자 닉네임·아이디 저장 금지**
- **타임존** (ADR-015) — 저장 UTC / 표시 `Asia/Seoul` (`lib/tz.ts`)
- **중복 제거 키** (ADR-009) — `sha1(origin | dest | floor(price/1000)×1000 | YYYY-MM | carrier_class)`. `posted_at`·정확 날짜는 포함하지 않음
- **크롤러는 순수 함수** — `(config) => Promise<RawPost[]>`. DB 접근·로깅은 caller(`scripts/crawl.ts`)에서만
- **fail-soft 파싱** — 예외 안 던짐, 실패 필드는 `null`, 필수 필드(origin/destination/priceKrw) 중 하나라도 null이면 UPSERT 제외

### 일반 규칙

- 컴포넌트는 `src/components/`, 타입은 `src/types/`, 유틸은 `src/lib/`, 외부 API 래퍼는 `src/services/`로 분리
- **Server Component 우선** — `app/page.tsx`는 `async function Page()`. `'use client'`는 FilterBar / PriceBadge 팝오버 / Sparkline / ShareButton 등 인터랙션 필요한 곳만
- 모든 배치 스크립트는 `scripts/` (Node tsx 실행). `crawler_runs` 기록 필수
- `SHOW_CACHED_ONLY=true` 환경변수 시 모든 외부 호출 스킵 (ADR-028)
- `.env.local`·`SUPABASE_SERVICE_ROLE_KEY`·Basic Auth 해시 commit 절대 금지 (public repo 전제)

## 디자인 규칙 (요약, 전체는 UI_GUIDE.md)

### 팔레트 (Cheapsky Light v5, 2026-04-19 포팅)
- 페이지 `#fafaf9`, 카드·surface `#ffffff`, 보조 면 `#f6f6f4`
- 텍스트: `--ink`(`#0b0b0c`) 주, `--ink-2/3/4/5` 단계별 회색
- Hairline `--line`(`#ececE7`), 강조 테두리 `--line-2`(`#dedcd6`)
- 데이터 시맨틱: `--low`(green) 할인 · `--hot`(ember) 🔥 저점 · `--up`(red) 가격 상승 · `--warn`(amber) 경고 · `--accent`(`#0a66ff`) focus 전용
- CSS 변수는 `app/src/app/globals.css`, Tailwind 매핑은 `tailwind.config.ts`
- 가격은 `font-variant-numeric: tabular-nums` 필수
- `text-white` / `text-neutral-*` / `text-emerald-*` / `text-amber-*` 신규 사용 금지 (레거시 다크 테마 잔재)

### 금지 (AI 슬롭)
- `backdrop-filter: blur()` (sticky 헤더/필터 `backdrop-blur-sm` 만 예외)
- bg-clip-text + text-transparent 로 만드는 gradient-text
- 보라·인디고·바이올렛 계열 (`from-purple-`, `to-indigo-`, `violet-*`)
- `blur-3xl` 배경 orb
- `box-shadow` glow 애니메이션
- "Powered by AI" 배지
- `rounded-3xl` 과 과도한 둥근 모서리 (hero 는 `rounded-xl`/`2xl`, 기본 `rounded-lg`)
- hover `scale` / `translate-y` / `rotate`
- 🔥 외 이모지 카드 사용

### 카드 유형 분리 (ADR-027)
- **딜 카드 hero** (`DealCard variant="hero"`): `rounded-xl border-line-2` + soft shadow, dual CTA (원문 + 스카이스캐너)
- **딜 카드 list** (`DealCard variant="list"`): `rounded-lg border-line`, 카드 전체 `<Link>` 원문 새 탭
- **시세 카드** (`MarketCard`): `rounded-lg border-dashed border-line-2`, `참고 시세` 라벨, 스카이스캐너 검색 URL 이동

## 개발 프로세스

- **Core 완성 전 Stretch 금지** (ADR-026). 각 ADR의 `[Core]` / `[Stretch]` 태그 확인 후 착수
- 새 기능은 `docs/ADR.md`의 기존 결정을 위반하지 않는지 점검. 위반 필요 시 **ADR을 먼저 update → 훅 완화 → 구현** 순서
- 커밋: conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`)
- `/harness`가 2단계 자동 커밋 (코드 `feat` + 메타데이터 `chore`)
- scorer·dedupe·parser 경계값 단위 테스트 필수 (할인 0/29/30/50%, baseline null, FSC/LCC 분기)
- 크롤러는 고정 HTML 픽스처(`__fixtures__/<source>-list.html`)로 파싱 회귀 테스트
- 추상 레이어·미래 확장성 금지. **3번 비슷한 코드 > 잘못된 추상화 1개**

## 명령어

### 개발
```
pnpm install
cp .env.example .env.local
psql $SUPABASE_DB_URL -f scripts/migrate.sql
psql $SUPABASE_DB_URL -f scripts/seed.sql
pnpm dev
```

### 배치 (수동 실행)
```
pnpm tsx scripts/crawl.ts              # 뽐뿌 (Core) + (Stretch 1) 루리웹·플레이윙즈
pnpm tsx scripts/verify.ts             # 실효성 검증 (Core: HEAD만)
pnpm tsx scripts/cost_check.ts         # 비용 모니터
pnpm tsx scripts/curate.ts             # Stretch 2: LLM 큐레이션
pnpm tsx scripts/archive_daily.ts      # Stretch 2: 일별 TOP 5 아카이브
pnpm tsx scripts/backfill.ts --seed-reload  # baseline_seed.json → route_market_data 재UPSERT
# scripts/ingest_market.ts: ADR-022 Rejected 2026-04-19 — 영구 미구현. 복원은 신규 ADR 로만
```

### 검증
```
pnpm build        # 컴파일 에러
pnpm lint         # ESLint
pnpm test         # vitest
pnpm typecheck    # tsc --noEmit
```

### Stage 환경
```
# Core (기본, LLM SDK 설치 차단)
python scripts/execute.py <task>

# Stretch (Anthropic SDK 허용)
export CHEAPSKY_STAGE=stretch
python scripts/execute.py <task>
```

### 하네스 자체 테스트
```
py -3.12 -m pytest scripts/test_execute.py -v
py -3.12 -m pytest scripts/test_hooks.py -v
```
