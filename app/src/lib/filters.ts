// 필터 상태 파싱/직렬화 (ADR-007, ADR-020).
//
// 이 모듈은 **Server Component (`app/page.tsx`) 와 Client Component (`FilterBar.tsx`)
// 양쪽에서 사용**되므로 `server-only` 마커 / Supabase 의존 없이 순수 함수만 둔다.
// step 6 에서 추가될 `app/api/deals/route.ts` 도 이 모듈을 그대로 재사용.
//
// 5 필터 (ADR-020):
// - region       : 'all' | 'JP' | 'CN' | 'TW' | 'HK' | 'SEA' | 'US' | 'GU'
// - maxPrice     : '전체' 또는 원 단위 숫자 (예: 300000)
// - month        : 'all' 또는 'YYYY-MM'
// - minDiscount  : 0~100 숫자 (%). 0 = '전체'.
// - since        : '24h' | '7d' | '30d' | 'all'
//
// URL 은 `?region=JP&maxPrice=300000&month=2026-05&minDiscount=30&since=24h` 형태.

export type RegionCode = 'all' | 'JP' | 'CN' | 'TW' | 'HK' | 'SEA' | 'US' | 'GU';
export type SinceCode = '24h' | '7d' | '30d' | 'all';

export type Filters = {
  region: RegionCode;
  maxPrice: number | null; // null = 전체
  month: string | null; // 'YYYY-MM' 또는 null = 전체
  minDiscount: number; // 0 = 전체. 0~100.
  since: SinceCode;
};

/**
 * `app/page.tsx` 의 `searchParams` 또는 Client 의 `URLSearchParams` 양쪽에 대응.
 * Next.js 15 에선 Server Component searchParams 가 `Promise<{...}>` 이라
 * 호출자가 await 후 이 함수에 넘겨야 한다.
 */
export type SearchParamsInput =
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | null
  | undefined;

export const DEFAULT_FILTERS: Filters = {
  region: 'all',
  maxPrice: null,
  month: null,
  minDiscount: 0,
  since: 'all',
};

const VALID_REGIONS: ReadonlySet<RegionCode> = new Set([
  'all',
  'JP',
  'CN',
  'TW',
  'HK',
  'SEA',
  'US',
  'GU',
]);
const VALID_SINCE: ReadonlySet<SinceCode> = new Set(['24h', '7d', '30d', 'all']);

/**
 * 지역코드 → 데스티네이션 IATA 목록 (ADR-021 20개 노선 기준).
 */
export const REGION_TO_DESTINATIONS: Record<
  Exclude<RegionCode, 'all'>,
  readonly string[]
> = {
  JP: ['NRT', 'KIX', 'FUK', 'CTS', 'OKA', 'NGO'],
  CN: ['PVG'],
  TW: ['TPE'],
  HK: ['HKG'],
  SEA: ['BKK', 'DAD', 'SGN', 'SIN', 'KUL', 'MNL', 'CEB'],
  US: ['LAX', 'JFK', 'HNL'],
  GU: ['GUM'],
};

export const REGION_LABELS: Record<RegionCode, string> = {
  all: '전체',
  JP: '일본',
  CN: '중국',
  TW: '대만',
  HK: '홍콩',
  SEA: '동남아',
  US: '미국',
  GU: '괌',
};

export const SINCE_LABELS: Record<SinceCode, string> = {
  '24h': '24시간',
  '7d': '7일',
  '30d': '30일',
  all: '전체',
};

export const MAX_PRICE_OPTIONS: readonly { label: string; value: number | null }[] = [
  { label: '전체', value: null },
  { label: '20만원', value: 200000 },
  { label: '30만원', value: 300000 },
  { label: '50만원', value: 500000 },
  { label: '80만원', value: 800000 },
  { label: '120만원', value: 1200000 },
];

export const MIN_DISCOUNT_OPTIONS: readonly { label: string; value: number }[] = [
  { label: '전체', value: 0 },
  { label: '20%+', value: 20 },
  { label: '30%+', value: 30 },
  { label: '50%+', value: 50 },
];

function getStringParam(input: SearchParamsInput, key: string): string | null {
  if (!input) return null;
  if (input instanceof URLSearchParams) {
    const v = input.get(key);
    return v === null || v === '' ? null : v;
  }
  const raw = input[key];
  if (raw === undefined || raw === null || raw === '') return null;
  if (Array.isArray(raw)) {
    const first = raw[0];
    return first === undefined || first === '' ? null : first;
  }
  return raw;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function parseFilters(input: SearchParamsInput): Filters {
  const region = getStringParam(input, 'region');
  const maxPriceStr = getStringParam(input, 'maxPrice');
  const month = getStringParam(input, 'month');
  const minDiscountStr = getStringParam(input, 'minDiscount');
  const since = getStringParam(input, 'since');

  const maxPrice =
    maxPriceStr && /^\d{1,9}$/.test(maxPriceStr)
      ? Math.min(10_000_000, parseInt(maxPriceStr, 10))
      : null;

  let minDiscount = 0;
  if (minDiscountStr && /^\d{1,3}$/.test(minDiscountStr)) {
    const n = parseInt(minDiscountStr, 10);
    minDiscount = Math.max(0, Math.min(100, n));
  }

  return {
    region:
      region && VALID_REGIONS.has(region as RegionCode)
        ? (region as RegionCode)
        : 'all',
    maxPrice,
    month: month && MONTH_RE.test(month) ? month : null,
    minDiscount,
    since:
      since && VALID_SINCE.has(since as SinceCode)
        ? (since as SinceCode)
        : 'all',
  };
}

/**
 * 현재 필터가 기본값과 동일한지. `초기화` 버튼 활성화 여부 판단용.
 */
export function isDefaultFilters(f: Filters): boolean {
  return (
    f.region === 'all' &&
    f.maxPrice === null &&
    f.month === null &&
    f.minDiscount === 0 &&
    f.since === 'all'
  );
}

/**
 * Filters → URLSearchParams. 기본값인 키는 생략해 URL 이 짧게 유지되도록 한다.
 * `t=<shareToken>` 등 외부 키는 호출자가 별도 주입.
 */
export function serializeFilters(f: Filters): URLSearchParams {
  const params = new URLSearchParams();
  if (f.region !== 'all') params.set('region', f.region);
  if (f.maxPrice !== null) params.set('maxPrice', String(f.maxPrice));
  if (f.month) params.set('month', f.month);
  if (f.minDiscount > 0) params.set('minDiscount', String(f.minDiscount));
  if (f.since !== 'all') params.set('since', f.since);
  return params;
}

/**
 * `since` 필터 → "이 시각 이후만" UTC Date. 'all' → null.
 */
export function sinceCutoff(filter: SinceCode, now: Date = new Date()): Date | null {
  if (filter === 'all') return null;
  const map: Record<Exclude<SinceCode, 'all'>, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };
  return new Date(now.getTime() - map[filter]);
}

/**
 * 'YYYY-MM' → { year, monthStartUtc, monthEndUtc } (KST 월경계 → UTC).
 * Depart_from 이 해당 월 이내에 걸치면 매치.
 */
export function monthWindow(
  month: string,
): { startUtc: Date; endUtc: Date } | null {
  if (!MONTH_RE.test(month)) return null;
  const [yStr, mStr] = month.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  // KST 월 1일 00:00 == UTC 전월 말일 15:00.
  const startUtc = new Date(Date.UTC(y, m - 1, 1, -9, 0, 0, 0));
  const endUtc = new Date(Date.UTC(y, m, 1, -9, 0, 0, 0)); // 다음 달 KST 1일
  return { startUtc, endUtc };
}
