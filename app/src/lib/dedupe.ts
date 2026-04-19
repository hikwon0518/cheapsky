// 중복 제거 키 — ADR-009.
// sha1(origin | destination | floor(price_krw/1000)*1000 | YYYY-MM | carrier_class)
// posted_at·정확 일자·시간 절대 포함 금지.

import { createHash } from 'node:crypto';

import type { CarrierClass } from '@/types/deal';

export function dedupeKey(params: {
  origin: string;
  destination: string;
  priceKrw: number;
  departYear: number;
  departMonth: number; // 1-12
  carrierClass: CarrierClass;
}): string {
  const { origin, destination, priceKrw, departYear, departMonth, carrierClass } =
    params;

  // 천 원 내림 — floor(price/1000)*1000. 음수 방어 겸사겸사.
  const priceBucket = Math.floor(Math.max(0, priceKrw) / 1000) * 1000;

  const mm = departMonth < 10 ? `0${departMonth}` : String(departMonth);
  const yearMonth = `${departYear}-${mm}`;

  const parts = [
    origin.trim().toUpperCase(),
    destination.trim().toUpperCase(),
    String(priceBucket),
    yearMonth,
    carrierClass,
  ];

  return createHash('sha1').update(parts.join('|')).digest('hex');
}
