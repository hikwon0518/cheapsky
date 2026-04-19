// Server Component. 최근 24시간 딜 흐름 피드 (Cheapsky Light v5).
//
// 이벤트 4종:
//   - 신규 게시글     (posted_at 최근 24h, 가격 정보 있음)
//   - 🔥 저점 갱신    (hot_deal=true · posted_at 최근 24h)
//   - 첫 등장        (route-frequency.ordinal=1, 최근 24h)
//   - 가격 상승 경고   (verification_status='price_changed' 최근 24h)
//
// UI_GUIDE "Timeline Feed" 참조. grid-cols-[58px_1fr_auto] 3열.
//
// Hard red lines:
// - Server Component — polling 클라 로직은 별도 (v5 Toast 컴포넌트에서)
// - 0건이면 섹션 전체 생략

import { cityName } from '@/lib/city-names';
import { formatKrw } from '@/lib/format';
import { formatRelativeKst } from '@/lib/tz';
import type { Deal } from '@/types/deal';

export type TimelineEvent = {
  kind: 'new' | 'hot' | 'first' | 'price_up';
  /** 이벤트 발생 시각 */
  at: Date;
  destination: string;
  headline: string;
  chipLabel: string;
  chipCls: string;
};

export function Timeline({
  events,
  now,
}: {
  events: readonly TimelineEvent[];
  now?: Date;
}) {
  if (!events || events.length === 0) return null;
  const ref = now ?? new Date();

  return (
    <section
      aria-label="최근 24시간 딜 흐름"
      className="rounded-lg bg-card border border-line overflow-hidden animate-fade-in"
    >
      <header className="flex items-center justify-between px-4 py-3 border-b border-line">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[13px] font-semibold text-ink">
            최근 24시간 딜 흐름
          </h3>
          <span className="text-[11px] text-ink-4">라이브 업데이트</span>
        </div>
        <div className="flex items-center gap-1">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full bg-low"
            aria-hidden="true"
          />
          <span className="text-[10.5px] text-low uppercase tracking-wide">
            실시간
          </span>
        </div>
      </header>
      <div>
        {events.map((e, i) => (
          <div
            key={`${e.kind}-${e.destination}-${i}`}
            className="grid grid-cols-[58px_1fr_auto] gap-[10px] items-center px-[14px] py-[10px] border-b border-line last:border-b-0 text-[12.5px]"
          >
            <span className="text-[10.5px] text-ink-4 tabular-nums font-mono">
              {formatRelativeKst(e.at, ref)}
            </span>
            <div className="min-w-0">
              <span className="text-ink font-medium">
                {cityName(e.destination)}{' '}
                <span className="text-ink-4 text-[11px]">
                  ({e.destination})
                </span>
              </span>
              <span className="text-ink-3"> {e.headline}</span>
            </div>
            <span className={`chip ${e.chipCls} shrink-0`}>{e.chipLabel}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * 딜 배열에서 최근 24h 이벤트 생성.
 * - hot_deal=true → kind 'hot'
 * - 첫 등장 (freqMap.ordinal=1) → kind 'first'
 * - verification_status='price_changed' → kind 'price_up'
 * - 그 외 최근 딜 → kind 'new'
 * 중복 노선은 우선순위로 하나만 (hot > first > price_up > new).
 */
export function buildTimelineEvents(
  deals: ReadonlyArray<Deal>,
  freqMap: ReadonlyMap<string, { ordinal: number }>,
  now: Date = new Date(),
  limit = 7,
): TimelineEvent[] {
  const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
  const seen = new Set<string>();
  const events: TimelineEvent[] = [];
  const sorted = [...deals].sort(
    (a, b) => b.postedAt.getTime() - a.postedAt.getTime(),
  );

  for (const d of sorted) {
    if (d.postedAt.getTime() < cutoff) continue;
    if (!d.destination) continue;
    if (seen.has(d.destination)) continue;
    seen.add(d.destination);

    if (d.hotDeal) {
      events.push({
        kind: 'hot',
        at: d.postedAt,
        destination: d.destination,
        headline: '90일 저점 갱신',
        chipLabel: `🔥 ${formatKrw(d.priceKrw)}`,
        chipCls: 'chip-hot',
      });
    } else if ((freqMap.get(d.id)?.ordinal ?? 0) === 1) {
      events.push({
        kind: 'first',
        at: d.postedAt,
        destination: d.destination,
        headline: '30일 만에 첫 등장',
        chipLabel: '첫 등장',
        chipCls: 'chip-low',
      });
    } else if (d.verificationStatus === 'price_changed') {
      events.push({
        kind: 'price_up',
        at: d.postedAt,
        destination: d.destination,
        headline: '가격이 바뀌었어요',
        chipLabel: '가격 변경',
        chipCls: 'chip-warn',
      });
    } else if (
      d.discountRate !== null &&
      Math.round(d.discountRate * 100) >= 20
    ) {
      events.push({
        kind: 'new',
        at: d.postedAt,
        destination: d.destination,
        headline: `가격이 ${Math.round(d.discountRate * 100)}% 내렸어요`,
        chipLabel: formatKrw(d.priceKrw),
        chipCls: 'chip-low',
      });
    }
    if (events.length >= limit) break;
  }

  return events;
}
