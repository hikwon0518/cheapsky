'use client';

// Route Detail Modal — 딜/노선 상세 오버레이 (Cheapsky Light v5).
//
// 트리거: `window.dispatchEvent(new CustomEvent('cheapsky:open-route', {
//   detail: { dealId, origin, destination }
// }))`
// 콘텐츠: 90일 대형 SVG 차트 · 12개월 시즌 mini calendar · CTA.
//
// 데이터: /api/price-trace/[id] 재사용 (Sparkline 과 동일 엔드포인트).
//
// Hard red lines:
// - 'use client' (상태/이벤트 리스너)
// - ESC · backdrop 클릭으로 닫기
// - 포커스 트랩까진 안 함 (스펙 간소화, 다음 iter 검토)

import { useEffect, useMemo, useState } from 'react';

import { cityName } from '@/lib/city-names';
import {
  buildSkyscannerSearchUrl,
} from '@/lib/skyscanner-url';
import { JP_DEFAULT_SEASONS } from '@/components/MonthTiming';

const CHART_W = 720;
const CHART_H = 200;
const CHART_PAD_Y = 16;

type Point = { date: string; priceKrw: number };

type TraceBody = {
  points: Point[];
  lowest: number | null;
  highest: number | null;
};

export function RouteDetailModal() {
  const [mounted, setMounted] = useState(false);
  const [ctx, setCtx] = useState<{
    dealId: string;
    origin: string;
    destination: string;
  } | null>(null);
  const [trace, setTrace] = useState<TraceBody | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
    const listener = (e: Event) => {
      const detail = (e as CustomEvent<{
        dealId: string;
        origin: string;
        destination: string;
      }>).detail;
      if (!detail) return;
      setCtx(detail);
      setTrace(null);
    };
    window.addEventListener('cheapsky:open-route', listener);
    return () =>
      window.removeEventListener('cheapsky:open-route', listener);
  }, []);

  useEffect(() => {
    if (!ctx) return;
    setLoading(true);
    fetch(`/api/price-trace/${encodeURIComponent(ctx.dealId)}`, {
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: TraceBody | null) => {
        setTrace(body ?? { points: [], lowest: null, highest: null });
      })
      .catch(() => setTrace({ points: [], lowest: null, highest: null }))
      .finally(() => setLoading(false));
  }, [ctx]);

  useEffect(() => {
    if (!ctx) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtx(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctx]);

  const segs = useMemo(() => {
    if (!trace || trace.points.length < 2) return null;
    const { points } = trace;
    const lowest = trace.lowest ?? 0;
    const highest = trace.highest ?? lowest + 1;
    const span = Math.max(1, highest - lowest);
    const step = CHART_W / (points.length - 1);
    const coords = points.map((p, i) => ({
      x: i * step,
      y:
        CHART_H -
        CHART_PAD_Y -
        ((p.priceKrw - lowest) / span) * (CHART_H - CHART_PAD_Y * 2),
      price: p.priceKrw,
      date: p.date,
    }));
    return { coords, lowest, highest };
  }, [trace]);

  if (!mounted || !ctx) return null;

  const skyUrl = buildSkyscannerSearchUrl({
    origin: ctx.origin,
    destination: ctx.destination,
  });

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center pt-[5vh] bg-black/45 backdrop-blur-[2px] overflow-auto"
      role="presentation"
      onClick={() => setCtx(null)}
    >
      <div
        className="w-[760px] max-w-[96vw] bg-surface border border-line-2 rounded-2xl shadow-[0_40px_80px_-20px_rgba(0,0,0,0.3)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`${cityName(ctx.destination)} 노선 상세`}
      >
        <header className="flex items-start justify-between gap-3 p-5 border-b border-line">
          <div>
            <h2 className="text-[18px] font-semibold text-ink tracking-tight">
              {cityName(ctx.destination)}
            </h2>
            <p className="text-[11.5px] text-ink-4 mt-1 tabular-nums">
              {ctx.origin} → {ctx.destination} · 90일 가격 추이
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCtx(null)}
            aria-label="닫기"
            className="text-ink-4 hover:text-ink text-[14px]"
          >
            ✕
          </button>
        </header>

        <div className="p-5 space-y-5">
          {/* 90일 차트 */}
          <section aria-label="90일 가격 추이">
            {loading ? (
              <div
                className="w-full h-[200px] animate-pulse rounded-md bg-surface-2"
                aria-hidden="true"
              />
            ) : trace && trace.points.length >= 2 && segs ? (
              <svg
                role="img"
                aria-label="90일 가격 추이 선형 차트"
                width="100%"
                viewBox={`0 0 ${CHART_W} ${CHART_H}`}
                className="block"
              >
                <line
                  x1="0"
                  y1={CHART_H - CHART_PAD_Y / 2}
                  x2={CHART_W}
                  y2={CHART_H - CHART_PAD_Y / 2}
                  stroke="var(--line)"
                  strokeWidth="1"
                />
                {segs.coords.slice(0, -1).map((c, i) => {
                  const n = segs.coords[i + 1];
                  const atLow =
                    c.price === segs.lowest || n.price === segs.lowest;
                  return (
                    <path
                      key={i}
                      d={`M${c.x.toFixed(2)},${c.y.toFixed(2)} L${n.x.toFixed(
                        2,
                      )},${n.y.toFixed(2)}`}
                      className={atLow ? 'stroke-low' : 'stroke-ink-4'}
                      strokeWidth={atLow ? 1.8 : 1.2}
                      fill="none"
                      strokeDasharray={atLow ? '3 3' : undefined}
                    />
                  );
                })}
                {segs.coords.map((c) => (
                  <circle
                    key={`${c.x}-${c.y}`}
                    cx={c.x}
                    cy={c.y}
                    r={c.price === segs.lowest ? 3 : 1.5}
                    className={c.price === segs.lowest ? 'fill-low' : 'fill-ink-4'}
                  />
                ))}
              </svg>
            ) : (
              <p className="text-[12px] text-ink-4 italic py-8 text-center">
                관측 데이터 수집 중이에요. 며칠 뒤 다시 확인해주세요.
              </p>
            )}
            {trace && trace.lowest !== null && trace.highest !== null ? (
              <div className="flex items-center gap-4 mt-2 text-[11.5px] text-ink-4 tabular-nums">
                <span>
                  최저 <b className="text-low">{trace.lowest.toLocaleString('ko-KR')}원</b>
                </span>
                <span>
                  최고 <b className="text-ink-2">{trace.highest.toLocaleString('ko-KR')}원</b>
                </span>
                <span>
                  관측 {trace.points.length} 일
                </span>
              </div>
            ) : null}
          </section>

          {/* 12개월 시즌 mini calendar */}
          <section aria-label="시즌 가이드">
            <h3 className="text-[13px] font-semibold text-ink mb-2">
              시즌 가이드 (일본 기준)
            </h3>
            <div className="grid grid-cols-12 gap-1">
              {JP_DEFAULT_SEASONS.map((s) => (
                <div
                  key={s.month}
                  title={`${s.month}월 · ${s.label}`}
                  className={`h-6 rounded-sm border ${
                    s.tone === 'good'
                      ? 'bg-low-soft border-low-line'
                      : s.tone === 'bad'
                        ? 'bg-up-soft border-up-line'
                        : 'bg-surface border-line'
                  }`}
                >
                  <span className="sr-only">
                    {s.month}월 {s.label}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* CTA */}
          <div className="flex gap-2 pt-2 border-t border-line">
            <a
              href={skyUrl}
              target="_blank"
              rel="nofollow noopener"
              className="btn btn-primary flex-1"
            >
              스카이스캐너에서 예약하기
            </a>
            <button
              type="button"
              onClick={() => {
                try {
                  const raw = window.localStorage.getItem('cheapsky_compare');
                  const arr: string[] = raw ? JSON.parse(raw) : [];
                  if (!arr.includes(ctx.destination)) {
                    arr.unshift(ctx.destination);
                    window.localStorage.setItem(
                      'cheapsky_compare',
                      JSON.stringify(arr.slice(0, 4)),
                    );
                    window.dispatchEvent(
                      new CustomEvent('cheapsky:compare-changed'),
                    );
                  }
                } catch {
                  // ignore
                }
              }}
              className="btn btn-ghost"
            >
              비교함에 추가
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
