import type { Metadata } from 'next';
import './globals.css';

import { CommandPalette } from '@/components/CommandPalette';
import { MobileTabBar } from '@/components/MobileTabBar';
import { RouteDetailModal } from '@/components/RouteDetailModal';
import { TweaksPanel } from '@/components/TweaksPanel';

export const metadata: Metadata = {
  title: 'Cheapsky',
  description: '인천 출발 항공권 저점 레이더',
  // ADR-008: noindex/nofollow. 검색엔진 노출 차단 + meta robots 태그 명시.
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        {/* Pretendard Variable + Inter via <link> — step 0 이 확립한 방식 유지. */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className="bg-page text-ink min-h-screen">
        <div>{children}</div>
        <MobileTabBar />
        <CommandPalette />
        <RouteDetailModal />
        <TweaksPanel />
      </body>
    </html>
  );
}
