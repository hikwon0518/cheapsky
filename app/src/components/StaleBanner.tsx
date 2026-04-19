// Server Component. 크롤러 2h+ 지연 경고 배너.
// UI_GUIDE: amber 계열 문구 그대로.

export function StaleBanner() {
  return (
    <div
      role="status"
      className="w-full bg-warn-soft border-b border-warn-line text-warn text-xs px-4 py-2 text-center"
    >
      최근 수집이 지연되고 있어요. 표시된 딜은 이전 수집 기준입니다.
    </div>
  );
}
