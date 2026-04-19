// Server Component — Discovery 대시보드 메인.
//
// 데이터 흐름 (ARCHITECTURE "데이터 흐름 (6) 렌더"):
//   1. parseFilters(searchParams) — 5종 필터 해석
//   2. SHOW_CACHED_ONLY → CacheOnlyBanner
//   3. heroTop3 쿼리 — hot_deal=true AND verification_status='active' AND expires_at > now() ORDER BY discount_rate DESC LIMIT 3
//      비면 폴백: 최근 7일 TOP 3 (discount_rate)
//   4. list 쿼리 — 필터 적용 50건
//   5. crawler_runs 최근 ppomppu success → SourceHealth
//   6. 뽐뿌 최근 success 가 2시간 초과면 StaleBanner
//
// Hard red lines:
// - Server Component only — `'use client'` 금지
// - `SHOW_CACHED_ONLY` 은 UI 전용 (ADR-028) — 쿼리는 평소와 동일
// - middleware 는 step 6 에서 붙으므로 여기선 인증 무관

import { Suspense } from 'react';

import { CacheOnlyBanner } from '@/components/CacheOnlyBanner';
import { CommunityPicks } from '@/components/CommunityPicks';
import { Counter, type CounterDeal } from '@/components/Counter';
import { CrawlerHealth, type SourceHealth } from '@/components/CrawlerHealth';
import { DealList } from '@/components/DealList';
import { FilterBar } from '@/components/FilterBar';
import { Header } from '@/components/Header';
import { Hero } from '@/components/Hero';
import { MarketHeatmap } from '@/components/MarketHeatmap';
import { CompareDrawer, type CompareRow } from '@/components/CompareDrawer';
import { MonthTiming } from '@/components/MonthTiming';
import { SavedStrip, type SavedStripDeal } from '@/components/SavedStrip';
import { StaleBanner } from '@/components/StaleBanner';
import { Timeline, buildTimelineEvents } from '@/components/Timeline';
import { Toast } from '@/components/Toast';
import { getAnonClient } from '@/lib/db';
import {
  REGION_TO_DESTINATIONS,
  monthWindow,
  parseFilters,
  serializeFilters,
  sinceCutoff,
  type Filters,
} from '@/lib/filters';
import { buildMarketHeatmap, type MarketRow } from '@/services/market-heatmap';
import { batchRouteFrequency, type FrequencyInfo } from '@/services/route-frequency';
import type { Deal, Source, VerificationStatus } from '@/types/deal';

// App Router Next.js 15: revalidate 60s (ARCHITECTURE "실시간 업데이트 UX").
export const revalidate = 60;

type DealRow = {
  id: string;
  dedupe_key: string;
  sources: string[];
  source_urls: string[];
  title: string;
  origin: string;
  destination: string;
  trip_type: 'oneway' | 'roundtrip';
  depart_from: string | null;
  depart_to: string | null;
  return_from: string | null;
  return_to: string | null;
  price_krw: number;
  carrier_code: string | null;
  carrier_class: 'fsc' | 'lcc' | 'mixed';
  baseline_krw: number | null;
  baseline_source: 'observed' | 'seed' | 'mixed' | null;
  baseline_confidence: 'low' | 'medium' | 'high' | null;
  discount_rate: number | string | null;
  price_percentile: number | string | null;
  hot_deal: boolean;
  curation_text: string | null;
  curation_generated_at: string | null;
  verification_status: VerificationStatus;
  verified_at: string | null;
  verification_fail_count: number;
  social_signal: 'hot' | 'trending' | null;
  posted_at: string;
  expires_at: string;
  body_expires_at: string;
  created_at: string;
};

function toDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}
function toDateReq(s: string): Date {
  return new Date(s);
}
function toNum(v: number | string | null): number | null {
  if (v === null) return null;
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowToDeal(r: DealRow): Deal {
  return {
    id: r.id,
    dedupeKey: r.dedupe_key,
    sources: (r.sources ?? []).filter((s): s is Source =>
      s === 'ppomppu' || s === 'ruliweb' || s === 'playwings',
    ),
    sourceUrls: r.source_urls ?? [],
    title: r.title,
    origin: r.origin,
    destination: r.destination,
    tripType: r.trip_type,
    departFrom: toDate(r.depart_from),
    departTo: toDate(r.depart_to),
    returnFrom: toDate(r.return_from),
    returnTo: toDate(r.return_to),
    priceKrw: r.price_krw,
    carrierCode: r.carrier_code,
    carrierClass: r.carrier_class,
    baselineKrw: r.baseline_krw,
    baselineSource: r.baseline_source,
    baselineConfidence: r.baseline_confidence,
    discountRate: toNum(r.discount_rate),
    pricePercentile: toNum(r.price_percentile),
    hotDeal: !!r.hot_deal,
    curationText: r.curation_text,
    curationGeneratedAt: toDate(r.curation_generated_at),
    verificationStatus: r.verification_status,
    verifiedAt: toDate(r.verified_at),
    verificationFailCount: r.verification_fail_count ?? 0,
    socialSignal: r.social_signal,
    postedAt: toDateReq(r.posted_at),
    expiresAt: toDateReq(r.expires_at),
    bodyExpiresAt: toDateReq(r.body_expires_at),
    createdAt: toDateReq(r.created_at),
  };
}

const DEAL_COLUMNS =
  'id, dedupe_key, sources, source_urls, title, origin, destination, trip_type, depart_from, depart_to, return_from, return_to, price_krw, carrier_code, carrier_class, baseline_krw, baseline_source, baseline_confidence, discount_rate, price_percentile, hot_deal, curation_text, curation_generated_at, verification_status, verified_at, verification_fail_count, social_signal, posted_at, expires_at, body_expires_at, created_at';

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

  const nowIso = now.toISOString();
  // "지나간 특가" 제외 — depart_from 이 오늘 이전이면 여행 날짜가 지나간 딜.
  // 단 depart_from 이 null (파서 실패) 이면 허용 (불명확한 경우는 노출).
  // Supabase `or` 문법: `depart_from.is.null,depart_from.gte.<today>`
  const todayIso = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
  const DEPART_FUTURE_OR_NULL = `depart_from.is.null,depart_from.gte.${todayIso}`;

  const regionDests =
    filters.region !== 'all'
      ? [...REGION_TO_DESTINATIONS[filters.region]]
      : null;
  const sinceDate = sinceCutoff(filters.since, now);
  const monthWin = filters.month ? monthWindow(filters.month) : null;

  // 1) heroTop3 — 활성 핫딜 상위 3. 현재 필터 적용 (사용자가 JP preset 시 Hero 도 JP 만).
  let heroTop3: Deal[] = [];
  try {
    let q = client
      .from('deals')
      .select(DEAL_COLUMNS)
      .eq('hot_deal', true)
      .eq('verification_status', 'active')
      .gt('expires_at', nowIso)
      .or(DEPART_FUTURE_OR_NULL)
      .gte('price_krw', 30000)
      .order('discount_rate', { ascending: false, nullsFirst: false })
      .limit(3);
    if (regionDests) q = q.in('destination', regionDests);
    if (filters.maxPrice !== null) q = q.lte('price_krw', filters.maxPrice);
    if (filters.minDiscount > 0)
      q = q.gte('discount_rate', filters.minDiscount / 100);
    if (sinceDate) q = q.gte('posted_at', sinceDate.toISOString());
    if (monthWin) {
      q = q
        .gte('depart_from', monthWin.startUtc.toISOString())
        .lt('depart_from', monthWin.endUtc.toISOString());
    }
    const res = await q;
    if (!res.error && res.data) {
      heroTop3 = (res.data as DealRow[]).map(rowToDeal);
    }
  } catch {
    heroTop3 = [];
  }

  // 2) heroTop3 비면 최근 7일 TOP 3 폴백. 동일 필터 적용.
  if (heroTop3.length === 0) {
    const sevenDaysAgo = new Date(
      now.getTime() - 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    try {
      let q = client
        .from('deals')
        .select(DEAL_COLUMNS)
        .gte('posted_at', sevenDaysAgo)
        .neq('verification_status', 'snapshot')
        .or(DEPART_FUTURE_OR_NULL)
        .gte('price_krw', 30000)
        .order('discount_rate', { ascending: false, nullsFirst: false })
        .limit(3);
      if (regionDests) q = q.in('destination', regionDests);
      if (filters.maxPrice !== null) q = q.lte('price_krw', filters.maxPrice);
      if (filters.minDiscount > 0)
        q = q.gte('discount_rate', filters.minDiscount / 100);
      if (monthWin) {
        q = q
          .gte('depart_from', monthWin.startUtc.toISOString())
          .lt('depart_from', monthWin.endUtc.toISOString());
      }
      const res = await q;
      if (!res.error && res.data) {
        heroTop3 = (res.data as DealRow[]).map(rowToDeal);
      }
    } catch {
      heroTop3 = [];
    }
  }

  // 3) communityPicks — social_signal IS NOT NULL, 활성 딜 상위 8건.
  //    hot > trending 순으로 정렬 (supabase 정렬은 알파벳순이라 'hot'<'trending' 이지만
  //    뒤집어 unstable 을 피하려고 여기서 수동 정렬).
  let communityPicks: Deal[] = [];
  try {
    let q = client
      .from('deals')
      .select(DEAL_COLUMNS)
      .not('social_signal', 'is', null)
      .eq('verification_status', 'active')
      .gt('expires_at', nowIso)
      .or(DEPART_FUTURE_OR_NULL)
      .gte('price_krw', 30000)
      .order('posted_at', { ascending: false })
      .limit(16);
    if (regionDests) q = q.in('destination', regionDests);
    if (filters.maxPrice !== null) q = q.lte('price_krw', filters.maxPrice);
    const res = await q;
    if (!res.error && res.data) {
      const rows = (res.data as DealRow[]).map(rowToDeal);
      const rank = (s: 'hot' | 'trending' | null) =>
        s === 'hot' ? 2 : s === 'trending' ? 1 : 0;
      rows.sort((a, b) => {
        const r = rank(b.socialSignal) - rank(a.socialSignal);
        if (r !== 0) return r;
        return b.postedAt.getTime() - a.postedAt.getTime();
      });
      communityPicks = rows.slice(0, 8);
    }
  } catch {
    communityPicks = [];
  }

  // 4) list — 필터 적용 최대 50건.
  let list: Deal[] = [];
  try {
    let q = client
      .from('deals')
      .select(DEAL_COLUMNS)
      .gt('expires_at', nowIso)
      .neq('verification_status', 'snapshot')
      .or(DEPART_FUTURE_OR_NULL)
      .gte('price_krw', 30000)
      .order('posted_at', { ascending: false })
      .limit(50);

    if (regionDests) {
      q = q.in('destination', regionDests);
    }
    if (filters.maxPrice !== null) {
      q = q.lte('price_krw', filters.maxPrice);
    }
    if (filters.minDiscount > 0) {
      q = q.gte('discount_rate', filters.minDiscount / 100);
    }
    if (sinceDate) {
      q = q.gte('posted_at', sinceDate.toISOString());
    }
    if (monthWin) {
      q = q
        .gte('depart_from', monthWin.startUtc.toISOString())
        .lt('depart_from', monthWin.endUtc.toISOString());
    }
    const res = await q;
    if (!res.error && res.data) {
      list = (res.data as DealRow[]).map(rowToDeal);
    }
  } catch {
    list = [];
  }

  // 5) crawler_runs 최근 success per source (Core: 뽐뿌).
  const sources: SourceHealth[] = [];
  let ppomppuLast: Date | null = null;
  try {
    const res = await client
      .from('crawler_runs')
      .select('source, started_at, finished_at, success')
      .eq('source', 'ppomppu')
      .eq('success', true)
      .order('started_at', { ascending: false })
      .limit(1);
    if (!res.error && res.data && res.data.length > 0) {
      const row = res.data[0] as {
        source: string;
        started_at: string;
        finished_at: string | null;
        success: boolean;
      };
      ppomppuLast = toDate(row.finished_at ?? row.started_at);
    }
  } catch {
    ppomppuLast = null;
  }
  sources.push({ source: 'ppomppu', label: '뽐뿌', lastSuccessAt: ppomppuLast });

  // 6) stale 여부: 뽐뿌 최근 2시간 성공 없음.
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const stale =
    !ppomppuLast || now.getTime() - ppomppuLast.getTime() > TWO_HOURS_MS;

  // 7) 20 노선 시세 히트맵 (Stretch 2, ADR-023). 실패 시 빈 배열 → 섹션 자체 렌더 생략.
  let marketRows: MarketRow[] = [];
  try {
    marketRows = await buildMarketHeatmap({ client, now });
  } catch {
    marketRows = [];
  }

  // 8) Counter (평소보다 비싼 노선, v5 "지금은 기다려보세요") — discount_rate <= -0.10
  let counterDeals: CounterDeal[] = [];
  try {
    const sevenDaysAgo = new Date(
      now.getTime() - 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const res = await client
      .from('deals')
      .select(
        'id, origin, destination, price_krw, baseline_krw, discount_rate, price_percentile',
      )
      .lte('discount_rate', -0.1)
      .gt('expires_at', nowIso)
      .or(DEPART_FUTURE_OR_NULL)
      .gte('posted_at', sevenDaysAgo)
      .neq('verification_status', 'snapshot')
      .order('discount_rate', { ascending: true })
      .limit(3);
    if (!res.error && res.data) {
      counterDeals = (res.data as Array<{
        id: string;
        origin: string;
        destination: string;
        price_krw: number;
        baseline_krw: number | null;
        discount_rate: number | null;
        price_percentile: number | null;
      }>).map((r) => ({
        id: r.id,
        origin: r.origin,
        destination: r.destination,
        priceKrw: r.price_krw,
        baselineKrw: r.baseline_krw,
        discountRate: r.discount_rate,
        pricePercentile: r.price_percentile,
      }));
    }
  } catch {
    counterDeals = [];
  }

  return { heroTop3, communityPicks, list, marketRows, sources, stale, counterDeals };
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

  // 노선 빈도 마이크로 지표 — list + Community Picks 딜을 한 번에 배치 집계.
  // 히어로는 UI_GUIDE 상 미노출이라 주입 대상 아님.
  const freqMap = await loadFrequencyMap(
    [...listUnique, ...communityPicksUnique],
    now,
  );

  // Timeline events (Light v5): 최근 24h 딜 흐름 — hero+picks+list 합해서 이벤트 생성
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
          available={[...data.heroTop3, ...communityPicksUnique, ...listUnique].map<SavedStripDeal>(
            (d) => ({
              destination: d.destination ?? '',
              priceKrw: d.priceKrw,
              baselineKrw: d.baselineKrw,
              hotDeal: d.hotDeal,
              discountRate: d.discountRate,
            }),
          )}
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

        {data.counterDeals.length > 0 ? (
          <Counter deals={data.counterDeals} />
        ) : null}

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
