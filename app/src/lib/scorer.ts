// 🔥 저점 판정 + 할인율/분위수 산출 — ADR-006 + ADR-024.
//
// Hard red lines (ADR-006 표):
// - baseline.source === null → 전 null, hotDeal=false
// - baseline.confidence === 'low' (mixed 시드) → 계산은 해도 **hotDeal=false 강제**
// - hotDeal = (pricePercentile ≤ 10) && confidence ∈ {medium, high}
// - ADR-022: source === 'api' 분기 금지. 여기선 confidence 만 읽으므로 자연 준수.
//
// pricePercentile 는 (p10, p50, p90) 세 점에 대한 piecewise linear 로 산출.
// 경계 밖 가격은 [0, 100] 로 clamp.

import type { ResolvedBaseline } from '@/services/baseline';

export type ScoreResult = {
  /**
   * (p50 - price) / p50. 음수(시장 평균보다 비싼 경우)도 그대로 전달.
   * baseline.p50 이 null 이면 null.
   */
  discountRate: number | null;
  /**
   * 0~100 사이 추정 분위수. p10 이하면 10 미만, p90 초과면 90 초과.
   * baseline 정보 부족 시 null.
   */
  pricePercentile: number | null;
  /**
   * 🔥 저점 여부. low confidence 또는 baseline 없음 → 항상 false.
   */
  hotDeal: boolean;
};

/**
 * 분위수 경계값으로부터 대략적인 백분위를 역산 (piecewise linear).
 *
 *   price ≤ p10 → 0 ~ 10 사이 (p10 이하가 p10 에서 얼마나 낮은지를 확장 범위 없이 0 으로 clamp)
 *   p10 ≤ price ≤ p50 → 10 ~ 50 linear
 *   p50 ≤ price ≤ p90 → 50 ~ 90 linear
 *   price ≥ p90 → 90 ~ 100 사이 (위쪽 extrapolate, clamp)
 *
 * 셋 중 어느 하나라도 null 또는 순서가 깨지면 null.
 */
export function estimatePercentile(
  price: number,
  p10: number,
  p50: number,
  p90: number,
): number | null {
  if (!Number.isFinite(price)) return null;
  if (!Number.isFinite(p10) || !Number.isFinite(p50) || !Number.isFinite(p90)) {
    return null;
  }
  // 단조성 보장. 데이터가 깨졌을 때 null.
  if (!(p10 <= p50 && p50 <= p90)) return null;

  // Below p10 — clamp toward 0. p10 이 0 이상이고 price < p10 이면 10 미만.
  if (price <= p10) {
    // 0 → price=0 (비현실적이지만), 10 → price=p10. 선형 비례.
    if (p10 <= 0) return 0;
    const ratio = Math.max(0, price) / p10; // 0..1
    return Math.min(10, ratio * 10);
  }

  if (price <= p50) {
    const span = p50 - p10;
    if (span <= 0) return 10;
    return 10 + ((price - p10) / span) * 40; // 10..50
  }

  if (price <= p90) {
    const span = p90 - p50;
    if (span <= 0) return 50;
    return 50 + ((price - p50) / span) * 40; // 50..90
  }

  // price > p90 — p90 기준 얼마나 벗어났는지 최대 100 까지.
  // p90 * 2 지점을 100 으로 간주 (단순 extrapolation).
  const over = (price - p90) / Math.max(1, p90);
  return Math.min(100, 90 + over * 10);
}

export function score(params: {
  priceKrw: number;
  baseline: ResolvedBaseline;
}): ScoreResult {
  const { priceKrw, baseline } = params;

  // baseline 없음 → 전부 null, 🔥 미부여.
  if (
    baseline.source === null ||
    baseline.p10Krw === null ||
    baseline.p50Krw === null ||
    baseline.p90Krw === null
  ) {
    return { discountRate: null, pricePercentile: null, hotDeal: false };
  }

  const { p10Krw, p50Krw, p90Krw, confidence } = baseline;

  const percentile = estimatePercentile(priceKrw, p10Krw, p50Krw, p90Krw);
  const discountRate = p50Krw > 0 ? (p50Krw - priceKrw) / p50Krw : null;

  // low confidence (mixed 시드) → 할인율/분위수는 노출해도 hotDeal 은 false 강제.
  const hotDeal =
    percentile !== null &&
    percentile <= 10 &&
    (confidence === 'medium' || confidence === 'high');

  return {
    discountRate: roundRate(discountRate),
    pricePercentile: percentile === null ? null : roundTo(percentile, 2),
    hotDeal,
  };
}

function roundRate(v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  // DB numeric(4,3) 범위 — 소수점 3자리.
  return Math.round(v * 1000) / 1000;
}

function roundTo(v: number, digits: number): number {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}
