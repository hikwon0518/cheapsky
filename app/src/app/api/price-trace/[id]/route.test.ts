// /api/price-trace/[id] 테스트.
// - aggregateObservations 순수 함수 경계값
// - GET 핸들러: deal 미존재 / 관측 0건 / 같은 날 여러 건 / 90일 경계

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  aggregateObservations,
  type PriceObservationRow,
} from '@/lib/price-trace';

// `@/lib/db` 를 통째로 mock. hoisted 되지만 아래 getAnonClient 를 beforeEach
// 에서 재설정해 각 테스트가 격리되도록 한다.
vi.mock('@/lib/db', () => ({
  getAnonClient: () => mockClient,
}));

type Chain = {
  select: (cols?: string) => Chain;
  eq: (col: string, val: unknown) => Chain;
  gte: (col: string, val: unknown) => Chain;
  order: (col: string, opts?: unknown) => Chain;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  then?: unknown;
};

type Calls = {
  observationGteArgs: Array<[string, unknown]>;
  dealEqArgs: Array<[string, unknown]>;
  observationEqArgs: Array<[string, unknown]>;
};

let mockClient: {
  from: (table: string) => Chain;
};
let calls: Calls;

type DealRowMock = {
  origin: string;
  destination: string;
  carrier_class: string;
};

function setupMockClient(opts: {
  deal: DealRowMock | null;
  observations: PriceObservationRow[];
  dealError?: boolean;
  obsError?: boolean;
}) {
  calls = {
    observationGteArgs: [],
    dealEqArgs: [],
    observationEqArgs: [],
  };

  const dealChain: Chain = {
    select: () => dealChain,
    eq: (col, val) => {
      calls.dealEqArgs.push([col, val]);
      return dealChain;
    },
    gte: () => dealChain,
    order: () => dealChain,
    maybeSingle: async () =>
      opts.dealError
        ? { data: null, error: { message: 'boom' } }
        : { data: opts.deal, error: null },
  };

  const obsChain: Chain = {
    select: () => obsChain,
    eq: (col, val) => {
      calls.observationEqArgs.push([col, val]);
      return obsChain;
    },
    gte: (col, val) => {
      calls.observationGteArgs.push([col, val]);
      return obsChain;
    },
    order: () => {
      // order 가 체인의 종단 — 여기서 Promise 로 resolve.
      return {
        ...obsChain,
        // Thenable — await 시 호출.
        then: (resolve: (v: { data: unknown; error: unknown }) => unknown) =>
          resolve(
            opts.obsError
              ? { data: null, error: { message: 'boom' } }
              : { data: opts.observations, error: null },
          ),
      } as unknown as Chain;
    },
    maybeSingle: async () => ({ data: null, error: null }),
  };

  mockClient = {
    from(table: string) {
      if (table === 'deals') return dealChain;
      if (table === 'price_observations') return obsChain;
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

beforeEach(() => {
  setupMockClient({ deal: null, observations: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('aggregateObservations', () => {
  it('관측 0건 → points: []', () => {
    const out = aggregateObservations([]);
    expect(out).toEqual({ points: [], lowest: null, highest: null });
  });

  it('같은 날 여러 건이면 최저가로 집계', () => {
    const rows: PriceObservationRow[] = [
      { price_krw: 180000, observed_at: '2026-03-10T01:00:00Z' },
      { price_krw: 150000, observed_at: '2026-03-10T11:00:00Z' },
      { price_krw: 200000, observed_at: '2026-03-10T23:00:00Z' },
      { price_krw: 120000, observed_at: '2026-03-11T10:00:00Z' },
    ];
    const out = aggregateObservations(rows);
    expect(out.points).toEqual([
      { date: '2026-03-10', priceKrw: 150000 },
      { date: '2026-03-11', priceKrw: 120000 },
    ]);
    expect(out.lowest).toBe(120000);
    expect(out.highest).toBe(150000);
  });

  it('가격 NaN / 음수 / 0 은 무시', () => {
    const rows: PriceObservationRow[] = [
      { price_krw: Number.NaN, observed_at: '2026-03-10T01:00:00Z' },
      { price_krw: 0, observed_at: '2026-03-11T01:00:00Z' },
      { price_krw: -1, observed_at: '2026-03-12T01:00:00Z' },
      { price_krw: 100000, observed_at: '2026-03-13T01:00:00Z' },
    ];
    const out = aggregateObservations(rows);
    expect(out.points).toEqual([{ date: '2026-03-13', priceKrw: 100000 }]);
  });

  it('정렬된 순으로 반환', () => {
    const rows: PriceObservationRow[] = [
      { price_krw: 100, observed_at: '2026-03-15T00:00:00Z' },
      { price_krw: 200, observed_at: '2026-03-10T00:00:00Z' },
      { price_krw: 300, observed_at: '2026-03-20T00:00:00Z' },
    ];
    const out = aggregateObservations(rows);
    expect(out.points.map((p) => p.date)).toEqual([
      '2026-03-10',
      '2026-03-15',
      '2026-03-20',
    ]);
  });
});

describe('GET /api/price-trace/[id]', () => {
  const VALID_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  async function invoke(id: string): Promise<{ body: unknown; res: Response }> {
    // 정적 import 는 vi.mock 보다 뒤에 실행되지만, 모듈이 이미 로드된 상태에서
    // mockClient 를 교체해도 closure 경유로 최신 값이 참조된다.
    const mod = await import('./route');
    const res = await mod.GET(
      new Request(`http://localhost/api/price-trace/${id}`),
      { params: Promise.resolve({ id }) },
    );
    const body = await res.json();
    return { body, res };
  }

  it('uuid 형태 아닌 id → 빈 body', async () => {
    setupMockClient({ deal: null, observations: [] });
    const { body } = await invoke('not-a-uuid!');
    expect(body).toEqual({ points: [], lowest: null, highest: null });
  });

  it('deal 미존재 → 빈 body', async () => {
    setupMockClient({ deal: null, observations: [] });
    const { body } = await invoke(VALID_ID);
    expect(body).toEqual({ points: [], lowest: null, highest: null });
  });

  it('관측 0건 → 빈 body', async () => {
    setupMockClient({
      deal: { origin: 'ICN', destination: 'KIX', carrier_class: 'lcc' },
      observations: [],
    });
    const { body } = await invoke(VALID_ID);
    expect(body).toEqual({ points: [], lowest: null, highest: null });
  });

  it('deal 있고 관측 있으면 집계 + Cache-Control 헤더', async () => {
    setupMockClient({
      deal: { origin: 'ICN', destination: 'KIX', carrier_class: 'lcc' },
      observations: [
        { price_krw: 180000, observed_at: '2026-03-10T01:00:00Z' },
        { price_krw: 150000, observed_at: '2026-03-10T23:00:00Z' },
      ],
    });
    const { body, res } = await invoke(VALID_ID);
    const b = body as {
      points: Array<{ date: string; priceKrw: number }>;
      lowest: number | null;
      highest: number | null;
    };
    expect(b.points).toHaveLength(1);
    expect(b.points[0]).toEqual({ date: '2026-03-10', priceKrw: 150000 });
    expect(res.headers.get('Cache-Control')).toBe(
      's-maxage=300, stale-while-revalidate=1800',
    );
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  it('90일 경계 cutoff 이 쿼리에 주입', async () => {
    setupMockClient({
      deal: { origin: 'ICN', destination: 'KIX', carrier_class: 'lcc' },
      observations: [],
    });
    const before = Date.now();
    await invoke(VALID_ID);
    const after = Date.now();
    const gteArg = calls.observationGteArgs.find(
      ([col]) => col === 'observed_at',
    );
    expect(gteArg).toBeDefined();
    const cutoffIso = gteArg![1] as string;
    const cutoff = new Date(cutoffIso).getTime();
    // cutoff 는 '지금 - 90일' 이어야 함 (±1s 허용).
    const expectedMin = before - 90 * 24 * 60 * 60 * 1000;
    const expectedMax = after - 90 * 24 * 60 * 60 * 1000;
    expect(cutoff).toBeGreaterThanOrEqual(expectedMin - 1000);
    expect(cutoff).toBeLessThanOrEqual(expectedMax + 1000);
  });

  it('deal 의 (origin,destination,carrier_class) 로 필터', async () => {
    setupMockClient({
      deal: { origin: 'ICN', destination: 'NRT', carrier_class: 'fsc' },
      observations: [],
    });
    await invoke(VALID_ID);
    const eqMap = new Map(calls.observationEqArgs);
    expect(eqMap.get('origin')).toBe('ICN');
    expect(eqMap.get('destination')).toBe('NRT');
    expect(eqMap.get('carrier_class')).toBe('fsc');
  });

  it('deal 에러 → 빈 body', async () => {
    setupMockClient({
      deal: null,
      observations: [],
      dealError: true,
    });
    const { body } = await invoke(VALID_ID);
    expect(body).toEqual({ points: [], lowest: null, highest: null });
  });

  it('observation 에러 → 빈 body', async () => {
    setupMockClient({
      deal: { origin: 'ICN', destination: 'KIX', carrier_class: 'lcc' },
      observations: [],
      obsError: true,
    });
    const { body } = await invoke(VALID_ID);
    expect(body).toEqual({ points: [], lowest: null, highest: null });
  });
});
