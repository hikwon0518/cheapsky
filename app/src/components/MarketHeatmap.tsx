// Server Component. 오늘의 노선 시세 히트맵 (Stretch 2, ADR-023, UI_GUIDE 히트맵).
//
// 데스크톱: grid grid-cols-5 gap-2 (5×4 = 20 셀)
// 모바일: 가장 싼 3 노선 프리뷰 + 토글 버튼 → 펼치면 나머지 17 행
//
// Hard red lines:
//   - 셀 클릭은 외부 새 탭 (MarketCard 가 처리)
//   - 데이터 0건이면 섹션 자체 렌더 생략
//   - 카드 모서리 표준은 rounded-md (UI_GUIDE)
//   - "역대가" / "Amadeus" 문자열 금지

import { HeatmapMobileToggle } from '@/components/HeatmapMobileToggle';
import { MarketCard } from '@/components/MarketCard';
import {
  HEATMAP_DESTINATIONS,
  type MarketRow,
} from '@/services/market-heatmap';

type Props = {
  rows: readonly MarketRow[];
  now?: Date;
};

const PREVIEW_COUNT = 3;

export function MarketHeatmap({ rows, now }: Props) {
  if (!rows || rows.length === 0) return null;

  // 데스크톱 표시 순서: ADR-021 노선 순서 고정 (HEATMAP_DESTINATIONS).
  const orderIndex = new Map<string, number>();
  HEATMAP_DESTINATIONS.forEach((d, i) => orderIndex.set(d, i));
  const desktopRows = [...rows].sort(
    (a, b) =>
      (orderIndex.get(a.destination) ?? 999) -
      (orderIndex.get(b.destination) ?? 999),
  );

  // 모바일 프리뷰: 가장 싼 3 노선 (cheapestTodayKrw 또는 p10 기준 오름차순).
  // null 가격은 뒤로 밀고, 동률은 노선 순서로.
  const sortableKey = (r: MarketRow): number => {
    const v = r.cheapestTodayKrw ?? r.p10Krw;
    return v ?? Number.POSITIVE_INFINITY;
  };
  const sortedByPrice = [...rows].sort((a, b) => {
    const diff = sortableKey(a) - sortableKey(b);
    if (diff !== 0) return diff;
    return (
      (orderIndex.get(a.destination) ?? 999) -
      (orderIndex.get(b.destination) ?? 999)
    );
  });
  const previewRows = sortedByPrice.slice(0, PREVIEW_COUNT);
  const previewIds = new Set(previewRows.map((r) => r.destination));
  // 나머지 17은 ADR-021 순서대로 표시 (프리뷰에 든 노선 제외).
  const restRows = desktopRows.filter((r) => !previewIds.has(r.destination));

  const previewNodes = previewRows.map((row) => (
    <MarketCard
      key={`preview-${row.destination}`}
      row={row}
      variant="row"
      now={now}
    />
  ));
  const restNodes = restRows.map((row) => (
    <MarketCard
      key={`rest-${row.destination}`}
      row={row}
      variant="row"
      now={now}
    />
  ));

  return (
    <section
      aria-label="오늘의 노선 시세"
      className="rounded-xl bg-card border border-line p-5 md:p-6 animate-fade-in"
    >
      <header className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-lg font-medium text-ink">오늘의 노선 시세</h2>
        <span className="text-xs text-ink-4">
          인천 출발 주요 20개 노선 오늘 최저가
        </span>
      </header>

      {/* 데스크톱: 5×4 그리드. 모바일에서는 hidden. */}
      <div
        role="list"
        aria-label="20 노선 시세 셀"
        className="hidden md:grid grid-cols-5 gap-2"
      >
        {desktopRows.map((row) => (
          <div role="listitem" key={`cell-${row.destination}`}>
            <MarketCard row={row} now={now} />
          </div>
        ))}
      </div>

      {/* 모바일: 프리뷰 3 + 토글로 나머지 펼침. */}
      <div className="md:hidden">
        <HeatmapMobileToggle
          preview={previewNodes}
          rest={restNodes}
          restCount={restNodes.length}
        />
      </div>
    </section>
  );
}
