'use client';

// Sparkline — 90일 가격 추이 inline SVG (UI_GUIDE "스파크라인 (Sparkline)").
//
// Hard red lines:
// - 차트 라이브러리 금지 (chart.js / recharts / victory / d3). inline SVG 만.
// - 상태 라이브러리 금지 (Zustand / Redux / SWR / React Query). native fetch.
// - 축·그리드·범례·첫 mount 애니메이션 금지 (밀도 원칙)
// - hover tooltip 은 박스형 금지, 얇은 텍스트 오버레이만
// - 데이터 3건 미만 → '데이터 수집 중' italic
//
// 색맹 보조 (UI_GUIDE "색에 의존하지 않는 신호"):
// - 최저 구간 stroke 색 + dasharray 로 끊김
// - 최고 구간 stroke-width 1 → 2 로 두껍게

import { useEffect, useState } from 'react';

import { formatKrw } from '@/lib/format';

export const SPARKLINE_WIDTH = 120;
export const SPARKLINE_HEIGHT = 30;
export const SPARKLINE_PADDING_Y = 2; // 점이 상하단에 박히지 않게
export const SPARKLINE_MIN_POINTS = 3; // 3건 미만 → '데이터 수집 중'

type Point = { date: string; priceKrw: number };

export type SparklineState =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'loaded'; points: Point[]; lowest: number; highest: number };

export type SparklineCoord = {
  x: number;
  y: number;
  price: number;
  date: string;
};

export type SparklineSegment = {
  d: string;
  lowest: boolean;
  highest: boolean;
};

/**
 * 서버 응답 → State. loading 은 별도.
 * 3건 미만 / 수 필드 누락 / 형식 불일치 → empty.
 */
export function parseTraceResponse(body: unknown): SparklineState {
  if (!body || typeof body !== 'object') return { kind: 'empty' };
  const rec = body as {
    points?: unknown;
    lowest?: unknown;
    highest?: unknown;
  };
  const pts = Array.isArray(rec.points) ? rec.points : null;
  if (!pts || pts.length < SPARKLINE_MIN_POINTS) return { kind: 'empty' };
  if (typeof rec.lowest !== 'number' || typeof rec.highest !== 'number') {
    return { kind: 'empty' };
  }
  const shaped: Point[] = [];
  for (const p of pts) {
    if (
      p &&
      typeof p === 'object' &&
      typeof (p as { date?: unknown }).date === 'string' &&
      typeof (p as { priceKrw?: unknown }).priceKrw === 'number'
    ) {
      shaped.push({
        date: (p as Point).date,
        priceKrw: (p as Point).priceKrw,
      });
    }
  }
  if (shaped.length < SPARKLINE_MIN_POINTS) return { kind: 'empty' };
  return {
    kind: 'loaded',
    points: shaped,
    lowest: rec.lowest,
    highest: rec.highest,
  };
}

/**
 * loaded 상태의 좌표·세그먼트 빌더. SVG 좌표는 원점 좌상단, y 하향.
 * - 점 x: 균등 분할 (points.length - 1 구간)
 * - 점 y: 최저/최고 사이 선형 매핑, PADDING_Y 여백
 * - segment.lowest: 한 점이라도 lowest → 색 + dasharray
 * - segment.highest: 한 점이라도 highest → stroke-width 2
 */
export function buildSparklineGeometry(
  points: readonly Point[],
  lowest: number,
  highest: number,
): { coords: SparklineCoord[]; segments: SparklineSegment[] } {
  const span = Math.max(1, highest - lowest);
  const step = points.length > 1 ? SPARKLINE_WIDTH / (points.length - 1) : 0;
  const coords: SparklineCoord[] = points.map((p, i) => {
    const x = i * step;
    const y =
      SPARKLINE_HEIGHT -
      SPARKLINE_PADDING_Y -
      ((p.priceKrw - lowest) / span) *
        (SPARKLINE_HEIGHT - SPARKLINE_PADDING_Y * 2);
    return { x, y, price: p.priceKrw, date: p.date };
  });

  const segments: SparklineSegment[] = coords.slice(0, -1).map((c, i) => {
    const next = coords[i + 1];
    const touchesLow = c.price === lowest || next.price === lowest;
    const touchesHigh = c.price === highest || next.price === highest;
    return {
      d: `M${c.x.toFixed(2)},${c.y.toFixed(2)} L${next.x.toFixed(2)},${next.y.toFixed(2)}`,
      lowest: touchesLow,
      highest: touchesHigh,
    };
  });

  return { coords, segments };
}

type SparklineProps = {
  dealId: string;
  /** 타임아웃 / 에러 / 관측 부족 모두 '데이터 수집 중'으로 통일 */
};

export function Sparkline({ dealId }: SparklineProps) {
  const [state, setState] = useState<SparklineState>({ kind: 'loading' });
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });

    fetch(`/api/price-trace/${encodeURIComponent(dealId)}`, {
      cache: 'no-store',
      credentials: 'same-origin',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled) return;
        setState(parseTraceResponse(body));
      })
      .catch(() => {
        if (cancelled) return;
        setState({ kind: 'empty' });
      });

    return () => {
      cancelled = true;
    };
  }, [dealId]);

  if (state.kind === 'loading') {
    return (
      <div
        className="h-[30px] w-[120px]"
        aria-hidden="true"
        data-testid="sparkline-loading"
      />
    );
  }

  if (state.kind === 'empty') {
    return (
      <p
        className="text-[11px] text-ink-4 italic h-[30px] leading-[30px]"
        data-testid="sparkline-empty"
      >
        데이터 수집 중
      </p>
    );
  }

  const { points, lowest, highest } = state;
  const { coords, segments } = buildSparklineGeometry(points, lowest, highest);
  const step = points.length > 1 ? SPARKLINE_WIDTH / (points.length - 1) : 0;

  const current = coords[coords.length - 1];
  const lowestIdx = coords.findIndex((c) => c.price === lowest);
  const isCurrentLowest = current.price === lowest;
  const hovered = hoverIdx !== null ? coords[hoverIdx] : null;

  return (
    <div className="relative h-[30px] w-[120px]">
      <svg
        role="img"
        aria-label={`90일 가격 추이, ${isCurrentLowest ? '현재 최저 구간' : '현재 평범한 구간'}`}
        width={SPARKLINE_WIDTH}
        height={SPARKLINE_HEIGHT}
        viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
        className="block"
      >
        {segments.map((seg, i) => (
          <path
            key={i}
            d={seg.d}
            className={
              seg.lowest
                ? 'stroke-low'
                : 'stroke-ink-4'
            }
            strokeWidth={seg.highest ? 2 : 1}
            strokeDasharray={seg.lowest ? '2 2' : undefined}
            fill="none"
          />
        ))}
        {/* 최저 마커 (현재가 아닌 경우에도 시각적 앵커 제공) */}
        {lowestIdx >= 0 && !isCurrentLowest ? (
          <circle
            cx={coords[lowestIdx].x}
            cy={coords[lowestIdx].y}
            r={1.5}
            className="fill-low"
          />
        ) : null}
        {/* 현재 점 — 항상 표시. 최저일 때는 emerald, 아닐 때도 emerald (UI_GUIDE) */}
        <circle
          cx={current.x}
          cy={current.y}
          r={2}
          className="fill-emerald-400"
        />
        {/* hover 핫스팟: 투명 rect 로 각 점 근처에 */}
        {coords.map((c, i) => (
          <rect
            key={i}
            x={Math.max(0, c.x - (step || SPARKLINE_WIDTH) / 2)}
            y={0}
            width={step || SPARKLINE_WIDTH}
            height={SPARKLINE_HEIGHT}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
            onFocus={() => setHoverIdx(i)}
            onBlur={() => setHoverIdx(null)}
          />
        ))}
      </svg>
      {hovered ? (
        <span
          className="absolute -top-4 left-0 text-[11px] text-white bg-ink rounded px-1.5 py-0.5 pointer-events-none whitespace-nowrap"
          role="tooltip"
        >
          {hovered.date} · {formatKrw(hovered.price)}
        </span>
      ) : null}
    </div>
  );
}
