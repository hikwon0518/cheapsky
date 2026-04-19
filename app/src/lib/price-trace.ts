// 가격 추이 집계 (API /api/price-trace/[id] 용 순수 로직).
//
// 같은 (origin, destination, carrier_class) 의 90일 관측 행들을
// 일자별 최저가 → 정렬된 points 로 집계한다.
// route.ts 가 이 모듈을 import. 테스트 용이성·Next.js 15 route 모듈 export 제약
// (route.ts 에서 GET 외 export 불가) 때문에 분리.

export type PriceTracePoint = { date: string; priceKrw: number };

export type PriceTraceBody = {
  points: PriceTracePoint[];
  lowest: number | null;
  highest: number | null;
};

export type PriceObservationRow = {
  price_krw: number;
  observed_at: string;
};

// 'YYYY-MM-DD' (UTC). 일자 해상도는 UTC 로 잘라도 시연 시 KST 와 ±9h 차이만
// 발생하는데, 스파크라인은 90일 추세라 시각적 차이가 없다.
function toUtcDateString(iso: string): string | null {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function aggregateObservations(
  rows: readonly PriceObservationRow[],
): PriceTraceBody {
  const minByDate = new Map<string, number>();
  for (const row of rows) {
    const date = toUtcDateString(row.observed_at);
    if (!date) continue;
    const price = row.price_krw;
    if (!Number.isFinite(price) || price <= 0) continue;
    const prev = minByDate.get(date);
    if (prev === undefined || price < prev) {
      minByDate.set(date, price);
    }
  }

  const points: PriceTracePoint[] = Array.from(minByDate.entries())
    .map(([date, priceKrw]) => ({ date, priceKrw }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (points.length === 0) return { points: [], lowest: null, highest: null };

  let lowest = points[0].priceKrw;
  let highest = points[0].priceKrw;
  for (const p of points) {
    if (p.priceKrw < lowest) lowest = p.priceKrw;
    if (p.priceKrw > highest) highest = p.priceKrw;
  }
  return { points, lowest, highest };
}
