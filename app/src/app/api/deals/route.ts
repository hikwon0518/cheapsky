// /api/deals — 필터 적용 딜 JSON (step6.md "API 라우트").
//
// 쿼리 파라미터:
//   region / maxPrice / month / minDiscount / since   (src/lib/filters.ts 규약)
//
// 응답:
//   { deals: Deal[], count: number, filters: Filters, generatedAt }
//
// Hard red lines:
//   - parseFilters 를 page.tsx 와 공유 (src/lib/filters.ts 재사용, step 6 의도)
//   - anon client 읽기만
//   - X-Robots-Tag + Cache-Control 명시 (middleware 중복 OK)
//   - 원문 URL 은 공유해야 하지만 body 텍스트는 반환하지 않음 (저장 정책, ADR-008)

import { getAnonClient } from '@/lib/db';
import {
  REGION_TO_DESTINATIONS,
  monthWindow,
  parseFilters,
  sinceCutoff,
  type Filters,
} from '@/lib/filters';
import type { Source, VerificationStatus } from '@/types/deal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEAL_COLUMNS =
  'id, dedupe_key, sources, source_urls, title, origin, destination, trip_type, depart_from, depart_to, return_from, return_to, price_krw, carrier_code, carrier_class, baseline_krw, baseline_source, baseline_confidence, discount_rate, price_percentile, hot_deal, curation_text, curation_generated_at, verification_status, verified_at, verification_fail_count, social_signal, posted_at, expires_at, body_expires_at, created_at';

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

function toNum(v: number | string | null): number | null {
  if (v === null) return null;
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowToDealJson(r: DealRow) {
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
    departFrom: r.depart_from,
    departTo: r.depart_to,
    returnFrom: r.return_from,
    returnTo: r.return_to,
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
    curationGeneratedAt: r.curation_generated_at,
    verificationStatus: r.verification_status,
    verifiedAt: r.verified_at,
    verificationFailCount: r.verification_fail_count ?? 0,
    socialSignal: r.social_signal,
    postedAt: r.posted_at,
    expiresAt: r.expires_at,
    bodyExpiresAt: r.body_expires_at,
    createdAt: r.created_at,
  };
}

export async function GET(req: Request): Promise<Response> {
  const generatedAt = new Date();
  const url = new URL(req.url);
  const filters: Filters = parseFilters(url.searchParams);

  const emptyBody = (extra?: Record<string, unknown>) =>
    respond({
      deals: [],
      count: 0,
      filters,
      generatedAt,
      ...(extra ?? {}),
    });

  let client;
  try {
    client = getAnonClient();
  } catch {
    return emptyBody();
  }

  try {
    const nowIso = generatedAt.toISOString();
    let q = client
      .from('deals')
      .select(DEAL_COLUMNS)
      .gt('expires_at', nowIso)
      .neq('verification_status', 'snapshot')
      .order('posted_at', { ascending: false })
      .limit(50);

    if (filters.region !== 'all') {
      const dests = REGION_TO_DESTINATIONS[filters.region];
      q = q.in('destination', [...dests]);
    }
    if (filters.maxPrice !== null) {
      q = q.lte('price_krw', filters.maxPrice);
    }
    if (filters.minDiscount > 0) {
      q = q.gte('discount_rate', filters.minDiscount / 100);
    }
    const sinceDate = sinceCutoff(filters.since, generatedAt);
    if (sinceDate) {
      q = q.gte('posted_at', sinceDate.toISOString());
    }
    if (filters.month) {
      const win = monthWindow(filters.month);
      if (win) {
        q = q.gte('depart_from', win.startUtc.toISOString());
        q = q.lt('depart_from', win.endUtc.toISOString());
      }
    }

    const res = await q;
    if (res.error || !res.data) {
      return emptyBody();
    }
    const deals = (res.data as DealRow[]).map(rowToDealJson);
    return respond({
      deals,
      count: deals.length,
      filters,
      generatedAt,
    });
  } catch {
    return emptyBody();
  }
}

function respond(body: {
  deals: ReturnType<typeof rowToDealJson>[];
  count: number;
  filters: Filters;
  generatedAt: Date;
}): Response {
  return new Response(
    JSON.stringify({
      deals: body.deals,
      count: body.count,
      filters: body.filters,
      generatedAt: body.generatedAt.toISOString(),
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 's-maxage=30, stale-while-revalidate=60',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    },
  );
}
