# Step 2: sparkline

## 읽어야 할 파일

- `docs/UI_GUIDE.md` — **"스파크라인 (Sparkline)" 섹션** + "색에 의존하지 않는 신호" 접근성
- `docs/ADR.md` — ADR-007 (URL 상태), ADR-012 (용어 정책)
- `docs/PRD.md` — "90일 스파크라인 (Stretch)" 요구사항
- 이전 산출물:
  - `app/src/components/DealCard.tsx`
  - `app/src/lib/db.ts` (anon client)
  - `app/src/types/deal.ts` (PriceObservation)

## 작업

앱 루트는 `cheapsky/app/`. 딜 카드 우하단에 90일 가격 추이 스파크라인 추가.

### 1) `src/app/api/price-trace/[id]/route.ts`

```ts
// GET /api/price-trace/[id]?t=<token>
// 응답: { points: { date: 'YYYY-MM-DD', priceKrw: number }[], lowest: number, highest: number }
```

- deals.id 를 받아 해당 딜의 `(origin, destination, carrier_class)` 로 `price_observations` 최근 90일 SELECT
- 같은 일자 여러 건은 최저가로 집계 (GROUP BY date)
- 응답에 `Cache-Control: s-maxage=300, stale-while-revalidate=1800` (5분 캐시)
- middleware 의 auth 통과하므로 별도 방어 불필요

### 2) `src/components/Sparkline.tsx` (`'use client'`)

UI_GUIDE 규정 그대로. 크기 `h-[30px] w-[120px]`, 색 `stroke-neutral-500` 기본 / `stroke-emerald-400` 최저 구간 / 현재 점 `fill-emerald-400 r=2`.

```tsx
export function Sparkline({ dealId, currentPriceKrw }: { dealId: string; currentPriceKrw: number }) {
  // fetch /api/price-trace/[id] on mount
  // render inline SVG <path> (축·그리드·범례·애니메이션 없음)
  // hover 시 점별 tooltip (text-[11px], 얇은 오버레이)
  // 데이터 3건 미만 → "데이터 수집 중" italic
}
```

구현 세부:
- SVG path: `d = "M0,h L10,h1 L20,h2 ..."` 형태. 마지막 점에 현재 가격 마커 추가
- 최저 구간: line stroke 를 emerald 로 바꾸고 dasharray 로 강조 (색맹 대비, UI_GUIDE 접근성)
- 최고 구간: line stroke-width 1 → 2 로 두껍게
- 접근성: `<svg role="img" aria-label="90일 가격 추이, 현재 최저 구간">` 같은 라벨
- `fetch` 는 native. 전역 상태 라이브러리·SWR·React Query 금지 (ADR-007 red line)
- `useState` + `useEffect` 로 loading/error/data 3-state 충분
- 로드 실패 → `"데이터 수집 중"` 동일 표기로 폴백 (에러 UX 간결)

### 3) `src/components/DealCard.tsx` 확장

```tsx
{variant === 'list' && <Sparkline dealId={deal.id} currentPriceKrw={deal.priceKrw} />}
```

히어로 카드에는 Sparkline 미노출 (UI_GUIDE: 하단 2 영역은 list 카드 한정). `min-h-[180px]` 여백 확보.

### 4) 테스트

`src/app/api/price-trace/[id]/route.test.ts` — 모의 client 로 응답 검증:
- 관측 0건 → `points: []`
- 같은 날 여러 건 → 최저가만
- 90일 경계 필터 정확성

`src/components/Sparkline.test.ts` — vitest 로 3-state 렌더:
- loading 상태 → skeleton 또는 빈 svg (에러 없이)
- data 3건 미만 → "데이터 수집 중" 텍스트
- 5건 이상 → svg path 생성 확인

### 5) 스모크

```bash
cd C:/Users/hukyu/Project_Document/cheapsky/app
pnpm dev &
sleep 6
curl -s "http://localhost:3000/api/price-trace/<some-deal-id>?t=<token>" | head -c 400
# 응답 JSON 확인
```

## Acceptance Criteria

```bash
cd C:/Users/hukyu/Project_Document/cheapsky/app
pnpm build
pnpm test
pnpm exec tsc --noEmit
pnpm lint
pnpm dev   # Sparkline 이 DealCard list 에 렌더
```

## 검증 절차

1. 위 AC 전부 성공
2. Sparkline 에 차트 라이브러리 import 0건 (`chart.js`, `recharts`, `victory`, `d3` 금지 — inline SVG 만)
3. UI_GUIDE 색 규정 준수: `stroke-neutral-500` / `stroke-emerald-400`, 보라 계열 0건
4. `useState`/`useEffect` 만 사용, 상태 라이브러리 0건
5. API 응답 Cache-Control 설정 확인
6. 상태 업데이트:
   - 성공 → `"status": "completed"`, `"summary": "Sparkline.tsx (inline SVG, native fetch, 3-state, 색맹 보조 — dasharray+stroke-width 변조) + /api/price-trace/[id] (90일 관측, 같은 날 최저가, 5분 캐시) + DealCard list 변형에만 주입. 차트 라이브러리 / SWR / Zustand 없음."`

## 금지사항

- **차트 라이브러리 설치 금지** (`chart.js`, `recharts`, `victory`, `d3`, `apexcharts`). 이유: inline SVG 면 충분 + 번들 사이즈
- **상태 라이브러리 / fetch 라이브러리 금지** (ADR-007 red line). 이유: 기본 hooks 만
- **축·그리드·범례·애니메이션 금지** (UI_GUIDE). 이유: 밀도 원칙
- **히어로 카드에 Sparkline 노출 금지**. 이유: UI_GUIDE 의 "하단 2 영역은 list 카드 한정"
