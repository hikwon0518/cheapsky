# Step 3: cross-source-matching

## 읽어야 할 파일

- `docs/ADR.md` — **ADR-030** ("소스 교차 매칭 규칙"), **ADR-009** (dedupe 키)
- 이전 구현:
  - `app/src/lib/dedupe.ts` (`sha1` 해시 · 배열 병합)
  - `app/src/types/deal.ts` (`sources`, `socialSignal` 타입)
  - `app/src/services/home-queries.ts` (dedupe 이후 DealCard 흐름)

## 작업

### 1) `sources` 배열 확장

- 현재 `sources: Array<'ppomppu'|'ruliweb'|'playwings'>` → `'clien'|'dcinside'` 추가
- `app/src/types/deal.ts`:
```ts
export const SOURCES = ['ppomppu','ruliweb','playwings','clien','dcinside'] as const;
export type Source = typeof SOURCES[number];
```
- Supabase `deals.sources` 는 이미 text[] 이므로 스키마 변경 없음 (값만 확장)

### 2) social_signal 승격 규칙

`app/src/services/home-queries.ts` (또는 dedupe 이후 merge 단계):
```ts
// ADR-030: 3곳 이상 동시 등장 = strong signal
if (deal.sources.length >= 3 && deal.socialSignal !== 'hot') {
  deal.socialSignal = 'hot';
}
```

- 기존 socialSignal (Ruliweb views 상위 20% = hot 등) 과 **OR** — 둘 중 하나라도 만족하면 hot
- `sources.length` 기준 승격은 UI 에서 별도 라벨 노출 (다중 소스 신호 구분)

### 3) `DealCard` 다중 소스 라벨

`app/src/components/DealCard.tsx` (list · hero 변형 공통):

```tsx
{deal.sources.length >= 2 && (
  <span className="text-[10.5px] text-ink-4 tabular-nums">
    {formatSources(deal.sources)}
  </span>
)}
```

`formatSources`:
- 1곳: 기존 단일 출처 태그 (변경 없음)
- 2곳: `뽐뿌 · 클리앙 2곳 동시 등장`
- 3곳 이상: `뽐뿌 · 클리앙 · 디시 3곳 동시 등장` (최대 3곳 표기, 추가는 "외 N곳")
- 60자 cut

### 4) 테스트

`app/src/lib/dedupe.test.ts` 확장 (기존 13건 → +5 이상):
- 2 소스 병합 시 `socialSignal !== 'hot'` (기존 규칙만 적용)
- 3 소스 병합 시 `socialSignal === 'hot'` (승격 규칙)
- 동일 소스 중복 → 배열 고유값 유지 (set 동작)
- `formatSources` 포맷 케이스 3건 (1/2/3+ 소스)

## Acceptance Criteria

```bash
cd app
pnpm test src/lib/dedupe.test.ts
pnpm typecheck && pnpm lint
pnpm dev   # 로컬에서 3+ 소스 교차 딜이 있으면 DealCard 에 '3곳 동시 등장' 라벨 확인
```

- 기존 테스트 전부 pass (회귀 없음)
- 신규 테스트 +5 이상

## 금지사항

- **dedupe_key 공식 변경 금지** (ADR-009). 해시 포함 필드 불변
- **"hot" 남발 금지** — 승격 임계 (`>= 3`) 이상 높이는 실험은 별도 ADR. 2 소스 승격은 과다 판정 위험
- **UI 에 소스별 조회수 숫자 노출 금지** (ADR-004 / ADR-008). 이진 라벨만
