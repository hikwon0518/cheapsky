// Server Component. SHOW_CACHED_ONLY 패닉 모드 (ADR-028).
// UI_GUIDE: 🔒 아이콘 허용 (🔥 외 유일한 예외), aria-hidden 필수.

export function CacheOnlyBanner() {
  return (
    <div
      role="status"
      className="w-full bg-surface-2 border-b border-line text-ink-2 text-xs px-4 py-2 flex items-center justify-center gap-2"
    >
      <span aria-hidden="true">🔒</span>
      <span>캐시 모드로 표시 중입니다. 데이터 갱신이 일시 중단되었어요.</span>
    </div>
  );
}
