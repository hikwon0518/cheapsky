// Server Component. 카드 최하단 출처 태그.
// UI_GUIDE: text-[11px] text-neutral-500 uppercase tracking-wide.
// 뱃지화 금지 — 그냥 텍스트. "PPOMPPU · RULIWEB" 처럼 interpunct 구분.

import type { Source } from '@/types/deal';

const LABEL: Record<Source, string> = {
  ppomppu: 'PPOMPPU',
  ruliweb: 'RULIWEB',
  playwings: 'PLAYWINGS',
  clien: 'CLIEN',
};

export function SourceTag({ sources }: { sources: readonly Source[] }) {
  if (!sources || sources.length === 0) return null;
  const text = sources.map((s) => LABEL[s] ?? s).join(' · ');
  return (
    <span className="text-[11px] text-ink-4 uppercase tracking-wide">
      {text}
    </span>
  );
}
