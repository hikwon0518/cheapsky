// Server Component. 리스트 빈 상태.
// UI_GUIDE: `조건에 맞는 딜이 없어요. 필터를 완화해보세요.` + 필터 초기화 링크.
// 이모지·일러스트 금지.

import Link from 'next/link';

export function EmptyState({ resetHref = '/' }: { resetHref?: string }) {
  return (
    <div className="bg-card border border-line rounded-lg p-8 text-center animate-fade-in">
      <p className="text-sm text-ink-2">
        조건에 맞는 딜이 없어요. 필터를 완화해보세요.
      </p>
      <Link
        href={resetHref}
        className="inline-block mt-3 text-xs text-low hover:text-ink underline underline-offset-2"
      >
        필터 초기화
      </Link>
    </div>
  );
}
