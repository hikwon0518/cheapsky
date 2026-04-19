'use client';

// AlertsForm — 감시 노선 등록 폼 (C1).
// /api/watcher POST 호출. 성공 시 router.refresh() 로 서버 컴포넌트 목록 갱신.

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { CITY_NAMES } from '@/lib/city-names';

const DESTINATIONS = Object.keys(CITY_NAMES).filter(
  (c) => c !== 'ICN' && c !== 'GMP',
);

export function AlertsForm() {
  const router = useRouter();
  const [destination, setDestination] = useState('NRT');
  const [maxPrice, setMaxPrice] = useState(300_000);
  const [carrierClass, setCarrierClass] = useState<'fsc' | 'lcc' | 'mixed'>(
    'mixed',
  );
  const [departMonth, setDepartMonth] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/watcher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: 'ICN',
          destination,
          maxPriceKrw: maxPrice,
          carrierClass,
          departMonth: departMonth || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({ error: 'unknown' }))) as {
          error?: string;
        };
        throw new Error(body.error ?? `status ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg bg-card border border-line p-4 space-y-3"
      aria-label="감시 노선 등록"
    >
      <h2 className="text-[14px] font-semibold text-ink">새 노선 감시</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-4 uppercase tracking-wide">
            목적지
          </span>
          <select
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            className="rounded-md bg-surface border border-line px-3 py-2 text-sm text-ink"
          >
            {DESTINATIONS.map((code) => (
              <option key={code} value={code}>
                {CITY_NAMES[code]} ({code})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-4 uppercase tracking-wide">
            최대 가격 (원)
          </span>
          <input
            type="number"
            min={30000}
            max={10_000_000}
            step={10_000}
            value={maxPrice}
            onChange={(e) => setMaxPrice(Number(e.target.value))}
            className="rounded-md bg-surface border border-line px-3 py-2 text-sm text-ink tabular-nums"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-4 uppercase tracking-wide">
            항공사 등급
          </span>
          <select
            value={carrierClass}
            onChange={(e) =>
              setCarrierClass(e.target.value as 'fsc' | 'lcc' | 'mixed')
            }
            className="rounded-md bg-surface border border-line px-3 py-2 text-sm text-ink"
          >
            <option value="mixed">전체 (혼합)</option>
            <option value="fsc">FSC (대한항공·아시아나 등)</option>
            <option value="lcc">LCC (저가항공)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-4 uppercase tracking-wide">
            출발 월 (선택)
          </span>
          <input
            type="month"
            value={departMonth}
            onChange={(e) => setDepartMonth(e.target.value)}
            className="rounded-md bg-surface border border-line px-3 py-2 text-sm text-ink tabular-nums"
          />
        </label>
      </div>
      {error ? (
        <p className="text-[12px] text-up">등록 실패: {error}</p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="btn btn-primary"
        >
          {submitting ? '등록 중…' : '감시 등록'}
        </button>
      </div>
    </form>
  );
}
