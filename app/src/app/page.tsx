// Server Component — Discovery 대시보드 메인. Orchestration 전용.
//
// 데이터 로드는 `services/home-queries.ts` 로 분리 (B-5 리팩토링 2026-04-19).
// 이 파일은:
//   1. parseFilters(searchParams)
//   2. 6개 쿼리를 home-queries 헬퍼로 병렬 실행 (현재는 순차 — Supabase 요청 절감)
//   3. dedupe · freqMap · timeline events 계산
//   4. 컴포넌트 렌더
//
// Hard red lines:
// - Server Component only — `'use client'` 금지
// - `SHOW_CACHED_ONLY` 은 UI 전용 (ADR-028)

import { Suspense } from 'react';

import { CacheOnlyBanner } from '@/components/CacheOnlyBanner';
import { CommunityPicks } from '@/components/CommunityPicks';
import { CompareDrawer, type CompareRow } from '@/components/CompareDrawer';
import { Counter, type CounterDeal } from '@/components/Counter';
import { CrawlerHealth, type SourceHealth } from '@/components/CrawlerHealth';
import { DealList } from '@/components/DealList';
import { FilterBar } from '@/components/FilterBar';
import { Header } from '@/components/Header';
import { Hero } from '@/components/Hero';
import { MarketHeatmap } from '@/components/MarketHeatmap';
import { MonthTiming } from '@/components/MonthTiming';
import { SavedStrip, type SavedStripDeal } from '@/components/SavedStrip';
import { StaleBanner } from '@/components/StaleBanner';
import { Timeline, buildTimelineEvents } from '@/components/Timeline';
import { Toast } from '@/components/Toast';
import { getAnonClient } from '@/lib/db';
import { parseFilters, serializeFilters, type Filters } from '@/lib/filters';
import {
  buildFilterCtx,
  loadCommunityPicks,
  loadCounterDeals,
  loadCrawlerHealth,
  loadDealList,
  loadHeroTop3,
  loadMarketRows,
} from '@/services/home-queries';
import type { MarketRow } from '@/services/market-heatmap';
import {
  batchRouteFrequency,
  type FrequencyInfo,
} from '@/services/route-frequency';
import type { Deal } from '@/types/deal';

export const revalidate = 60;

type DataBundle = {
  heroTop3: Deal[];
  communityPicks: Deal[];
  list: Deal[];
  marketRows: MarketRow[];
  sources: SourceHealth[];
  stale: boolean;
  counterDeals: CounterDeal[];
};

async function loadData(filters: Filters, now: Date): Promise<DataBundle> {
  let client;
  try {
    client = getAnonClient();
  } catch {
    return {
      heroTop3: [],
      communityPicks: [],
      list: [],
      marketRows: [],
      sources: [],
      stale: false,
      counterDeals: [],
    };
  }

  const ctx = buildFilterCtx(filters, now);

  const [
    heroTop3,
    communityPicks,
    list,
    marketRows,
    health,
    counterDeals,
  ] = await Promise.all([
    loadHeroTop3(client, filters, ctx, now),
    loadCommunityPicks(client, filters, ctx),
    loadDealList(client, filters, ctx),
    loadMarketRows(client, now),
    loadCrawlerHealth(client, now),
    loadCounterDeals(client, now, ctx),
  ]);

  return {
    heroTop3,
    communityPicks,
    list,
    marketRows,
    sources: health.sources,
    stale: health.stale,
    counterDeals,
  };
}

async function loadFrequencyMap(
  deals: ReadonlyArray<Pick<Deal, 'id' | 'origin' | 'destination' | 'postedAt'>>,
  now: Date,
): Promise<Map<string, FrequencyInfo>> {
  if (deals.length === 0) return new Map();
  try {
    const client = getAnonClient();
    return await batchRouteFrequency(deals, client, now);
  } catch {
    return new Map();
  }
}

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: PageProps) {
  const raw = searchParams ? await searchParams : {};
  const filters = parseFilters(raw);
  const showCachedOnly = process.env.SHOW_CACHED_ONLY === 'true';
  const now = new Date();

  const data = await loadData(filters, now);

  const shareQuery = serializeFilters(filters).toString();

  // 섹션 간 중복 제거: Hero > CommunityPicks > list.
  const heroIds = new Set(data.heroTop3.map((d) => d.id));
  const communityPicksUnique = data.communityPicks.filter(
    (d) => !heroIds.has(d.id),
  );
  const picksIds = new Set(communityPicksUnique.map((d) => d.id));
  const listUnique = data.list.filter(
    (d) => !heroIds.has(d.id) && !picksIds.has(d.id),
  );

  const freqMap = await loadFrequencyMap(
    [...listUnique, ...communityPicksUnique],
    now,
  );

  // Timeline events: 최근 24h 딜 흐름 — hero+picks+list 합해서 이벤트 생성
  const timelineEvents = buildTimelineEvents(
    [...data.heroTop3, ...communityPicksUnique, ...listUnique],
    freqMap,
    now,
    7,
  );

  return (
    <>
      <Header />
      {showCachedOnly ? <CacheOnlyBanner /> : null}
      {data.stale ? <StaleBanner /> : null}
      <Suspense fallback={null}>
        <FilterBar initial={filters} />
      </Suspense>
      <main className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-8">
        {data.heroTop3.length > 0 ? (
          <Hero deals={data.heroTop3} shareQuery={shareQuery} now={now} />
        ) : null}

        <SavedStrip
          available={[
            ...data.heroTop3,
            ...communityPicksUnique,
            ...listUnique,
          ].map<SavedStripDeal>((d) => ({
            destination: d.destination ?? '',
            priceKrw: d.priceKrw,
            baselineKrw: d.baselineKrw,
            hotDeal: d.hotDeal,
            discountRate: d.discountRate,
          }))}
        />

        {/* Timeline + MonthTiming 2-column (Cheapsky Light v5) */}
        {timelineEvents.length > 0 ? (
          <section className="grid grid-cols-1 lg:grid-cols-5 gap-5">
            <div className="lg:col-span-3">
              <Timeline events={timelineEvents} now={now} />
            </div>
            <div className="lg:col-span-2">
              <MonthTiming />
            </div>
          </section>
        ) : (
          <MonthTiming />
        )}

        {communityPicksUnique.length > 0 ? (
          <CommunityPicks
            deals={communityPicksUnique}
            shareQuery={shareQuery}
            now={now}
            freqMap={freqMap}
          />
        ) : null}
        <section aria-label="전체 딜 리스트">
          <DealList
            deals={listUnique}
            shareQuery={shareQuery}
            now={now}
            freqMap={freqMap}
          />
        </section>
        {data.marketRows.length > 0 ? (
          <MarketHeatmap rows={data.marketRows} now={now} />
        ) : null}
        {data.counterDeals.length > 0 ? (
          <Counter deals={data.counterDeals} />
        ) : null}
      </main>
      <footer className="max-w-6xl mx-auto px-4 md:px-6 py-6 border-t border-line text-[11px] text-ink-4 flex flex-wrap justify-between gap-4">
        <p>
          학습 프로젝트입니다. 구매·예약은 반드시 원본 출처 링크로 접속해주세요.
        </p>
        <CrawlerHealth sources={data.sources} now={now} />
      </footer>
      {data.heroTop3.length > 0 ? (
        <Toast
          latestDealId={data.heroTop3[0].id}
          destination={data.heroTop3[0].destination}
          priceKrw={data.heroTop3[0].priceKrw}
          discountPct={
            data.heroTop3[0].discountRate !== null
              ? Math.round(data.heroTop3[0].discountRate * 100)
              : null
          }
          sourceUrl={data.heroTop3[0].sourceUrls[0] ?? null}
        />
      ) : null}
      <CompareDrawer
        rows={data.marketRows.map<CompareRow>((r) => ({
          destination: r.destination,
          priceKrw: r.cheapestTodayKrw,
          p50Krw: r.p50Krw,
          carrierClass: r.carrierClass,
        }))}
      />
    </>
  );
}
