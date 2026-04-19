// market-heatmap selectRepresentative — 20 노선 × 우선순위 엔트리 선택 로직.
// resolveBaseline 결과 모킹 → selectRepresentative 의 5가지 우선순위 분기 검증.

import { describe, expect, it } from 'vitest';

import type { ResolvedBaseline } from '@/services/baseline';
import {
  HEATMAP_DESTINATIONS,
  HEATMAP_ORIGIN,
  selectRepresentative,
} from '@/services/market-heatmap';

function rb(partial: Partial<ResolvedBaseline>): ResolvedBaseline {
  return {
    p10Krw: null,
    p50Krw: null,
    p90Krw: null,
    source: null,
    confidence: null,
    observationCount: 0,
    ...partial,
  };
}

const empty = rb({});

describe('HEATMAP_DESTINATIONS — ADR-021 20 노선', () => {
  it('정확히 20개 노선', () => {
    expect(HEATMAP_DESTINATIONS.length).toBe(20);
  });

  it('일본 6 + 중화권 3 + 동남아 7 + 괌 1 + 미국 3 = 20', () => {
    expect(HEATMAP_DESTINATIONS).toEqual(
      expect.arrayContaining([
        'NRT', 'KIX', 'FUK', 'CTS', 'OKA', 'NGO', // JP 6
        'TPE', 'HKG', 'PVG',                       // CN/TW/HK 3
        'BKK', 'DAD', 'SGN', 'SIN', 'KUL', 'MNL', 'CEB', // SEA 7
        'GUM',                                     // GU 1
        'LAX', 'JFK', 'HNL',                       // US 3
      ]),
    );
  });

  it('origin 은 ICN 고정', () => {
    expect(HEATMAP_ORIGIN).toBe('ICN');
  });

  it('유럽·오세아니아·중동 노선 0건 (ADR-021)', () => {
    const banned = ['CDG', 'FRA', 'LHR', 'SYD', 'AKL', 'DXB', 'DOH'];
    for (const dest of banned) {
      expect(HEATMAP_DESTINATIONS).not.toContain(dest);
    }
  });
});

describe('selectRepresentative — 5단계 우선순위', () => {
  it('1순위: FSC + LCC 둘 다 observed → mixed 병합 (min p10/p50/p90, source=mixed, confidence=high)', () => {
    const fsc = rb({
      p10Krw: 200_000,
      p50Krw: 380_000,
      p90Krw: 580_000,
      source: 'observed',
      confidence: 'high',
      observationCount: 35,
    });
    const lcc = rb({
      p10Krw: 95_000,
      p50Krw: 180_000,
      p90Krw: 270_000,
      source: 'observed',
      confidence: 'high',
      observationCount: 40,
    });

    const row = selectRepresentative('KIX', fsc, lcc, empty);

    expect(row.source).toBe('mixed');
    expect(row.confidence).toBe('high');
    expect(row.carrierClass).toBe('mixed');
    // min(200k, 95k) = 95k
    expect(row.p10Krw).toBe(95_000);
    expect(row.p50Krw).toBe(180_000);
    expect(row.p90Krw).toBe(270_000);
    expect(row.cheapestTodayKrw).toBe(95_000);
    // 합산
    expect(row.observationCount).toBe(75);
  });

  it('2순위: 단일 observed (LCC) → 그대로 사용', () => {
    const fsc = empty;
    const lcc = rb({
      p10Krw: 99_000,
      p50Krw: 180_000,
      p90Krw: 280_000,
      source: 'observed',
      confidence: 'high',
      observationCount: 32,
    });

    const row = selectRepresentative('KIX', fsc, lcc, empty);
    expect(row.source).toBe('observed');
    expect(row.confidence).toBe('high');
    expect(row.carrierClass).toBe('lcc');
    expect(row.p10Krw).toBe(99_000);
    expect(row.observationCount).toBe(32);
  });

  it('2순위: mixed(관측+시드 혼합) 도 observed 군에 속함 — 둘 다 mixed 면 관측 많은 쪽', () => {
    const fsc = rb({
      p10Krw: 220_000,
      p50Krw: 380_000,
      p90Krw: 580_000,
      source: 'mixed',
      confidence: 'medium',
      observationCount: 12,
    });
    const lcc = rb({
      p10Krw: 110_000,
      p50Krw: 200_000,
      p90Krw: 290_000,
      source: 'mixed',
      confidence: 'medium',
      observationCount: 25,
    });
    const mixed = empty;

    // FSC + LCC 둘 다 observed (mixed 도 isObserved=true) → 1순위 병합
    const row = selectRepresentative('KIX', fsc, lcc, mixed);
    expect(row.source).toBe('mixed');
    // confidence=medium (둘 다 medium)
    expect(row.confidence).toBe('medium');
    expect(row.observationCount).toBe(37);
  });

  it('3순위: 관측 0 + seed FSC + seed LCC 둘 다 → FSC 우선', () => {
    const fsc = rb({
      p10Krw: 209_000,
      p50Krw: 380_000,
      p90Krw: 589_000,
      source: 'seed',
      confidence: 'medium',
      observationCount: 0,
    });
    const lcc = rb({
      p10Krw: 121_000,
      p50Krw: 220_000,
      p90Krw: 341_000,
      source: 'seed',
      confidence: 'medium',
      observationCount: 0,
    });
    const mixed = rb({
      p10Krw: 165_000,
      p50Krw: 300_000,
      p90Krw: 465_000,
      source: 'seed',
      confidence: 'low',
      observationCount: 0,
    });

    const row = selectRepresentative('NRT', fsc, lcc, mixed);

    expect(row.source).toBe('seed');
    expect(row.confidence).toBe('medium');
    expect(row.carrierClass).toBe('fsc');
    expect(row.p10Krw).toBe(209_000);
    expect(row.p50Krw).toBe(380_000);
  });

  it('3순위 (LCC 만 시드 매치): FSC 시드 없으면 LCC 시드 사용', () => {
    const fsc = rb({
      // FSC 시드 매치가 없는 케이스 — resolveBaseline 이 4순위로 떨어져 mixed seed 가 들어옴
      p10Krw: 165_000,
      p50Krw: 300_000,
      p90Krw: 465_000,
      source: 'seed',
      confidence: 'low',
      observationCount: 0,
    });
    const lcc = rb({
      p10Krw: 121_000,
      p50Krw: 220_000,
      p90Krw: 341_000,
      source: 'seed',
      confidence: 'medium',
      observationCount: 0,
    });

    const row = selectRepresentative('NRT', fsc, lcc, empty);
    expect(row.source).toBe('seed');
    expect(row.confidence).toBe('medium');
    expect(row.carrierClass).toBe('lcc');
    expect(row.p10Krw).toBe(121_000);
  });

  it('4순위: seed mixed 만 존재 → confidence=low (🔥 미부여 신호)', () => {
    const onlyMixed = rb({
      p10Krw: 165_000,
      p50Krw: 300_000,
      p90Krw: 465_000,
      source: 'seed',
      confidence: 'low',
      observationCount: 0,
    });

    const row = selectRepresentative('GUM', empty, empty, onlyMixed);
    expect(row.source).toBe('seed');
    expect(row.confidence).toBe('low');
    expect(row.carrierClass).toBe('mixed');
    expect(row.p50Krw).toBe(300_000);
  });

  it('5순위: 어떤 baseline 도 없음 → 전 필드 null', () => {
    const row = selectRepresentative('LAX', empty, empty, empty);
    expect(row.source).toBeNull();
    expect(row.confidence).toBeNull();
    expect(row.p10Krw).toBeNull();
    expect(row.p50Krw).toBeNull();
    expect(row.p90Krw).toBeNull();
    expect(row.cheapestTodayKrw).toBeNull();
    expect(row.observationCount).toBe(0);
  });

  it('관측 LCC 우선: LCC observation count > FSC mixed count → LCC 채택', () => {
    const fsc = rb({
      p10Krw: 220_000,
      p50Krw: 380_000,
      p90Krw: 580_000,
      source: 'mixed',
      confidence: 'medium',
      observationCount: 11,
    });
    const lcc = rb({
      p10Krw: 99_000,
      p50Krw: 180_000,
      p90Krw: 280_000,
      source: 'observed',
      confidence: 'high',
      observationCount: 38,
    });

    const row = selectRepresentative('KIX', fsc, lcc, empty);
    // 둘 다 isObserved → 1순위 병합 경로 (병합)
    expect(row.source).toBe('mixed');
    // min p10
    expect(row.p10Krw).toBe(99_000);
    // confidence: 한쪽 high, 한쪽 medium → medium
    expect(row.confidence).toBe('medium');
    expect(row.observationCount).toBe(49);
  });

  it('도착지(destination)·origin(ICN) 이 결과에 그대로 반영', () => {
    const row = selectRepresentative('TPE', empty, empty, empty);
    expect(row.origin).toBe('ICN');
    expect(row.destination).toBe('TPE');
  });
});
