// Server Component. 로고 + 서브라벨.
//
// UI_GUIDE 레이아웃: h-14 sticky top-0 bg-[#0a0a0a]/90 backdrop-blur-sm.
// backdrop-blur 는 전체 코드베이스에서 이 한 곳만 허용 (AI 슬롭 방지 예외 1곳).

export function Header() {
  return (
    <header className="h-14 sticky top-0 z-30 bg-page/90 backdrop-blur-sm border-b border-line">
      <div className="max-w-6xl mx-auto px-4 md:px-6 h-full flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <span className="text-base font-semibold tracking-tight text-ink">
            Cheapsky
          </span>
          <span className="hidden sm:inline text-xs text-ink-4">
            인천 출발 항공권 저점 레이더
          </span>
        </div>
        <nav className="flex items-center gap-3 text-xs text-ink-4">
          <span className="hidden md:inline">아시아·미국 20개 노선</span>
        </nav>
      </div>
      <div className="sm:hidden max-w-6xl mx-auto px-4 pb-1 text-[11px] text-ink-4">
        인천 출발 항공권 저점 레이더
      </div>
    </header>
  );
}
