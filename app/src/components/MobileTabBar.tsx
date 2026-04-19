'use client';

// Mobile 하단 탭바 (Cheapsky Light v5). 768px 미만에서만 표시.
// 4탭: 홈 · 찜 · 알림 · 설정. 홈 외는 placeholder anchor (#coming-soon).
//
// Hard red lines:
// - 'use client' 필수 (pathname 기반 active 판정)
// - 모바일 전용 (`md:hidden`)
// - 이모지 금지. lucide 아이콘 사용

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Heart, Home as HomeIcon } from 'lucide-react';

type Tab = {
  id: string;
  label: string;
  href: string;
  Icon: typeof HomeIcon;
};

const TABS: readonly Tab[] = [
  { id: 'home', label: '홈', href: '/', Icon: HomeIcon },
  { id: 'saved', label: '찜', href: '/saved', Icon: Heart },
  { id: 'alerts', label: '알림', href: '/alerts', Icon: Bell },
];

export function MobileTabBar() {
  const pathname = usePathname() || '/';

  return (
    <nav
      aria-label="모바일 탭"
      className="md:hidden fixed left-0 right-0 bottom-0 z-40 bg-white/95 backdrop-blur-sm border-t border-line flex"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TABS.map(({ id, label, href, Icon }) => {
        const active = id === 'home' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={id}
            href={href}
            prefetch={false}
            aria-current={active ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center justify-center gap-[2px] py-[9px] text-[10px] ${
              active ? 'text-ink' : 'text-ink-4'
            }`}
          >
            <Icon size={20} strokeWidth={active ? 1.8 : 1.5} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
