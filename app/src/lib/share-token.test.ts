import { describe, expect, it } from 'vitest';

import { parseShareTokens, verifyShareToken } from '@/lib/share-token';

describe('share-token.parseShareTokens', () => {
  it('undefined / empty → 빈 배열', () => {
    expect(parseShareTokens(undefined)).toEqual([]);
    expect(parseShareTokens('')).toEqual([]);
  });

  it('12자 미만 토큰은 필터', () => {
    expect(parseShareTokens('a,b,longenoughtoken12')).toEqual(['longenoughtoken12']);
  });

  it('공백 trim', () => {
    expect(parseShareTokens('  abcdefghij12 , xyzabcdefg34 ')).toEqual([
      'abcdefghij12',
      'xyzabcdefg34',
    ]);
  });

  it('12자 정확히는 허용', () => {
    expect(parseShareTokens('abcdefghij12')).toEqual(['abcdefghij12']);
  });

  it('여러 개 + 일부 짧은 토큰 혼합', () => {
    const env = 'friend_abc123xyz, short, backup_def456uvw,debug_ghi789rst';
    expect(parseShareTokens(env)).toEqual([
      'friend_abc123xyz',
      'backup_def456uvw',
      'debug_ghi789rst',
    ]);
  });
});

describe('share-token.verifyShareToken', () => {
  const allowed = ['friend_abc123xyz', 'backup_def456uvw'];

  it('정확 일치하면 true', () => {
    expect(verifyShareToken('friend_abc123xyz', allowed)).toBe(true);
    expect(verifyShareToken('backup_def456uvw', allowed)).toBe(true);
  });

  it('대소문자 구분', () => {
    expect(verifyShareToken('FRIEND_abc123xyz', allowed)).toBe(false);
  });

  it('미일치 → false', () => {
    expect(verifyShareToken('nope_nope_nope', allowed)).toBe(false);
  });

  it('빈 / null 토큰 → false', () => {
    expect(verifyShareToken(null, allowed)).toBe(false);
    expect(verifyShareToken(undefined, allowed)).toBe(false);
    expect(verifyShareToken('', allowed)).toBe(false);
  });

  it('allowed 빈 배열 → 항상 false', () => {
    expect(verifyShareToken('friend_abc123xyz', [])).toBe(false);
  });

  it('길이가 다른 토큰은 false (timing-safe 비교 길이 mismatch)', () => {
    expect(verifyShareToken('friend_abc123xyz_more', allowed)).toBe(false);
    expect(verifyShareToken('short', allowed)).toBe(false);
  });
});
