// 규칙 파서 단위 테스트 + 골든셋 커버리지 (PRD 성공 지표: Core ≥ 60%).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  parseCarrier,
  parseDepartRange,
  parsePrice,
  parseRoute,
  parseRules,
  parseTripType,
} from './rules';
import type { RawPost } from '@/types/deal';

const FIXED_NOW = new Date('2026-04-18T00:00:00Z');

function makePost(title: string, body = ''): RawPost {
  return {
    source: 'ppomppu',
    sourceId: 't',
    sourceUrl: 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu4&no=1',
    title,
    body,
    postedAt: FIXED_NOW,
  };
}

describe('parsePrice', () => {
  it('parses 135,000원', () => {
    expect(parsePrice('왕복 135,000원')).toBe(135000);
  });

  it('parses 29만', () => {
    expect(parsePrice('29만')).toBe(290000);
  });

  it('parses 45만원', () => {
    expect(parsePrice('45만원')).toBe(450000);
  });

  it('parses 99,900원부터 (picks smallest valid)', () => {
    expect(parsePrice('99,900원부터')).toBe(99900);
  });

  it('parses 9만원대 as 90000', () => {
    expect(parsePrice('9만원대')).toBe(90000);
  });

  it('parses 20만원대 as 200000', () => {
    expect(parsePrice('20만원대')).toBe(200000);
  });

  it('returns null when no price pattern', () => {
    expect(parsePrice('공지사항')).toBeNull();
  });

  it('picks smallest when multiple candidates', () => {
    expect(parsePrice('대한항공 왕복 300,000원 → 150,000원 특가')).toBe(150000);
  });

  it('filters out under-50,000 misparses (tax/fee/partial/편도/역대가)', () => {
    expect(parsePrice('세금 6,250원 포함')).toBeNull();
    expect(parsePrice('공항세 49,999원')).toBeNull();
    expect(parsePrice('편도 38,000원')).toBeNull();
  });

  it('prefers 50,000+ candidate over sub-threshold noise', () => {
    expect(parsePrice('왕복 135,000원 (세금 12,700원 별도)')).toBe(135000);
    // 50,000 경계: 포함
    expect(parsePrice('편도 50,000원부터')).toBe(50000);
  });
});

describe('parseTripType', () => {
  it('detects 편도', () => {
    expect(parseTripType('편도 60만')).toBe('oneway');
  });
  it('detects 왕복', () => {
    expect(parseTripType('왕복 135,000원')).toBe('roundtrip');
  });
  it('defaults to roundtrip when neither keyword', () => {
    expect(parseTripType('135,000원')).toBe('roundtrip');
  });
});

describe('parseRoute', () => {
  it('extracts 인천-오사카', () => {
    const r = parseRoute('[대한항공] 인천-오사카 왕복 135,000원');
    expect(r.origin).toBe('ICN');
    expect(r.destination).toBe('KIX');
  });

  it('defaults origin to ICN when missing', () => {
    const r = parseRoute('다낭 99,900원부터');
    expect(r.origin).toBe('ICN');
    expect(r.destination).toBe('DAD');
  });

  it('동경 and 도쿄 both map to NRT', () => {
    expect(parseRoute('동경 왕복 14만').destination).toBe('NRT');
    expect(parseRoute('도쿄 왕복 14만').destination).toBe('NRT');
  });

  it('IATA code in title (ICN-NRT)', () => {
    const r = parseRoute('에어서울 ICN-NRT 왕복 159,000원');
    expect(r.origin).toBe('ICN');
    expect(r.destination).toBe('NRT');
  });

  it('returns null destination when unresolved', () => {
    const r = parseRoute('홍대 카페 추천');
    expect(r.destination).toBeNull();
  });
});

describe('parseDepartRange', () => {
  it('parses 3~5월 as range', () => {
    const r = parseDepartRange('3~5월', FIXED_NOW);
    expect(r.departFrom?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(r.departTo?.toISOString()).toBe('2026-05-31T00:00:00.000Z');
  });

  it('parses 6월 출발 as single month', () => {
    const r = parseDepartRange('6월 출발', FIXED_NOW);
    expect(r.departFrom?.getUTCMonth()).toBe(5);
    expect(r.departTo?.getUTCMonth()).toBe(5);
  });

  it('parses ISO range 2026-05-10~05-25', () => {
    const r = parseDepartRange('2026-05-10~05-25', FIXED_NOW);
    expect(r.departFrom?.toISOString()).toBe('2026-05-10T00:00:00.000Z');
    expect(r.departTo?.toISOString()).toBe('2026-05-25T00:00:00.000Z');
  });

  it('parses 2026-05 single month', () => {
    const r = parseDepartRange('출발 2026-05', FIXED_NOW);
    expect(r.departFrom?.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(r.departTo?.toISOString()).toBe('2026-05-31T00:00:00.000Z');
  });

  it('rolls past month to next year', () => {
    // now = 2026-04-18, "3월" 은 이미 지났으므로 2027-03
    const r = parseDepartRange('3월 특가', FIXED_NOW);
    expect(r.departFrom?.getUTCFullYear()).toBe(2027);
    expect(r.departFrom?.getUTCMonth()).toBe(2);
  });

  it('returns nulls when no pattern', () => {
    const r = parseDepartRange('공지사항', FIXED_NOW);
    expect(r.departFrom).toBeNull();
    expect(r.departTo).toBeNull();
  });
});

describe('parseCarrier', () => {
  it('detects 대한항공 as KE/FSC', () => {
    expect(parseCarrier('[대한항공] 왕복 135,000원')).toEqual({
      code: 'KE',
      carrierClass: 'fsc',
    });
  });

  it('detects 제주항공 as 7C/LCC', () => {
    expect(parseCarrier('[제주항공] 99,000원')).toEqual({
      code: '7C',
      carrierClass: 'lcc',
    });
  });

  it('detects longer airline name before shorter', () => {
    // 베트남항공 should match before 베트남
    expect(parseCarrier('베트남항공 호치민')).toEqual({
      code: 'VN',
      carrierClass: 'fsc',
    });
  });

  it('returns mixed when no airline', () => {
    expect(parseCarrier('다낭 99,900원부터')).toEqual({
      code: null,
      carrierClass: 'mixed',
    });
  });
});

describe('parseRules (integration)', () => {
  it('fail-soft on empty post', () => {
    const draft = parseRules(makePost(''));
    expect(draft.source).toBe('ppomppu');
    expect(draft.priceKrw).toBeNull();
    expect(draft.parsedBy).toBe('rules');
  });

  it('filters hotel package', () => {
    const draft = parseRules(makePost('세부 패키지 호텔 3박 포함 79만원'));
    expect(draft.priceKrw).toBeNull();
    expect(draft.origin).toBeNull();
    expect(draft.destination).toBeNull();
    expect(draft.tripType).toBeNull();
  });

  it('bounds body slice at 500 chars', () => {
    const bigBody = '가격 99,000원 '.repeat(500);
    const draft = parseRules(
      makePost('대한항공 오사카', bigBody),
    );
    // Parser internally cuts at 500 chars; this should still parse a price.
    expect(draft.priceKrw).toBe(99000);
    expect(draft.carrierCode).toBe('KE');
  });

  it('does not throw on garbage input', () => {
    expect(() => parseRules(makePost('🥒🥒🥒!!'))).not.toThrow();
  });

  it('parsedBy is rules', () => {
    const draft = parseRules(makePost('[대한항공] 135,000원'));
    expect(draft.parsedBy).toBe('rules');
  });
});

// ─── 골든셋 커버리지 테스트 (PRD 성공 지표 ≥ 60%) ──────────────────

type GoldenCase = {
  title: string;
  expected: {
    origin: string | null;
    destination: string | null;
    priceKrw: number | null;
    tripType: 'oneway' | 'roundtrip' | null;
    carrierCode: string | null;
    carrierClass: 'fsc' | 'lcc' | 'mixed';
  };
};

const GOLDEN: GoldenCase[] = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../__fixtures__/parser-golden.json'),
    'utf-8',
  ),
);

type FieldKey = keyof GoldenCase['expected'];

function actualOf(title: string): GoldenCase['expected'] {
  const draft = parseRules(makePost(title));
  return {
    origin: draft.origin,
    destination: draft.destination,
    priceKrw: draft.priceKrw,
    tripType: draft.tripType,
    carrierCode: draft.carrierCode,
    carrierClass: draft.carrierClass ?? 'mixed',
  };
}

describe('parser golden set (coverage target ≥ 60%)', () => {
  it(`loads at least 30 cases (got ${GOLDEN.length})`, () => {
    expect(GOLDEN.length).toBeGreaterThanOrEqual(30);
  });

  it('achieves ≥ 60% exact-match coverage', () => {
    const fields: FieldKey[] = [
      'origin',
      'destination',
      'priceKrw',
      'tripType',
      'carrierCode',
      'carrierClass',
    ];
    const failures: string[] = [];
    let passes = 0;
    for (const c of GOLDEN) {
      const actual = actualOf(c.title);
      const diffs: string[] = [];
      for (const f of fields) {
        const exp = c.expected[f];
        const act = actual[f];
        if (exp !== act) {
          diffs.push(`${f}: expected=${JSON.stringify(exp)} actual=${JSON.stringify(act)}`);
        }
      }
      if (diffs.length === 0) {
        passes += 1;
      } else {
        failures.push(`  ✗ "${c.title}" → ${diffs.join('; ')}`);
      }
    }
    const coverage = passes / GOLDEN.length;
    // eslint-disable-next-line no-console
    console.log(
      `[parser-golden] ${passes}/${GOLDEN.length} = ${(coverage * 100).toFixed(1)}%`,
    );
    if (failures.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[parser-golden] failures:\n${failures.join('\n')}`);
    }
    expect(coverage).toBeGreaterThanOrEqual(0.6);
  });
});
