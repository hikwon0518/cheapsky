// Server Component. 카드 최하단 출처 태그.
// UI_GUIDE: text-[11px] text-ink-4 uppercase tracking-wide.
// 뱃지화 금지 — 그냥 텍스트. "PPOMPPU · RULIWEB" 처럼 interpunct 구분.
//
// ADR-030 (2026-04-19): 소스 교차 매칭. sources.length >= 2 일 때 "N곳 동시 등장"
// 접미. `>= 3` 은 social_signal='hot' 승격 대상 (DealCard 가 별도 hot 배지 표시).

import type { Source } from '@/types/deal';

const LABEL: Record<Source, string> = {
  ppomppu: 'PPOMPPU',
  ruliweb: 'RULIWEB',
  playwings: 'PLAYWINGS',
  clien: 'CLIEN',
};

/**
 * 순수 포맷 함수. 테스트 편의성을 위해 분리.
 * - 0 엔트리 → 빈 문자열
 * - 1 엔트리 → "LABEL"
 * - 2+ 엔트리 → "A · B [· C] [(외 N곳)] · N곳 동시 등장" (ADR-030)
 * - 상위 3곳까지 표기, 초과는 "(외 N곳)" overflow
 */
export function formatSourcesLabel(sources: readonly Source[]): string {
  if (!sources || sources.length === 0) return '';
  const unique = Array.from(new Set(sources));
  const shown = unique.slice(0, 3);
  const base = shown.map((s) => LABEL[s] ?? s).join(' · ');
  const overflow = unique.length > 3 ? ` (외 ${unique.length - 3}곳)` : '';
  const suffix =
    unique.length >= 2 ? ` · ${unique.length}곳 동시 등장` : '';
  return `${base}${overflow}${suffix}`;
}

export function SourceTag({ sources }: { sources: readonly Source[] }) {
  const text = formatSourcesLabel(sources);
  if (!text) return null;
  return (
    <span className="text-[11px] text-ink-4 uppercase tracking-wide">
      {text}
    </span>
  );
}
