import { describe, expect, it } from 'vitest';

import type { ResolvedBaseline } from '@/services/baseline';
import { estimatePercentile, score } from './scorer';

function baseline(
  src: ResolvedBaseline['source'],
  conf: ResolvedBaseline['confidence'],
  p10: number | null,
  p50: number | null,
  p90: number | null,
  observationCount = 0,
): ResolvedBaseline {
  return {
    source: src,
    confidence: conf,
    p10Krw: p10,
    p50Krw: p50,
    p90Krw: p90,
    observationCount,
  };
}

describe('estimatePercentile', () => {
  it('returns ~50 at p50', () => {
    expect(estimatePercentile(200, 100, 200, 400)).toBeCloseTo(50, 1);
  });

  it('returns ~10 at p10 and ~90 at p90', () => {
    expect(estimatePercentile(100, 100, 200, 400)).toBeCloseTo(10, 1);
    expect(estimatePercentile(400, 100, 200, 400)).toBeCloseTo(90, 1);
  });

  it('clamps below 10 when price < p10', () => {
    const pct = estimatePercentile(50, 100, 200, 400);
    expect(pct).not.toBeNull();
    expect(pct! < 10).toBe(true);
  });

  it('extrapolates above 90 when price > p90', () => {
    const pct = estimatePercentile(500, 100, 200, 400);
    expect(pct).not.toBeNull();
    expect(pct! > 90).toBe(true);
  });

  it('returns null when ordering is broken', () => {
    expect(estimatePercentile(100, 300, 200, 400)).toBeNull();
  });
});

describe('score — ADR-006 table', () => {
  it('price ≈ p50 → percentile ~50, discountRate ~0', () => {
    const r = score({
      priceKrw: 300_000,
      baseline: baseline('observed', 'high', 150_000, 300_000, 500_000, 40),
    });
    expect(r.pricePercentile).toBeCloseTo(50, 1);
    expect(r.discountRate).toBeCloseTo(0, 3);
    expect(r.hotDeal).toBe(false);
  });

  it('price < p10 with HIGH confidence → percentile ≤ 10, hotDeal=true', () => {
    const r = score({
      priceKrw: 80_000,
      baseline: baseline('observed', 'high', 100_000, 200_000, 400_000, 40),
    });
    expect(r.pricePercentile).not.toBeNull();
    expect(r.pricePercentile! <= 10).toBe(true);
    expect(r.hotDeal).toBe(true);
  });

  it('price < p10 with MEDIUM confidence → hotDeal=true still', () => {
    const r = score({
      priceKrw: 80_000,
      baseline: baseline('seed', 'medium', 100_000, 200_000, 400_000),
    });
    expect(r.pricePercentile! <= 10).toBe(true);
    expect(r.hotDeal).toBe(true);
  });

  it('price < p10 with LOW confidence (mixed 시드) → hotDeal=false (ADR-006 강제)', () => {
    const r = score({
      priceKrw: 80_000,
      baseline: baseline('seed', 'low', 100_000, 200_000, 400_000),
    });
    // 할인율·분위수는 계산됨.
    expect(r.pricePercentile).not.toBeNull();
    expect(r.discountRate).not.toBeNull();
    expect(r.pricePercentile! <= 10).toBe(true);
    // 하지만 hotDeal 은 강제 false.
    expect(r.hotDeal).toBe(false);
  });

  it('baseline null (5순위) → all null, hotDeal=false', () => {
    const r = score({
      priceKrw: 100_000,
      baseline: baseline(null, null, null, null, null, 0),
    });
    expect(r.discountRate).toBeNull();
    expect(r.pricePercentile).toBeNull();
    expect(r.hotDeal).toBe(false);
  });

  it('discountRate = (p50 - price) / p50', () => {
    // p50=200, price=100 → (200-100)/200 = 0.5
    const r = score({
      priceKrw: 100_000,
      baseline: baseline('observed', 'high', 80_000, 200_000, 400_000, 35),
    });
    expect(r.discountRate).toBeCloseTo(0.5, 3);
  });

  it('negative discountRate preserved (price > p50)', () => {
    const r = score({
      priceKrw: 300_000,
      baseline: baseline('observed', 'high', 80_000, 200_000, 400_000, 35),
    });
    expect(r.discountRate).toBeCloseTo(-0.5, 3);
  });

  it('returns 🔥 only when confidence is medium or high', () => {
    // p10=100, p50=200, p90=400. price=50 → well below p10 → percentile ~5.
    const low = score({
      priceKrw: 50_000,
      baseline: baseline('seed', 'low', 100_000, 200_000, 400_000),
    });
    expect(low.hotDeal).toBe(false);

    const med = score({
      priceKrw: 50_000,
      baseline: baseline('seed', 'medium', 100_000, 200_000, 400_000),
    });
    expect(med.hotDeal).toBe(true);

    const hi = score({
      priceKrw: 50_000,
      baseline: baseline('observed', 'high', 100_000, 200_000, 400_000, 35),
    });
    expect(hi.hotDeal).toBe(true);
  });
});
