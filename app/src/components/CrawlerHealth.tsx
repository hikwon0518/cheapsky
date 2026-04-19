// Server Component. 푸터에 크롤러 헬스 점 표시.
//
// Core 표기: `● 뽐뿌 <time>` 하나만 (루리웹·플레이윙즈는 Stretch 1).
// UI_GUIDE:
//   - 성공 (최근 30분): bg-emerald-500
//   - 지연 (30분~2시간): bg-neutral-600
//   - 실패 (2h+ 또는 최근 run failed): bg-red-500
// aria-label 병기.

import { formatRelativeKst } from '@/lib/tz';
import type { Source } from '@/types/deal';

export type SourceHealth = {
  source: Source;
  label: string;
  lastSuccessAt: Date | null; // null → 수집 이력 없음
};

function dotColor(
  lastSuccessAt: Date | null,
  now: Date,
): { cls: string; state: 'success' | 'delayed' | 'failed' } {
  if (!lastSuccessAt) return { cls: 'bg-up', state: 'failed' };
  const diffMin = (now.getTime() - lastSuccessAt.getTime()) / (60 * 1000);
  if (diffMin <= 30) return { cls: 'bg-low', state: 'success' };
  if (diffMin <= 120) return { cls: 'bg-warn', state: 'delayed' };
  return { cls: 'bg-up', state: 'failed' };
}

export function CrawlerHealth({
  sources,
  now,
}: {
  sources: readonly SourceHealth[];
  now?: Date;
}) {
  const ref = now ?? new Date();
  if (!sources || sources.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-4 list-none m-0 p-0">
      {sources.map((s) => {
        const { cls, state } = dotColor(s.lastSuccessAt, ref);
        const when = s.lastSuccessAt
          ? formatRelativeKst(s.lastSuccessAt, ref)
          : '수집 없음';
        const stateLabel =
          state === 'success' ? '정상' : state === 'delayed' ? '지연' : '실패';
        return (
          <li key={s.source} className="flex items-center gap-1.5">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${cls}`}
              aria-hidden="true"
            />
            <span
              aria-label={`${s.label} ${stateLabel}, ${when} 수집`}
              className="tabular-nums"
            >
              {s.label} {when}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
