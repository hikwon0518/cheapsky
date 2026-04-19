import Link from 'next/link';

export const metadata = {
  title: 'Cheapsky · 설정',
  robots: { index: false, follow: false },
};

export default function SettingsPage() {
  return (
    <section aria-label="설정" className="max-w-lg">
      <h1 className="text-2xl font-semibold text-ink tracking-tight">설정</h1>
      <p className="mt-2 text-sm text-ink-3">
        언어, 밀도, CTA 표시 방식 같은 설정은 화면 우하단의{' '}
        <b className="text-ink">Tweaks</b> 버튼 (개발 모드 전용) 에서 조정할 수
        있어요. 정식 설정 페이지는 다음 버전에서 제공 예정입니다.
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
