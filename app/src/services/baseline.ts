// Baseline 해석 서비스 — ADR-011 우선순위 5단계 구현.
//
// Hard red lines:
// - ADR-022 Deprecated: `source === 'api'` 또는 `'amadeus'` 분기 금지.
// - 관측 분위수는 client 측(JS) 에서 linear interpolation 으로 산출 (옵션 B).
// - 관측 ≥ 30 건 → observed 단독 (confidence: 'high')
// - 10~29 건 → observed·seed 혼합 0.6·0.4 (confidence: 'medium', source: 'mixed')
// - 관측 < 10, 시드 FSC/LCC 매치 → seed 단독 (confidence: 'medium')
// - 시드 mixed 만 존재 → confidence: 'low' (caller 가 🔥 미부여)
// - 아무것도 없음 → 전 필드 null
//
// 이 파일은 `scripts/crawl.ts` (service client) 와 앱 서버 컴포넌트(anon client) 양쪽에서
// 호출 가능해야 해서 `client` 를 주입받는 구조. `db.ts` 의 `getServiceClient()` 는
// `server-only` 마커 때문에 테스트·배치 양쪽에서 명시 주입이 더 깔끔함.

import type { SupabaseClient } from '@supabase/supabase-js';

import type { CarrierClass } from '@/types/deal';

/**
 * 30일 관측 윈도우. ADR-011 재집계 윈도우와 동일.
 */
export const OBSERVATION_WINDOW_DAYS = 30;

/** 관측 단독으로 전환되는 임계치 (30 건 이상). */
export const OBSERVED_SOLO_THRESHOLD = 30;

/** 혼합 판정 하한 (10 건 이상). 이 미만은 시드 폴백. */
export const MIXED_THRESHOLD = 10;

/** 혼합 가중치: 관측 0.6, 시드 0.4 (ADR-011 2순위). */
const WEIGHT_OBSERVED = 0.6;
const WEIGHT_SEED = 0.4;

export type ResolvedBaseline = {
  p10Krw: number | null;
  p50Krw: number | null;
  p90Krw: number | null;
  /** 'observed' = 관측 단독, 'seed' = 시드 단독, 'mixed' = 관측·시드 혼합. null = baseline 없음. */
  source: 'observed' | 'seed' | 'mixed' | null;
  confidence: 'low' | 'medium' | 'high' | null;
  observationCount: number;
};

/**
 * 오름차순 정렬된 숫자 배열에서 분위수 (0~1) 값을 linear interpolation.
 * 샘플이 0 이면 null, 1 이면 해당 값 반환.
 */
export function percentileLinear(
  sortedAsc: readonly number[],
  q: number,
): number | null {
  if (sortedAsc.length === 0) return null;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const clamped = Math.min(1, Math.max(0, q));
  const idx = clamped * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const frac = idx - lo;
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}

/**
 * 관측 가격 배열에서 p10/p50/p90 산출. 샘플이 하나도 없으면 전 null.
 */
export function observedQuantiles(
  pricesKrw: readonly number[],
): { p10: number | null; p50: number | null; p90: number | null } {
  const sorted = [...pricesKrw].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  return {
    p10: percentileLinear(sorted, 0.1),
    p50: percentileLinear(sorted, 0.5),
    p90: percentileLinear(sorted, 0.9),
  };
}

/**
 * 시드 + 관측 분위수 가중 혼합 (ADR-011 2순위).
 * 어느 한쪽이 null 이면 없는 쪽을 0 가중으로 강등해 다른 한쪽 단독 반환.
 */
function mixQuantile(
  observed: number | null,
  seed: number | null,
): number | null {
  if (observed === null && seed === null) return null;
  if (observed === null) return seed;
  if (seed === null) return observed;
  return observed * WEIGHT_OBSERVED + seed * WEIGHT_SEED;
}

type SeedRow = {
  p10_krw: number | null;
  p50_krw: number | null;
  p90_krw: number | null;
  carrier_class: CarrierClass;
};

/**
 * ADR-011 우선순위 해석기. 외부에서 SupabaseClient 주입 가능 (테스트 / 배치).
 *
 * 주의: 이 구현은 `source === 'api'` 또는 `'amadeus'` 분기를 쓰지 않는다.
 * (ADR-022 Deprecated — 해당 값이 스키마에 존재하지 않음.)
 */
export async function resolveBaseline(params: {
  origin: string;
  destination: string;
  carrierClass: CarrierClass;
  now?: Date;
  client: SupabaseClient;
}): Promise<ResolvedBaseline> {
  const { origin, destination, carrierClass, client } = params;
  const now = params.now ?? new Date();

  const windowStart = new Date(
    now.getTime() - OBSERVATION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  // 1) 30일 관측 가격 조회 (carrier_class 매치)
  const obsRes = await client
    .from('price_observations')
    .select('price_krw')
    .eq('origin', origin)
    .eq('destination', destination)
    .eq('carrier_class', carrierClass)
    .gte('observed_at', windowStart.toISOString());

  if (obsRes.error) {
    throw new Error(
      `[baseline] price_observations select failed: ${obsRes.error.message}`,
    );
  }

  const observedPrices = (obsRes.data ?? []).map((r: { price_krw: number }) =>
    Number(r.price_krw),
  );
  const observationCount = observedPrices.length;

  // 2) 시드 조회 (carrier_class 매치 + mixed 폴백 양쪽 모두 준비)
  //    ADR-022: source 필터는 'seed' 고정. 'api' 금지.
  const seedRes = await client
    .from('route_market_data')
    .select('p10_krw, p50_krw, p90_krw, carrier_class')
    .eq('origin', origin)
    .eq('destination', destination)
    .eq('source', 'seed')
    .in('carrier_class', ['fsc', 'lcc', 'mixed']);

  if (seedRes.error) {
    throw new Error(
      `[baseline] route_market_data select failed: ${seedRes.error.message}`,
    );
  }

  const seedRows = (seedRes.data ?? []) as SeedRow[];
  const seedMatch = seedRows.find((r) => r.carrier_class === carrierClass) ?? null;
  const seedMixed = seedRows.find((r) => r.carrier_class === 'mixed') ?? null;

  // 1순위: 관측 ≥ 30 건
  if (observationCount >= OBSERVED_SOLO_THRESHOLD) {
    const { p10, p50, p90 } = observedQuantiles(observedPrices);
    return {
      p10Krw: roundOrNull(p10),
      p50Krw: roundOrNull(p50),
      p90Krw: roundOrNull(p90),
      source: 'observed',
      confidence: 'high',
      observationCount,
    };
  }

  // 2순위: 10~29 건 + 시드 매치 존재 → 혼합
  if (
    observationCount >= MIXED_THRESHOLD &&
    observationCount < OBSERVED_SOLO_THRESHOLD &&
    seedMatch
  ) {
    const { p10, p50, p90 } = observedQuantiles(observedPrices);
    return {
      p10Krw: roundOrNull(mixQuantile(p10, seedMatch.p10_krw)),
      p50Krw: roundOrNull(mixQuantile(p50, seedMatch.p50_krw)),
      p90Krw: roundOrNull(mixQuantile(p90, seedMatch.p90_krw)),
      source: 'mixed',
      confidence: 'medium',
      observationCount,
    };
  }

  // 2순위-b: 10~29 건인데 carrier_class 매치 시드가 없으면 — 관측이 부족하고 시드도 없음.
  //  ADR-011 엄격 해석상 이 경우 아직 confident 하지 않으므로 3순위로 내려감.

  // 3순위: 관측 < 10 건 + 시드 FSC/LCC 매치 존재 → 시드 단독 (medium)
  if (seedMatch && (seedMatch.carrier_class === 'fsc' || seedMatch.carrier_class === 'lcc')) {
    return {
      p10Krw: seedMatch.p10_krw,
      p50Krw: seedMatch.p50_krw,
      p90Krw: seedMatch.p90_krw,
      source: 'seed',
      confidence: 'medium',
      observationCount,
    };
  }

  // 4순위: 시드 mixed 만 존재 → low (🔥 미부여)
  //   (carrier_class 매치는 없지만 mixed 엔트리가 있는 경우 전부 포함,
  //    요청 carrierClass 가 mixed 이고 seedMatch=mixed 인 경우도 동일하게 low 처리)
  if (seedMixed) {
    return {
      p10Krw: seedMixed.p10_krw,
      p50Krw: seedMixed.p50_krw,
      p90Krw: seedMixed.p90_krw,
      source: 'seed',
      confidence: 'low',
      observationCount,
    };
  }

  // 5순위: 어떤 baseline 도 없음
  return {
    p10Krw: null,
    p50Krw: null,
    p90Krw: null,
    source: null,
    confidence: null,
    observationCount,
  };
}

function roundOrNull(v: number | null): number | null {
  if (v === null) return null;
  if (!Number.isFinite(v)) return null;
  return Math.round(v);
}
