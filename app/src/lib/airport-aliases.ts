// 공항 대표 IATA 매핑 (ADR-017).
// data/airports.json 의 각 엔트리에서 representative 필드로 대표 공항을 찾는다.
// GMP → ICN 별칭 매핑은 데이터상 존재하지만, MVP 에선 서울 외 도시만 병합 정책 유효.

import airports from '@/data/airports.json';

type AirportEntry = {
  city: string;
  country: string;
  representative: string;
};

const AIRPORTS: Record<string, AirportEntry> = airports as Record<
  string,
  AirportEntry
>;

/**
 * Maps an IATA code to its representative airport per ADR-017.
 * Unknown code → returned as uppercase (identity fallback).
 * Empty/whitespace-only → empty string.
 */
export function toRepresentative(iata: string): string {
  if (!iata) return '';
  const upper = iata.trim().toUpperCase();
  if (!upper) return '';
  const entry = AIRPORTS[upper];
  if (!entry) return upper;
  return entry.representative;
}

export function isKnownAirport(iata: string): boolean {
  if (!iata) return false;
  const upper = iata.trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(AIRPORTS, upper);
}

export function cityOf(iata: string): string | null {
  if (!iata) return null;
  const upper = iata.trim().toUpperCase();
  const entry = AIRPORTS[upper];
  return entry ? entry.city : null;
}
