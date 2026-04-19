// /alerts — 감시 노선 관리 (C1 MVP).
// 본인 실사용 전제 (owner = WATCHER_OWNER_EMAIL env). 외부 인증 없음.
// 서버에서 service_role 로 목록 로드, 클라 컴포넌트로 CRUD.

import Link from 'next/link';

import { AlertsForm } from '@/components/AlertsForm';
import { AlertsList } from '@/components/AlertsList';
import { Header } from '@/components/Header';
import { getServiceClient } from '@/lib/db';
import { getWatcherOwner, rowToWatchedRoute, type WatchedRouteRow, type WatchedRoute } from '@/lib/watcher';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'Cheapsky · 알림',
  robots: { index: false, follow: false },
};

async function loadWatchedRoutes(): Promise<WatchedRoute[]> {
  const owner = getWatcherOwner();
  if (!owner) return [];
  try {
    const client = getServiceClient();
    const res = await client
      .from('watched_routes')
      .select('*')
      .eq('owner_email', owner)
      .eq('active', true)
      .order('created_at', { ascending: false });
    if (res.error || !res.data) return [];
    return (res.data as WatchedRouteRow[]).map(rowToWatchedRoute);
  } catch {
    return [];
  }
}

export default async function AlertsPage() {
  const owner = getWatcherOwner();
  const routes = await loadWatchedRoutes();

  if (!owner) {
    return (
      <>
        <Header />
        <main className="max-w-xl mx-auto px-4 py-10">
          <h1 className="text-2xl font-semibold text-ink tracking-tight">
            알림 기능 비활성
          </h1>
          <p className="mt-3 text-sm text-ink-3">
            감시 기능은 개인 사용 전제로 <code className="text-[12px]">WATCHER_OWNER_EMAIL</code> 환경 변수가
            필요해요. Vercel 대시보드에서 본인 이메일로 설정하고, Supabase 에{' '}
            <code className="text-[12px]">scripts/migrations/20260419_route_watcher.sql</code> 을 실행하면 활성화됩니다.
          </p>
          <Link
            href="/"
            className="inline-block mt-6 text-xs text-low hover:text-ink underline underline-offset-2"
          >
            ← 홈으로
          </Link>
        </main>
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold text-ink tracking-tight">
            노선 알림
          </h1>
          <p className="mt-1 text-sm text-ink-3">
            관심 노선을 등록하면 매시간 cron 이 돌면서 설정한 가격 이하의 딜이
            나오면 이메일로 알려드려요. (이메일 발송은 Resend 연동 후 활성.)
          </p>
          <p className="mt-1 text-[11.5px] text-ink-4">소유자: {owner}</p>
        </header>

        <AlertsForm />

        <section aria-label="등록된 감시 노선">
          <h2 className="text-[14px] font-semibold text-ink mb-3">
            등록된 노선 ({routes.length})
          </h2>
          <AlertsList initial={routes} />
        </section>

        <footer className="pt-6 border-t border-line text-[11px] text-ink-4">
          <Link href="/" className="text-low hover:text-ink underline underline-offset-2">
            ← 홈으로
          </Link>
        </footer>
      </main>
    </>
  );
}
