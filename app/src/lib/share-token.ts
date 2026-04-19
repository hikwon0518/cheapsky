// Share token (ADR-019). SHARE_TOKENS env 를 콤마 분리로 받아
// 공백 trim + 12자 이상 토큰만 유효. 비교는 timing-safe.

import { timingSafeEqual } from 'node:crypto';

const MIN_TOKEN_LEN = 12;

/**
 * Parse SHARE_TOKENS env string. Returns only tokens ≥ 12 chars.
 * undefined/empty → [].
 */
export function parseShareTokens(env: string | undefined): string[] {
  if (!env) return [];
  return env
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length >= MIN_TOKEN_LEN);
}

/**
 * Constant-time token check. Returns true iff token matches any allowed token
 * exactly (case-sensitive).
 *
 * We walk every candidate even after a match to avoid early-exit timing leaks,
 * and compare via crypto.timingSafeEqual on equal-length buffers.
 */
export function verifyShareToken(
  token: string | null | undefined,
  allowedTokens: string[],
): boolean {
  if (!token) return false;
  if (!Array.isArray(allowedTokens) || allowedTokens.length === 0) return false;

  const tokenBuf = Buffer.from(token, 'utf8');
  let found = false;

  for (const allowed of allowedTokens) {
    const allowedBuf = Buffer.from(allowed, 'utf8');
    // Length mismatch → can't use timingSafeEqual, but this is a public
    // check (not a secret-length oracle) so we record a non-match and keep going.
    if (allowedBuf.length !== tokenBuf.length) continue;
    if (timingSafeEqual(allowedBuf, tokenBuf)) {
      found = true;
      // Keep iterating for timing symmetry — do not break.
    }
  }

  return found;
}
