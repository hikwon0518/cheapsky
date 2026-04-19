import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FILTERS,
  isDefaultFilters,
  monthWindow,
  parseFilters,
  serializeFilters,
  sinceCutoff,
} from '@/lib/filters';

describe('parseFilters', () => {
  it('returns defaults for null input', () => {
    expect(parseFilters(null)).toEqual(DEFAULT_FILTERS);
  });

  it('parses URLSearchParams', () => {
    const sp = new URLSearchParams(
      'region=JP&maxPrice=300000&month=2026-05&minDiscount=30&since=24h',
    );
    const f = parseFilters(sp);
    expect(f).toEqual({
      region: 'JP',
      maxPrice: 300000,
      month: '2026-05',
      minDiscount: 30,
      since: '24h',
    });
  });

  it('rejects invalid region / month / since', () => {
    const f = parseFilters({
      region: 'EU',
      month: '2026-13',
      since: '10h',
    });
    expect(f).toEqual(DEFAULT_FILTERS);
  });

  it('clamps minDiscount into 0..100', () => {
    expect(parseFilters({ minDiscount: '250' }).minDiscount).toBe(100);
    expect(parseFilters({ minDiscount: 'nan' }).minDiscount).toBe(0);
  });

  it('accepts Record with array values (Next 15 searchParams)', () => {
    const f = parseFilters({ region: ['SEA', 'US'] });
    expect(f.region).toBe('SEA');
  });
});

describe('serializeFilters', () => {
  it('omits default values', () => {
    expect(serializeFilters(DEFAULT_FILTERS).toString()).toBe('');
  });

  it('round trips', () => {
    const f = {
      region: 'JP' as const,
      maxPrice: 500000,
      month: '2026-05',
      minDiscount: 30,
      since: '7d' as const,
    };
    const sp = serializeFilters(f);
    expect(parseFilters(sp)).toEqual(f);
  });
});

describe('isDefaultFilters', () => {
  it('is true for DEFAULT_FILTERS', () => {
    expect(isDefaultFilters(DEFAULT_FILTERS)).toBe(true);
  });
  it('is false when any field differs', () => {
    expect(
      isDefaultFilters({ ...DEFAULT_FILTERS, region: 'JP' }),
    ).toBe(false);
  });
});

describe('sinceCutoff', () => {
  it('returns null for "all"', () => {
    expect(sinceCutoff('all', new Date('2026-04-18T00:00:00Z'))).toBeNull();
  });
  it('returns date for 24h', () => {
    const now = new Date('2026-04-18T00:00:00Z');
    const c = sinceCutoff('24h', now);
    expect(c).not.toBeNull();
    if (c) {
      expect(now.getTime() - c.getTime()).toBe(24 * 60 * 60 * 1000);
    }
  });
});

describe('monthWindow', () => {
  it('rejects malformed', () => {
    expect(monthWindow('2026-13')).toBeNull();
    expect(monthWindow('2026-1')).toBeNull();
    expect(monthWindow('abcd')).toBeNull();
  });
  it('spans exactly the KST month', () => {
    const w = monthWindow('2026-05');
    expect(w).not.toBeNull();
    if (w) {
      // KST 2026-05-01 00:00 = UTC 2026-04-30 15:00
      expect(w.startUtc.toISOString()).toBe('2026-04-30T15:00:00.000Z');
      expect(w.endUtc.toISOString()).toBe('2026-05-31T15:00:00.000Z');
    }
  });
});
