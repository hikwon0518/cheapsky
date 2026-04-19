// Server Component. 시세 카드 (ADR-027 시세 유형, UI_GUIDE "시세 카드 (MarketCard)").
//
// 레이아웃:
//   상단    : 노선 (ICN → KIX) · 우상단 `참고 시세` 라벨
//   중단    : 가격 (text-xl, 딜 카드보다 작게) + carrier_class 텍스트
//   분위수  : 점 + `하위 N%` (또는 `데이터 수집 중`)
//   하단    : `예약 시 가격은 달라질 수 있어요` 고정 고지
//
// Hard red lines:
// - <a target="_blank" rel="nofollow noopener"> + 스카이스캐너 검색 URL (ADR-027/008)
// - "역대가" / "Amadeus" 문자열 금지 (ADR-012)
// - 🔥 외 이모지 금지
// - hover scale / translate-y / rotate 금지 (UI_GUIDE)
// - 카드 모서리 표준은 rounded-md (UI_GUIDE)

import { buildSkyscannerSearchUrl } from '@/lib/skyscanner-url';
import { formatKrw } from '@/lib/format';
import type { MarketRow } from '@/services/market-heatmap';

type MarketCardProps = {
  row: MarketRow;
  /** preview 행 1줄 컴팩트 변형 (모바일 접힘 상태 프리뷰). 기본은 standard 셀. */
  variant?: 'cell' | 'row';
  now?: Date;
};

function classLabel(c: MarketRow['carrierClass']): string {
  if (c === 'fsc') return 'FSC';
  if (c === 'lcc') return 'LCC';
  return '혼합';
}

function dotColorFromPercentile(
  cheapestKrw: number | null,
  p10: number | null,
  p50: number | null,
  hasObservation: boolean,
): { color: string; label: string } {
  // 관측 0건이면 중립 (UI_GUIDE: 관측 <10건 → 데이터 수집 중 + 중립 점)
  if (!hasObservation || cheapestKrw === null) {
    return { color: 'bg-ink-5', label: '데이터 수집 중' };
  }
  if (p10 !== null && cheapestKrw <= p10) {
    return { color: 'bg-low', label: '하위 10%' };
  }
  if (p50 !== null && cheapestKrw <= p50) {
    return { color: 'bg-ink-4', label: '하위 50%' };
  }
  return { color: 'bg-ink-2', label: '평균 이상' };
}

export function MarketCard({ row, variant = 'cell', now }: MarketCardProps) {
  const skyscannerUrl = buildSkyscannerSearchUrl({
    origin: row.origin,
    destination: row.destination,
    now,
  });

  // confidence 가 'low' (시드 mixed only) 또는 source 가 'seed' 면 관측이 부족한 상태.
  // 점 색깔 결정은 "관측 신호가 있는가" 기준.
  const hasObservation =
    row.source === 'observed' ||
    row.source === 'mixed' ||
    row.observationCount >= 1;

  const cheapest = row.cheapestTodayKrw ?? row.p10Krw;
  const { color, label } = dotColorFromPercentile(
    cheapest,
    row.p10Krw,
    row.p50Krw,
    hasObservation,
  );

  const ariaLabel = `${row.origin} → ${row.destination} 참고 시세 ${
    cheapest !== null ? formatKrw(cheapest) : '데이터 수집 중'
  }`;

  if (variant === 'row') {
    // 모바일 리스트 행 변형 (UI_GUIDE 모바일 펼침/프리뷰).
    return (
      <a
        href={skyscannerUrl}
        target="_blank"
        rel="nofollow noopener"
        aria-label={ariaLabel}
        className="flex items-center justify-between py-2 px-3 border-b border-line transition-colors duration-[120ms] hover:bg-surface-2"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${color}`}
            aria-hidden="true"
          />
          <span className="text-sm font-medium text-ink-2">
            {row.origin} → {row.destination}
          </span>
          <span className="text-[11px] text-ink-4 truncate">
            {classLabel(row.carrierClass)}
          </span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          <span className="text-sm tabular-nums text-ink">
            {cheapest !== null ? formatKrw(cheapest) : '—'}
          </span>
          <span className="text-[10px] text-ink-4">{label}</span>
        </span>
      </a>
    );
  }

  return (
    <a
      href={skyscannerUrl}
      target="_blank"
      rel="nofollow noopener"
      aria-label={ariaLabel}
      className="flex flex-col rounded-lg bg-surface border border-dashed border-line-2 p-3 transition-colors duration-[120ms] hover:border-solid hover:border-ink-4"
    >
      {/* Row 1: 노선 + 참고 시세 라벨 */}
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium text-ink-2">
          {row.origin} → {row.destination}
        </div>
        <span className="text-[10px] text-ink-4 tracking-wide shrink-0">
          참고 시세
        </span>
      </div>

      {/* Row 2: 가격 + carrier class */}
      <div className="mt-2">
        <span className="text-xl font-semibold text-ink tabular-nums">
          {cheapest !== null ? formatKrw(cheapest) : '—'}
        </span>
        <div className="text-[11px] text-ink-4 mt-0.5">
          {classLabel(row.carrierClass)}
        </div>
      </div>

      {/* Row 3: 분위수 점 + 라벨 */}
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-3">
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${color}`}
          aria-hidden="true"
        />
        <span>{label}</span>
      </div>

      {/* Row 4: 고지 (마지막 줄 고정) */}
      <div className="mt-auto pt-2 text-[10px] text-ink-4">
        예약 시 가격은 달라질 수 있어요
      </div>
    </a>
  );
}
