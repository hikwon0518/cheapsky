import { describe, expect, it } from 'vitest';

import { classOf, lookupCarrier } from '@/lib/airlines';

describe('airlines.classOf', () => {
  it("대한항공(KE) → 'fsc'", () => {
    expect(classOf('KE')).toBe('fsc');
  });

  it("제주항공(7C) → 'lcc'", () => {
    expect(classOf('7C')).toBe('lcc');
  });

  it("진에어(LJ) → 'lcc'", () => {
    expect(classOf('LJ')).toBe('lcc');
  });

  it("미지 코드 → 'mixed'", () => {
    expect(classOf('UNKNOWN')).toBe('mixed');
    expect(classOf('XX')).toBe('mixed');
  });

  it("null / undefined / '' → 'mixed'", () => {
    expect(classOf(null)).toBe('mixed');
    expect(classOf(undefined)).toBe('mixed');
    expect(classOf('')).toBe('mixed');
    expect(classOf('   ')).toBe('mixed');
  });

  it("대소문자 무시 — 'ke' → 'fsc'", () => {
    expect(classOf('ke')).toBe('fsc');
  });
});

describe('airlines.lookupCarrier — 코드 조회', () => {
  it("'KE' → 대한항공", () => {
    const r = lookupCarrier('KE');
    expect(r?.code).toBe('KE');
    expect(r?.info.name).toBe('대한항공');
    expect(r?.info.class).toBe('fsc');
  });

  it('소문자 코드도 매칭', () => {
    const r = lookupCarrier('7c');
    expect(r?.code).toBe('7C');
    expect(r?.info.class).toBe('lcc');
  });
});

describe('airlines.lookupCarrier — 한글명 역방향', () => {
  it("'대한항공' → KE", () => {
    const r = lookupCarrier('대한항공');
    expect(r?.code).toBe('KE');
  });

  it("'제주항공' → 7C (lcc)", () => {
    const r = lookupCarrier('제주항공');
    expect(r?.code).toBe('7C');
    expect(r?.info.class).toBe('lcc');
  });
});

describe('airlines.lookupCarrier — 실패', () => {
  it('미지 문자열 → null', () => {
    expect(lookupCarrier('없는항공')).toBeNull();
    expect(lookupCarrier('ZZ')).toBeNull();
  });

  it('공백/빈 문자열 → null', () => {
    expect(lookupCarrier('')).toBeNull();
    expect(lookupCarrier('   ')).toBeNull();
  });
});
