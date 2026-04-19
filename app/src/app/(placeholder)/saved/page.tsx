import Link from 'next/link';

export const metadata = {
  title: 'Cheapsky · 찜',
  robots: { index: false, follow: false },
};

export default function SavedPage() {
  return (
    <section aria-label="찜한 노선" className="max-w-lg">
      <h1 className="text-2xl font-semibold text-ink tracking-tight">
        찜한 노선
      </h1>
      <p className="mt-2 text-sm text-ink-3">
        홈 화면의 하트 버튼으로 노선을 저장하면 여기서 모아볼 수 있어요. 아직
        조건 충족 알림 · 구독 기능은 준비 중입니다.
      </p>
      <Link
        href="/"
        className="inline-block mt-6 text-xs text-low hover:text-ink underline underline-offset-2"
      >
        ← 홈으로
      </Link>
    </section>
  );
}
