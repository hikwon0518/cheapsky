// Server Component — 일별 TOP 5 아카이브 페이지 (Stretch 2, PRD "아카이브 페이지").
//
// 흐름 (ARCHITECTURE.md "아카이브 페이지 렌더 정책"):
//   1. params.date 형식 검증 (/^\d{4}-\d{2}-\d{2}$/) — 실패 시 notFound()
//   2. archive_snapshots WHERE date=params.date → deal_ids 배열 조회
//   3. deals WHERE id IN (deal_ids) — 아카이브 순서 유지
//   4. snapshot / price_changed / 만료 딜도 모두 표시 (그날의 기록이므로)
//   5. DealCard 에 showArchivedLabel=true 주입 → '당시 가격' 라벨
//
// Hard red lines:
// - 실시간 데이터로 대체 금지 — archive_snapshots.deal_ids 그대로 보여줌
// - middleware 가 share_token / Basic Auth 를 이미 검증
// - metadata.robots = noindex,nofollow (layout 에 이미 있지만 명시 안전)

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { DealCard } from '@/components/DealCard';
import { Header } from '@/components/Header';
import { getAnonClient } from '@/lib/db';
import type { Deal, Source, VerificationStatus } from '@/types/deal';

export const revalidate = 60;

export const metadata: Metadata = {
  // 모든 페이지 noindex 원칙 (ADR-008). layout 에 이미 있지만 명시.
  robots: { index: false, follow: false },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

type ArchivePageProps = {
  params: Promise<{ date: string }>;
};

export default async function ArchivePage({ params }: ArchivePageProps) {
  const { date } = await params;

  // 1) 형식 검증 — invalid 면 404.
  if (!DATE_RE.test(date)) {
    notFound();
  }

  let client;
  try {
    client = getAnonClient();
  } catch {
    return renderEmpty(date);
  }

  // 2) archive_snapshots → deal_ids
  let dealIds: string[] = [];
  try {
    const res = await client
      .from('archive_snapshots')
      .select('deal_ids, captured_at')
      .eq('date', date)
      .maybeSingle();
    if (res.error || !res.data) {
      return renderEmpty(date);
    }
    const row = res.data as { deal_ids: string[] | null };
    dealIds = (row.deal_ids ?? []).filter(
      (id): id is string => typeof id === 'string',
    );
  } catch {
    return renderEmpty(date);
  }

  if (dealIds.length === 0) {
    return renderEmpty(date);
  }

  // 3) deals IN (...) — 아카이브 순서 유지를 위해 결과를 dealIds 순으로 재정렬.
  let deals: Deal[] = [];
  try {
    const res = await client
      .from('deals')
      .select(DEAL_COLUMNS)
      .in('id', dealIds);
    if (!res.error && res.data) {
      const rows = (res.data as DealRow[]).map(rowToDeal);
      const byId = new Map(rows.map((d) => [d.id, d]));
      deals = dealIds
        .map((id) => byId.get(id))
        .filter((d): d is Deal => Boolean(d));
    }
  } catch {
    deals = [];
  }

  return (
    <>
      <Header />
      <main className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-6">
        <section aria-label={`${date} 아카이브`}>
          <h1 className="text-2xl font-semibold text-ink tracking-tight">
            {date} 아카이브
          </h1>
          <p className="mt-1 text-xs text-ink-4">
            이 날짜에 기록된 저점 딜 TOP {deals.length}.
          </p>
          {deals.length === 0 ? (
            <div className="mt-4 bg-card border border-line rounded-lg p-8 text-center">
              <p className="text-sm text-ink-2">
                기록된 딜이 모두 삭제되었어요.
              </p>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {deals.map((deal) => (
                <DealCard
                  key={deal.id}
                  deal={deal}
                  variant="list"
                  showArchivedLabel
                />
              ))}
            </div>
          )}
        </section>
      </main>
      <footer className="max-w-6xl mx-auto px-4 md:px-6 py-6 border-t border-line text-[11px] text-ink-4">
        <p>
          학습 프로젝트입니다. 구매·예약은 반드시 원본 출처 링크로 접속해주세요.
        </p>
      </footer>
    </>
  );
}

function renderEmpty(date: string) {
  return (
    <>
      <Header />
      <main className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-6">
        <section aria-label={`${date} 아카이브`}>
          <h1 className="text-2xl font-semibold text-ink tracking-tight">
            {date} 아카이브
          </h1>
          <div className="mt-4 bg-card border border-line rounded-lg p-8 text-center">
            <p className="text-sm text-ink-2">
              이 날짜의 기록이 없어요. 다른 날짜를 선택하세요.
            </p>
          </div>
        </section>
      </main>
      <footer className="max-w-6xl mx-auto px-4 md:px-6 py-6 border-t border-line text-[11px] text-ink-4">
        <p>
          학습 프로젝트입니다. 구매·예약은 반드시 원본 출처 링크로 접속해주세요.
        </p>
      </footer>
    </>
  );
}
