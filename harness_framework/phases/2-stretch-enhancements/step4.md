# Step 4: route-frequency

## 읽어야 할 파일

- `docs/UI_GUIDE.md` — **"노선 빈도 (RouteFrequency)" 섹션**
- `docs/PRD.md` — "노선 빈도 마이크로 지표 (Stretch)"
- 이전 산출물:
  - `app/src/components/DealCard.tsx` (Sparkline, CurationLine 이미 있음)
  - `app/src/lib/db.ts` (anon client)
  - `app/src/types/deal.ts`

## 작업

앱 루트는 `cheapsky/app/`. 각 딜 카드 하단에 "이 노선 30일 3번째 등장" 식의 마이크로 지표를 추가.

### 1) `src/services/route-frequency.ts`

```ts
export type FrequencyInfo = {
  count30d: number;
  ordinal: number;   // 이 딜이 30일 내 같은 노선에서 몇 번째인지 (1-indexed)
};

export async function getRouteFrequency(params: {
  dealId: string; origin: string; destination: string; postedAt: Date;
  client?: SupabaseClient;
}): Promise<FrequencyInfo>
```

- 같은 `(origin, destination)` 의 `deals` 에서 `posted_at > now() - interval '30 days'` 카운트
- `ordinal` = 해당 노선에서 postedAt 기준 몇 번째 (오래된 순). 최근 딜이라면 count30d 와 유사
- **N+1 쿼리 주의**: page.tsx 에서 list 50개 × 각 deal 마다 개별 쿼리는 비효율 → 배치 쿼리 한 번으로 `(origin, destination) → count`, `ordinal` 맵 구성

```ts
export async function batchRouteFrequency(deals: Pick<Deal, 'id'|'origin'|'destination'|'postedAt'>[], client?: SupabaseClient):
  Promise<Map<string, FrequencyInfo>>
// return: Map<dealId, FrequencyInfo>
```

### 2) `src/components/RouteFrequency.tsx` (Server Component)

UI_GUIDE 표기 규칙:
- 1번째 → `이 노선 30일 내 첫 등장` (강조 `text-emerald-400`)
- 2~4번째 → `이 노선 30일 <N>번째`
- 5번째 이상 → `자주 올라오는 노선 (30일 <N>회)` (`text-neutral-500`)
- 전체 base: `text-[11px] text-neutral-500`

```tsx
export function RouteFrequency({ info }: { info: FrequencyInfo }) { ... }
```

### 3) `src/components/DealCard.tsx` 확장

```tsx
// variant='list' 카드에만 노출. 히어로 카드는 제외 (UI_GUIDE)
{variant === 'list' && info && <RouteFrequency info={info} />}
```

prop `info?: FrequencyInfo` 를 받아 RouteFrequency 에 전달. 없으면 렌더 생략.

### 4) `src/app/page.tsx` 업데이트

```ts
const freqMap = await batchRouteFrequency(list, client);
<DealList deals={list} freqMap={freqMap} />
// DealList 에서 각 DealCard 에 freqMap.get(deal.id) 전달
```

CommunityPicks 섹션에도 동일하게 전달.

### 5) 테스트

`src/services/route-frequency.test.ts`:
- 0건 → count30d=0, ordinal=0
- 3건 → count30d=3, ordinal 순차
- 배치 쿼리 효율: mock client 의 `from().select()` 호출 횟수가 list 크기와 무관하게 상수 (1~2회)

## Acceptance Criteria

```bash
cd C:/Users/hukyu/Project_Document/cheapsky/app
pnpm build
pnpm test
pnpm exec tsc --noEmit
pnpm lint
pnpm dev
```

## 검증 절차

1. 위 AC 전부 성공
2. `batchRouteFrequency` 의 DB 호출 횟수가 O(1) (list 크기와 무관)
3. RouteFrequency 컴포넌트가 3 가지 표기 분기 (1 / 2~4 / 5+) 전부 테스트됨
4. 히어로 카드에는 RouteFrequency 미노출 (UI_GUIDE)
5. 상태 업데이트:
   - 성공 → `"status": "completed"`, `"summary": "services/route-frequency.ts (batch 쿼리, O(1) DB hit) + RouteFrequency.tsx (3분기 표기) + DealCard list 변형 주입 + DealList·CommunityPicks 에 freqMap 전달."`

## 금지사항

- **리스트 각 카드당 개별 쿼리 금지** (N+1). 이유: 성능. 배치로 한 번에
- **숫자 소숫점·과장 카피 금지** (UI_GUIDE). `이 노선 30일 3번째` 형식 고정
- **히어로 카드에 RouteFrequency 노출 금지** (UI_GUIDE)
- **30일 경계 외 데이터 포함 금지**. 이유: 정의 일관성
