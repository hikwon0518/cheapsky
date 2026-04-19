// Sparkline 은 'use client' 컴포넌트지만, 핵심 로직은 순수 함수로 추출했다.
// 이 파일은 다음을 검증:
//   - parseTraceResponse: API 응답 → state (loading / empty / loaded 결정 로직)
//   - buildSparklineGeometry: 좌표/세그먼트 빌더 (SVG path 생성)
//
// 3-state 렌더는 pure 함수 경로로 검증한다:
//   - loading 은 초기 상태 (useState default) — 렌더 시 빈 svg (체크 생략, 구현 상수)
//   - 3건 미만 → empty (= '데이터 수집 중' 표기 분기)
//   - 5건 이상 → loaded → segments/path 생성 확인

import { describe, expect, it } from 'vitest';

import {
  SPARKLINE_HEIGHT,
  SPARKLINE_MIN_POINTS,
  SPARKLINE_WIDTH,
  buildSparklineGeometry,
  parseTraceResponse,
} from './Sparkline';

describe('parseTraceResponse', () => {
  it('null body → empty', () => {
    expect(parseTraceResponse(null)).toEqual({ kind: 'empty' });
  });

  it('points 누락 → empty', () => {
    expect(parseTraceResponse({ lowest: 100, highest: 200 })).toEqual({
      kind: 'empty',
    });
  });

  it('points 3건 미만 → empty (데이터 수집 중)', () => {
    expect(
      parseTraceResponse({
        points: [
          { date: '2026-03-10', priceKrw: 100 },
          { date: '2026-03-11', priceKrw: 110 },
        ],
        lowest: 100,
        highest: 110,
      }),
    ).toEqual({ kind: 'empty' });
    expect(SPARKLINE_MIN_POINTS).toBe(3);
  });

  it('lowest/highest 숫자 아니면 → empty', () => {
    expect(
      parseTraceResponse({
        points: [
          { date: '2026-03-10', priceKrw: 100 },
          { date: '2026-03-11', priceKrw: 110 },
          { date: '2026-03-12', priceKrw: 120 },
        ],
        lowest: null,
        highest: null,
      }),
    ).toEqual({ kind: 'empty' });
  });

  it('points 3건 이상 + 숫자 → loaded', () => {
    const out = parseTraceResponse({
      points: [
        { date: '2026-03-10', priceKrw: 100 },
        { date: '2026-03-11', priceKrw: 200 },
        { date: '2026-03-12', priceKrw: 150 },
      ],
      lowest: 100,
      highest: 200,
    });
    expect(out.kind).toBe('loaded');
    if (out.kind === 'loaded') {
      expect(out.points).toHaveLength(3);
      expect(out.lowest).toBe(100);
      expect(out.highest).toBe(200);
    }
  });

  it('잘못된 point 엔트리는 무시 — 3건 미만 남으면 empty', () => {
    const out = parseTraceResponse({
      points: [
        { date: '2026-03-10', priceKrw: 100 },
        { date: 123, priceKrw: 200 }, // invalid
        { priceKrw: 300 }, // invalid
      ],
      lowest: 100,
      highest: 300,
    });
    expect(out.kind).toBe('empty');
  });
});

describe('buildSparklineGeometry', () => {
  const makePoints = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      date: `2026-03-${String(i + 1).padStart(2, '0')}`,
      priceKrw: 100 + i * 10,
    }));

  it('5건 이상 → 세그먼트 n-1 개 + 각 path `M x,y L x,y` 형태', () => {
    const points = makePoints(5);
    const { coords, segments } = buildSparklineGeometry(points, 100, 140);
    expect(coords).toHaveLength(5);
    expect(segments).toHaveLength(4);
    for (const s of segments) {
      expect(s.d).toMatch(/^M\d+(\.\d+)?,\d+(\.\d+)? L\d+(\.\d+)?,\d+(\.\d+)?$/);
    }
  });

  it('x 는 균등 분할 (0 ~ WIDTH)', () => {
    const points = makePoints(5);
    const { coords } = buildSparklineGeometry(points, 100, 140);
    expect(coords[0].x).toBeCloseTo(0);
    expect(coords[coords.length - 1].x).toBeCloseTo(SPARKLINE_WIDTH);
  });

  it('y 는 padding 범위 내 (lowest 일 때 바닥, highest 일 때 천장 근처)', () => {
    const points = makePoints(3);
    const { coords } = buildSparklineGeometry(points, 100, 120);
    const lowestCoord = coords.find((c) => c.price === 100)!;
    const highestCoord = coords.find((c) => c.price === 120)!;
    // lowest 는 SVG y 값이 큰 쪽 (아래), highest 는 작은 쪽 (위).
    expect(lowestCoord.y).toBeGreaterThan(highestCoord.y);
    // 모든 점이 [0, HEIGHT] 내.
    for (const c of coords) {
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeLessThanOrEqual(SPARKLINE_HEIGHT);
    }
  });

  it('세그먼트가 lowest 포인트에 닿으면 lowest=true', () => {
    const points = [
      { date: '2026-03-10', priceKrw: 200 },
      { date: '2026-03-11', priceKrw: 100 }, // lowest
      { date: '2026-03-12', priceKrw: 150 },
      { date: '2026-03-13', priceKrw: 250 }, // highest
    ];
    const { segments } = buildSparklineGeometry(points, 100, 250);
    // seg 0: 200→100 (lowest touch)
    expect(segments[0].lowest).toBe(true);
    // seg 1: 100→150 (lowest touch)
    expect(segments[1].lowest).toBe(true);
    // seg 2: 150→250 (highest touch)
    expect(segments[2].lowest).toBe(false);
    expect(segments[2].highest).toBe(true);
  });

  it('최저=최고 (flat) 인 엣지 케이스도 NaN 없이 처리 (span 분모 가드)', () => {
    const points = [
      { date: '2026-03-10', priceKrw: 100 },
      { date: '2026-03-11', priceKrw: 100 },
      { date: '2026-03-12', priceKrw: 100 },
    ];
    const { coords } = buildSparklineGeometry(points, 100, 100);
    for (const c of coords) {
      expect(Number.isFinite(c.y)).toBe(true);
    }
  });
});
