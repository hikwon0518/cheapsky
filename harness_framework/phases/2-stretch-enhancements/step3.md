# Step 3: market-heatmap

## 읽어야 할 파일

- `docs/UI_GUIDE.md` — **"오늘의 노선 시세 히트맵 (Stretch, ADR-023)"**, "시세 카드 (MarketCard)", "카드 유형 분리"
- `docs/ADR.md` — **ADR-023** (3-섹션 UI), **ADR-027** (카드 유형 분리), ADR-021 (20 노선 고정)
- `docs/PRD.md` — "오늘의 노선 시세 히트맵 (Stretch 2)" 요구사항
- 이전 산출물:
  - `app/src/lib/skyscanner-url.ts` (Core 완성됨)
  - `app/src/services/baseline.ts` (ADR-011 우선순위)
  - `app/src/types/deal.ts` (RouteMarketData)

## 작업

앱 루트는 `cheapsky/app/`. 20 노선 시세 히트맵을 일반 리스트 아래에 추가.

### 1) `src/app/api/market/route.ts`

```ts
// GET /api/market?t=<token>
// 응답: { rows: MarketRow[] }
// MarketRow = {
//   origin: 'ICN', destination: string,
//   carrierClass: 'fsc'|'lcc'|'mixed',
//   p10Krw, p50Krw, p90Krw,
//   cheapestTodayKrw, cheapestTodayCarrier,
//   source: 'seed'|'observed'|'mixed',
//   confidence: 'low'|'medium'|'high',
//   observationCount: number
// }
```

- 20 노선 × FSC/LCC/mixed 중 각 노선의 **대표 엔트리 1개** 선택 (우선순위: observed FSC+LCC 병합 → observed 단일 → seed 우선순위 ADR-011)
- `src/services/baseline.ts` 의 `resolveBaseline` 을 20 노선 × 필요한 class 에 대해 호출
- `Cache-Control: s-maxage=600, stale-while-revalidate=3600`

### 2) `src/components/MarketCard.tsx` (Server Component, ADR-027)

UI_GUIDE "시세 카드 (MarketCard)" 규정 그대로:
- `rounded-md bg-[#0f0f0f] border border-dashed border-neutral-700 p-3`
- 상단 우측 `참고 시세` 라벨 (`text-[10px] text-neutral-500 tracking-wide`)
- 가격 `text-xl` (딜 카드보다 작게) · 분위수 점 + `하위 N%`
- 하단 고정 고지: `예약 시 가격은 달라질 수 있어요` (`text-[10px] text-neutral-500`)
- `<a target="_blank" rel="nofollow noopener">` 로 감싸고 스카이스캐너 **검색 URL** 로 이동 (`buildSkyscannerSearchUrl`, ADR-027)
- **"역대가"·"Amadeus" 문자열 금지**

### 3) `src/components/MarketHeatmap.tsx` (Server Component)

UI_GUIDE 히트맵 규정:
- 섹션 헤더: `오늘의 노선 시세` + 서브라벨 `인천 출발 주요 20개 노선 오늘 최저가`
- 데스크톱: `grid grid-cols-5 gap-2` (5×4 그리드)
- 모바일: 기본 접힘 + **가장 싼 3개 노선 프리뷰 항상 표시** + 토글 `노선 17곳 더 보기 ∨`
- 분위수 점 색:
  - p10 이하: `bg-emerald-500`
  - p10~p50: `bg-neutral-600`
  - p50 초과: `bg-neutral-800`
- 셀은 MarketCard 재사용
- 관측 <10건 노선 셀 → `데이터 수집 중` 라벨 + 중립 점

모바일 접힘·펼침은 `'use client'` 서브컴포넌트 (`<HeatmapMobileToggle>`) 필요. 서버에서 20개 row 전체 prop 으로 넘기고 클라이언트는 show/hide 만.

### 4) `src/app/page.tsx` 에 섹션 추가

```tsx
<Header />
{banners}
<FilterBar />
{heroTop3.length > 0 && <Hero deals={heroTop3} />}
{communityPicks.length > 0 && <CommunityPicks deals={communityPicks} />}
<DealList deals={list} />
<MarketHeatmap rows={marketRows} />   {/* 신규 */}
<Footer />
```

marketRows 는 `/api/market` 내부 로직을 page.tsx 에서도 공유 함수 `src/services/market-heatmap.ts` 로 뽑아 재사용. 또는 page.tsx 에서 직접 DB 쿼리.

### 5) `src/lib/skyscanner-url.ts` 재확인

Core step 2 에서 이미 구현됨. 변경 없이 import 해 사용. MarketCard onClick(또는 `<a href>`) 에 해당 URL 주입.

### 6) 테스트

`src/services/market-heatmap.test.ts` — 20 노선 × 우선순위 엔트리 선택 로직:
- observed ≥30 → observed 단독
- observed 10~29 → mixed
- seed FSC+LCC 있음 → seed (FSC 우선)
- seed mixed 만 → seed mixed (confidence=low, 🔥 미부여)

MarketCard / MarketHeatmap Server Component 는 unit 테스트 최소. snapshot 또는 생략.

### 7) 스모크

```bash
pnpm dev &
sleep 6
curl -s "http://localhost:3000/api/market?t=<token>" | head -c 500
# rows 배열이 20개 근처
```

## Acceptance Criteria

```bash
cd C:/Users/hukyu/Project_Document/cheapsky/app
pnpm build
pnpm test
pnpm exec tsc --noEmit
pnpm lint
pnpm dev   # 히트맵 렌더 (20 노선)
```

## 검증 절차

1. 위 AC 전부 성공
2. UI 슬롭 재점검: MarketCard 에 `rounded-2xl`, 보라/인디고, `backdrop-blur`, `hover:scale-*` 0건
3. 스카이스캐너 URL 은 검색 URL (`/transport/flights/...`) 만. OTA 직접 크롤 경로 금지 (ADR-008)
4. `참고 시세` 라벨 노출 (카드 혼동 방지)
5. 하단 `예약 시 가격은 달라질 수 있어요` 고지 노출
6. 상태 업데이트:
   - 성공 → `"status": "completed"`, `"summary": "MarketCard.tsx (border-dashed, 참고 시세 라벨, 스카이스캐너 검색 URL) + MarketHeatmap.tsx (5×4 데스크톱 / 모바일 접힘 + 프리뷰 3개) + /api/market + services/market-heatmap.ts 엔트리 선택 로직. page.tsx 에 섹션 추가. 20 노선 × ADR-011 우선순위 엔트리 반영."`

## 금지사항

- **MarketCard 를 DealCard 로 렌더 금지** (ADR-027). 이유: 시각·동작 구분 (원문 새 탭 vs 스카이스캐너 검색)
- **스카이스캐너·구글 플라이트 직접 크롤 금지** (ADR-008). 이유: 검색 URL 생성만 허용
- **카드 hover 3D·scale·translate-y 금지** (UI_GUIDE)
- **"역대가"·"Amadeus" 라벨 금지** (ADR-012)
- **셀 클릭 → 같은 탭 이동 금지**. 이유: 외부 사이트 이동이므로 `target="_blank"` 필수
- **히트맵에 애니메이션 · orb · gradient 금지** (AI 슬롭 방어)
