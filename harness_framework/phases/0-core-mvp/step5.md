# Step 5: ui-core

## 읽어야 할 파일

- `docs/UI_GUIDE.md` — **전체**. 팔레트·컴포넌트·AI 슬롭 금지·접근성·반응형
- `docs/ARCHITECTURE.md` — "데이터 흐름 (6) 렌더", "Server Component 우선"
- `docs/PRD.md` — 히어로·필터 5종·리스트·카드 한 줄 맥락 Core 요구사항
- `docs/ADR.md` — ADR-007 (URL 상태), ADR-012 ("역대가"·Anthropic 명칭 금지), ADR-023 (Core 히어로만, Community/히트맵 Stretch)
- 이전 step 산출물:
  - `../app/src/types/deal.ts`
  - `../app/src/lib/{db,tz,format,airlines,airport-aliases,route-map,share-token,skyscanner-url}.ts`
  - `../app/src/services/baseline.ts`

## 작업

앱 루트는 `../app/`. 이 step 은 **Core UI 전부**. Community Picks·MarketCard·시세 히트맵·Sparkline 은 Stretch — **만들지 마라**.

### 1) 페이지 · 레이아웃

**`src/app/layout.tsx`** — Server Component
- metadata: `robots: { index: false, follow: false }`, `title: 'Cheapsky'`, `description` 한 줄
- `<html lang="ko" className="dark">` / `<body className="bg-page text-neutral-200 min-h-screen">`
- 폰트: Pretendard Variable (Google Fonts 또는 CDN link), Inter fallback
- 컨테이너 `max-w-6xl mx-auto px-4 md:px-6`

**`src/app/page.tsx`** — `async function Page({ searchParams })`
1. filters = parseSearchParams(searchParams) — 5종 필터 해석
2. SHOW_CACHED_ONLY 체크 → `<CacheOnlyBanner />`
3. 데이터 쿼리 (getAnonClient):
   - heroTop3: `hot_deal=true AND verification_status='active' AND expires_at > now()` ORDER BY `discount_rate DESC` LIMIT 3
   - heroTop3 비면 "최근 7일 TOP 3" (discount_rate 기준)로 폴백
   - list: 필터 적용 쿼리 (50건)
   - crawlerHealth: `crawler_runs` 에서 source 별 최근 success row
   - stale 여부: 뽐뿌 최근 2시간 성공 없음
4. render:
```
<Header />  (sticky, backdrop-blur-sm 예외 1곳)
{SHOW_CACHED_ONLY && <CacheOnlyBanner />}
{stale && <StaleBanner />}
<FilterBar />  (sticky top-14)
{heroTop3.length > 0 && <Hero deals={heroTop3} />}
<DealList deals={list} />
<Footer>
  <CrawlerHealth data={health} />
</Footer>
```

### 2) Server Components (DealCard 포함)

**`src/components/Header.tsx`** — 로고 + 서브라벨 `인천 출발 항공권 저점 레이더`

**`src/components/Hero.tsx`** — Server Component
- 상단 바: `오늘 찾은 큰 폭 할인 <N>개` · `최대 할인율 <X>%`
- `grid md:grid-cols-3 gap-3 mt-4` TOP 3 카드 (데스크톱)
- 모바일: TOP 1 크게, 2·3 간소화
- 히어로 카드는 `DealCard variant="hero"` 로 렌더 (크기만 차이)
- UI_GUIDE "히어로" 섹션 정확히 준수

**`src/components/DealCard.tsx`** — Server Component (변형 `variant: 'hero' | 'list'`)
- `<a href={deal.sourceUrls[0]} target="_blank" rel="nofollow noopener">` 로 감쌈 (원문 새 탭)
- 레이아웃: UI_GUIDE "딜 카드" 1~5 순서
  1. 상단: 노선(`ICN → KIX`) + 항공사(`대한항공 · FSC`) + `<ShareButton />`
  2. 중단: 가격(`text-2xl`, hero 는 `text-3xl`) + `<PriceBadge />`
  3. 하단 1: `<CurationLine />` (Core: 규칙 기반 한 줄)
  4. 하단 2: 경과시간 (Stretch 부분은 skip — 스파크라인·노선빈도 X)
  5. 최하단: `<SourceTag sources={deal.sources} />`
- `border-neutral-800`, `rounded-md` (UI_GUIDE 금지 목록 따라 `rounded-2xl` 금지)
- `min-h-[180px]` (hero 220px)
- `snapshot` / `price_changed` 상태 처리 (opacity 0.5 grayscale italic, `price_changed` 배지 옆 amber)

**`src/components/DealList.tsx`** — Server Component
- `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3`
- 빈 상태: `<EmptyState />`

**`src/components/SourceTag.tsx`** — `text-[11px] text-neutral-500 uppercase tracking-wide`. `sources.join(' · ')`.

**`src/components/CurationLine.tsx`** — Server Component. **규칙 기반 폴백 전용** (Stretch 에서 LLM 덮어쓰기).
- 입력: `deal: Deal` (필요 필드 추출)
- 로직:
  - baselineSource null → `시장 평균 정보 수집 중`
  - 정상: `시장 평균 대비 -<X>% · 하위 p<N> · <FSC|LCC|혼합> 분위수`
  - confidence low 일 때 접미사 변경 가능
- 60자 cut (format.clampCurationText)
- "Amadeus" 금지 (ADR-012). "역대가" 금지
- `text-xs text-neutral-300 leading-snug line-clamp-2 min-h-[32px]`

**`src/components/CrawlerHealth.tsx`** — Server Component (푸터용)
- Core 표기: `● 뽐뿌 3분 전` 하나만
- 점 색: UI_GUIDE 규칙 (30분 이내 에메랄드 / 30분~2h 회색 / 2h+ 빨강)
- `aria-label` 병기

**`src/components/StaleBanner.tsx`** — amber 계열, UI_GUIDE 문구 그대로

**`src/components/CacheOnlyBanner.tsx`** — 🔒 아이콘 + 문구

**`src/components/EmptyState.tsx`** — `조건에 맞는 딜이 없어요. 필터를 완화해보세요.` + 필터 초기화 링크

### 3) Client Components

**`src/components/FilterBar.tsx`** — `'use client'` (ADR-007, ADR-020)
- 5개 입력: 국가/대륙, 최대 가격, 출발 월, 최소 할인율, 신선도
- `useSearchParams` + `useRouter` + 300 ms debounce
- 모바일 < 640 px: `FilterDrawer` 로 수납 (bottom sheet, 같은 파일 또는 `FilterDrawer.tsx` 분리)
- 초기화 버튼 (기본값일 때 비활성)
- 전역 상태 라이브러리 절대 금지 (ADR-007)

**`src/components/PriceBadge.tsx`** — `'use client'`
- 배지 텍스트: `🔥 저점 -47%` / `큰 폭 할인` / snapshot 시 비표시
- 팝오버 (UI_GUIDE "배지 근거 팝오버" 4줄 포맷)
- 모바일 tap 충돌: `onClick={e => { e.preventDefault(); e.stopPropagation(); toggle(); }}`
- `<button type="button">` 로 렌더 (접근성)
- popover `stopPropagation`, 내부 링크는 예외
- `aria-label="저점 딜, N% 할인"`
- **"역대가" 문자열 금지** (ADR-012)

**`src/components/ShareButton.tsx`** — `'use client'`
- lucide `share-2` size=14
- Web Share API / clipboard fallback
- 토스트 (`링크 복사됨`, 2s)
- 공유 URL 에 현재 필터 쿼리 + share token 포함 (token 은 현재 URL 에서 추출)
- `aria-label="이 딜 공유하기"`

### 4) Tailwind 설정 확장

step 0 에서 만든 `tailwind.config.ts` 에 UI_GUIDE 색 팔레트 추가 (`page/card/hero/filter`). 필요시 `animation: { 'fade-in': 'fadeIn 200ms', ... }` 키프레임 추가.

### 5) 글로벌 CSS

`src/app/globals.css` 에 `font-variant-numeric: tabular-nums` 를 `.tabular-nums` 유틸로 (Tailwind 기본 제공 확인 후 필요시). `* { focus-visible:outline-2 outline-emerald-400 outline-offset-2 }` 접근성 기본.

### 6) 실제 페이지 동작 확인

```bash
cd ../app
pnpm dev
# 브라우저 localhost:3000?t=<SHARE_TOKENS 중 하나>
```

- 딜 데이터가 있으면 히어로·리스트 렌더
- 딜이 없으면 히어로 숨김 + EmptyState
- 필터 조작 시 URL 갱신 + 300 ms debounce 후 리스트 교체

**주의**: middleware (share token → Basic Auth) 는 step 6 에서 붙인다. 이 step 에선 URL 로 직접 접근해도 됨 (middleware 없으니 인증 통과).

## Acceptance Criteria

```bash
cd ../app
pnpm build          # Next.js 빌드 성공 (Server Component 타입 에러 없음)
pnpm typecheck 2>/dev/null || pnpm exec tsc --noEmit
pnpm lint
pnpm test           # 기존 테스트 유지
pnpm dev            # localhost:3000 정상 응답 (백그라운드)
```

`curl -s http://localhost:3000 | head` 또는 브라우저에서 HTML 확인:
- 히어로·리스트 렌더되거나 EmptyState
- Tailwind 색 적용 (`bg-page`, `text-neutral-200`)
- `<meta name="robots" content="noindex, nofollow">` 포함

## 검증 절차

1. 위 AC 전부 성공
2. **UI 슬롭 체크리스트** (`check_ui_slop.py` 훅이 Write 시 검증하지만 수동 재확인):
   - `backdrop-blur` 는 헤더 한 곳만 (`backdrop-blur-sm`)
   - `rounded-2xl`, `from-purple-`, `to-indigo-`, `violet-*`, `blur-3xl`, "Powered by AI" 문자열 0건
   - 🔥 외 이모지 카드 사용 0건 (🔒 배너 제외)
   - `hover:scale-*`, `hover:translate-y-*`, `hover:rotate-*` 0건
3. `CurationLine`, `PriceBadge` 에 "역대가" / "Amadeus" 문자열 없음
4. 전역 상태 라이브러리 import 0건 (`grep -r "from ['\\\"]zustand\\|redux\\|jotai\\|recoil\\|swr\\|react-query" src/`)
5. `FilterBar` 가 `'use client'` 이고 `useSearchParams` 사용
6. **MarketCard / MarketHeatmap / CommunityPicks / Sparkline 파일이 없음** (Stretch 범위)
7. `phases/0-core-mvp/index.json` step 5 업데이트:
   - 성공 → `"status": "completed"`, `"summary": "app/{layout,page} + components/{Header,Hero,DealCard,DealList,FilterBar,PriceBadge+popover,CurationLine(규칙 기반),ShareButton,SourceTag,CrawlerHealth,StaleBanner,CacheOnlyBanner,EmptyState}. URL 쿼리 상태(ADR-007), UI 슬롭 금지 규칙 전수 준수. MarketCard/히트맵/Community Picks/Sparkline 은 Stretch 로 제외."`

## 금지사항

- **MarketCard · MarketHeatmap · CommunityPicks · Sparkline 구현 금지** (ADR-023, ADR-026). 이유: 각각 Stretch 2 / Stretch 1 범위. Core 완성 전 금지
- **Zustand / Redux / SWR / React Query 등 상태·fetch 라이브러리 사용 금지** (ADR-007). 이유: 필터는 URL 상태 + Server Component 만으로 충분
- **"역대가" / "Amadeus" 문자열 UI 노출 금지** (ADR-012). 이유: 불가역 결정
- **Tailwind `rounded-2xl` / gradient-text / `blur-3xl` / `hover:scale-*` 사용 금지** (UI_GUIDE). 이유: AI 슬롭 패턴
- **LLM 호출·커뮤니티 댓글 fetching 금지** (ADR-005 Core). 이유: Core 단계 LLM 전면 금지
- **`'Powered by AI'` 배지, 🔥·🔒 외 이모지 카드 사용 금지** (UI_GUIDE)
- **`rounded-2xl` 표준화 금지**. 이유: 기본은 `rounded-md` (8px)
