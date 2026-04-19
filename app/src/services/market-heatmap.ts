// 시세 히트맵 데이터 빌더 (Stretch 2, ADR-023 / ADR-011 / ADR-021).
//
// 책임:
//   - 인천 출발 20개 노선 × FSC/LCC/mixed 중 각 노선의 대표 엔트리 1개 선택
//   - 우선순위:
//     1) FSC, LCC 둘 다 observed (count ≥ 30) → 두 클래스 관측을 min 으로 병합
//        (heatmap 셀은 "참고 시세" 이므로 가장 싼 쪽의 분위수가 정직)
//     2) 단일 observed (FSC 또는 LCC) 또는 mixed(관측+시드 혼합) → 그대로 사용
//        (둘 다 있으면 observation 수가 많은 쪽)
//     3) seed FSC/LCC match (confidence: medium) → FSC 우선 → LCC
//     4) seed mixed only (confidence: low, 🔥 미부여) → mixed
//     5) 어떤 baseline 도 없음 → 전 필드 null
//
// Hard red lines:
//   - ADR-022 Deprecated: 'amadeus'/'api' 분기 금지. resolveBaseline 만 호출.
//   - 노선 목록은 ADR-021 의 20 노선 고정. 외부 입력 금지.
//   - origin 은 ICN 고정 (ADR-021).

import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveBaseline, type ResolvedBaseline } from '@/services/baseline';
import type { CarrierClass } from '@/types/deal';

/**
 * ADR-021 인천 출발 20 노선 (히트맵 5×4 그리드 순서).
 * 일본 → 중화권 → 동남아 → 괌 → 미국 순.
 */
export const HEATMAP_DESTINATIONS = [
  // 일본 6
  'NRT', 'KIX', 'FUK', 'CTS', 'OKA', 'NGO',
  // 중화권 3
  'TPE', 'HKG', 'PVG',
  // 동남아 7
  'BKK', 'DAD', 'SGN', 'SIN', 'KUL', 'MNL', 'CEB',
  // 괌 1
  'GUM',
  // 미국 3
  'LAX', 'JFK', 'HNL',
] as const;

export const HEATMAP_ORIGIN = 'ICN' as const;

export type MarketRow = {
  origin: typeof HEATMAP_ORIGIN;
  destination: string;
  carrierClass: CarrierClass;
  p10Krw: number | null;
  p50Krw: number | null;
  p90Krw: number | null;
  cheapestTodayKrw: number | null;
  cheapestTodayCarrier: string | null;
  source: 'seed' | 'observed' | 'mixed' | null;
  confidence: 'low' | 'medium' | 'high' | null;
  observationCount: number;
};

function pickMin(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/**
 * Pure selection: given the three resolveBaseline outputs for a route,
 * pick the representative MarketRow.
 *
 * 분리 이유: DB 호출 없이 단위 테스트 가능 (mock resolveBaseline 결과만 주입).
 */
export function selectRepresentative(
  destination: string,
  fsc: ResolvedBaseline,
  lcc: ResolvedBaseline,
  mixed: ResolvedBaseline,
): MarketRow {
  const isObserved = (b: ResolvedBaseline) =>
    b.source === 'observed' || b.source === 'mixed';

  // 1) FSC + LCC 둘 다 observed → 병합 (min). carrierClass='mixed', source='mixed' (혼합 의미).
  if (isObserved(fsc) && isObserved(lcc)) {
    const observationCount = fsc.observationCount + lcc.observationCount;
    return {
      origin: HEATMAP_ORIGIN,
      destination,
      carrierClass: 'mixed',
      p10Krw: pickMin(fsc.p10Krw, lcc.p10Krw),
      p50Krw: pickMin(fsc.p50Krw, lcc.p50Krw),
      p90Krw: pickMin(fsc.p90Krw, lcc.p90Krw),
      cheapestTodayKrw: pickMin(fsc.p10Krw, lcc.p10Krw),
      cheapestTodayCarrier: null,
      source: 'mixed',
      confidence:
        fsc.confidence === 'high' && lcc.confidence === 'high' ? 'high' : 'medium',
      observationCount,
    };
  }

  // 2) 단일 observed (또는 mixed). 관측 많은 쪽 우선.
  if (isObserved(lcc) || isObserved(fsc)) {
    const pick =
      isObserved(lcc) && isObserved(fsc)
        ? lcc.observationCount >= fsc.observationCount
          ? { row: lcc, klass: 'lcc' as CarrierClass }
          : { row: fsc, klass: 'fsc' as CarrierClass }
        : isObserved(lcc)
          ? { row: lcc, klass: 'lcc' as CarrierClass }
          : { row: fsc, klass: 'fsc' as CarrierClass };
    return baselineToRow(destination, pick.klass, pick.row);
  }

  // 3) seed FSC / LCC match (medium). FSC 우선.
  if (fsc.source === 'seed' && fsc.confidence === 'medium') {
    return baselineToRow(destination, 'fsc', fsc);
  }
  if (lcc.source === 'seed' && lcc.confidence === 'medium') {
    return baselineToRow(destination, 'lcc', lcc);
  }

  // 4) seed mixed only (confidence: low). 🔥 미부여.
  if (mixed.source === 'seed') {
    return baselineToRow(destination, 'mixed', mixed);
  }
  // 일부 fsc/lcc 결과가 seed mixed 로 폴백된 경우(seed mixed 가 carrier_class 매치 안 될 때 4순위로 내려간 결과).
  if (fsc.source === 'seed' && fsc.confidence === 'low') {
    return baselineToRow(destination, 'mixed', fsc);
  }
  if (lcc.source === 'seed' && lcc.confidence === 'low') {
    return baselineToRow(destination, 'mixed', lcc);
  }

  // 5) null
  return {
    origin: HEATMAP_ORIGIN,
    destination,
    carrierClass: 'mixed',
    p10Krw: null,
    p50Krw: null,
    p90Krw: null,
    cheapestTodayKrw: null,
    cheapestTodayCarrier: null,
    source: null,
    confidence: null,
    observationCount: 0,
  };
}

function baselineToRow(
  destination: string,
  carrierClass: CarrierClass,
  b: ResolvedBaseline,
): MarketRow {
  return {
    origin: HEATMAP_ORIGIN,
    destination,
    carrierClass,
    p10Krw: b.p10Krw,
    p50Krw: b.p50Krw,
    p90Krw: b.p90Krw,
    cheapestTodayKrw: b.p10Krw,
    cheapestTodayCarrier: null,
    source: b.source,
    confidence: b.confidence,
    observationCount: b.observationCount,
  };
}

/**
 * 20 노선 × FSC/LCC/mixed 동시 조회 후 selectRepresentative 적용.
 * 하나의 RouteMarketRow 가 노선 셀 1개에 대응.
 */
export async function buildMarketHeatmap(params: {
  client: SupabaseClient;
  now?: Date;
}): Promise<MarketRow[]> {
  const { client, now } = params;
  const rows: MarketRow[] = [];

  for (const destination of HEATMAP_DESTINATIONS) {
    const [fsc, lcc, mixed] = await Promise.all([
      resolveBaseline({
        origin: HEATMAP_ORIGIN,
        destination,
        carrierClass: 'fsc',
        client,
        now,
      }).catch(emptyResolved),
      resolveBaseline({
        origin: HEATMAP_ORIGIN,
        destination,
        carrierClass: 'lcc',
        client,
        now,
      }).catch(emptyResolved),
      resolveBaseline({
        origin: HEATMAP_ORIGIN,
        destination,
        carrierClass: 'mixed',
        client,
        now,
      }).catch(emptyResolved),
    ]);

    rows.push(selectRepresentative(destination, fsc, lcc, mixed));
  }

  return rows;
}

function emptyResolved(): ResolvedBaseline {
  return {
    p10Krw: null,
    p50Krw: null,
    p90Krw: null,
    source: null,
    confidence: null,
    observationCount: 0,
  };
}
