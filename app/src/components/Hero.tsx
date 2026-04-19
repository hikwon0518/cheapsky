// Server Component. 히어로 ("오늘의 레이더") — TOP 3 딜.
//
// UI_GUIDE:
//   - 상단 바: `오늘 찾은 큰 폭 할인 <N>개` · `최대 할인율 <X>%`
//   - 데스크톱 TOP 3: `grid md:grid-cols-3 gap-3`
//   - 모바일: TOP 1 크게, 2·3 간소화(현재 Core 는 동일 카드 3개로 충분)
//   - 데이터 부족 시 섹션 렌더 생략 (page.tsx 에서 조건 렌더)

import { DealCard } from '@/components/DealCard';
import { formatDiscount } from '@/lib/format';
import type { Deal } from '@/types/deal';

export function Hero({
  deals,
  shareQuery,
  now,
}: {
  deals: readonly Deal[];
  shareQuery?: string;
  now?: Date;
}) {
  if (!deals || deals.length === 0) return null;

  const count = deals.length;
  const maxRate = deals.reduce((acc, d) => {
    if (d.discountRate === null) return acc;
    return Math.max(acc, d.discountRate);
  }, 0);

  return (
    <section
      aria-label="오늘의 레이더"
      className="rounded-xl bg-card border border-line-2 p-5 md:p-7 mb-6 animate-fade-in shadow-[0_1px_0_rgba(0,0,0,.02),0_24px_48px_-32px_rgba(20,20,20,.14)]"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm text-ink-3">
          오늘 찾은 큰 폭 할인{' '}
          <span className="text-ink font-semibold tabular-nums">{count}개</span>
        </div>
        {maxRate > 0 ? (
          <div className="text-sm tabular-nums text-low">
            최대 할인율 {formatDiscount(maxRate)}
          </div>
        ) : null}
      </header>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
        {deals.map((deal) => (
          <DealCard
            key={deal.id}
            deal={deal}
            variant="hero"
            shareQuery={shareQuery}
            now={now}
          />
        ))}
      </div>
    </section>
  );
}
