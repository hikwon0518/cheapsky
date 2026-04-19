// FilterBar Preset 칩 정의 (Cheapsky Light v5 포팅).
// 사용자의 첫 방문 학습 비용 완화용 퀵 필터. 여러 필터 값을 한 번에 URL 에 set.
//
// 규칙:
// - 프리셋은 DEFAULT_FILTERS 에서 출발해 몇 필드만 덮어씀 (다른 필드는 기본값 유지)
// - activeIn(filters, preset) 이 true 면 해당 preset 이 현재 활성 상태 ([data-on="true"])

import {
  DEFAULT_FILTERS,
  type Filters,
  type RegionCode,
  type SinceCode,
} from '@/lib/filters';

export type PresetDef = {
  id: string;
  label: string;
  /** chip 앞의 flag/이모지 아이콘 (optional) */
  prefix?: string;
  /** DEFAULT_FILTERS 대비 덮어쓸 필드들. 나머지는 기본값 유지 */
  set: Partial<Filters>;
};

/**
 * 현재 달 기준으로 "다음 여름 7월" 를 YYYY-MM 문자열로 반환.
 * 이미 7월이 지났으면 내년 7월.
 */
function nextSummerMonth(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = now.getMonth() + 1; // 1-12
  const summerYear = m > 7 ? y + 1 : y;
  return `${summerYear}-07`;
}

export function getPresets(now: Date = new Date()): readonly PresetDef[] {
  return [
    {
      id: 'jp-under-300k',
      label: '일본 30만 이하',
      prefix: '🇯🇵',
      set: { region: 'JP' as RegionCode, maxPrice: 300_000 },
    },
    {
      id: 'big-discount',
      label: '큰 폭 할인만',
      prefix: '🔥',
      set: { minDiscount: 30 },
    },
    {
      id: 'summer',
      label: '여름휴가 7–8월',
      set: { month: nextSummerMonth(now) },
    },
    {
      id: 'fresh-24h',
      label: '오늘 올라온 딜',
      set: { since: '24h' as SinceCode },
    },
    {
      id: 'us-under-1m',
      label: '미국 100만 이하',
      prefix: '🇺🇸',
      set: { region: 'US' as RegionCode, maxPrice: 1_000_000 },
    },
    {
      id: 'sea',
      label: '동남아',
      set: { region: 'SEA' as RegionCode },
    },
  ];
}

/**
 * 현재 filters 가 preset 과 일치하는지.
 * preset.set 에 있는 필드는 전부 일치해야 하고, 없는 필드는 DEFAULT 값이어야 "깔끔히 active".
 * 완화된 버전: preset.set 필드만 일치하면 active (다른 필드가 기본값 아니어도 OK).
 */
export function presetActive(filters: Filters, preset: PresetDef): boolean {
  for (const [key, expected] of Object.entries(preset.set)) {
    const actual = (filters as Record<string, unknown>)[key];
    if (actual !== expected) return false;
  }
  return true;
}

/**
 * 클릭 시 적용할 다음 filters.
 * 이미 active 면 토글 해제 (DEFAULT 로). 아니면 DEFAULT 에 preset.set 덮어씀.
 */
export function applyPreset(filters: Filters, preset: PresetDef): Filters {
  if (presetActive(filters, preset)) {
    return DEFAULT_FILTERS;
  }
  return { ...DEFAULT_FILTERS, ...preset.set } as Filters;
}

const FILTER_PARAM_KEYS = [
  'region',
  'maxPrice',
  'month',
  'minDiscount',
  'since',
] as const;

/**
 * Preset 클릭 href 계산. `<Link>` 로 즉시 네비게이션하기 위함.
 * - 이미 active → 필터 param 제거 (나머지 쿼리는 보존)
 * - 비활성 → preset.set 을 URL param 으로 변환 + 비-filter 쿼리 보존
 */
export function presetHref(
  current: Filters,
  preset: PresetDef,
  searchParams: URLSearchParams | null | undefined,
): string {
  const next = applyPreset(current, preset);
  const params = new URLSearchParams();
  if (next.region !== 'all') params.set('region', next.region);
  if (next.maxPrice !== null) params.set('maxPrice', String(next.maxPrice));
  if (next.month) params.set('month', next.month);
  if (next.minDiscount > 0) params.set('minDiscount', String(next.minDiscount));
  if (next.since !== 'all') params.set('since', next.since);

  if (searchParams) {
    for (const [k, v] of searchParams.entries()) {
      if (!(FILTER_PARAM_KEYS as readonly string[]).includes(k)) {
        params.append(k, v);
      }
    }
  }

  const qs = params.toString();
  return qs ? `/?${qs}` : '/';
}
