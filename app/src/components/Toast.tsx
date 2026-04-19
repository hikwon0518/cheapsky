'use client';

// Toast — 최근 hot deal / 가격 변동 알림 (Cheapsky Light v5).
//
// 동작:
//   1. localStorage `cheapsky_toast_seen` 에 마지막 본 딜 id 저장
//   2. SSR 시점에 받은 최신 hot deal 의 id 가 저장값과 다르면 toast 표시
//   3. 6초 후 자동 dismiss, 닫기 버튼 수동 dismiss
//   4. `보기` 버튼 → 원문 링크 새 탭
//
// Hard red lines:
// - 'use client' 필수 (localStorage 접근)
// - prefers-reduced-motion 존중
// - 한 번 닫으면 같은 id 재표시 안 함

import { useEffect, useState } from 'react';

import { cityName } from '@/lib/city-names';
import { formatKrw } from '@/lib/format';

const SEEN_KEY = 'cheapsky_toast_seen';

type Props = {
  latestDealId: string | null;
  destination: string | null;
  priceKrw: number | null;
  discountPct: number | null;
  sourceUrl: string | null;
};

export function Toast({
  latestDealId,
  destination,
  priceKrw,
  discountPct,
  sourceUrl,
}: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!latestDealId || !destination || priceKrw === null) return;
    try {
      const seen = window.localStorage.getItem(SEEN_KEY);
      if (seen === latestDealId) return;
      setVisible(true);
      const t = window.setTimeout(() => setVisible(false), 6000);
      return () => window.clearTimeout(t);
    } catch {
      // localStorage 접근 실패 시 toast 생략
    }
  }, [latestDealId, destination, priceKrw]);

  if (!visible || !latestDealId) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(SEEN_KEY, latestDealId);
    } catch {
      // ignore
    }
  };

  const openOriginal = () => {
    if (sourceUrl) {
      window.open(sourceUrl, '_blank', 'noopener,nofollow');
    }
    dismiss();
  };

  const headline =
    discountPct !== null
      ? `${cityName(destination)}이 ${discountPct}% 더 내렸어요`
      : `${cityName(destination)} 새 딜`;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 bottom-[88px] md:bottom-[28px] z-[70] flex items-center gap-[10px] -translate-x-1/2 bg-ink text-white text-[12.5px] px-[14px] py-[10px] rounded-[10px] shadow-[0_12px_30px_-10px_rgba(0,0,0,0.4)] animate-fade-in"
    >
      <span className="tabular-nums">
        {headline} · <b>{priceKrw !== null ? formatKrw(priceKrw) : ''}</b>
      </span>
      <button
        type="button"
        onClick={openOriginal}
        className="text-[#b8c4d8] hover:text-white font-medium"
      >
        보기
      </button>
      <button
        type="button"
        aria-label="닫기"
        onClick={dismiss}
        className="text-[#8a98aa] hover:text-white"
      >
        ✕
      </button>
    </div>
  );
}
