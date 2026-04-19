// ADR-011 우선순위 5단계 테스트.
// 모든 테스트는 SupabaseClient 의 `from(...).select(...)` 체인을 mock.

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  MIXED_THRESHOLD,
  OBSERVED_SOLO_THRESHOLD,
  observedQuantiles,
  percentileLinear,
  resolveBaseline,
} from './baseline';

/**
 * Supabase fluent API mock factory.
 * `price_observations` / `route_market_data` 두 테이블의 select 결과만 받아
 * 적절한 체인을 돌려주는 최소 mock.
 */
function makeClientMock(opts: {
  observations: Array<{ price_krw: number }>;
  seeds: Array<{
    p10_krw: number | null;
    p50_krw: number | null;
    p90_krw: number | null;
    carrier_class: 'fsc' | 'lcc' | 'mixed';
  }>;
}): SupabaseClient {
  const client = {
    from(table: string) {
      if (table === 'price_observations') {
        return makeObsQuery(opts.observations);
      }
      if (table === 'route_market_data') {
        return makeSeedQuery(opts.seeds);
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
  return client as unknown as SupabaseClient;
}

type QueryResult<T> = Promise<{ data: T[]; error: null }>;

function makeObsQuery(data: Array<{ price_krw: number }>) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    gte: () => Promise.resolve({ data, error: null }) as QueryResult<{ price_krw: number }>,
  };
  return chain;
}

function makeSeedQuery(
  data: Array<{
    p10_krw: number | null;
    p50_krw: number | null;
    p90_krw: number | null;
    carrier_class: 'fsc' | 'lcc' | 'mixed';
  }>,
) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => Promise.resolve({ data, error: null }),
  };
  return chain;
}

describe('percentileLinear', () => {
  it('returns null for empty array', () => {
    expect(percentileLinear([], 0.5)).toBeNull();
  });

  it('returns single value for length-1 array', () => {
    expect(percentileLinear([100], 0.1)).toBe(100);
    expect(percentileLinear([100], 0.9)).toBe(100);
  });

  it('interpolates linearly between sorted values', () => {
    // 값 [0, 10, 20, 30, 40]. q=0.5 → index 2 → 20.
    expect(percentileLinear([0, 10, 20, 30, 40], 0.5)).toBe(20);
    // q=0.25 → index 1 → 10.
    expect(percentileLinear([0, 10, 20, 30, 40], 0.25)).toBe(10);
    // q=0.1 → index 0.4 → 0*(0.6) + 10*(0.4) = 4.
    expect(percentileLinear([0, 10, 20, 30, 40], 0.1)).toBeCloseTo(4, 5);
  });
});

describe('observedQuantiles', () => {
  it('returns p10/p50/p90 for 10 samples', () => {
    const samples = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    const q = observedQuantiles(samples);
    expect(q.p50).toBeCloseTo(550, 0);
    // idx = 0.9*9 = 8.1 → 900 + 1000*0.1 = 910.
    expect(q.p90).toBeCloseTo(910, 1);
  });

  it('handles all-null input', () => {
    const q = observedQuantiles([]);
    expect(q.p10).toBeNull();
    expect(q.p50).toBeNull();
    expect(q.p90).toBeNull();
  });
});

describe('resolveBaseline — ADR-011 priority levels (5 paths)', () => {
  const now = new Date('2026-04-18T00:00:00Z');

  it('priority 1: 40 observations → observed-only, confidence=high', async () => {
    const observations = Array.from({ length: 40 }, (_, i) => ({
      price_krw: 100_000 + i * 1000,
    }));
    const client = makeClientMock({
      observations,
      seeds: [
        {
          carrier_class: 'lcc',
          p10_krw: 99_000,
          p50_krw: 180_000,
          p90_krw: 280_000,
        },
      ],
    });

    const out = await resolveBaseline({
      origin: 'ICN',
      destination: 'KIX',
      carrierClass: 'lcc',
      client,
      now,
    });

    expect(out.source).toBe('observed');
    expect(out.confidence).toBe('high');
    expect(out.observationCount).toBe(40);
    // 관측 단독이므로 시드값(p50=180000)과 다를 것.
    expect(out.p50Krw).not.toBe(180_000);
    expect(out.p10Krw).not.toBeNull();
  });

  it('priority 2: 15 observations + seed match → mixed 0.6*obs + 0.4*seed, confidence=medium', async () => {
    // 15 건, p50 관측 ≈ 200. 시드 p50 = 300.
    const observations = Array.from({ length: 15 }, (_, i) => ({
      price_krw: 100 + i * 15, // 100, 115, ..., 310
    }));
    const client = makeClientMock({
      observations,
      seeds: [
        {
          carrier_class: 'lcc',
          p10_krw: 200,
          p50_krw: 300,
          p90_krw: 400,
        },
      ],
    });

    const out = await resolveBaseline({
      origin: 'ICN',
      destination: 'KIX',
      carrierClass: 'lcc',
      client,
      now,
    });

    expect(out.source).toBe('mixed');
    expect(out.confidence).toBe('medium');
    expect(out.observationCount).toBe(15);

    // 관측 p50 검증: [100, 115, …, 310] 14개 step → median index = 7 → 100 + 15*7 = 205.
    // mix: 205 * 0.6 + 300 * 0.4 = 243.
    expect(out.p50Krw).toBeCloseTo(243, 0);
  });

  it('priority 3: 5 observations + seed FSC/LCC match → seed-only, confidence=medium', async () => {
    const observations = Array.from({ length: 5 }, () => ({ price_krw: 150_000 }));
    const client = makeClientMock({
      observations,
      seeds: [
        {
          carrier_class: 'lcc',
          p10_krw: 99_000,
          p50_krw: 180_000,
          p90_krw: 279_000,
        },
        {
          carrier_class: 'mixed',
          p10_krw: 120_000,
          p50_krw: 200_000,
          p90_krw: 300_000,
        },
      ],
    });

    const out = await resolveBaseline({
      origin: 'ICN',
      destination: 'KIX',
      carrierClass: 'lcc',
      client,
      now,
    });

    expect(out.source).toBe('seed');
    expect(out.confidence).toBe('medium');
    expect(out.p10Krw).toBe(99_000);
    expect(out.p50Krw).toBe(180_000);
    expect(out.p90Krw).toBe(279_000);
    expect(out.observationCount).toBe(5);
  });

  it('priority 4: seed mixed only → source=seed, confidence=low (🔥 미부여)', async () => {
    // 관측 0건, 시드는 mixed 만 존재
    const client = makeClientMock({
      observations: [],
      seeds: [
        {
          carrier_class: 'mixed',
          p10_krw: 150_000,
          p50_krw: 250_000,
          p90_krw: 400_000,
        },
      ],
    });

    // 요청 carrierClass 가 LCC 이지만 시드는 mixed 만 있음 → 4순위 fallback
    const out = await resolveBaseline({
      origin: 'ICN',
      destination: 'KIX',
      carrierClass: 'lcc',
      client,
      now,
    });

    expect(out.source).toBe('seed');
    expect(out.confidence).toBe('low');
    expect(out.p50Krw).toBe(250_000);
    expect(out.observationCount).toBe(0);
  });

  it('priority 5: no observations, no seed → all null', async () => {
    const client = makeClientMock({
      observations: [],
      seeds: [],
    });

    const out = await resolveBaseline({
      origin: 'ICN',
      destination: 'DAD',
      carrierClass: 'fsc',
      client,
      now,
    });

    expect(out.p10Krw).toBeNull();
    expect(out.p50Krw).toBeNull();
    expect(out.p90Krw).toBeNull();
    expect(out.source).toBeNull();
    expect(out.confidence).toBeNull();
    expect(out.observationCount).toBe(0);
  });

  it('edge: 5 observations + only seed mixed → falls through priority 3 to priority 4 (low)', async () => {
    // 관측 부족 + FSC/LCC 시드 매치 없음 + mixed 시드 있음 → 4순위
    const observations = Array.from({ length: 5 }, () => ({ price_krw: 100_000 }));
    const client = makeClientMock({
      observations,
      seeds: [
        {
          carrier_class: 'mixed',
          p10_krw: 100_000,
          p50_krw: 200_000,
          p90_krw: 300_000,
        },
      ],
    });

    const out = await resolveBaseline({
      origin: 'ICN',
      destination: 'DAD',
      carrierClass: 'lcc',
      client,
      now,
    });
    expect(out.source).toBe('seed');
    expect(out.confidence).toBe('low');
    expect(out.p50Krw).toBe(200_000);
  });

  it('thresholds constants match spec', () => {
    expect(OBSERVED_SOLO_THRESHOLD).toBe(30);
    expect(MIXED_THRESHOLD).toBe(10);
  });
});
