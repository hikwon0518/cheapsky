'use client';

// 히어로 카드 "상세 보기" 버튼 — RouteDetailModal 을 여는 트리거.
// Hard red line: 'use client' 필수 (window.dispatchEvent).

type Props = {
  dealId: string;
  origin: string;
  destination: string;
};

export function DetailButton({ dealId, origin, destination }: Props) {
  const open = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.dispatchEvent(
      new CustomEvent('cheapsky:open-route', {
        detail: { dealId, origin, destination },
      }),
    );
  };
  return (
    <button
      type="button"
      onClick={open}
      className="btn btn-ghost flex-1"
      aria-label={`${destination} 노선 상세 보기`}
    >
      상세 보기
    </button>
  );
}
