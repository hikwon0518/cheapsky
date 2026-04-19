import { describe, expect, it } from 'vitest';

import type { ParsedListItem } from '@/services/crawlers/types';

import { computeSocialSignals, maxSocialSignal } from './social-signal';

function item(sourceId: string, views: number | null | undefined): ParsedListItem {
  return {
    sourceId,
    sourceUrl: `https://example.com/${sourceId}`,
    title: sourceId,
    postedAt: new Date('2026-04-19T00:00:00Z'),
    views,
  };
}

describe('computeSocialSignals', () => {
  it('상위 20% → hot, 다음 20% → trending, 나머지 null (10건 기준)', () => {
    const items = Array.from({ length: 10 }, (_, i) => item(`id${i}`, 100 - i * 10));
    const m = computeSocialSignals(items);
    // 내림차순: id0=100, id1=90, ..., id9=10
    // 상위 2 (20%) → hot: id0, id1
    // 다음 2 (20~40%) → trending: id2, id3
    // 나머지 → null
    expect(m.get('id0')).toBe('hot');
    expect(m.get('id1')).toBe('hot');
    expect(m.get('id2')).toBe('trending');
    expect(m.get('id3')).toBe('trending');
    expect(m.get('id4')).toBeNull();
    expect(m.get('id9')).toBeNull();
  });

  it('views 가 null / 0 인 항목은 null', () => {
    const items: ParsedListItem[] = [
      item('a', 500),
      item('b', null),
      item('c', 0),
      item('d', undefined),
      item('e', 100),
    ];
    const m = computeSocialSignals(items);
    // scored: a=500, e=100 → 2건
    // hotCutIdx = Math.ceil(2 * 0.2) = 1 → a=hot
    // trendingCutIdx = Math.ceil(2 * 0.4) = 1 → e = null(범위 밖)
    expect(m.get('a')).toBe('hot');
    expect(m.get('e')).toBeNull();
    expect(m.get('b')).toBeNull();
    expect(m.get('c')).toBeNull();
    expect(m.get('d')).toBeNull();
  });

  it('입력이 비어 있으면 빈 Map', () => {
    const m = computeSocialSignals([]);
    expect(m.size).toBe(0);
  });

  it('모든 sourceId 가 Map 에 포함 (판정 결과 null 이어도)', () => {
    const items = [item('x', 10), item('y', null)];
    const m = computeSocialSignals(items);
    expect(m.has('x')).toBe(true);
    expect(m.has('y')).toBe(true);
  });

  it('views 같은 경우 정렬 안정성에 의존하지 않고 둘 다 같은 레이블 내로 떨어질 수 있다', () => {
    const items = [item('a', 100), item('b', 100), item('c', 100), item('d', 100), item('e', 100)];
    const m = computeSocialSignals(items);
    // hotCutIdx = ceil(5*0.2) = 1, trendingCutIdx = ceil(5*0.4) = 2
    // 상위 1 → hot, 그 다음 1 → trending, 나머지 null
    const vals = ['a', 'b', 'c', 'd', 'e'].map((id) => m.get(id));
    expect(vals.filter((v) => v === 'hot').length).toBe(1);
    expect(vals.filter((v) => v === 'trending').length).toBe(1);
    expect(vals.filter((v) => v === null).length).toBe(3);
  });

  it('1건만 있으면 hot', () => {
    const m = computeSocialSignals([item('solo', 42)]);
    expect(m.get('solo')).toBe('hot');
  });
});

describe('maxSocialSignal', () => {
  it('null + null → null', () => {
    expect(maxSocialSignal(null, null)).toBeNull();
    expect(maxSocialSignal(undefined, undefined)).toBeNull();
  });

  it('hot > trending > null', () => {
    expect(maxSocialSignal('hot', 'trending')).toBe('hot');
    expect(maxSocialSignal('trending', 'hot')).toBe('hot');
    expect(maxSocialSignal('trending', null)).toBe('trending');
    expect(maxSocialSignal(null, 'trending')).toBe('trending');
    expect(maxSocialSignal('hot', null)).toBe('hot');
  });

  it('동일 랭크는 a 우선', () => {
    expect(maxSocialSignal('hot', 'hot')).toBe('hot');
    expect(maxSocialSignal('trending', 'trending')).toBe('trending');
  });
});
