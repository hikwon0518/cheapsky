# Cheapsky

인천(ICN) 출발 아시아·미국 20개 노선의 저점 딜을 커뮤니티 관측 + 수동 시드 baseline 으로 증명하는 Discovery 대시보드.

## Why

- 한국 커뮤니티(뽐뿌·루리웹·클리앙)는 항공권 핫딜의 2~3차 전파라 지연·범위 편향이 심함
- 무료로 쓸 수 있는 외부 시세 API 가 부재 — 외부 시세 API 는 Stretch 3 조건부 (아래 "변경 이력" 참조)
- 그래서 **커뮤니티 관측(`price_observations`) + 수동 시드(`baseline_seed.json`) 하이브리드** 로 FSC/LCC 분위수를 구성해 "지금 저점인지"를 세 갈래 증거(할인율·분위수·시장 평균 대비)로 설명

## 차별화 포인트

- **FSC/LCC 이중 baseline**: 풀 서비스 항공사와 저비용 항공사를 분리해 분위수 산정 (ADR-024). LCC 특가가 FSC 기준에 찍혀 과대 판정되는 문제 해소
- **규칙 기반 한 줄 맥락 폴백**: 모든 카드에 데이터로부터 자동 생성한 한 줄이 항상 붙음. Stretch 2 에서 같은 위에 LLM 큐레이션이 덧씌워져도 Core 에선 규칙만으로 커버율 100%
- **Share Token 공유**: `?t=<token>` 기반 친구 공유 링크. Basic Auth 폴백 (ADR-019). 검색엔진에는 `X-Robots-Tag: noindex, nofollow` 로 차단 (ADR-008)

## 스크린샷

`docs/screenshot-2026-04-18.png` — 히어로 TOP 3 + 필터 5종 + 일반 리스트. (현재 placeholder — 실데이터 누적 후 교체 예정)

## 1분 DEMO 시나리오

1. **(0:00)** `?t=<share_token>` 링크 접속 → 히어로 "오늘 찾은 저점 딜 N개" + TOP 3 카드 즉시 렌더
2. **(0:15)** 첫 카드 🔥 배지 hover → 팝오버 4줄 (기준·현재·할인율·분위수 + confidence)
3. **(0:30)** 필터 조작 `출발월 5월 + 최대가 30만` → URL 갱신 (`?month=2026-05&maxPrice=300000`) · 리스트 fade 교체
4. **(0:45)** 카드 클릭 → 뽐뿌 원문이 새 탭으로 열림 (`target="_blank" rel="nofollow noopener"`, ADR-008 트래픽 환원)
5. **(0:55)** 공유 버튼 → 현재 필터·토큰 포함 URL 클립보드 복사

## 아키텍처 한 장

```
┌ baseline_seed.json (20 노선 × FSC/LCC/mixed) ─┐  ┌ 뽐뿌 해외여행 ─┐
└──────────── seed 로드 ─────────────────────────┘  └─── */15m cron ──┘
                              │                             │
                              ▼                             ▼
                    route_market_data           scripts/crawl.ts
                     (source='seed')                  │
                              │                       ├▶ rules 파서
                              │                       ├▶ dedupe (carrier_class 포함)
                              │                       ├▶ baseline.resolve
                              │                       ├▶ scorer (FSC/LCC 분위수 → 🔥)
                              │                       └▶ Supabase UPSERT
                              │                              │
                              └──────────────┬───────────────┘
                                             ▼
                                   Next.js 15 on Vercel
                              (middleware: Share Token → Basic Auth
                               SHOW_CACHED_ONLY=true → UI 캐시 배너)
                                             │
                                             ▼
                                         Browser
```

상세: `../harness_framework/docs/ARCHITECTURE.md` (한 눈에 보기 · 레이어 책임 · 데이터 모델).

## Core 범위

- [x] 프로젝트 부트스트랩 (`.env.example`, `tsconfig.json`, Tailwind v3, pnpm, vitest)
- [x] Baseline — 시드 20 노선 × FSC/LCC/mixed + 관측(`price_observations`) 가중 혼합 (ADR-011)
- [x] 뽐뿌 해외여행 크롤러 (`services/crawlers/ppomppu.ts`)
- [x] 규칙 기반 파싱 — `services/parser/rules.ts` (LLM 없음)
- [x] FSC / LCC 이중 baseline + 분위수 판정 (`lib/scorer.ts`, `services/baseline.ts`)
- [x] 딜 카드 (`DealCard`) — 시세 카드(`MarketCard`)는 Stretch 2
- [x] 히어로 + 일반 리스트 (Community Picks·히트맵 없음)
- [x] 🔥 배지 + 근거 팝오버 (`PriceBadge`) — 모바일 tap 대응
- [x] 카드 한 줄 맥락 규칙 기반 폴백 (`CurationLine`)
- [x] 필터 5종 + URL 상태 (`lib/filters.ts`, `FilterBar`)
- [x] Share Token + Basic Auth 미들웨어 (`src/middleware.ts`, runtime=nodejs)
- [x] 실효성 검증 HEAD (`scripts/verify.ts`)
- [x] 크롤러 헬스 푸터 (`CrawlerHealth`) + `/api/health`
- [x] `SHOW_CACHED_ONLY` UI 전용 플래그 (`CacheOnlyBanner`)
- [x] 일일 비용 모니터 (`scripts/cost_check.ts`)
- [x] README (이 문서, 1분 DEMO 인라인)

## 개발 명령어

### 1회 셋업

```bash
cp .env.example .env.local   # 값 채우기 — ARCHITECTURE.md 환경 변수 표 참조
pnpm install
psql $SUPABASE_DB_URL -f scripts/migrate.sql
psql $SUPABASE_DB_URL -f scripts/seed.sql     # baseline_seed.json → route_market_data
pnpm tsx scripts/crawl.ts                      # 뽐뿌 1회 시드 크롤
pnpm dev
```

### 일상

```bash
pnpm dev                               # http://localhost:3000 (middleware 401 방어)
pnpm tsx scripts/crawl.ts              # 수동 크롤
pnpm tsx scripts/verify.ts             # 실효성 검증 HEAD
pnpm tsx scripts/cost_check.ts         # 비용·행 수 알림
pnpm test                              # vitest
pnpm build                             # Next.js 15 프로덕션 빌드
pnpm typecheck                         # tsc --noEmit
pnpm lint
```

## 배치 운영

| 작업 | cron (UTC) | 한국시간 | 워크플로우 | 핵심 env |
|------|:----------:|:--------:|------------|----------|
| crawl | `*/15 * * * *` | 매 15 분 | `.github/workflows/crawl.yml` | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRAWLER_USER_AGENT` |
| verify | `0 */3 * * *` | 매 3 시간 | `.github/workflows/verify.yml` | 위와 동일 |
| cost_check | `0 0 * * *` | 매일 09:00 KST | `.github/workflows/cost_check.yml` | 위 + `ALERT_WEBHOOK` |

**Public repo 전제** (ADR-002): GH Actions 분 한도 무제한. `.env.local` / service role 키 / bcrypt 해시 commit 금지.

**Core 워크플로우는 `CHEAPSKY_STAGE` 환경변수를 설정하지 않는다** — 훅 게이트가 `core` 로 취급해 LLM SDK 설치를 차단한다 (ADR-005). Stretch 진입 시 별도 워크플로우에서만 `CHEAPSKY_STAGE: stretch` 명시.

헬스 대시보드: `/api/health` (JSON) · `CrawlerHealth` 푸터 점 (색상으로 최근 성공 / 지연 / 실패 구분).

## 라이선스·고지

**학습 프로젝트입니다. 구매·예약은 반드시 원본 출처 링크로 접속해주세요.**

- `robots.txt` 준수 · 요청 간격 ≥ 1 초 · 동시성 1 (ADR-008)
- UA 투명: `Cheapsky/0.1 (학습 프로젝트, +mailto:...)`
- 저장 범위: 제목·가격·링크·메타만 영구 · 본문 7일 TTL · **작성자 닉네임 저장 안 함**
- 공개 차단: Share Token + Basic Auth + `X-Robots-Tag: noindex, nofollow` + `<meta name="robots">`
- 트래픽 환원: 모든 딜 카드의 주 액션은 원문 링크 (`target="_blank" rel="nofollow noopener"`)
- 커뮤니티 운영진이 삭제 요청 → 해당 source 즉시 중단

### 변경 이력

- **2026-04-18** ADR-022 Deprecated — Amadeus for Developers 포털 신규 가입 중단 확인. Core baseline 은 수동 시드 + 관측 단독 운영으로 재편. 외부 시세 API 는 Stretch 3 조건부 (포털 재오픈 또는 ToS·비용 통과하는 대안 확보 시).

### Stretch 범위

- **1-stretch-sources** — 완료. 커뮤니티 확장 (루리웹 크롤러 · 플레이윙즈 크롤러 (ADR-025 동의 절차 통과 후) · Community Picks 섹션)
- **2-stretch-enhancements** — 완료. LLM 파싱 폴백 · 카드 큐레이션 · 스파크라인 · 시세 히트맵 · 노선 빈도 · 실효성 검증 정밀 (GET+가격 패턴) · 아카이브 페이지 · GLOSSARY / OPERATIONS / LLM_PROMPTS 문서
- **3-stretch-market-api** — 외부 조건부 (ADR-022 Deprecated). Amadeus 포털 재오픈 또는 ToS·비용 통과하는 대안 확보 시에만 착수

### 관련 문서

- [`docs/GLOSSARY.md`](docs/GLOSSARY.md) — 프로젝트 용어 사전 (가격 표현 · 분위수 · 소스 레이어 · 금지 용어)
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — 운영 런북 (장애 타입별 대응 · SQL 스니펫 · 주기 작업 타임라인 · Share Token 유출 대응)
- [`docs/LLM_PROMPTS.md`](docs/LLM_PROMPTS.md) — Stretch 2 LLM 프롬프트 아카이빙 (파싱 폴백 tool schema · 카드 큐레이션 system · 캐싱 전략 · 변경 이력)
- 아키텍처·결정·방법론: `../harness_framework/docs/` (ARCHITECTURE / ADR / PRD / UI_GUIDE / methodology / BACKLOG)
