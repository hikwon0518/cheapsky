'use client';

// Compare Drawer — 여러 노선 선택해 우측 drawer 로 나란히 비교 (Cheapsky Light v5).
//
// 최대 4개. localStorage `cheapsky_compare` 에 destination 배열 저장.
// 선택은 현재 MarketCard / Hero 카드 옆 "비교" 버튼이 dispatch 하는 커스텀 이벤트로.
// 이번 iter 은 drawer 본체만 — 카드 쪽 진입점은 TweaksPanel 에서 수동 입력 가능.
//
// Hard red lines:
// - 'use client'
// - 비교 항목은 최대 4. 초과 시 오래된 것 FIFO pop

import { useEffect, useState } from 'react';

import { cityName } from '@/lib/city-names';

const KEY = 'cheapsky_compare';
const MAX = 4;

export function loadCompare(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter((x): x is string => typeof x === 'string').slice(0, MAX)
      : [];
  } catch {
    return [];
  }
}

export function saveCompare(dests: readonly string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(dests.slice(0, MAX)));
    window.dispatchEvent(new CustomEvent('cheapsky:compare-changed'));
  } catch {
    // ignore
  }
}

export type CompareRow = {
  destination: string;
  priceKrw: number | null;
  p50Krw: number | null;
  carrierClass: 'fsc' | 'lcc' | 'mixed';
};

export function CompareDrawer({
  rows,
}: {
  rows: ReadonlyArray<CompareRow>;
}) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    setMounted(true);
    const load = () => setSelected(loadCompare());
    load();
    window.addEventListener('storage', load);
    window.addEventListener('cheapsky:compare-changed', load as EventListener);
    return () => {
      window.removeEventListener('storage', load);
      window.removeEventListener(
        'cheapsky:compare-changed',
        load as EventListener,
      );
    };
  }, []);

  if (!mounted) return null;
  if (selected.length === 0) return null;

  const entries = selected
    .map((dest) => ({ dest, row: rows.find((r) => r.destination === dest) }))
    .slice(0, MAX);

  const remove = (dest: string) => {
    saveCompare(selected.filter((d) => d !== dest));
  };

  const clearAll = () => saveCompare([]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-[16px] top-[72px] z-[55] bg-ink text-white text-[11.5px] rounded-full px-3 py-1.5 shadow-[0_4px_12px_-6px_rgba(0,0,0,0.25)] flex items-center gap-2"
        aria-label={`비교함 (${selected.length})`}
      >
        비교 {selected.length}
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-low" />
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-[70] flex justify-end"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <aside
            className="w-[380px] max-w-[92vw] h-full bg-surface border-l border-line-2 p-5 overflow-auto animate-fade-in"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="노선 비교"
          >
            <header className="flex items-center justify-between mb-4">
              <h2 className="text-[14px] font-semibold text-ink">
                노선 비교 ({entries.length})
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="닫기"
                className="text-ink-4 hover:text-ink"
              >
                ✕
              </button>
            </header>
            <div className="space-y-3">
              {entries.map(({ dest, row }) => (
                <div
                  key={dest}
                  className="rounded-lg border border-line p-3 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-ink">
                      {cityName(dest)}{' '}
                      <span className="text-[11px] text-ink-4">({dest})</span>
                    </div>
                    <dl className="mt-2 text-[11.5px] tabular-nums space-y-1">
                      <div className="flex justify-between">
                        <dt className="text-ink-4">현재가</dt>
                        <dd className="text-ink">
                          {row?.priceKrw !== undefined && row.priceKrw !== null
                            ? `${row.priceKrw.toLocaleString('ko-KR')}원`
                            : '—'}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-ink-4">시장 평균 (p50)</dt>
                        <dd className="text-ink-2">
                          {row?.p50Krw !== undefined && row.p50Krw !== null
                            ? `${row.p50Krw.toLocaleString('ko-KR')}원`
                            : '—'}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-ink-4">클래스</dt>
                        <dd className="text-ink-2 uppercase">
                          {row?.carrierClass ?? 'mixed'}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(dest)}
                    aria-label="비교에서 제거"
                    className="text-ink-4 hover:text-up text-[12px]"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            {entries.length > 1 ? (
              <button
                type="button"
                onClick={clearAll}
                className="mt-4 text-[11.5px] text-ink-3 underline underline-offset-2 hover:text-ink"
              >
                전체 비우기
              </button>
            ) : null}
          </aside>
        </div>
      ) : null}
    </>
  );
}
