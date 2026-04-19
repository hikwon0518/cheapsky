import { describe, expect, it } from 'vitest';

import {
  KST,
  formatRelativeKst,
  kstStartOfDay,
  toKstDateOnly,
  toKstIsoString,
} from '@/lib/tz';

describe('tz.KST', () => {
  it('is the Asia/Seoul IANA identifier', () => {
    expect(KST).toBe('Asia/Seoul');
  });
});

describe('tz.toKstIsoString', () => {
  it('formats UTC Date into YYYY-MM-DD HH:mm KST', () => {
    // 2026-04-18T03:45:00Z == 2026-04-18 12:45 KST (+09:00)
    const d = new Date('2026-04-18T03:45:00Z');
    expect(toKstIsoString(d)).toBe('2026-04-18 12:45');
  });

  it('rolls over the day when UTC is 23:59', () => {
    // 2026-04-18T23:59:00Z == 2026-04-19 08:59 KST
    const d = new Date('2026-04-18T23:59:00Z');
    expect(toKstIsoString(d)).toBe('2026-04-19 08:59');
  });

  it('stays on same KST day when UTC is 15:00 (midnight KST next day)', () => {
    // 2026-04-18T15:00:00Z == 2026-04-19 00:00 KST
    const d = new Date('2026-04-18T15:00:00Z');
    expect(toKstIsoString(d)).toBe('2026-04-19 00:00');
  });
});

describe('tz.toKstDateOnly', () => {
  it('returns KST calendar date near UTC midnight', () => {
    // 23:59 UTC on 2026-04-18 → KST is 2026-04-19 08:59
    const d1 = new Date('2026-04-18T23:59:00Z');
    expect(toKstDateOnly(d1)).toBe('2026-04-19');

    // 00:00 UTC on 2026-04-18 → KST is 2026-04-18 09:00
    const d2 = new Date('2026-04-18T00:00:00Z');
    expect(toKstDateOnly(d2)).toBe('2026-04-18');
  });

  it('handles KST midnight boundary (15:00 UTC)', () => {
    const justBefore = new Date('2026-04-18T14:59:59Z'); // 23:59:59 KST
    const atBoundary = new Date('2026-04-18T15:00:00Z'); // 00:00:00 KST next day
    expect(toKstDateOnly(justBefore)).toBe('2026-04-18');
    expect(toKstDateOnly(atBoundary)).toBe('2026-04-19');
  });
});

describe('tz.kstStartOfDay', () => {
  it('returns the UTC instant corresponding to KST midnight of d', () => {
    // 2026-04-18 12:45 KST -> KST midnight of 2026-04-18 -> 2026-04-17T15:00:00Z
    const d = new Date('2026-04-18T03:45:00Z');
    const start = kstStartOfDay(d);
    expect(start.toISOString()).toBe('2026-04-17T15:00:00.000Z');
  });

  it('is idempotent when applied to its own result', () => {
    const d = new Date('2026-04-18T03:45:00Z');
    const once = kstStartOfDay(d);
    const twice = kstStartOfDay(once);
    expect(twice.toISOString()).toBe(once.toISOString());
  });
});

describe('tz.formatRelativeKst boundary cases', () => {
  const now = new Date('2026-04-18T12:00:00Z');

  it('< 60s → "방금 전"', () => {
    const d = new Date(now.getTime() - 59 * 1000);
    expect(formatRelativeKst(d, now)).toBe('방금 전');
  });

  it('== 60s → "1분 전"', () => {
    const d = new Date(now.getTime() - 60 * 1000);
    expect(formatRelativeKst(d, now)).toBe('1분 전');
  });

  it('3599s → "59분 전"', () => {
    const d = new Date(now.getTime() - 3599 * 1000);
    expect(formatRelativeKst(d, now)).toBe('59분 전');
  });

  it('3600s → "1시간 전"', () => {
    const d = new Date(now.getTime() - 3600 * 1000);
    expect(formatRelativeKst(d, now)).toBe('1시간 전');
  });

  it('23시간 59분 전 → 시간 단위 표시', () => {
    const d = new Date(now.getTime() - (23 * 3600 + 59 * 60) * 1000);
    expect(formatRelativeKst(d, now)).toBe('23시간 전');
  });

  it('어제 이벤트 → "어제 HH:mm"', () => {
    // now = 2026-04-18T12:00Z = 2026-04-18 21:00 KST
    // 26 hours earlier = 2026-04-17T10:00Z = 2026-04-17 19:00 KST (어제)
    const d = new Date('2026-04-17T10:00:00Z');
    expect(formatRelativeKst(d, now)).toBe('어제 19:00');
  });

  it('그보다 오래된 이벤트 → KST 날짜만', () => {
    const d = new Date('2026-04-10T00:00:00Z');
    expect(formatRelativeKst(d, now)).toBe('2026-04-10');
  });
});
