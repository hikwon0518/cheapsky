// /api/health — 크롤러 소스별 최근 성공 시각 요약 (ADR-002, ARCHITECTURE "관측/운영").
//
// 출력:
//   {
//     sources: { ppomppu: { lastSuccess, ageSeconds, status } },
//     generatedAt
//   }
//
// Core 범위: 뽐뿌 1 소스만 노출 (루리웹·플레이윙즈 Stretch 1).
// Stretch 에서 sources 객체에 항목 추가될 예정.
//
// Hard red lines:
//   - X-Robots-Tag 항상 (middleware 도 붙이지만 직접 호출 대비 명시).
//   - service_role 사용 금지 — 읽기 전용 (anon client).

import { getAnonClient } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SourceHealth = {
  lastSuccess: string | null;
  ageSeconds: number | null;
  status: 'active' | 'stale' | 'failed';
};

// 2 시간 이상 성공 없으면 stale (ADR / ARCHITECTURE 동일 기준).
const STALE_THRESHOLD_SECONDS = 2 * 60 * 60;

const CORE_SOURCES = ['ppomppu'] as const;
type CoreSource = (typeof CORE_SOURCES)[number];

type RunRow = {
  source: string;
  started_at: string;
  finished_at: string | null;
  success: boolean;
};

function computeStatus(ageSeconds: number | null): SourceHealth['status'] {
  if (ageSeconds === null) return 'failed';
  if (ageSeconds > STALE_THRESHOLD_SECONDS) return 'stale';
  return 'active';
}

export async function GET(): Promise<Response> {
  const generatedAt = new Date();
  const sources: Record<CoreSource, SourceHealth> = {
    ppomppu: { lastSuccess: null, ageSeconds: null, status: 'failed' },
  };

  let client;
  try {
    client = getAnonClient();
  } catch {
    return respond({ sources, generatedAt });
  }

  try {
    const res = await client
      .from('crawler_runs')
      .select('source, started_at, finished_at, success')
      .in('source', CORE_SOURCES as unknown as string[])
      .eq('success', true)
      .order('started_at', { ascending: false })
      .limit(20);

    if (!res.error && res.data) {
      const latestBySource = new Map<string, RunRow>();
      for (const r of res.data as RunRow[]) {
        if (!latestBySource.has(r.source)) {
          latestBySource.set(r.source, r);
        }
      }
      for (const src of CORE_SOURCES) {
        const row = latestBySource.get(src);
        if (!row) continue;
        const t = row.finished_at ?? row.started_at;
        const d = new Date(t);
        if (!Number.isFinite(d.getTime())) continue;
        const ageSeconds = Math.max(
          0,
          Math.floor((generatedAt.getTime() - d.getTime()) / 1000),
        );
        sources[src] = {
          lastSuccess: d.toISOString(),
          ageSeconds,
          status: computeStatus(ageSeconds),
        };
      }
    }
  } catch {
    // keep defaults (failed)
  }

  return respond({ sources, generatedAt });
}

function respond(body: {
  sources: Record<CoreSource, SourceHealth>;
  generatedAt: Date;
}): Response {
  return new Response(
    JSON.stringify({
      sources: body.sources,
      generatedAt: body.generatedAt.toISOString(),
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        // 30초 edge 캐시 + 60초 SWR.
        'Cache-Control': 's-maxage=30, stale-while-revalidate=60',
        // middleware 도 붙이지만 직접 호출 대비 명시.
        'X-Robots-Tag': 'noindex, nofollow',
      },
    },
  );
}
