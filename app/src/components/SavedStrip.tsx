'use client';

// Saved routes strip (Cheapsky Light v5) — Hero 아래 노출.
// localStorage 기반. 저장된 노선 X개 중 현재 딜에 있는 것 M개를 하이라이트.
// 저장 노선 0개면 섹션 생략.

import { useEffect, useState } from 'react';

import { cityName } from '@/lib/city-names';
import { formatKrw } from '@/lib/format';
import { loadSavedRoutes } from '@/lib/saved-routes';

export type SavedStripDeal = {
  destination: string;
  priceKrw: number;
  baselineKrw: number | null;
  hotDeal: boolean;
  discountRate: number | null;
};

export function SavedStrip({
  available,
}: {
  available: ReadonlyArray<SavedStripDeal>;
}) {
  const [saved, setSaved] = useState<string[] | null>(null);

  useEffect(() => {
    setSaved(loadSavedRoutes());
    const listener = () => setSaved(loadSavedRoutes());
    window.addEventListener('storage', listener);
    window.addEventListener('cheapsky:saved-changed', listener as EventListener);
    return () => {
      window.removeEventListener('storage', listener);
      window.removeEventListener('cheapsky:saved-changed', listener as EventListener);
    };
  }, []);

  if (saved === null) return null; // SSR mount 전
  if (saved.length === 0) return null;

  const rows = saved.slice(0, 3).map((dest) => {
    const deal = available.find((a) => a.destination === dest);
    return { dest, deal };
  });

  const matched = rows.filter((r) => r.deal).length;

  return (
    <section
      aria-label="찜한 노선 알림"
      className="rounded-lg bg-card border border-line overflow-hidden animate-fade-in"
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-2.5 border-b border-line">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h3 className="text-[12.5px] font-semibold text-ink">
            찜한 노선 알림
          </h3>
          <span className="text-[11px] text-ink-4">
            저장해둔 {saved.length}개 중 {matched}개가 지금 리스트에 있어요
          </span>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-line">
        {rows.map(({ dest, deal }) => {
          const lowest = deal !== undefined;
          const price = deal?.priceKrw ?? null;
          const baseline = deal?.baselineKrw ?? null;
          const status = deal
            ? deal.hotDeal
              ? '🔥 저점 갱신'
              : deal.discountRate !== null &&
                  Math.round(deal.discountRate * 100) >= 20
                ? `${Math.round(deal.discountRate * 100)}% 할인 중`
                : '현재 리스트에 있음'
            : '지금은 리스트에 없어요';
          const toneCls = !lowest
            ? 'text-ink-4'
            : deal?.hotDeal
              ? 'text-hot'
              : 'text-low';
          return (
            <div
              key={dest}
              className="flex items-center gap-[10px] px-3 py-[10px] transition-colors hover:bg-surface-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-ink truncate">
                  {cityName(dest)}{' '}
                  <span className="text-[11px] text-ink-4">({dest})</span>
                </div>
                <div className="text-[11px] text-ink-4 tabular-nums">
                  {baseline !== null ? `평소 ${formatKrw(baseline)}` : '관측 수집 중'}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className={`text-[13px] tabular-nums font-semibold ${toneCls}`}>
                  {price !== null ? formatKrw(price) : '—'}
                </div>
                <div className={`text-[10.5px] ${toneCls}`}>{status}</div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
