'use client';

// 카드 우상단 공유 아이콘 버튼.
// Web Share API 있으면 OS 공유 시트, 없으면 clipboard 복사 + 토스트 (2s).
// 공유 URL 에 현재 필터 쿼리 + share token 포함 (호출자가 `url` 로 주입).
//
// 접근성: <button type="button">, `aria-label="이 딜 공유하기"`.
// 모바일 tap 충돌 방지: preventDefault + stopPropagation — 카드 <a> 링크로 버블링 안 함.

import { Share2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export function ShareButton({
  url,
  title,
}: {
  url: string;
  title: string;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const onClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      const nav = typeof navigator !== 'undefined' ? navigator : null;
      if (nav && typeof (nav as Navigator).share === 'function') {
        await (nav as Navigator).share({ url, title });
        return;
      }
      if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
        await nav.clipboard.writeText(url);
        setCopied(true);
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setCopied(false), 2000);
        return;
      }
    } catch {
      // 사용자 취소 등 — 실패해도 무해하게 넘긴다.
    }
  };

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={onClick}
        aria-label="이 딜 공유하기"
        className="w-7 h-7 rounded grid place-items-center text-ink-4 hover:bg-surface-2 hover:text-ink transition-colors"
      >
        <Share2 size={14} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {copied ? (
        <span
          role="status"
          className="absolute top-full right-0 mt-1 text-[11px] text-white bg-ink border border-ink rounded px-1.5 py-0.5 whitespace-nowrap"
        >
          링크 복사됨
        </span>
      ) : null}
    </span>
  );
}
