// 노선 빈도 배치 집계 단위 테스트.
// 중점: DB 호출 횟수가 list 크기와 무관하게 상수여야 한다 (N+1 방지).

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { batchRouteFrequency, getRouteFrequency } from './route-frequency';

type Row = { id: string; origin: string; destination: string; posted_at: string };

type MockStats = {
  fromCalls: number;
  selectCalls: number;
  lastQuery: {
    origins?: readonly string[];
    destinations?: readonly string[];
    cutoff?: string;
  };
};

function makeClientMock(rows: Row[]): {
  client: SupabaseClient;
  stats: MockStats;
} {
  const stats: MockStats = { fromCalls: 0, selectCalls: 0, lastQuery: {} };

  const filtered = {
    inOrigin: undefined as readonly string[] | undefined,
    inDest: undefined as readonly string[] | undefined,
    cutoff: undefined as string | undefined,
  };

  const terminal = {
    // `order` is terminal in the real client here — return the promise.
    order: () =>
      Promise.resolve({
        data: rows
          .filter((r) =>
            filtered.inOrigin ? filtered.inOrigin.includes(r.origin) : true,
          )
          .filter((r) =>
            filtered.inDest ? filtered.inDest.includes(r.destination) : true,
          )
          .filter((r) =>
            filtered.cutoff ? r.posted_at >= filtered.cutoff : true,
          )
          .sort((a, b) => a.posted_at.localeCompare(b.posted_at)),
        error: null,
      }),
  };

  const chain: {
    select: () => typeof chain;
    in: (col: string, vals: string[]) => typeof chain;
    gte: (col: string, v: string) => typeof terminal;
  } = {
    select: () => {
      stats.selectCalls += 1;
      return chain;
    },
    in: (col, vals) => {
      if (col === 'origin') {
        filtered.inOrigin = vals;
        stats.lastQuery.origins = vals;
      }
      if (col === 'destination') {
        filtered.inDest = vals;
        stats.lastQuery.destinations = vals;
      }
      return chain;
    },
    gte: (col, v) => {
      if (col === 'posted_at') {
        filtered.cutoff = v;
        stats.lastQuery.cutoff = v;
      }
      return terminal;
    },
  };

  const client = {
    from(table: string) {
      stats.fromCalls += 1;
      if (table !== 'deals') {
        throw new Error(`unexpected table: ${table}`);
      }
      return chain;
    },
  };

  return { client: client as unknown as SupabaseClient, stats };
}

const NOW = new Date('2026-04-19T00:00:00Z');

describe('batchRouteFrequency', () => {
  it('returns empty map for zero deals without hitting DB', async () => {
    const { client, stats } = makeClientMock([]);
    const map = await batchRouteFrequency([], client, NOW);
    expect(map.size).toBe(0);
    expect(stats.fromCalls).toBe(0);
  });

  it('counts 0 and ordinal 0 when no rows match', async () => {
    const { client } = makeClientMock([]);
    const deal = {
      id: 'd1',
      origin: 'ICN',
      destination: 'KIX',
      postedAt: new Date('2026-04-10T00:00:00Z'),
    };
    const map = await batchRouteFrequency([deal], client, NOW);
    expect(map.get('d1')).toEqual({ count30d: 0, ordinal: 0 });
  });

  it('returns count30d=3, ordinal in ascending posted_at order', async () => {
    const rows: Row[] = [
      {
        id: 'd-old',
        origin: 'ICN',
        destination: 'KIX',
        posted_at: '2026-04-01T00:00:00Z',
      },
      {
        id: 'd-mid',
        origin: 'ICN',
        destination: 'KIX',
        posted_at: '2026-04-10T00:00:00Z',
      },
      {
        id: 'd-new',
        origin: 'ICN',
        destination: 'KIX',
        posted_at: '2026-04-18T00:00:00Z',
      },
    ];
    const { client } = makeClientMock(rows);
    const deals = rows.map((r) => ({
      id: r.id,
      origin: r.origin,
      destination: r.destination,
      postedAt: new Date(r.posted_at),
    }));
    const map = await batchRouteFrequency(deals, client, NOW);
    expect(map.get('d-old')).toEqual({ count30d: 3, ordinal: 1 });
    expect(map.get('d-mid')).toEqual({ count30d: 3, ordinal: 2 });
    expect(map.get('d-new')).toEqual({ count30d: 3, ordinal: 3 });
  });

  it('is a single DB call regardless of list size (O(1) hit)', async () => {
    // 50개 딜, 다양한 목적지. 실제 쿼리는 한 번.
    const destinations = ['KIX', 'NRT', 'FUK', 'BKK', 'DAD', 'TPE', 'HKG'];
    const rows: Row[] = [];
    const deals: {
      id: string;
      origin: string;
      destination: string;
      postedAt: Date;
    }[] = [];
    for (let i = 0; i < 50; i++) {
      const dest = destinations[i % destinations.length];
      const id = `d${i}`;
      const posted = new Date(NOW.getTime() - (i % 20) * 24 * 60 * 60 * 1000);
      rows.push({
        id,
        origin: 'ICN',
        destination: dest,
        posted_at: posted.toISOString(),
      });
      deals.push({
        id,
        origin: 'ICN',
        destination: dest,
        postedAt: posted,
      });
    }

    const { client, stats } = makeClientMock(rows);
    const map = await batchRouteFrequency(deals, client, NOW);

    // 전 50개 딜 모두 맵에 존재
    expect(map.size).toBe(50);

    // 핵심: DB 호출 횟수가 list 크기와 무관하게 상수 (from = 1회, select = 1회)
    expect(stats.fromCalls).toBe(1);
    expect(stats.selectCalls).toBe(1);
    expect(stats.lastQuery.origins).toEqual(['ICN']);
    expect(stats.lastQuery.destinations).toEqual(destinations);
  });

  it('filters to the 30-day window (older rows excluded from count)', async () => {
    // NOW - 31일 된 row 는 cutoff 밖 → 쿼리 결과에서 제외되어야 함 (mock 이 cutoff 필터링)
    const rows: Row[] = [
      {
        id: 'ancient',
        origin: 'ICN',
        destination: 'KIX',
        posted_at: new Date(
          NOW.getTime() - 31 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      },
      {
        id: 'recent',
        origin: 'ICN',
        destination: 'KIX',
        posted_at: new Date(
          NOW.getTime() - 5 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      },
    ];
    const { client, stats } = makeClientMock(rows);
    const map = await batchRouteFrequency(
      [
        {
          id: 'recent',
          origin: 'ICN',
          destination: 'KIX',
          postedAt: new Date(rows[1].posted_at),
        },
      ],
      client,
      NOW,
    );
    // ancient 는 30일 밖 → count 에서 제외
    expect(map.get('recent')).toEqual({ count30d: 1, ordinal: 1 });
    // 쿼리 cutoff 가 NOW - 30일 로 세팅됐는지 간접 검증
    expect(stats.lastQuery.cutoff).toBeDefined();
  });

  it('ignores cross-product pairs not in input (origin IN × dest IN safety)', async () => {
    // 요청: ICN→KIX 만. DB 에 ICN→NRT row 도 있지만 카운트에 들어가면 안 됨.
    const rows: Row[] = [
      {
        id: 'kix-1',
        origin: 'ICN',
        destination: 'KIX',
        posted_at: '2026-04-15T00:00:00Z',
      },
      {
        id: 'nrt-1',
        origin: 'ICN',
        destination: 'NRT',
        posted_at: '2026-04-16T00:00:00Z',
      },
    ];
    const { client } = makeClientMock(rows);
    const deal = {
      id: 'kix-1',
      origin: 'ICN',
      destination: 'KIX',
      postedAt: new Date(rows[0].posted_at),
    };
    const map = await batchRouteFrequency([deal], client, NOW);
    expect(map.get('kix-1')).toEqual({ count30d: 1, ordinal: 1 });
  });

  it('fails soft to empty map if DB returns error', async () => {
    // error 리턴 시나리오: order() 가 `{ error }` 리턴.
    const client = {
      from: () => ({
        select: () => ({
          in: () => ({
            in: () => ({
              gte: () => ({
                order: () =>
                  Promise.resolve({ data: null, error: { message: 'boom' } }),
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    const map = await batchRouteFrequency(
      [
        {
          id: 'd1',
          origin: 'ICN',
          destination: 'KIX',
          postedAt: new Date(),
        },
      ],
      client,
      NOW,
    );
    expect(map.size).toBe(0);
  });

  it('fails soft to empty map if client throws synchronously', async () => {
    const client = {
      from: () => {
        throw new Error('network down');
      },
    } as unknown as SupabaseClient;
    const map = await batchRouteFrequency(
      [
        {
          id: 'd1',
          origin: 'ICN',
          destination: 'KIX',
          postedAt: new Date(),
        },
      ],
      client,
      NOW,
    );
    expect(map.size).toBe(0);
  });
});

describe('getRouteFrequency (single-deal convenience wrapper)', () => {
  it('delegates to batchRouteFrequency and returns its entry', async () => {
    const rows: Row[] = [
      {
        id: 'd1',
        origin: 'ICN',
        destination: 'FUK',
        posted_at: '2026-04-10T00:00:00Z',
      },
      {
        id: 'd1-other',
        origin: 'ICN',
        destination: 'FUK',
        posted_at: '2026-04-15T00:00:00Z',
      },
    ];
    const { client } = makeClientMock(rows);
    const info = await getRouteFrequency({
      dealId: 'd1',
      origin: 'ICN',
      destination: 'FUK',
      postedAt: new Date(rows[0].posted_at),
      client,
      now: NOW,
    });
    // 배치 쿼리 결과 전체(2건)를 기준으로 계산된 ordinal/count 가 나와야 함.
    expect(info.count30d).toBe(2);
    expect(info.ordinal).toBe(1);
  });

  it('returns {0, 0} when deal not found in window', async () => {
    const { client } = makeClientMock([]);
    const info = await getRouteFrequency({
      dealId: 'd-missing',
      origin: 'ICN',
      destination: 'GUM',
      postedAt: new Date('2026-04-10T00:00:00Z'),
      client,
      now: NOW,
    });
    expect(info).toEqual({ count30d: 0, ordinal: 0 });
  });
});
