// 표시용 포매터. 모두 순수 함수.

/**
 * Krw number → '135,000원'. NaN/undefined guard.
 */
export function formatKrw(n: number): string {
  if (!Number.isFinite(n)) return '0원';
  const rounded = Math.round(n);
  return `${rounded.toLocaleString('ko-KR')}원`;
}

/**
 * Discount rate (0~1, may exceed 1 or be negative) → '-52%' / '+N%'.
 * 입력 0.52 → '-52%'. 즉 원가 대비 얼마나 싸졌는지(양수는 할인) 관점 표기.
 * rate < 0 → '+N%' (가격 상승).
 */
export function formatDiscount(rate: number): string {
  if (!Number.isFinite(rate)) return '0%';
  const pct = Math.round(rate * 100);
  if (pct === 0) return '0%';
  if (pct > 0) return `-${pct}%`;
  return `+${Math.abs(pct)}%`;
}

/**
 * Percentile (0~100) → 'p7'. 소수점 반올림, 하한 0, 상한 100.
 */
export function formatPercentile(p: number): string {
  if (!Number.isFinite(p)) return 'p0';
  const clamped = Math.min(100, Math.max(0, p));
  return `p${Math.round(clamped)}`;
}

/**
 * UTF-8 safe hard cap for curation text (ADR-005 60자 이내).
 * 기본 60자. ellipsis 없음 — 금칙어·길이 검증은 호출자가 실패 시 null 반환.
 * surrogate pair (이모지 등) 은 한 문자로 count.
 */
export function clampCurationText(s: string, maxLen: number = 60): string {
  if (!s) return '';
  const arr = Array.from(s); // code point 기준 split (surrogate 안전)
  if (arr.length <= maxLen) return s;
  return arr.slice(0, maxLen).join('');
}

/**
 * Hero 카드 verdict 한 줄 (Cheapsky Light v5 포팅).
 *   - hotDeal → `'지금 사기 좋아요'` + 기준 비교
 *   - 큰 폭 할인(>=30%) → `'평소보다 많이 싸요'`
 *   - 그 외 → null (verdict 미표시)
 * 근거(분위수/hot flag) 는 caller 가 전달.
 */
export function formatVerdict(input: {
  hotDeal: boolean;
  discountRate: number | null;
  baselineKrw: number | null;
}): { tone: 'hot' | 'good' | null; headline: string; from: string | null } {
  const { hotDeal, discountRate, baselineKrw } = input;
  if (hotDeal) {
    return {
      tone: 'hot',
      headline: '지금 사기 좋아요.',
      from: baselineKrw !== null ? formatKrw(baselineKrw) : null,
    };
  }
  if (discountRate !== null && Math.round(discountRate * 100) >= 30) {
    return {
      tone: 'good',
      headline: '평소보다 많이 싸요.',
      from: baselineKrw !== null ? formatKrw(baselineKrw) : null,
    };
  }
  return { tone: null, headline: '', from: null };
}
