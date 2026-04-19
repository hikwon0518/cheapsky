// Server Component. 일반 리스트 그리드. 비면 EmptyState.

import { DealCard } from '@/components/DealCard';
import { EmptyState } from '@/components/EmptyState';
import type { FrequencyInfo } from '@/services/route-frequency';
import type { Deal } from '@/types/deal';

export function DealList({
  deals,
  shareQuery,
  now,
  freqMap,
}: {
  deals: readonly Deal[];
  shareQuery?: string;
  now?: Date;
  /** page.tsx 에서 단일 배치 쿼리로 구성한 (dealId → 노선 빈도) 맵. 없으면 빈 Map. */
  freqMap?: ReadonlyMap<string, FrequencyInfo>;
}) {
  if (!deals || deals.length === 0) {
    return <EmptyState />;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {deals.map((deal) => (
        <DealCard
          key={deal.id}
          deal={deal}
          variant="list"
          shareQuery={shareQuery}
          now={now}
          freqInfo={freqMap?.get(deal.id)}
        />
      ))}
    </div>
  );
}
