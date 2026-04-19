# Step 2: community-picks-ui

## 읽어야 할 파일

- `docs/UI_GUIDE.md` — "Community Picks 섹션 (Stretch)" 블록, AI 슬롭 금지 규칙
- `docs/ADR.md` — ADR-023 (3-섹션 UI), ADR-004 (소스 구조)
- `docs/PRD.md` — "Community Picks 섹션 (Stretch)" 요구사항
- 이전 step 산출물:
  - `app/src/components/*` (13 컴포넌트)
  - `app/src/services/crawlers/{ppomppu,ruliweb,playwings}.ts`
  - `app/src/app/page.tsx`
  - `app/scripts/crawl.ts`

## 작업

앱 루트는 `cheapsky/app/`. 히어로 아래·일반 리스트 위에 **Community Picks** 섹션을 추가한다.

### 1) `social_signal` 필드 채우기 (crawl.ts)

Core 스키마에는 이미 `deals.social_signal text` 컬럼 존재 ('hot' | 'trending' | null). step 0 의 루리웹 크롤이 `ParsedListItem.views` 를 수집하므로 이를 기준으로 판정.

`scripts/crawl.ts` UPSERT 블록:
```ts
// ruliweb 회차 내:
//   ParsedListItem.views 로 내림차순 정렬 후
//   상위 20% → social_signal='hot'
//   다음 20% → social_signal='trending'
//   나머지 → null
// 같은 딜이 여러 소스에서 보이면 social_signal 은 max-priority 유지
//   (hot > trending > null)
```

뽐뿌·플레이윙즈는 views 없음 → social_signal=null 유지.

### 2) `src/components/CommunityPicks.tsx` (Server Component)

UI_GUIDE "Community Picks 섹션" 규정 그대로:

```tsx
// 컴포넌트 시그니처
export function CommunityPicks({ deals }: { deals: Deal[] }) { ... }
```

- `rounded-md bg-card border border-neutral-800 p-5` (Hero 와 동일 패턴)
- 섹션 헤더: `text-lg font-medium text-neutral-200 mb-3 flex items-center gap-2`
  - 타이틀: `반응 많은 딜`
  - 서브라벨: `text-xs text-neutral-500` → `뽐뿌·루리웹·플레이윙즈에서 반응 많은 딜`
- 카드 그리드: `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3`
- 각 카드는 **기존 `DealCard variant="list"`** 재사용 (신규 카드 타입 금지)
- 카드 배지 옆 라벨: `text-[10px] text-neutral-500 uppercase tracking-wide`
  - `deal.social_signal === 'hot'` → `'HOT'`
  - `deal.social_signal === 'trending'` → `'TRENDING'`
- **조회수·댓글수 숫자 표시 절대 금지** (UI_GUIDE). 이유: 소스 간 스케일 상이

### 3) `src/app/page.tsx` 업데이트

기존 `heroTop3` / `list` 쿼리 뒤에 추가:

```ts
const communityPicks = await client
  .from('deals')
  .select('...')
  .not('social_signal', 'is', null)
  .eq('verification_status', 'active')
  .gt('expires_at', new Date().toISOString())
  .order('social_signal', { ascending: true })  // hot > trending (알파벳상 정렬 주의 — 수동 정렬 권장)
  .limit(8);
```

렌더 순서:
```
<Header />
{banners}
<FilterBar />
{heroTop3.length > 0 && <Hero deals={heroTop3} />}
{communityPicks.length > 0 && <CommunityPicks deals={communityPicks} />}
<DealList deals={list} />
<Footer />
```

`communityPicks` 가 0건이면 섹션 자체 렌더 생략 (placeholder 금지).

### 4) `DealCard` 에 social_signal 라벨 prop 추가

기존 `DealCard` 에 optional prop:

```ts
export function DealCard({ deal, variant, showSocialSignalLabel }: {
  deal: Deal;
  variant: 'hero' | 'list';
  showSocialSignalLabel?: boolean;
}) { ... }
```

- `showSocialSignalLabel === true` 일 때만 상단 우측에 `HOT`/`TRENDING` 라벨 노출
- 일반 리스트·Hero 에선 false (기본) → 라벨 숨김
- CommunityPicks 에서만 true
- 중복 카드(heroTop3 와 CommunityPicks 둘 다 포함) 는 page.tsx 에서 id 기준으로 중복 제거

### 5) `src/app/page.tsx` 중복 제거

```ts
const heroIds = new Set(heroTop3.map((d) => d.id));
const communityPicksUnique = communityPicks.filter((d) => !heroIds.has(d.id));
const listIds = new Set([...heroIds, ...communityPicksUnique.map((d) => d.id)]);
const listUnique = list.filter((d) => !listIds.has(d.id));
```

렌더에서는 `communityPicksUnique`, `listUnique` 사용.

### 6) 테스트

`src/components/CommunityPicks.test.ts` 는 선택 (Server Component 라 unit test 제한적). 대신 `src/lib/filters.test.ts` 에 social_signal 필터 헬퍼가 있으면 테스트 추가. 또는 smoke test 수준만.

scripts/crawl.ts 의 social_signal 판정 로직은 pure function 으로 분리해 단위 테스트: `src/services/social-signal.ts` + `src/services/social-signal.test.ts`.

### 7) 스모크

```bash
cd C:/Users/hukyu/Project_Document/cheapsky/app
pnpm tsx scripts/crawl.ts     # deals.social_signal 업데이트
pnpm dev &
sleep 8
curl -s "http://localhost:3000/?t=<token>" | grep -E "반응 많은 딜|TRENDING|HOT" | head -3
```

## Acceptance Criteria

```bash
cd C:/Users/hukyu/Project_Document/cheapsky/app
pnpm build
pnpm test
pnpm exec tsc --noEmit
pnpm lint
pnpm tsx scripts/crawl.ts
pnpm dev   # 브라우저에서 CommunityPicks 섹션 렌더 확인 (deals 가 있을 때)
```

## 검증 절차

1. 위 AC 전부 성공
2. **UI 슬롭 재점검**: CommunityPicks 에 `rounded-2xl`, `backdrop-blur`, `hover:scale-*` 0건
3. `CommunityPicks.tsx` 에 조회수·댓글수·추천수 숫자 **텍스트 노출 0건** (UI_GUIDE red line)
4. social_signal 판정 로직이 pure function 으로 분리 (DB 접근 없음)
5. DB 확인: `select social_signal, count(*) from deals where social_signal is not null group by social_signal` → hot·trending 카운트 존재
6. 상태 업데이트:
   - 성공 → `"status": "completed"`, `"summary": "CommunityPicks.tsx (Server Component, DealCard 재사용, HOT/TRENDING 라벨) + scripts/crawl.ts 에 social_signal 백분위 판정 (views 상위 20%/다음 20%) + page.tsx 섹션 추가 + hero/picks/list 중복 제거. social-signal 로직 pure function + unit test."`

## 금지사항

- **조회수·댓글수·추천수 숫자 UI 노출 금지** (UI_GUIDE). 이유: 소스 간 스케일 상이로 사용자 오해
- **새 카드 컴포넌트 생성 금지** (예: `CommunityPickCard.tsx`). 이유: DealCard 재사용. **3번 비슷한 코드 > 잘못된 추상화**
- **social_signal 텍스트 "뜨거운" / "화제" 등 한글 마케팅 카피 사용 금지** (AI 슬롭 방어). 이유: UI_GUIDE 용어 정책. `HOT` / `TRENDING` 고정
- **`rounded-2xl` / gradient-text / `backdrop-blur` (헤더 외) / 보라 계열** 금지 (UI_GUIDE)
- **조회수 기반 hot 판정 없이 임의 판단 금지**. 이유: 사회적 신호의 객관성 유지
