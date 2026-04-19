// /api/price-trace/[id] — 딜 id 기준 90일 가격 추이 (ADR-007 / UI_GUIDE Sparkline).
//
// 응답:
//   { points: { date: 'YYYY-MM-DD', priceKrw: number }[], lowest: number|null, highest: number|null }
//
// 흐름:
//   1. deals 에서 (origin, destination, carrier_class) 조회
//   2. 같은 (origin, destination, carrier_class) 의 최근 90일 price_observations
//   3. 같은 일자 여러 건은 최저가로 집계 (GROUP BY observed_at::date)
//
// Hard red lines:
//   - anon client 읽기만 (RLS 로 방어)
//   - body 텍스트 반환 금지 (ADR-008)
//   - middleware 가 share_token / Basic Auth 를 이미 검증 — 별도 방어 불필요
//   - Cache-Control: s-maxage=300, stale-while-revalidate=1800 (5분 캐시)
//
// Next.js 15 route 모듈은 GET/POST/... 외 export 가 금지되어 있어서
// 순수 로직은 `@/lib/price-trace` 로 분리했다 (`aggregateObservations`).

import { getAnonClient } from '@/lib/db';
import {
  aggregateObservations,
  type PriceObservationRow,
  type PriceTraceBody,
} from '@/lib/price-trace';
import { checkRate, extractIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DealRow = {
  origin: string;
  destination: string;
  carrier_class: 'fsc' | 'lcc' | 'mixed';
};

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;

  const empty: PriceTraceBody = { points: [], lowest: null, highest: null };

  // Rate limit: IP 당 60 req/min. burst 방어용 1차 게이트.
  const ip = extractIp(req);
  const rl = checkRate(ip);
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({ error: 'rate limited', resetAt: rl.resetAt }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Retry-After': String(
            Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)),
          ),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(rl.resetAt / 1000)),
        },
      },
    );
  }

  // uuid 형태가 아니면 바로 빈 응답. (잘못 호출된 요청에서 DB 왕복 방지)
  if (!id || !/^[0-9a-fA-F-]{8,40}$/.test(id)) {
    return respond(empty);
  }

  let client;
  try {
    client = getAnonClient();
  } catch {
    return respond(empty);
  }

  try {
    const dealRes = await client
      .from('deals')
      .select('origin, destination, carrier_class')
      .eq('id', id)
      .maybeSingle();

    if (dealRes.error || !dealRes.data) return respond(empty);
    const deal = dealRes.data as DealRow;

    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const obsRes = await client
      .from('price_observations')
      .select('price_krw, observed_at')
      .eq('origin', deal.origin)
      .eq('destination', deal.destination)
      .eq('carrier_class', deal.carrier_class)
      .gte('observed_at', cutoff.toISOString())
      .order('observed_at', { ascending: true });

    if (obsRes.error || !obsRes.data) return respond(empty);

    return respond(aggregateObservations(obsRes.data as PriceObservationRow[]));
  } catch {
    return respond(empty);
  }
}

function respond(body: PriceTraceBody): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 's-maxage=300, stale-while-revalidate=1800',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
