import { describe, expect, it } from 'vitest';

import {
  clampCurationText,
  formatDiscount,
  formatKrw,
  formatPercentile,
} from '@/lib/format';

describe('format.formatKrw', () => {
  it('정수 가격 → "135,000원"', () => {
    expect(formatKrw(135000)).toBe('135,000원');
  });

  it('0 → "0원"', () => {
    expect(formatKrw(0)).toBe('0원');
  });

  it('소수점 가격은 반올림', () => {
    expect(formatKrw(1000.4)).toBe('1,000원');
    expect(formatKrw(1000.6)).toBe('1,001원');
  });

  it('NaN 은 "0원" 로 fail-soft', () => {
    expect(formatKrw(Number.NaN)).toBe('0원');
    expect(formatKrw(Number.POSITIVE_INFINITY)).toBe('0원');
  });
});

describe('format.formatDiscount', () => {
  it('0.52 → "-52%"', () => {
    expect(formatDiscount(0.52)).toBe('-52%');
  });

  it('0 → "0%"', () => {
    expect(formatDiscount(0)).toBe('0%');
  });

  it('음수(가격 상승) → "+N%"', () => {
    expect(formatDiscount(-0.1)).toBe('+10%');
  });

  it('1 이상도 처리 (e.g. 무료 거의 수준)', () => {
    expect(formatDiscount(1.5)).toBe('-150%'); // 비정상 입력, 깨지지 않음
  });

  it('NaN 은 "0%"', () => {
    expect(formatDiscount(Number.NaN)).toBe('0%');
  });

  it('0.30 반올림 → -30%', () => {
    expect(formatDiscount(0.3)).toBe('-30%');
  });

  it('0.295 반올림 → -30%', () => {
    expect(formatDiscount(0.295)).toBe('-30%');
  });

  it('0.294 반올림 → -29%', () => {
    expect(formatDiscount(0.294)).toBe('-29%');
  });
});

describe('format.formatPercentile', () => {
  it('7.3 → "p7"', () => {
    expect(formatPercentile(7.3)).toBe('p7');
  });

  it('7.5 → "p8" (반올림)', () => {
    expect(formatPercentile(7.5)).toBe('p8');
  });

  it('상한/하한 clamp', () => {
    expect(formatPercentile(150)).toBe('p100');
    expect(formatPercentile(-5)).toBe('p0');
  });

  it('NaN → "p0"', () => {
    expect(formatPercentile(Number.NaN)).toBe('p0');
  });
});

describe('format.clampCurationText', () => {
  it('짧은 문자열은 그대로', () => {
    expect(clampCurationText('짧은 문장', 60)).toBe('짧은 문장');
  });

  it('60자 초과면 앞에서 잘라냄', () => {
    const long = 'a'.repeat(100);
    expect(clampCurationText(long, 60)).toHaveLength(60);
  });

  it('기본 maxLen 은 60', () => {
    const s = '가'.repeat(70);
    expect(Array.from(clampCurationText(s)).length).toBe(60);
  });

  it('emoji(surrogate pair) 는 한 문자로 카운트', () => {
    const s = '🔥'.repeat(80); // 각 🔥 는 surrogate pair
    expect(Array.from(clampCurationText(s, 10)).length).toBe(10);
  });

  it('빈 입력은 빈 문자열', () => {
    expect(clampCurationText('', 60)).toBe('');
  });
});
