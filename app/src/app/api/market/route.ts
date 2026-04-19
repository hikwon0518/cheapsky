// /api/market — 인천 출발 20 노선 시세 히트맵 데이터 (Stretch 2, ADR-023).
//
// 응답:
//   { rows: MarketRow[], generatedAt }
//
// Hard red lines:
//   - anon client 읽기만 (RLS 로 방어).
//   - ADR-022 Deprecated: source 'amadeus'/'api' 분기 금지 (services/market-heatmap 으로 위임).
//   - Cache-Control: s-maxage=600, stale-while-revalidate=3600 (10분 캐시, 30분 SWR).
//     히트맵은 한 시간 단위로 갱신해도 충분 (관측 재집계 주기 24h, 시드는 분기).
//   - X-Robots-Tag noindex (middleware 도 붙이지만 직접 호출 대비 명시).
//   - middleware 가 share_token / Basic Auth 를 이미 검증.

import { getAnonClient } from '@/lib/db';
import {
  buildMarketHeatmap,
  type MarketRow,
} from '@/services/market-heatmap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const generatedAt = new Date();
  const empty = (): Response =>
    respond({ rows: [], generatedAt });

  let client;
  try {
    client = getAnonClient();
  } catch {
    return empty();
  }

  try {
    const rows = await buildMarketHeatmap({ client, now: generatedAt });
    return respond({ rows, generatedAt });
  } catch {
    return empty();
  }
}

function respond(body: { rows: MarketRow[]; generatedAt: Date }): Response {
  return new Response(
    JSON.stringify({
      rows: body.rows,
      generatedAt: body.generatedAt.toISOString(),
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 's-maxage=600, stale-while-revalidate=3600',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    },
  );
}
