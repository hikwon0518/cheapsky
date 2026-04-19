'use client';

// HeatmapMobileToggle — 모바일 전용 펼침/접힘 토글 (UI_GUIDE 모바일 히트맵 규정).
//
// 흐름:
//   기본: 프리뷰 3 행만 표시 + "노선 17곳 더 보기 ∨" 버튼
//   클릭: 나머지 17 행 추가 노출 + 버튼 라벨 "접기 ∧" 로 토글
//
// Hard red lines:
//   - 'use client' 필수 — useState 사용
//   - 카드 모서리 표준은 rounded-md (UI_GUIDE)
//   - hover scale / translate-y / rotate 금지
//
// Server 컴포넌트 MarketCard 를 children 슬롯으로 받지 못하므로 (서버→클라 직렬화 OK 인 쪽이지만
// 단순화를 위해), preview/rest React node 를 prop 으로 그대로 받는다.

import { useState, type ReactNode } from 'react';

type Props = {
  preview: ReactNode;
  rest: ReactNode;
  restCount: number;
};

export function HeatmapMobileToggle({ preview, rest, restCount }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <div role="list">{preview}</div>
      {restCount > 0 ? (
        <>
          {open ? <div role="list">{rest}</div> : null}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-2 w-full rounded-md border border-line bg-surface py-2 text-sm text-ink-3 hover:bg-surface-2 transition-colors duration-[120ms] flex items-center justify-between px-3"
          >
            <span>{open ? '접기' : `노선 ${restCount}곳 더 보기`}</span>
            <span aria-hidden="true">{open ? '∧' : '∨'}</span>
          </button>
        </>
      ) : null}
    </div>
  );
}
