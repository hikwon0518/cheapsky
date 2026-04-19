// CurationLine 은 JSX 를 반환하지만 핵심 로직은 `buildCurationLine` 순수 함수.
// 이 파일은 규칙 기반 폴백 텍스트만 검증한다 (vitest node 환경).

import { describe, expect, it } from 'vitest';

import { buildCurationLine } from '@/components/CurationLine';

describe('buildCurationLine', () => {
  it('returns collecting-message when baseline missing', () => {
    expect(
      buildCurationLine({
        discountRate: null,
        pricePercentile: null,
        carrierClass: 'mixed',
        baselineSource: null,
        baselineConfidence: null,
      }),
    ).toBe('시장 평균 정보 수집 중');
  });

  it('formats hot deal with percentile', () => {
    expect(
      buildCurationLine({
        discountRate: 0.52,
        pricePercentile: 7,
        carrierClass: 'lcc',
        baselineSource: 'observed',
        baselineConfidence: 'high',
      }),
    ).toBe('시장 평균 대비 -52% · 하위 p7 · LCC 분위수');
  });

  it('drops percentile when above 10', () => {
    expect(
      buildCurationLine({
        discountRate: 0.2,
        pricePercentile: 35,
        carrierClass: 'fsc',
        baselineSource: 'seed',
        baselineConfidence: 'medium',
      }),
    ).toBe('시장 평균 대비 -20% · FSC 분위수');
  });

  it('labels over-market prices without hotDeal marker', () => {
    expect(
      buildCurationLine({
        discountRate: -0.1,
        pricePercentile: 72,
        carrierClass: 'mixed',
        baselineSource: 'mixed',
        baselineConfidence: 'medium',
      }),
    ).toBe('시장 평균 대비 +10% · 혼합 분위수');
  });

  it('appends 참고용 for low confidence', () => {
    expect(
      buildCurationLine({
        discountRate: 0.1,
        pricePercentile: 45,
        carrierClass: 'mixed',
        baselineSource: 'seed',
        baselineConfidence: 'low',
      }),
    ).toBe('시장 평균 대비 -10% · 혼합 분위수 (참고용)');
  });

  it('forbids forbidden strings', () => {
    const out = buildCurationLine({
      discountRate: 0.5,
      pricePercentile: 5,
      carrierClass: 'lcc',
      baselineSource: 'observed',
      baselineConfidence: 'high',
    });
    expect(out).not.toMatch(/역대가/);
    expect(out).not.toMatch(/Amadeus/);
    expect(out).not.toMatch(/Anthropic/);
  });
});
