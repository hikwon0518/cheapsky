// 사회적 신호 판정 (ADR-023 / step2.md).
//
// 한 크롤 회차의 ParsedListItem 배열을 받아, views 상위 20% → 'hot',
// 다음 20% → 'trending', 나머지 → null 로 상대 판정한다.
//
// Hard red lines:
// - 순수 함수. DB / 파일 IO / 네트워크 접근 없음.
// - 조회수·댓글수·추천수 절대값은 숫자로 외부(UI)에 노출되지 않는다 (UI_GUIDE).
//   이 함수는 숫자를 레이블로 변환하는 유일한 진입점.
// - 같은 dedupe_key 에 두 소스가 붙으면 caller 가 `maxSocialSignal` 로 합성.
//   (hot > trending > null)

import type { ParsedListItem } from '@/services/crawlers/types';

export type SocialSignalLabel = 'hot' | 'trending' | null;

export const SOCIAL_HOT_CUT = 0.2;
export const SOCIAL_TRENDING_CUT = 0.4;

const RANK: Record<'hot' | 'trending', number> = {
  hot: 2,
  trending: 1,
};

/**
 * `items` 중 views 가 유효한 것들을 내림차순으로 정렬해, 상위 cut 비율을 'hot',
 * 다음 cut 비율을 'trending', 나머지를 null 로 반환한다.
 *
 * 반환: sourceId → label Map. `items` 에 포함된 모든 sourceId 가 결과에 존재.
 * views 가 null / undefined / 0 이하 / 비숫자인 항목은 null.
 */
export function computeSocialSignals(
  items: readonly ParsedListItem[],
): Map<string, SocialSignalLabel> {
  const out = new Map<string, SocialSignalLabel>();

  const scored = items
    .filter(
      (i): i is ParsedListItem & { views: number } =>
        typeof i.views === 'number' && Number.isFinite(i.views) && i.views > 0,
    )
    .map((i) => ({ id: i.sourceId, views: i.views }))
    .sort((a, b) => b.views - a.views);

  const total = scored.length;
  const hotCutIdx = Math.ceil(total * SOCIAL_HOT_CUT);
  const trendingCutIdx = Math.ceil(total * SOCIAL_TRENDING_CUT);

  scored.forEach((s, idx) => {
    if (idx < hotCutIdx) {
      out.set(s.id, 'hot');
    } else if (idx < trendingCutIdx) {
      out.set(s.id, 'trending');
    } else {
      out.set(s.id, null);
    }
  });

  for (const item of items) {
    if (!out.has(item.sourceId)) out.set(item.sourceId, null);
  }

  return out;
}

/**
 * 같은 dedupe_key 에 여러 소스가 붙을 때 max-priority 로 합성.
 * null < 'trending' < 'hot'.
 */
export function maxSocialSignal(
  a: SocialSignalLabel | undefined,
  b: SocialSignalLabel | undefined,
): SocialSignalLabel {
  const ra = a ? RANK[a] : 0;
  const rb = b ? RANK[b] : 0;
  if (ra === 0 && rb === 0) return null;
  return ra >= rb ? (a ?? null) : (b ?? null);
}
