'use client';

// Hero 카드 찜 하트 버튼 (Cheapsky Light v5).
// localStorage 기반. 클릭 시 toggle + `cheapsky:saved-changed` 커스텀 이벤트 dispatch.

import { Heart } from 'lucide-react';
import { useEffect, useState } from 'react';

import { loadSavedRoutes, saveRoutes, toggleRoute } from '@/lib/saved-routes';

export function SaveButton({ destination }: { destination: string }) {
  const [saved, setSaved] = useState<boolean>(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setSaved(loadSavedRoutes().includes(destination));
    const listener = () =>
      setSaved(loadSavedRoutes().includes(destination));
    window.addEventListener('storage', listener);
    window.addEventListener('cheapsky:saved-changed', listener as EventListener);
    return () => {
      window.removeEventListener('storage', listener);
      window.removeEventListener('cheapsky:saved-changed', listener as EventListener);
    };
  }, [destination]);

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const next = toggleRoute(destination, loadSavedRoutes());
    saveRoutes(next);
    setSaved(next.includes(destination));
    window.dispatchEvent(new CustomEvent('cheapsky:saved-changed'));
  };

  if (!mounted) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={saved ? '찜 해제' : '찜하기'}
      aria-pressed={saved}
      className={`w-7 h-7 rounded grid place-items-center transition-colors ${
        saved
          ? 'text-hot hover:bg-hot-soft'
          : 'text-ink-4 hover:bg-surface-2 hover:text-ink'
      }`}
    >
      <Heart
        size={13}
        strokeWidth={1.6}
        fill={saved ? 'currentColor' : 'none'}
        aria-hidden="true"
      />
    </button>
  );
}
