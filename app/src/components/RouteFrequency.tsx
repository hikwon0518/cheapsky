// Server Component. 카드 하단 한 줄 노선 빈도 마이크로 지표 (UI_GUIDE "노선 빈도").
//
// 표기 분기 (UI_GUIDE):
//   - ordinal === 1           → `이 노선 30일 내 첫 등장` (emerald 강조)
//   - ordinal ∈ [2, 4]        → `이 노선 30일 <ordinal>번째`
//   - ordinal >= 5            → `자주 올라오는 노선 (30일 <count30d>회)` (text-neutral-500 보조)
//
// Hard red lines:
// - 소숫점·과장 카피 금지 (ordinal 은 정수, count30d 는 정수).
// - ordinal === 0 (이 딜이 30일 윈도우 밖) 이면 렌더 생략 — 잘못된 수치 표시 방지.

import type { FrequencyInfo } from '@/services/route-frequency';

export function RouteFrequency({ info }: { info: FrequencyInfo }) {
  const { ordinal, count30d } = info;
  if (ordinal <= 0) return null;

  if (ordinal === 1) {
    return (
      <span className="text-[11px] text-low">
        이 노선 30일 내 첫 등장
      </span>
    );
  }

  if (ordinal <= 4) {
    return (
      <span className="text-[11px] text-ink-4">
        이 노선 30일 {ordinal}번째
      </span>
    );
  }

  return (
    <span className="text-[11px] text-ink-4">
      자주 올라오는 노선 (30일 {count30d}회)
    </span>
  );
}
