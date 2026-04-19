// Server Component. Community Picks 섹션 (Stretch, ADR-023).
//
// UI_GUIDE "Community Picks 섹션":
//   - 컨테이너: rounded-md bg-card border border-neutral-800 p-4 md:p-6
//   - 헤더: `text-lg font-medium text-neutral-200 mb-3 flex items-center gap-2`
//     + 서브라벨 `text-xs text-neutral-500` → `뽐뿌·루리웹·플레이윙즈에서 반응 많은 딜`
//   - 그리드: `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3`
//   - 카드: 기존 `DealCard variant="list"` 재사용 (신규 카드 컴포넌트 생성 금지)
//   - 배지 옆 라벨: `HOT` / `TRENDING` (한글 마케팅 카피 금지)
//
// Hard red lines:
// - 조회수·댓글수·추천수 숫자 텍스트 노출 금지 (UI_GUIDE, 소스 간 스케일 상이)
// - deals 가 0건이면 page.tsx 에서 섹션 자체 렌더 생략 (placeholder 금지)

import { DealCard } from '@/components/DealCard';
import type { FrequencyInfo } from '@/services/route-frequency';
import type { Deal } from '@/types/deal';

export function CommunityPicks({
  deals,
  shareQuery,
  now,
  freqMap,
}: {
  deals: readonly Deal[];
  shareQuery?: string;
  now?: Date;
  freqMap?: ReadonlyMap<string, FrequencyInfo>;
}) {
  if (!deals || deals.length === 0) return null;

  return (
    <section
      aria-label="반응 많은 딜"
      className="rounded-xl bg-card border border-line p-5 md:p-6 animate-fade-in"
    >
      <header className="mb-3 flex items-center gap-2">
        <h2 className="text-lg font-medium text-ink">반응 많은 딜</h2>
        <span className="text-xs text-ink-4">
          뽐뿌·루리웹·플레이윙즈에서 반응 많은 딜
        </span>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {deals.map((deal) => (
          <DealCard
            key={deal.id}
            deal={deal}
            variant="list"
            shareQuery={shareQuery}
            now={now}
            showSocialSignalLabel
            freqInfo={freqMap?.get(deal.id)}
          />
        ))}
      </div>
    </section>
  );
}
