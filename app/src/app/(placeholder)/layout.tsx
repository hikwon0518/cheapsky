// Placeholder route layout — saved/alerts/settings 탭 아직 구현 전.
// 홈으로 돌아가는 링크 제공.

import { Header } from '@/components/Header';

export default function PlaceholderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Header />
      <main className="max-w-6xl mx-auto px-4 md:px-6 py-10">{children}</main>
    </>
  );
}
