import Link from 'next/link';

export const metadata = {
  title: 'Cheapsky · 알림',
  robots: { index: false, follow: false },
};

export default function AlertsPage() {
  return (
    <section aria-label="가격 알림 설정" className="max-w-lg">
      <h1 className="text-2xl font-semibold text-ink tracking-tight">
        가격 알림
      </h1>
      <p className="mt-2 text-sm text-ink-3">
        조건을 맞춘 딜이 올라오면 푸시로 알려드리는 기능을 준비 중이에요.
        현재는 홈 하단의 실시간 토스트와 24시간 Timeline 으로 대신 확인해주세요.
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
