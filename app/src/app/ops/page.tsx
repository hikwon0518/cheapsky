// Server Component. 운영 대시보드 (`/ops`).
// 최근 24h 각 source 의 crawler_runs · deal_verifications · api_usage_daily 를
// 한 장에 요약. "뭔가 이상해" → 1분 내 원인 특정.
//
// 접근 제어: OPS_ACCESS_TOKEN env 기반 쿼리 토큰 (2026-04-19 QA 회고).
//   env 미설정 → 404 로 위장 (페이지 존재 숨김)
//   env 설정 + URL ?key=<token> 일치 → 통과
//   불일치 → 404

import { notFound } from 'next/navigation';

import { getAnonClient, getServiceClient } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'Cheapsky · Ops',
  robots: { index: false, follow: false },
};

type CrawlerRunRow = {
  source: string;
  started_at: string;
  finished_at: string | null;
  success: boolean;
  processed: number | null;
  saved: number | null;
  errors: unknown;
};

type VerificationBucket = {
  status: string;
  cnt: number;
};

type UsageRow = {
  date: string;
  anthropic_tokens_in: number | null;
  anthropic_tokens_out: number | null;
  supabase_rows_total: number | null;
};

async function loadOps() {
  let client;
  try {
    client = getServiceClient();
  } catch {
    // fallback to anon — api_usage_daily / deal_verifications 정책 제거된 상태면 빈 결과
    client = getAnonClient();
  }

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // 1) crawler_runs last 24h, group by source
  const runs = await client
    .from('crawler_runs')
    .select('source, started_at, finished_at, success, processed, saved, errors')
    .gte('started_at', since24h)
    .order('started_at', { ascending: false })
    .limit(200);

  const bySource = new Map<string, CrawlerRunRow[]>();
  for (const row of (runs.data ?? []) as CrawlerRunRow[]) {
    const key = row.source ?? 'unknown';
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key)!.push(row);
  }

  // 2) deal_verifications status 분포
  let verificationBuckets: VerificationBucket[] = [];
  try {
    const v = await client
      .from('deal_verifications')
      .select('status')
      .gte('verified_at', since24h);
    if (v.data) {
      const bucket = new Map<string, number>();
      for (const row of v.data as { status: string }[]) {
        bucket.set(row.status, (bucket.get(row.status) ?? 0) + 1);
      }
      verificationBuckets = Array.from(bucket.entries()).map(([status, cnt]) => ({
        status,
        cnt,
      }));
    }
  } catch {
    verificationBuckets = [];
  }

  // 3) api_usage_daily 최근 7일
  let usage: UsageRow[] = [];
  try {
    const u = await client
      .from('api_usage_daily')
      .select('date, anthropic_tokens_in, anthropic_tokens_out, supabase_rows_total')
      .order('date', { ascending: false })
      .limit(7);
    if (u.data) usage = u.data as UsageRow[];
  } catch {
    usage = [];
  }

  return { bySource, verificationBuckets, usage };
}

function formatKrwTimestamp(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

type OpsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function OpsPage({ searchParams }: OpsPageProps) {
  // Access token gate (2026-04-19 QA): OPS_ACCESS_TOKEN env 기반 쿼리 토큰.
  const expected = process.env.OPS_ACCESS_TOKEN;
  const params = searchParams ? await searchParams : {};
  const provided = typeof params.key === 'string' ? params.key : null;
  if (!expected || !provided || provided !== expected) {
    notFound();
  }

  const { bySource, verificationBuckets, usage } = await loadOps();
  const now = new Date();

  return (
    <main className="max-w-6xl mx-auto px-4 md:px-6 py-8 space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-ink tracking-tight">
          Cheapsky Ops
        </h1>
        <p className="mt-1 text-[12.5px] text-ink-4 tabular-nums">
          최근 24시간 ({formatKrwTimestamp(now.toISOString())} UTC 기준)
        </p>
      </header>

      {/* Crawler runs per source */}
      <section aria-label="크롤러 실행 현황" className="space-y-3">
        <h2 className="text-[14px] font-semibold text-ink">크롤러 실행 (24h)</h2>
        {bySource.size === 0 ? (
          <p className="text-[12px] text-ink-4 italic">
            최근 24시간 내 크롤러 실행 없음.
          </p>
        ) : (
          Array.from(bySource.entries()).map(([source, rows]) => {
            const successCount = rows.filter((r) => r.success).length;
            const failCount = rows.length - successCount;
            const totalSaved = rows.reduce((acc, r) => acc + (r.saved ?? 0), 0);
            const totalProcessed = rows.reduce(
              (acc, r) => acc + (r.processed ?? 0),
              0,
            );
            const latestErrors = rows.find(
              (r) => !r.success && r.errors && Array.isArray(r.errors) && (r.errors as unknown[]).length > 0,
            )?.errors as unknown[] | undefined;
            return (
              <div
                key={source}
                className="rounded-lg border border-line bg-card p-4 space-y-2"
              >
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="text-[13px] font-semibold text-ink uppercase tracking-wide">
                    {source}
                  </span>
                  <span className="text-[11.5px] text-ink-4 tabular-nums">
                    {rows.length} runs · {successCount} ok · {failCount} fail ·
                    processed {totalProcessed} · saved {totalSaved}
                  </span>
                </div>
                <ul className="text-[11.5px] text-ink-3 space-y-1 tabular-nums font-mono">
                  {rows.slice(0, 5).map((r, i) => (
                    <li key={`${r.started_at}-${i}`}>
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full mr-2 ${
                          r.success ? 'bg-low' : 'bg-up'
                        }`}
                        aria-hidden="true"
                      />
                      {formatKrwTimestamp(r.started_at)} · saved{' '}
                      {r.saved ?? '—'} / processed {r.processed ?? '—'}
                    </li>
                  ))}
                </ul>
                {latestErrors && latestErrors.length > 0 ? (
                  <details className="text-[11.5px] text-ink-3">
                    <summary className="cursor-pointer text-up">
                      최근 에러 {latestErrors.length}건 ▸
                    </summary>
                    <pre className="mt-2 p-2 bg-surface-2 rounded text-[10.5px] overflow-auto">
                      {JSON.stringify(latestErrors.slice(0, 5), null, 2)}
                    </pre>
                  </details>
                ) : null}
              </div>
            );
          })
        )}
      </section>

      {/* Verification buckets */}
      <section aria-label="딜 검증 상태">
        <h2 className="text-[14px] font-semibold text-ink mb-2">
          딜 검증 상태 (24h)
        </h2>
        {verificationBuckets.length === 0 ? (
          <p className="text-[12px] text-ink-4 italic">
            검증 이력 접근 불가 (RLS) 또는 데이터 없음.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {verificationBuckets.map((b) => (
              <span
                key={b.status}
                className={`chip tabular-nums ${
                  b.status === 'active'
                    ? 'chip-low'
                    : b.status === 'snapshot'
                      ? 'chip-up'
                      : 'chip-warn'
                }`}
              >
                {b.status} {b.cnt}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* API usage */}
      <section aria-label="API 사용량">
        <h2 className="text-[14px] font-semibold text-ink mb-2">
          Anthropic API 사용량 (최근 7일)
        </h2>
        {usage.length === 0 ? (
          <p className="text-[12px] text-ink-4 italic">
            API 사용 이력 없음 (Stretch 2 미가동 또는 RLS 차단).
          </p>
        ) : (
          <table className="w-full text-[11.5px] tabular-nums">
            <thead className="text-[10.5px] text-ink-4 uppercase tracking-wide">
              <tr>
                <th className="text-left py-1">date</th>
                <th className="text-right py-1">tokens in</th>
                <th className="text-right py-1">tokens out</th>
                <th className="text-right py-1">supabase rows</th>
              </tr>
            </thead>
            <tbody className="text-ink-2">
              {usage.map((u) => (
                <tr key={u.date} className="border-t border-line">
                  <td className="py-1">{u.date}</td>
                  <td className="text-right py-1">
                    {(u.anthropic_tokens_in ?? 0).toLocaleString('ko-KR')}
                  </td>
                  <td className="text-right py-1">
                    {(u.anthropic_tokens_out ?? 0).toLocaleString('ko-KR')}
                  </td>
                  <td className="text-right py-1">
                    {(u.supabase_rows_total ?? 0).toLocaleString('ko-KR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <footer className="pt-4 border-t border-line text-[11px] text-ink-4 space-y-1">
        <p>
          이 페이지는 운영 디버깅 전용 (`/ops`). 링크는 공유 금지. RLS 정책 변경 시
          service_role 경유로 읽음.
        </p>
        <p>
          배포 정보: <a href="https://github.com/hikwon0518/cheapsky/actions" className="underline">GitHub Actions</a> ·{' '}
          <a href="https://vercel.com/dashboard" className="underline">Vercel</a> ·{' '}
          <a href="https://supabase.com/dashboard" className="underline">Supabase</a>
        </p>
      </footer>
    </main>
  );
}
