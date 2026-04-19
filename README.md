# Cheapsky

**인천 출발 20개 노선 항공권 저점 레이더.** 뽐뿌 · 루리웹 · 플레이윙즈 커뮤니티 관측 + 20 노선 수동 시드 baseline 으로 "지금 저점인가?" 를 세 갈래 증거로 증명하는 Discovery 대시보드.

> 2주짜리 학습용 MVP. **Cheapsky Light v5** (2026-04-19) 라이트 테마 공식 전환.

---

## Monorepo 구조

```
cheapsky/
├── app/                 # Next.js 15 + TypeScript strict (실제 웹앱)
│   ├── src/components/  # Hero · DealCard · Counter · Timeline · MonthTiming · ...
│   ├── src/lib/         # city-names · format · presets · filters · i18n · ...
│   ├── src/services/    # crawlers/{ppomppu,ruliweb,playwings} · parser · verifier · ...
│   ├── scripts/         # crawl · verify · curate · archive_daily · backfill · cost_check
│   └── docs/            # GLOSSARY · OPERATIONS · LLM_PROMPTS
│
├── harness_framework/   # Phase 기반 자동 실행 도구 (jha0313/harness_framework 기반 재구성)
│   ├── docs/            # PRD · ARCHITECTURE · ADR(029) · UI_GUIDE · methodology · BACKLOG
│   ├── phases/          # 0-core-mvp · 1-stretch-sources · 2-stretch-enhancements
│   └── scripts/
│       ├── execute.py   # Claude -p --dangerously-skip-permissions 로 step 자동 실행
│       └── hooks/       # AI-slop · secrets · LLM deps · dangerous bash · deprecated targets
│
└── .github/workflows/   # GitHub Actions cron (crawl · verify · cost_check · curate · archive)
```

---

## 설치 · 개발

```bash
# 1) 의존성
cd app
pnpm install

# 2) 환경 변수 (ADR-002 · public repo 전제로 secrets 는 .env.local 에만)
cp .env.example .env.local
# .env.local 편집: Supabase URL·KEY, CRAWLER_USER_AGENT, ANTHROPIC_API_KEY (Stretch 2)

# 3) DB 마이그레이션
psql "$SUPABASE_DB_URL" -f scripts/migrate.sql
psql "$SUPABASE_DB_URL" -f scripts/seed.sql

# 4) 개발 서버
pnpm dev   # http://localhost:3000
```

---

## 주요 명령어

```bash
# 검증
pnpm test        # vitest · 384 tests
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm build       # 프로덕션 빌드

# 배치 (수동 실행)
pnpm tsx scripts/crawl.ts           # 뽐뿌 + 루리웹 + 플레이윙즈
pnpm tsx scripts/verify.ts          # 실효성 검증 (Core HEAD / Stretch PRECISE GET)
pnpm tsx scripts/archive_daily.ts   # 일별 TOP 5 스냅샷
CHEAPSKY_STAGE=stretch pnpm tsx scripts/curate.ts  # LLM 큐레이션 (Anthropic 크레딧 필요)

# Harness (phase 기반 자동 실행)
cd ../harness_framework
py -3.12 scripts/execute.py 0-core-mvp
py -3.12 scripts/execute.py 1-stretch-sources
CHEAPSKY_STAGE=stretch py -3.12 scripts/execute.py 2-stretch-enhancements
```

---

## 핵심 기능 (Light v5)

- **Hero 3 · Verdict** — "지금 사기 좋아요 · 평소 X원이던 노선이에요"
- **프리셋 칩** — 일본 30만 / 🔥 할인만 / 여름휴가 / 오늘 올라온 딜 / 미국 100만 / 동남아
- **Dual CTA** — 원문 · {source} + 스카이스캐너 검색 + 상세 보기 (Hero hover reveal)
- **Counter 섹션** — "지금은 기다려 보세요" (평소보다 비싼 노선 3개)
- **Timeline feed** — 최근 24h 딜 흐름 (hot/first/price_up/new 4종)
- **Month best timing** — 일본 12개월 시즌 calendar
- **Community Picks** — 반응 많은 딜 (루리웹 views 상위 20% → `HOT` · 다음 20% → `TRENDING`)
- **20 노선 시세 히트맵** — MarketCard 5×4 grid + 모바일 펼침
- **노선 상세 모달** — 90일 큰 SVG 차트 + 시즌 mini calendar + CTA
- **⌘K Command palette** — 20 목적지 · 6 프리셋 키보드 검색
- **Compare drawer** — 최대 4 노선 나란히 비교 (localStorage)
- **Saved routes** — 찜 strip + 하트 토글 (localStorage)
- **모바일 하단 탭바** — 홈/찜/알림/설정
- **Toast · Tweaks(dev) · i18n(KO/JA/EN)**

---

## 문서 (Single Source of Truth)

모든 결정은 `harness_framework/docs/` 를 따른다. 본 README 는 진입점 요약.

| 문서 | 내용 |
|------|------|
| [docs/PRD.md](harness_framework/docs/PRD.md) | 목표 · 페르소나 · Core/Stretch 범위 · 성공 지표 · 실패 UX |
| [docs/ARCHITECTURE.md](harness_framework/docs/ARCHITECTURE.md) | 디렉토리 · 데이터 모델 · 흐름 · 장애 복구 |
| [docs/ADR.md](harness_framework/docs/ADR.md) | 29개 결정 (ADR-001 ~ ADR-029, 각 `[Core]` / `[Stretch]` 태그) |
| [docs/UI_GUIDE.md](harness_framework/docs/UI_GUIDE.md) | 라이트 팔레트 · AI 슬롭 금지 · 컴포넌트 스펙 · 접근성 |
| [docs/methodology.md](harness_framework/docs/methodology.md) | 시드 baseline 조사 절차 (20 노선 × FSC/LCC/mixed) |
| [docs/BACKLOG.md](harness_framework/docs/BACKLOG.md) | MVP 범위 밖 아이디어 |
| [app/docs/GLOSSARY.md](app/docs/GLOSSARY.md) | 용어 사전 (금지 용어 포함) |
| [app/docs/OPERATIONS.md](app/docs/OPERATIONS.md) | 운영 런북 (장애 대응 · SQL snippets) |
| [app/docs/LLM_PROMPTS.md](app/docs/LLM_PROMPTS.md) | Stretch 2 LLM 프롬프트 아카이브 |

---

## 배포

- **앱**: Vercel Hobby (`app/` 를 프로젝트 루트로 지정, `vercel.json` 참조)
- **Cron**: GitHub Actions (`.github/workflows/*.yml` · public repo 전제로 분 한도 무제한)
  - `crawl.yml`: 매 15 분 (뽐뿌 · 루리웹 · 플레이윙즈)
  - `verify.yml`: 매 시간 (딜 실효성 HEAD/PRECISE)
  - `cost_check.yml`: 매일 (Supabase · LLM 사용량)
  - `curate.yml`: 매시 30분 (LLM 큐레이션, Stretch 2)
  - `archive_daily.yml`: 매일 KST 00:05 (일별 TOP 5 snapshot)
- **DB**: Supabase Free Tier · RLS (anon read-only, service_role write-only)
- **Stage 게이트**: `CHEAPSKY_STAGE=stretch` env 로 LLM SDK 허용 (Core 는 차단)

---

## 스택

- **Frontend**: Next.js 15 (App Router) · React 19 · TypeScript strict · Tailwind v3
- **DB**: Supabase Postgres
- **LLM** (Stretch 2): Anthropic Claude Haiku 4.5 · 일 300회 상한
- **패키지 매니저**: pnpm
- **테스트**: Vitest · 384 tests
- **배포**: Vercel + GitHub Actions

---

## 라이선스 · 데이터

학습 프로젝트. 모든 딜은 **원문 링크로 트래픽 환원** (ADR-008). 작성자 닉네임·아이디 저장 금지. 본문 7일 TTL. 상용 OTA 크롤 금지. "역대가" 용어 금지 (ADR-012).

Source: [jha0313/harness_framework](https://github.com/jha0313/harness_framework) 를 참고해 본인 스타일로 재구성.

---

Built with [Claude Code](https://claude.com/claude-code) · Opus 4.7 (1M context).
