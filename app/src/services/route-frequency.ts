// 노선 빈도 집계 (Stretch 2, UI_GUIDE "노선 빈도 (RouteFrequency)").
//
// 한 카드에 "이 노선 30일 3번째 등장" 같은 마이크로 지표를 붙이기 위한 단순 집계.
//
// Hard red lines:
// - list 카드마다 개별 쿼리 금지 (N+1 회피) — `batchRouteFrequency` 가 O(1) DB hit.
// - 30일 경계 외 데이터 포함 금지 (정의 일관성).
// - 카드 렌더 실패가 페이지 전체를 깨면 안 됨 — 쿼리 실패 시 fail-soft (빈 Map).

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Deal } from '@/types/deal';

export type FrequencyInfo = {
  /** 같은 (origin, destination) 노선에서 최근 30일 등장 건수 */
  count30d: number;
  /** 이 딜이 해당 노선·30일 윈도우에서 posted_at 오름차순 기준 몇 번째인지 (1-indexed). 윈도우 밖이면 0. */
  ordinal: number;
};

/** 30일 관측 윈도우. ADR-011 재집계 윈도우와 동일. */
export const FREQUENCY_WINDOW_DAYS = 30;

type FrequencyRow = {
  id: string;
  origin: string;
  destination: string;
  posted_at: string;
};

/**
 * list 전체 (최대 50건) 를 위한 **단일 쿼리** 배치 집계.
 *
 * 구현 요점:
 *   - origin/destination 각각 `IN (…)` 필터 + 30일 `posted_at` gte. 한 번의 DB 호출.
 *   - 쿼리 결과를 JS 에서 `(origin, destination)` 로 그룹핑 후 posted_at 오름차순 정렬,
 *     각 딜의 ordinal 계산.
 *   - dedupe 를 거치면 이미 동일 노선+월 엔트리가 합쳐져 있으므로 이 쿼리로 셀 건수는 O(노선 × 1~수건).
 *
 * 쿼리 실패·환경변수 부재 시 fail-soft 로 빈 Map 반환 — 페이지 렌더는 계속.
 */
export async function batchRouteFrequency(
  deals: ReadonlyArray<Pick<Deal, 'id' | 'origin' | 'destination' | 'postedAt'>>,
  client: SupabaseClient,
  now: Date = new Date(),
): Promise<Map<string, FrequencyInfo>> {
  const out = new Map<string, FrequencyInfo>();
  if (deals.length === 0) return out;

  const cutoff = new Date(
    now.getTime() - FREQUENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  const origins = Array.from(new Set(deals.map((d) => d.origin)));
  const destinations = Array.from(new Set(deals.map((d) => d.destination)));
  const wantedPairs = new Set(
    deals.map((d) => `${d.origin}|${d.destination}`),
  );

  let rows: FrequencyRow[] = [];
  try {
    const res = await client
      .from('deals')
      .select('id, origin, destination, posted_at')
      .in('origin', origins)
      .in('destination', destinations)
      .gte('posted_at', cutoff.toISOString())
      .order('posted_at', { ascending: true });

    if (res.error || !res.data) return out;
    rows = res.data as FrequencyRow[];
  } catch {
    return out;
  }

  // 노선별 오름차순 (쿼리에서 이미 정렬됨, pair 필터만 추가).
  const byRoute = new Map<string, { id: string }[]>();
  for (const row of rows) {
    const key = `${row.origin}|${row.destination}`;
    if (!wantedPairs.has(key)) continue;
    const list = byRoute.get(key);
    if (list) list.push({ id: row.id });
    else byRoute.set(key, [{ id: row.id }]);
  }

  for (const deal of deals) {
    const key = `${deal.origin}|${deal.destination}`;
    const routeDeals = byRoute.get(key) ?? [];
    const count30d = routeDeals.length;
    const idx = routeDeals.findIndex((r) => r.id === deal.id);
    const ordinal = idx >= 0 ? idx + 1 : 0;
    out.set(deal.id, { count30d, ordinal });
  }

  return out;
}

/**
 * 단일 딜용 편의 래퍼. 한 장의 카드만 개별 조회할 일은 없으므로 테스트·디버그 한정.
 * 내부적으로 `batchRouteFrequency` 를 재사용 → 동일한 정의를 쓴다.
 */
export async function getRouteFrequency(params: {
  dealId: string;
  origin: string;
  destination: string;
  postedAt: Date;
  client: SupabaseClient;
  now?: Date;
}): Promise<FrequencyInfo> {
  const { dealId, origin, destination, postedAt, client, now } = params;
  const map = await batchRouteFrequency(
    [{ id: dealId, origin, destination, postedAt }],
    client,
    now ?? new Date(),
  );
  return map.get(dealId) ?? { count30d: 0, ordinal: 0 };
}
