# Step 6: archive-page

## 읽어야 할 파일

- `docs/PRD.md` — "아카이브 페이지 (Stretch)" 요구사항
- `docs/ARCHITECTURE.md` — "아카이브 페이지 렌더 정책", `archive_snapshots` 테이블
- `docs/ADR.md` — ADR-023 (3-섹션 UI), ADR-018 (snapshot 정책)
- 이전 산출물:
  - `app/scripts/migrate.sql` (archive_snapshots 테이블 이미 존재)
  - `app/src/lib/tz.ts` (KST 변환)
  - `app/src/components/DealCard.tsx`

## 작업

앱 루트는 `cheapsky/app/`. 매일 00:05 KST 에 당일 TOP 5 스냅샷을 저장하고 `/archive/[date]` 로 조회.

### 1) `scripts/archive_daily.ts`

```bash
pnpm tsx scripts/archive_daily.ts
```

흐름:
1. `crawler_runs` INSERT (source='archiver')
2. 오늘 날짜 (KST) 산정 — `tz.ts` 의 `toKstDateOnly(new Date())`
3. SELECT deals: `hot_deal=true AND verification_status='active' AND expires_at > now()` ORDER BY `discount_rate DESC` LIMIT 5
4. TOP 5 dealIds 를 `archive_snapshots` 에 UPSERT (date primary key, `deal_ids` 배열)
5. crawler_runs finalize

**재실행 멱등**: 같은 날짜 재실행 시 기존 행 덮어씀. `captured_at` 갱신.

### 2) `src/app/archive/[date]/page.tsx` (Server Component)

```tsx
export default async function ArchivePage({ params }: { params: { date: string } }) {
  // 1. validate date: /^\d{4}-\d{2}-\d{2}$/
  // 2. SELECT archive_snapshots WHERE date = params.date → deal_ids
  // 3. SELECT deals WHERE id IN (...) — preserve archived order
  // 4. render DealList 스타일의 리스트
  //    - 각 카드 우상단에 '당시 가격' 라벨 (text-[10px] text-neutral-500)
  //    - 404/snapshot 상태인 deal 도 표시 (ARCHITECTURE.md 정책)
  //    - 링크는 그대로 유지 (유효 여부는 사용자가 확인)
}
```

- 잘못된 date 포맷 → `notFound()` (Next.js 15 helper)
- 날짜에 스냅샷 없음 → empty 페이지 + `이 날짜의 기록이 없어요. 다른 날짜를 선택하세요.`
- metadata: `noindex, nofollow` (middleware 가 이미 주입하지만 명시 안전)

### 3) `src/components/DealCard.tsx` 의 `당시 가격` 라벨

optional prop `showArchivedLabel?: boolean`. 아카이브 페이지에서만 true.

```tsx
{showArchivedLabel && <span className="text-[10px] text-neutral-500">당시 가격</span>}
```

일반 리스트·Hero 에선 false (기본).

### 4) `.github/workflows/archive_daily.yml`

```yaml
name: archive_daily
on:
  schedule:
    - cron: '5 15 * * *'   # UTC 15:05 = KST 00:05
  workflow_dispatch:
jobs:
  archive:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: app } }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: '10' }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm', cache-dependency-path: app/pnpm-lock.yaml }
      - run: pnpm install --frozen-lockfile
      - run: pnpm tsx scripts/archive_daily.ts
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          # CHEAPSKY_STAGE 불필요 (archive 는 LLM 사용 안 함)
```

### 5) 테스트

`scripts/archive_daily.test.ts` (선택): 멱등 재실행 테스트, 0건인 날의 스냅샷 생성 여부. 필요시 mock.

`src/app/archive/[date]/page.test.ts` (선택): Server Component 단위 테스트 생략.

### 6) 스모크

```bash
cd C:/Users/hukyu/Project_Document/cheapsky/app
pnpm tsx scripts/archive_daily.ts   # 오늘 TOP 5 스냅샷
pnpm dev &
sleep 6
curl -s "http://localhost:3000/archive/2026-04-19?t=<token>" | head -c 500
```

## Acceptance Criteria

```bash
cd C:/Users/hukyu/Project_Document/cheapsky/app
pnpm build
pnpm test
pnpm exec tsc --noEmit
pnpm lint
pnpm tsx scripts/archive_daily.ts
pnpm dev   # /archive/<today> 렌더
```

## 검증 절차

1. 위 AC 전부 성공
2. archive_daily.ts 는 멱등: 같은 날 재실행 시 기존 행 덮어씀
3. `/archive/invalid-date` → 404
4. 아카이브된 snapshot 상태 딜도 표시 (ARCHITECTURE.md 정책)
5. `.github/workflows/archive_daily.yml` 에 `CHEAPSKY_STAGE` 없음 (LLM 무관)
6. 상태 업데이트:
   - 성공 → `"status": "completed"`, `"summary": "scripts/archive_daily.ts (멱등, 00:05 KST TOP 5) + app/archive/[date]/page.tsx (Server Component, '당시 가격' 라벨, snapshot 상태 표시) + .github/workflows/archive_daily.yml. DealCard 에 showArchivedLabel prop 추가."`

## 금지사항

- **아카이브 페이지에서 실시간 데이터로 대체 금지**. 이유: 그날의 기록이므로 snapshot 상태여도 당시 링크·가격 유지
- **`archive_snapshots.deal_ids` 를 JSON string 으로 저장 금지**. 이유: Postgres uuid 배열 네이티브 사용 (이미 스키마에 있음)
- **archive workflow 에 `CHEAPSKY_STAGE: stretch` 설정 금지**. 이유: LLM 안 씀 → Core gate 유지
- **metadata.robots 를 noindex 에서 해제 금지**. 이유: 모든 페이지 noindex 원칙
