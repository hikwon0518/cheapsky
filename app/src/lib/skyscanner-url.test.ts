import { describe, expect, it } from 'vitest';

import { buildSkyscannerSearchUrl } from '@/lib/skyscanner-url';

describe('skyscanner-url.buildSkyscannerSearchUrl', () => {
  it('departFrom 지정 시 YYMMDD 로 포맷', () => {
    // 2026-05-03 KST 는 UTC 기준 2026-05-02T15:00:00Z 이상 ~ 05-03T14:59:59Z
    const departFrom = new Date('2026-05-03T03:00:00Z'); // 2026-05-03 12:00 KST
    const url = buildSkyscannerSearchUrl({
      origin: 'ICN',
      destination: 'NRT',
      departFrom,
    });
    expect(url).toBe(
      'https://www.skyscanner.co.kr/transport/flights/ICN/NRT/260503/',
    );
  });

  it('소문자 origin/destination 도 대문자 정규화', () => {
    const url = buildSkyscannerSearchUrl({
      origin: 'icn',
      destination: 'nrt',
      departFrom: new Date('2026-05-03T03:00:00Z'),
    });
    expect(url).toBe(
      'https://www.skyscanner.co.kr/transport/flights/ICN/NRT/260503/',
    );
  });

  it('departFrom null → now + 7일 (KST)', () => {
    // 2026-04-18 12:00 KST = 2026-04-18T03:00:00Z
    // +7일 → 2026-04-25 KST → 260425
    const now = new Date('2026-04-18T03:00:00Z');
    const url = buildSkyscannerSearchUrl({
      origin: 'ICN',
      destination: 'NRT',
      departFrom: null,
      now,
    });
    expect(url).toBe(
      'https://www.skyscanner.co.kr/transport/flights/ICN/NRT/260425/',
    );
  });

  it('departFrom undefined → now + 7일 fallback 동일', () => {
    const now = new Date('2026-04-18T03:00:00Z');
    const url = buildSkyscannerSearchUrl({
      origin: 'ICN',
      destination: 'KIX',
      now,
    });
    expect(url).toBe(
      'https://www.skyscanner.co.kr/transport/flights/ICN/KIX/260425/',
    );
  });

  it('KST 자정 직전(14:59Z)은 KST 전날 기준으로 포맷', () => {
    // 2026-05-02T14:59:59Z == 2026-05-02 23:59:59 KST → YYMMDD = 260502
    const departFrom = new Date('2026-05-02T14:59:59Z');
    const url = buildSkyscannerSearchUrl({
      origin: 'ICN',
      destination: 'NRT',
      departFrom,
    });
    expect(url).toBe(
      'https://www.skyscanner.co.kr/transport/flights/ICN/NRT/260502/',
    );
  });

  it('KST 자정(15:00Z)에서 하루 넘어감', () => {
    // 2026-05-02T15:00:00Z == 2026-05-03 00:00 KST → YYMMDD = 260503
    const departFrom = new Date('2026-05-02T15:00:00Z');
    const url = buildSkyscannerSearchUrl({
      origin: 'ICN',
      destination: 'NRT',
      departFrom,
    });
    expect(url).toBe(
      'https://www.skyscanner.co.kr/transport/flights/ICN/NRT/260503/',
    );
  });
});
