'use client';

// AlertsList — 등록된 감시 노선 목록 + 삭제 버튼 (C1).

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { cityName } from '@/lib/city-names';
import { formatKrw } from '@/lib/format';
import type { WatchedRoute } from '@/lib/watcher';

type Props = {
  initial: WatchedRoute[];
};

export function AlertsList({ initial }: Props) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);

  if (initial.length === 0) {
    return (
      <p className="text-[12px] text-ink-4 italic">
        아직 등록된 감시 노선이 없어요. 위 폼에서 관심 있는 노선을 추가하세요.
      </p>
    );
  }

  const onDelete = async (id: string) => {
    if (!confirm('이 노선 감시를 해제할까요?')) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/watcher?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      router.refresh();
    } catch (e) {
      alert(`삭제 실패: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <ul className="space-y-2">
      {initial.map((r) => (
        <li
          key={r.id}
          className="rounded-lg border border-line p-3 flex items-start justify-between gap-3"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-ink">
              {cityName(r.destination)}{' '}
              <span className="text-[11px] text-ink-4">
                ({r.origin} → {r.destination})
              </span>
            </div>
            <div className="text-[11.5px] text-ink-3 tabular-nums mt-1">
              최대 {formatKrw(r.maxPriceKrw)} · {r.carrierClass.toUpperCase()}
              {r.departMonth ? ` · ${r.departMonth} 출발` : ''}
            </div>
            {r.lastNotifiedAt ? (
              <div className="text-[11px] text-ink-4 tabular-nums mt-1">
                마지막 알림: {r.lastNotifiedAt.toISOString().slice(0, 16).replace('T', ' ')}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onDelete(r.id)}
            disabled={deleting === r.id}
            aria-label="감시 해제"
            className="text-[12px] text-ink-4 hover:text-up underline underline-offset-2"
          >
            {deleting === r.id ? '해제 중…' : '해제'}
          </button>
        </li>
      ))}
    </ul>
  );
}
