// 제목 파싱 보조 — 한글 도시명 / 영문 코드 → IATA 정규화.
// ADR-017: GMP 는 ICN 으로 병합하지 않음 (MVP 제외).

import { isKnownAirport, toRepresentative } from '@/lib/airport-aliases';

/**
 * 한글(또는 영문 소문자) 도시명 → IATA 코드.
 * 파싱 시 정확 일치하면 즉시 매핑, 후단에 toRepresentative 로 대표 공항 병합.
 */
export const DESTINATION_ALIASES: Record<string, string> = {
  // 일본
  도쿄: 'NRT',
  동경: 'NRT',
  TOKYO: 'NRT',
  오사카: 'KIX',
  OSAKA: 'KIX',
  후쿠오카: 'FUK',
  하카타: 'FUK',
  FUKUOKA: 'FUK',
  삿포로: 'CTS',
  SAPPORO: 'CTS',
  치토세: 'CTS',
  오키나와: 'OKA',
  OKINAWA: 'OKA',
  나하: 'OKA',
  나고야: 'NGO',
  NAGOYA: 'NGO',
  // 중화권
  타이베이: 'TPE',
  타이페이: 'TPE',
  TAIPEI: 'TPE',
  대만: 'TPE',
  홍콩: 'HKG',
  HONGKONG: 'HKG',
  상하이: 'PVG',
  SHANGHAI: 'PVG',
  // 동남아
  방콕: 'BKK',
  BANGKOK: 'BKK',
  다낭: 'DAD',
  DANANG: 'DAD',
  호치민: 'SGN',
  사이공: 'SGN',
  HOCHIMINH: 'SGN',
  싱가포르: 'SIN',
  SINGAPORE: 'SIN',
  쿠알라룸푸르: 'KUL',
  KL: 'KUL',
  KUALALUMPUR: 'KUL',
  마닐라: 'MNL',
  MANILA: 'MNL',
  세부: 'CEB',
  CEBU: 'CEB',
  괌: 'GUM',
  GUAM: 'GUM',
  // 미국
  LA: 'LAX',
  엘에이: 'LAX',
  로스앤젤레스: 'LAX',
  LOSANGELES: 'LAX',
  뉴욕: 'JFK',
  NEWYORK: 'JFK',
  NY: 'JFK',
  하와이: 'HNL',
  호놀룰루: 'HNL',
  HAWAII: 'HNL',
  HONOLULU: 'HNL',
};

export const ORIGIN_ALIASES: Record<string, string> = {
  인천: 'ICN',
  INCHEON: 'ICN',
  서울: 'ICN',
  SEOUL: 'ICN',
  // 김포는 ICN 으로 병합하지 않음 (ADR-017, MVP 제외).
  김포: 'GMP',
  GIMPO: 'GMP',
};

/**
 * Normalize a raw origin/destination pair (may come as IATA code or city name)
 * to representative IATA codes.
 * Returns `null` for tokens we can't resolve, so callers can fail-soft-drop
 * the row during UPSERT (per CLAUDE.md fail-soft parsing rule).
 */
export function normalizeRoute(
  rawOrigin?: string | null,
  rawDest?: string | null,
): { origin: string | null; destination: string | null } {
  return {
    origin: resolveOne(rawOrigin, ORIGIN_ALIASES, /* isDestination */ false),
    destination: resolveOne(rawDest, DESTINATION_ALIASES, true),
  };
}

function resolveOne(
  raw: string | null | undefined,
  aliases: Record<string, string>,
  isDestination: boolean,
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1) 별명 사전: 한글/영문(대소문자 무시)
  const key = trimmed.toUpperCase();
  if (aliases[trimmed]) return applyRepresentative(aliases[trimmed], isDestination);
  if (aliases[key]) return applyRepresentative(aliases[key], isDestination);

  // 2) 3글자 IATA 직접 입력
  if (key.length === 3 && /^[A-Z]{3}$/.test(key) && isKnownAirport(key)) {
    return applyRepresentative(key, isDestination);
  }

  return null;
}

function applyRepresentative(iata: string, isDestination: boolean): string {
  // ORIGIN 축에서는 GMP 를 ICN 으로 병합하지 않는다 (ADR-017 MVP 제외).
  if (!isDestination && iata === 'GMP') return 'GMP';
  return toRepresentative(iata);
}
