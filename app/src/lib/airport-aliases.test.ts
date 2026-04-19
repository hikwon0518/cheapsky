import { describe, expect, it } from 'vitest';

import {
  cityOf,
  isKnownAirport,
  toRepresentative,
} from '@/lib/airport-aliases';

describe('airport-aliases.toRepresentative', () => {
  it('HND → NRT (도쿄 대표 공항, ADR-017)', () => {
    expect(toRepresentative('HND')).toBe('NRT');
  });

  it('ITM → KIX (오사카 대표 공항)', () => {
    expect(toRepresentative('ITM')).toBe('KIX');
  });

  it('EWR / LGA → JFK (뉴욕)', () => {
    expect(toRepresentative('EWR')).toBe('JFK');
    expect(toRepresentative('LGA')).toBe('JFK');
  });

  it('identity IATA 도 대문자로 반환', () => {
    expect(toRepresentative('nrt')).toBe('NRT');
    expect(toRepresentative('NRT')).toBe('NRT');
  });

  it('unknown IATA → 자기 자신(대문자)', () => {
    expect(toRepresentative('XYZ')).toBe('XYZ');
    expect(toRepresentative('zzz')).toBe('ZZZ');
  });
});

describe('airport-aliases.isKnownAirport', () => {
  it('known → true', () => {
    expect(isKnownAirport('NRT')).toBe(true);
    expect(isKnownAirport('icn')).toBe(true);
  });

  it('unknown → false', () => {
    expect(isKnownAirport('XYZ')).toBe(false);
    expect(isKnownAirport('')).toBe(false);
  });
});

describe('airport-aliases.cityOf', () => {
  it('returns Korean city name for known IATA', () => {
    expect(cityOf('NRT')).toBe('도쿄');
    expect(cityOf('HND')).toBe('도쿄');
    expect(cityOf('JFK')).toBe('뉴욕');
  });

  it('returns null for unknown or empty', () => {
    expect(cityOf('XYZ')).toBeNull();
    expect(cityOf('')).toBeNull();
  });
});
