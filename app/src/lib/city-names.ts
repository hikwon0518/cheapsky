// 공항 IATA → 한국어 도시명 매핑.
// UI humanization (Cheapsky Light v5 디자인 포팅): 카드·배너에서 `ICN → FUK` 옆에
// `후쿠오카` 같은 도시명을 함께 보이게 하려고 도입.
//
// 20 노선 고정 (ADR-021). airport-aliases.ts 의 역방향이 아닌 "사람이 부르는 이름".

export const CITY_NAMES: Readonly<Record<string, string>> = {
  ICN: '인천',
  GMP: '김포',
  // 일본 (ADR-021)
  NRT: '도쿄',
  HND: '도쿄',
  KIX: '오사카',
  FUK: '후쿠오카',
  CTS: '삿포로',
  OKA: '오키나와',
  NGO: '나고야',
  // 동남아
  BKK: '방콕',
  DMK: '방콕',
  SGN: '호찌민',
  HAN: '하노이',
  DAD: '다낭',
  SIN: '싱가포르',
  KUL: '쿠알라룸푸르',
  MNL: '마닐라',
  CEB: '세부',
  // 대만·홍콩·중국
  TPE: '타이베이',
  HKG: '홍콩',
  PVG: '상하이',
  // 미국·괌
  LAX: 'LA',
  JFK: '뉴욕',
  HNL: '호놀룰루',
  SFO: '샌프란시스코',
  GUM: '괌',
};

/**
 * IATA 코드 → 한국어 도시명. 없으면 코드 그대로 반환 (ICN 같은 출발지도 동작).
 */
export function cityName(iata: string | null): string {
  if (!iata) return '';
  return CITY_NAMES[iata] ?? iata;
}

/**
 * '4박 5일' / '3박 4일' — departFrom ~ departTo 범위로 체류 계산.
 * null 또는 동일 날짜면 null 반환 (미표시).
 */
export function formatStayDuration(
  departFrom: Date | null,
  departTo: Date | null,
): string | null {
  if (!departFrom || !departTo) return null;
  const ms = departTo.getTime() - departFrom.getTime();
  const days = Math.round(ms / (1000 * 60 * 60 * 24));
  if (!Number.isFinite(days) || days <= 0) return null;
  const nights = days;
  const totalDays = days + 1;
  return `${nights}박 ${totalDays}일`;
}
