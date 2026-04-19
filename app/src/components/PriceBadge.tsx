'use client';

// 🔥 저점 배지 + 근거 팝오버 (ADR-006 / ADR-012 / UI_GUIDE).
//
// Hard red lines:
// - "역대가" 문자열 절대 금지 (ADR-012)
// - 배지는 <button type="button"> 로 렌더 (<div onclick> 금지)
// - onClick 에서 preventDefault + stopPropagation — 카드 <a> 링크 tap 충돌 방지
// - snapshot 상태 카드에서는 애초에 배지 렌더하지 않음 (카드 컴포넌트 쪽에서 제어)
//
// 데스크톱: hover 로 팝오버 표시, 모바일: tap 토글.
// 팝오버 내부 tap 은 stopPropagation 으로 닫히지 않게.

import { useEffect, useRef, useState } from 'react';

import { formatDiscount, formatKrw, formatPercentile } from '@/lib/format';
import type {
  BaselineConfidence,
  BaselineSource,
  CarrierClass,
} from '@/types/deal';

type PriceBadgeProps = {
  discountRate: number | null;
  pricePercentile: number | null;
  baselineKrw: number | null;
  priceKrw: number;
  carrierClass: CarrierClass;
  baselineSource: BaselineSource | null;
  baselineConfidence: BaselineConfidence | null;
  hotDeal: boolean;
  priceChanged?: boolean;
};

function classLabel(c: CarrierClass): string {
  if (c === 'fsc') return 'FSC';
  if (c === 'lcc') return 'LCC';
  return '혼합';
}

function sourceLabel(s: BaselineSource | null): string {
  if (s === 'observed') return '관측 기반';
  if (s === 'seed') return '수동 조사';
  if (s === 'mixed') return '관측+조사';
  return '—';
}

export function PriceBadge(props: PriceBadgeProps) {
  const {
    discountRate,
    pricePercentile,
    baselineKrw,
    priceKrw,
    carrierClass,
    baselineSource,
    baselineConfidence,
    hotDeal,
    priceChanged,
  } = props;

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  // 외부 클릭 시 팝오버 닫기.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (wrapRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [open]);

  // baseline 이 아예 없으면 배지 자체를 생성하지 않는다.
  if (baselineSource === null || discountRate === null) return null;

  const pct = Math.round(discountRate * 100);
  let label: string;
  if (hotDeal) {
    label = `🔥 저점 ${formatDiscount(discountRate)}`;
  } else if (pct >= 30) {
    label = `큰 폭 할인 ${formatDiscount(discountRate)}`;
  } else if (pct > 0) {
    label = `${formatDiscount(discountRate)}`;
  } else {
    // 평균보다 비싸거나 동등 — 배지 생략.
    return null;
  }

  const ariaLabel = hotDeal
    ? `저점 딜, ${pct}% 할인`
    : `${pct}% 할인`;

  const confidence =
    baselineConfidence === 'high'
      ? 'high'
      : baselineConfidence === 'medium'
        ? 'medium'
        : baselineConfidence === 'low'
          ? 'low'
          : null;

  const toggle = (e: React.MouseEvent) => {
    // 카드 <a> 링크가 상위에 있으므로 반드시 preventDefault + stopPropagation.
    e.preventDefault();
    e.stopPropagation();
    setOpen((v) => !v);
  };

  const onEnter = () => setOpen(true);
  const onLeave = () => setOpen(false);

  const tone = hotDeal
    ? 'bg-hot-soft text-hot border border-hot-line'
    : pct >= 30
      ? 'bg-low-soft text-low border border-low-line'
      : 'bg-surface-2 text-ink-2 border border-line';

  // price_changed 경고 테두리(warn).
  const ringClass = priceChanged ? 'ring-1 ring-warn/60' : '';

  return (
    <span
      ref={wrapRef}
      className="relative inline-block"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={ariaLabel}
        aria-expanded={open}
        className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium tabular-nums ${tone} ${ringClass}`}
      >
        {label}
      </button>
      {priceChanged ? (
        <span
          className="ml-1 text-[10px] text-warn"
          aria-label="가격 변경 가능성"
        >
          가격 변경
        </span>
      ) : null}
      {open ? (
        <span
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full mt-1 z-40 w-[240px] rounded-lg bg-surface border border-line-2 p-3 text-xs text-ink-2 tabular-nums shadow-[0_12px_28px_-12px_rgba(20,20,20,0.24)] animate-fade-in"
        >
          <div className="flex justify-between gap-2">
            <span className="text-ink-4">기준</span>
            <span className="text-right">
              {baselineKrw !== null ? formatKrw(baselineKrw) : '—'}
              {confidence ? (
                <span className="ml-1 text-[10px] text-ink-4">
                  confidence: {confidence}
                </span>
              ) : null}
            </span>
          </div>
          <div className="flex justify-between gap-2 mt-1">
            <span className="text-ink-4">현재</span>
            <span className="text-right">{formatKrw(priceKrw)}</span>
          </div>
          <div className="flex justify-between gap-2 mt-1">
            <span className="text-ink-4">할인</span>
            <span className="text-right">{formatDiscount(discountRate)}</span>
          </div>
          <div className="flex justify-between gap-2 mt-1">
            <span className="text-ink-4">분위수</span>
            <span className="text-right">
              {pricePercentile !== null ? formatPercentile(pricePercentile) : '—'}{' '}
              <span className="text-ink-4">
                ({classLabel(carrierClass)} 기준 · {sourceLabel(baselineSource)})
              </span>
            </span>
          </div>
        </span>
      ) : null}
    </span>
  );
}
