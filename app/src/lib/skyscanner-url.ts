// Skyscanner 검색 URL 생성 (ADR-027).
// 크롤링 아님 — 공개된 URL 패턴에 IATA·날짜를 채워서 새 탭 이동.
// 날짜 기준: KST. departFrom null → 오늘 + 7일.

import { kstStartOfDay, toKstDateOnly } from '@/lib/tz';

const BASE = 'https://www.skyscanner.co.kr/transport/flights';

export function buildSkyscannerSearchUrl(params: {
  origin: string;
  destination: string;
  departFrom?: Date | null;
  now?: Date; // 테스트 훅
}): string {
  const origin = (params.origin ?? '').trim().toUpperCase();
  const destination = (params.destination ?? '').trim().toUpperCase();
  const ref = params.now ?? new Date();

  const target = params.departFrom ?? addKstDays(ref, 7);
  const yymmdd = toYymmddKst(target);

  return `${BASE}/${origin}/${destination}/${yymmdd}/`;
}

/**
 * Returns a UTC Date that corresponds to KST midnight of (now + deltaDays).
 */
function addKstDays(d: Date, deltaDays: number): Date {
  const kstMidnight = kstStartOfDay(d);
  // KST 자정 기준에서 하루 == 24h (DST 없음).
  return new Date(kstMidnight.getTime() + deltaDays * 24 * 60 * 60 * 1000);
}

/**
 * Convert a Date to YYMMDD string using the KST calendar date.
 */
function toYymmddKst(d: Date): string {
  const iso = toKstDateOnly(d); // 'YYYY-MM-DD' (KST)
  const [yyyy, mm, dd] = iso.split('-');
  return `${yyyy.slice(-2)}${mm}${dd}`;
}
