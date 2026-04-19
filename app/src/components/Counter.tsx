// Server Component. "지금은 기다려 보세요" — 평소보다 비싼 노선 섹션 (Cheapsky Light v5).
// 딜 카드와 달리 **경고 톤** (up). 정직한 가격 정보 제공이 목표.
//
// 데이터: deals.discount_rate <= -0.10 (평균 대비 10% 이상 비쌈), active, 최근 30일. 최대 3개.
// 구성: bad-card 형식 (flag 제외 · 도시명 · 평소→현재 비교 · chip-up 배지).
//
// Hard red lines:
// - 🔥 외 이모지 금지 (up chip `↑` 화살표만 허용)
// - 섹션 0건이면 렌더 생략 (placeholder 금지)

import { cityName } from '@/lib/city-names';
import { formatKrw } from '@/lib/format';
import type { Deal } from '@/types/deal';

export type CounterDeal = Pick<
  Deal,
  | 'id'
  | 'origin'
  | 'destination'
  | 'priceKrw'
  | 'baselineKrw'
  | 'discountRate'
  | 'pricePercentile'
>;

export function Counter({ deals }: { deals: readonly CounterDeal[] }) {
  if (!deals || deals.length === 0) return null;

  return (
    <section aria-label="지금은 사지 말아야 할 노선" className="animate-fade-in">
      <header className="flex items-baseline justify-between gap-2 mb-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">
            지금은 기다려 보세요
          </h2>
          <span className="text-[11.5px] text-ink-3">
            평소보다 비싸게 나온 노선이에요
          </span>
        </div>
        <span className="text-[11px] text-ink-4">FSC·LCC 분리 기준</span>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {deals.slice(0, 3).map((d) => {
          const pct =
            d.discountRate !== null
              ? Math.round(Math.abs(d.discountRate) * 100)
              : null;
          const percentile =
            d.pricePercentile !== null ? Math.round(d.pricePercentile) : null;
          return (
            <div
              key={d.id}
              className="rounded-lg border border-line p-3 flex items-center gap-3 bg-gradient-to-b from-surface to-[#fdfafa]"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-ink truncate">
                  {cityName(d.destination)}{' '}
                  <span className="text-ink-4 text-[11px]">
                    ({d.destination})
                  </span>
                </div>
                <div className="text-[11px] text-ink-4 tabular-nums">
                  평소{' '}
                  {d.baselineKrw !== null ? formatKrw(d.baselineKrw) : '—'} →{' '}
                  <span className="text-up">
                    {formatKrw(d.priceKrw)}
                    {pct !== null ? ` (+${pct}%)` : ''}
                  </span>
                </div>
              </div>
              <span className="chip chip-up shrink-0" aria-hidden="true">
                ↑{percentile !== null ? ` 상위 p${percentile}` : ' 비싸요'}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
