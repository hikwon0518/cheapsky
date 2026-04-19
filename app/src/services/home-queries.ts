// Home page data access layer.
// page.tsx 를 orchestration 전용으로 축소하고 6개 Supabase 쿼리를 여기로 모음.
// filter chain 중복을 applyDealFilters 로 제거.

import type { SupabaseClient } from '@supabase/supabase-js';

import type { SourceHealth } from '@/components/CrawlerHealth';
import type { CounterDeal } from '@/components/Counter';
import {
  REGION_TO_DESTINATIONS,
  monthWindow,
  sinceCutoff,
  type Filters,
} from '@/lib/filters';
import { buildMarketHeatmap, type MarketRow } from '@/services/market-heatmap';
import type { Deal, Source, VerificationStatus } from '@/types/deal';

// ──────────────────────────────────────────────────────────────
// Row ↔ Deal 변환
// ──────────────────────────────────────────────────────────────

export type DealRow = {
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

export function rowToDeal(r: DealRow): Deal {
  return {
    id: r.id,
    dedupeKey: r.dedupe_key,
    sources: (r.sources ?? []).filter(
      (s): s is Source =>
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

export const DEAL_COLUMNS =
  'id, dedupe_key, sources, source_urls, title, origin, destination, trip_type, depart_from, depart_to, return_from, return_to, price_krw, carrier_code, carrier_class, baseline_krw, baseline_source, baseline_confidence, discount_rate, price_percentile, hot_deal, curation_text, curation_generated_at, verification_status, verified_at, verification_fail_count, social_signal, posted_at, expires_at, body_expires_at, created_at';

// ──────────────────────────────────────────────────────────────
// Query composition — 공통 필터
// ──────────────────────────────────────────────────────────────

/**
 * 공통 제약값을 한 번에 계산. page.tsx 는 이 helper 를 쓰는 쿼리를 여러 개 조합.
 */
export function buildFilterCtx(filters: Filters, now: Date) {
  const nowIso = now.toISOString();
  const todayIso = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
  return {
    nowIso,
    // "지나간 특가" 제외 — depart_from 이 오늘 이전이면 배제 (null 은 허용).
    departFutureOrNull: `depart_from.is.null,depart_from.gte.${todayIso}`,
    regionDests:
      filters.region !== 'all'
        ? [...REGION_TO_DESTINATIONS[filters.region]]
        : null,
    sinceDate: sinceCutoff(filters.since, now),
    monthWin: filters.month ? monthWindow(filters.month) : null,
  };
}

type FilterCtx = ReturnType<typeof buildFilterCtx>;

/**
 * region/price/month/discount 를 query 에 적용.
 * since 는 caller 가 posted_at 로 적용 여부 결정 (fallback 쿼리는 7일 고정이라 skip 가능).
 */
function applyFiltersToDealQuery<T>(
  q: T,
  filters: Filters,
  ctx: FilterCtx,
  opts: { applySince?: boolean } = {},
): T {
  const { applySince = true } = opts;
  // 타입 캐스트: supabase-js query builder 는 체이닝되는 제네릭 타입이라 any 로 우회.
  let qq = q as unknown as {
    in: (c: string, v: string[]) => typeof qq;
    lte: (c: string, v: number) => typeof qq;
    gte: (c: string, v: string | number) => typeof qq;
    lt: (c: string, v: string | number) => typeof qq;
  };

  if (ctx.regionDests) qq = qq.in('destination', ctx.regionDests);
  if (filters.maxPrice !== null) qq = qq.lte('price_krw', filters.maxPrice);
  if (filters.minDiscount > 0)
    qq = qq.gte('discount_rate', filters.minDiscount / 100);
  if (applySince && ctx.sinceDate)
    qq = qq.gte('posted_at', ctx.sinceDate.toISOString());
  if (ctx.monthWin) {
    qq = qq
      .gte('depart_from', ctx.monthWin.startUtc.toISOString())
      .lt('depart_from', ctx.monthWin.endUtc.toISOString());
  }
  return qq as unknown as T;
}

// ──────────────────────────────────────────────────────────────
// 개별 쿼리들
// ──────────────────────────────────────────────────────────────

type Client = SupabaseClient;

/**
 * heroTop3 — 활성 hot_deal 상위 3. 비면 최근 7일 폴백.
 */
export async function loadHeroTop3(
  client: Client,
  filters: Filters,
  ctx: FilterCtx,
  now: Date,
): Promise<Deal[]> {
  try {
    let q = client
      .from('deals')
      .select(DEAL_COLUMNS)
      .eq('hot_deal', true)
      .eq('verification_status', 'active')
      .gt('expires_at', ctx.nowIso)
      .or(ctx.departFutureOrNull)
      .gte('price_krw', 50000)
      .order('discount_rate', { ascending: false, nullsFirst: false })
      .limit(3);
    q = applyFiltersToDealQuery(q, filters, ctx);
    const res = await q;
    if (!res.error && res.data) {
      const rows = (res.data as DealRow[]).map(rowToDeal);
      if (rows.length > 0) return rows;
    }
  } catch {
    // fall through to fallback
  }

  // fallback: 최근 7일 TOP 3
  const sevenDaysAgo = new Date(
    now.getTime() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  try {
    let q = client
      .from('deals')
      .select(DEAL_COLUMNS)
      .gte('posted_at', sevenDaysAgo)
      .neq('verification_status', 'snapshot')
      .or(ctx.departFutureOrNull)
      .gte('price_krw', 50000)
      .order('discount_rate', { ascending: false, nullsFirst: false })
      .limit(3);
    q = applyFiltersToDealQuery(q, filters, ctx, { applySince: false });
    const res = await q;
    if (!res.error && res.data) {
      return (res.data as DealRow[]).map(rowToDeal);
    }
  } catch {
    // ignore
  }
  return [];
}

/**
 * communityPicks — social_signal IS NOT NULL 상위 8. hot > trending > postedAt desc.
 */
export async function loadCommunityPicks(
  client: Client,
  filters: Filters,
  ctx: FilterCtx,
): Promise<Deal[]> {
  try {
    let q = client
      .from('deals')
      .select(DEAL_COLUMNS)
      .not('social_signal', 'is', null)
      .eq('verification_status', 'active')
      .gt('expires_at', ctx.nowIso)
      .or(ctx.departFutureOrNull)
      .gte('price_krw', 50000)
      .order('posted_at', { ascending: false })
      .limit(16);
    if (ctx.regionDests) q = q.in('destination', ctx.regionDests);
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
      return rows.slice(0, 8);
    }
  } catch {
    // ignore
  }
  return [];
}

/**
 * list — 필터 적용 최대 50건. 기본 정렬 posted_at desc.
 */
export async function loadDealList(
  client: Client,
  filters: Filters,
  ctx: FilterCtx,
): Promise<Deal[]> {
  try {
    let q = client
      .from('deals')
      .select(DEAL_COLUMNS)
      .gt('expires_at', ctx.nowIso)
      .neq('verification_status', 'snapshot')
      .or(ctx.departFutureOrNull)
      .gte('price_krw', 50000)
      .order('posted_at', { ascending: false })
      .limit(50);
    q = applyFiltersToDealQuery(q, filters, ctx);
    const res = await q;
    if (!res.error && res.data) {
      return (res.data as DealRow[]).map(rowToDeal);
    }
  } catch {
    // ignore
  }
  return [];
}

/**
 * sourceHealth (뽐뿌 최근 성공) + stale 여부. Core.
 */
export async function loadCrawlerHealth(
  client: Client,
  now: Date,
): Promise<{ sources: SourceHealth[]; stale: boolean }> {
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
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
        started_at: string;
        finished_at: string | null;
      };
      const s = row.finished_at ?? row.started_at;
      const d = s ? new Date(s) : null;
      ppomppuLast = d && Number.isFinite(d.getTime()) ? d : null;
    }
  } catch {
    ppomppuLast = null;
  }
  const sources: SourceHealth[] = [
    { source: 'ppomppu', label: '뽐뿌', lastSuccessAt: ppomppuLast },
  ];
  const stale =
    !ppomppuLast || now.getTime() - ppomppuLast.getTime() > TWO_HOURS_MS;
  return { sources, stale };
}

/**
 * marketRows — 20 노선 시세 히트맵 (Stretch 2, ADR-023).
 */
export async function loadMarketRows(
  client: Client,
  now: Date,
): Promise<MarketRow[]> {
  try {
    return await buildMarketHeatmap({ client, now });
  } catch {
    return [];
  }
}

/**
 * counterDeals — 평소보다 비싼 노선 3개 (discount_rate <= -0.10).
 */
export async function loadCounterDeals(
  client: Client,
  now: Date,
  ctx: FilterCtx,
): Promise<CounterDeal[]> {
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
      .gt('expires_at', ctx.nowIso)
      .or(ctx.departFutureOrNull)
      .gte('posted_at', sevenDaysAgo)
      .neq('verification_status', 'snapshot')
      .order('discount_rate', { ascending: true })
      .limit(3);
    if (!res.error && res.data) {
      return (
        res.data as Array<{
          id: string;
          origin: string;
          destination: string;
          price_krw: number;
          baseline_krw: number | null;
          discount_rate: number | null;
          price_percentile: number | null;
        }>
      ).map((r) => ({
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
    // ignore
  }
  return [];
}
