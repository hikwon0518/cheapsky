// Server Component. 규칙 기반 한 줄 맥락 (Core, ADR-005 폴백).
//
// Hard red lines:
// - "역대가" / "Amadeus" / "Anthropic" / "AI" 문자열 금지 (ADR-012)
// - 감성·계절·이벤트 추론 금지 (UI_GUIDE)
// - 60자 이내 (`clampCurationText`)
// - baselineSource null → `시장 평균 정보 수집 중` (빈 줄 대신)
//
// Stretch 2 에서 `deal.curationText` 가 채워져 들어오면 그쪽을 우선하도록
// Page 레이어에서 덮어쓸 수 있지만, 이 컴포넌트는 순수 규칙 기반 폴백만 생성한다.

import { clampCurationText } from '@/lib/format';
import type { CarrierClass, Deal } from '@/types/deal';

function classLabel(c: CarrierClass): string {
  if (c === 'fsc') return 'FSC';
  if (c === 'lcc') return 'LCC';
  return '혼합';
}

/**
 * deal 필드로부터 한 줄을 만든다.
 * - baseline 없음 → '시장 평균 정보 수집 중'
 * - discountRate>=0 & percentile ≤ 10 → '시장 평균 대비 -X% · 하위 pN · <class> 분위수'
 * - discountRate>=0 & percentile > 10 → '시장 평균 대비 -X% · <class> 분위수'
 * - discountRate<0 → '시장 평균 대비 +X% · <class> 분위수' (정보 고지용)
 * - baselineConfidence low → 접미사 '(참고용)' 추가
 */
export function buildCurationLine(
  deal: Pick<
    Deal,
    | 'discountRate'
    | 'pricePercentile'
    | 'carrierClass'
    | 'baselineSource'
    | 'baselineConfidence'
  >,
): string {
  if (!deal.baselineSource || deal.discountRate === null) {
    return clampCurationText('시장 평균 정보 수집 중');
  }

  const pct = Math.round(deal.discountRate * 100);
  const priceVsMarket =
    pct > 0
      ? `시장 평균 대비 -${pct}%`
      : pct < 0
        ? `시장 평균 대비 +${Math.abs(pct)}%`
        : '시장 평균 수준';

  const klass = `${classLabel(deal.carrierClass)} 분위수`;

  let main: string;
  if (deal.pricePercentile !== null && deal.pricePercentile <= 10 && pct > 0) {
    const p = Math.max(0, Math.round(deal.pricePercentile));
    main = `${priceVsMarket} · 하위 p${p} · ${klass}`;
  } else {
    main = `${priceVsMarket} · ${klass}`;
  }

  if (deal.baselineConfidence === 'low') {
    main = `${main} (참고용)`;
  }

  return clampCurationText(main);
}

export function CurationLine({
  deal,
  override,
}: {
  deal: Pick<
    Deal,
    | 'discountRate'
    | 'pricePercentile'
    | 'carrierClass'
    | 'baselineSource'
    | 'baselineConfidence'
    | 'curationText'
  >;
  override?: string | null;
}) {
  // Stretch 2 에서 채워진 `curationText` 가 있으면 그대로 표시, 없으면 규칙 기반.
  const text =
    override ??
    (deal.curationText ? clampCurationText(deal.curationText) : null) ??
    buildCurationLine(deal);

  return (
    <p className="text-xs text-ink-3 leading-snug line-clamp-2 min-h-[32px]">
      {text}
    </p>
  );
}
