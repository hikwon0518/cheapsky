import { describe, expect, it } from 'vitest';

import {
  DESTINATION_ALIASES,
  ORIGIN_ALIASES,
  normalizeRoute,
} from '@/lib/route-map';

describe('route-map.normalizeRoute — 한글 도시명', () => {
  it('인천/도쿄 → ICN/NRT', () => {
    expect(normalizeRoute('인천', '도쿄')).toEqual({
      origin: 'ICN',
      destination: 'NRT',
    });
  });

  it('서울/오사카 → ICN/KIX', () => {
    expect(normalizeRoute('서울', '오사카')).toEqual({
      origin: 'ICN',
      destination: 'KIX',
    });
  });

  it('인천/타이베이 → ICN/TPE', () => {
    expect(normalizeRoute('인천', '타이베이')).toEqual({
      origin: 'ICN',
      destination: 'TPE',
    });
  });
});

describe('route-map.normalizeRoute — IATA 입력 + 대표 공항 적용', () => {
  it('HND → NRT 로 병합', () => {
    const { destination } = normalizeRoute('ICN', 'HND');
    expect(destination).toBe('NRT');
  });

  it('ITM → KIX 로 병합', () => {
    expect(normalizeRoute('ICN', 'ITM').destination).toBe('KIX');
  });

  it('소문자 IATA 도 대문자 대표 공항으로', () => {
    expect(normalizeRoute('icn', 'hnd').destination).toBe('NRT');
  });
});

describe('route-map.normalizeRoute — ADR-017 예외', () => {
  it('GMP 는 ORIGIN 에서 ICN 으로 병합하지 않음', () => {
    expect(normalizeRoute('GMP', 'NRT').origin).toBe('GMP');
    expect(normalizeRoute('김포', 'NRT').origin).toBe('GMP');
  });
});

describe('route-map.normalizeRoute — 실패 케이스', () => {
  it('미지 문자열 → null', () => {
    expect(normalizeRoute('화성', '목성')).toEqual({
      origin: null,
      destination: null,
    });
  });

  it('null/undefined/공백 → null', () => {
    expect(normalizeRoute(null, null)).toEqual({
      origin: null,
      destination: null,
    });
    expect(normalizeRoute(undefined, '')).toEqual({
      origin: null,
      destination: null,
    });
    expect(normalizeRoute('   ', '   ')).toEqual({
      origin: null,
      destination: null,
    });
  });
});

describe('route-map alias 사전 커버리지', () => {
  it('DESTINATION_ALIASES 는 20 노선 주요 도시를 포함', () => {
    const required = [
      '도쿄',
      '오사카',
      '후쿠오카',
      '삿포로',
      '오키나와',
      '나고야',
      '타이베이',
      '홍콩',
      '상하이',
      '방콕',
      '다낭',
      '호치민',
      '싱가포르',
      '쿠알라룸푸르',
      '마닐라',
      '세부',
      '괌',
      '뉴욕',
      '하와이',
    ];
    for (const k of required) {
      expect(DESTINATION_ALIASES[k], `missing alias: ${k}`).toBeDefined();
    }
  });

  it('ORIGIN_ALIASES 는 인천/서울/김포 를 포함', () => {
    expect(ORIGIN_ALIASES['인천']).toBe('ICN');
    expect(ORIGIN_ALIASES['서울']).toBe('ICN');
    expect(ORIGIN_ALIASES['김포']).toBe('GMP');
  });
});
