// scripts/watch.ts — 감시 노선 순회 + 매칭 딜 알림 (C1 MVP).
//
// Cron: .github/workflows/watch.yml (매 시 :45). 수동: `pnpm tsx scripts/watch.ts`.
//
// 동작:
//   1. watched_routes where active=true 순회
//   2. 각 route 에 대해 활성 deals 중 price_krw <= max_price_krw AND verification_status='active'
//      AND (carrier_class match OR 'mixed') AND (depart_month match OR null) 검색 → 최저가 1건
//   3. cooldown (기본 24h) 체크해서 중복 알림 방지
//   4. 이메일 발송 (Resend API). RESEND_API_KEY 없으면 console.log fallback
//   5. notification_log 기록 + last_notified_at 갱신
//
// Hard red lines:
//   - service_role 필요 (RLS 쓰기)
//   - fail-soft: 한 route 실패해도 다음 진행
//   - 개인 사용 전제. 다사용자 도입 시 per-user 인증 추가

import 'dotenv/config';

import { createClient } from '@supabase/supabase-js';

import type { WatchedRouteRow } from '../src/lib/watcher';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.WATCHER_FROM_EMAIL ?? 'alerts@cheapsky.local';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[watch] NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 필수');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type MatchedDeal = {
  id: string;
  title: string;
  price_krw: number;
  source_urls: string[];
  posted_at: string;
  carrier_code: string | null;
  carrier_class: 'fsc' | 'lcc' | 'mixed';
};

async function findMatchingDeal(
  route: WatchedRouteRow,
): Promise<MatchedDeal | null> {
  let q = supabase
    .from('deals')
    .select(
      'id, title, price_krw, source_urls, posted_at, carrier_code, carrier_class',
    )
    .eq('origin', route.origin)
    .eq('destination', route.destination)
    .eq('verification_status', 'active')
    .gt('expires_at', new Date().toISOString())
    .lte('price_krw', route.max_price_krw)
    .gte('price_krw', 50_000)
    .order('price_krw', { ascending: true })
    .limit(1);

  if (route.carrier_class !== 'mixed') {
    q = q.eq('carrier_class', route.carrier_class);
  }
  if (route.depart_month) {
    // YYYY-MM → 월경계 UTC range
    const [year, mo] = route.depart_month.split('-').map((n) => Number(n));
    const startUtc = new Date(Date.UTC(year, mo - 1, 1));
    const endUtc = new Date(Date.UTC(year, mo, 1));
    q = q
      .gte('depart_from', startUtc.toISOString())
      .lt('depart_from', endUtc.toISOString());
  }

  const res = await q.maybeSingle();
  if (res.error || !res.data) return null;
  return res.data as MatchedDeal;
}

function cooldownPassed(route: WatchedRouteRow): boolean {
  if (!route.last_notified_at) return true;
  const lastMs = new Date(route.last_notified_at).getTime();
  const cooldownMs = route.notify_cooldown_h * 60 * 60 * 1000;
  return Date.now() - lastMs > cooldownMs;
}

async function sendEmail(
  to: string,
  subject: string,
  body: string,
): Promise<{ success: boolean; error?: string }> {
  if (!RESEND_KEY) {
    console.log(`[watch] [console fallback] to=${to} subject=${subject}`);
    console.log(`[watch] body:\n${body}`);
    return { success: true };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to,
        subject,
        text: body,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `resend ${res.status}: ${err.slice(0, 200)}` };
    }
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'unknown',
    };
  }
}

function buildEmailBody(
  route: WatchedRouteRow,
  deal: MatchedDeal,
): { subject: string; body: string } {
  const subject = `[Cheapsky] ${route.origin} → ${route.destination} ${deal.price_krw.toLocaleString('ko-KR')}원 발견`;
  const body = [
    `감시 중인 ${route.origin} → ${route.destination} 노선이 최대 ${route.max_price_krw.toLocaleString('ko-KR')}원 이하로 나왔어요.`,
    '',
    `가격: ${deal.price_krw.toLocaleString('ko-KR')}원`,
    `항공사: ${deal.carrier_code ?? '—'} (${deal.carrier_class.toUpperCase()})`,
    `제목: ${deal.title}`,
    `원문: ${deal.source_urls[0] ?? '—'}`,
    `게시: ${deal.posted_at}`,
    '',
    `24시간 cooldown 후 다시 매칭 시 재알림.`,
    `해제: /alerts 페이지에서 '해제' 버튼 클릭`,
  ].join('\n');
  return { subject, body };
}

async function processRoute(route: WatchedRouteRow): Promise<void> {
  if (!cooldownPassed(route)) {
    console.log(
      `[watch] skip ${route.origin}→${route.destination} (cooldown, last=${route.last_notified_at})`,
    );
    return;
  }

  const deal = await findMatchingDeal(route);
  if (!deal) {
    console.log(
      `[watch] no match ${route.origin}→${route.destination} (<= ${route.max_price_krw})`,
    );
    return;
  }

  const { subject, body } = buildEmailBody(route, deal);
  const sendRes = await sendEmail(route.owner_email, subject, body);

  await supabase.from('notification_log').insert({
    watched_route_id: route.id,
    deal_id: deal.id,
    price_krw: deal.price_krw,
    channel: RESEND_KEY ? 'email' : 'console',
    success: sendRes.success,
    error: sendRes.error ?? null,
  });

  if (sendRes.success) {
    await supabase
      .from('watched_routes')
      .update({ last_notified_at: new Date().toISOString() })
      .eq('id', route.id);
    console.log(
      `[watch] notified ${route.origin}→${route.destination} @ ${deal.price_krw.toLocaleString('ko-KR')}원`,
    );
  } else {
    console.error(`[watch] send failed: ${sendRes.error}`);
  }
}

async function main(): Promise<void> {
  const res = await supabase
    .from('watched_routes')
    .select(
      'id, owner_email, origin, destination, max_price_krw, carrier_class, depart_month, active, created_at, last_notified_at, notify_cooldown_h',
    )
    .eq('active', true);

  if (res.error) {
    console.error(`[watch] load routes failed: ${res.error.message}`);
    process.exit(1);
  }
  const routes = (res.data ?? []) as WatchedRouteRow[];
  console.log(`[watch] processing ${routes.length} active routes`);

  for (const route of routes) {
    try {
      await processRoute(route);
    } catch (e) {
      console.error(
        `[watch] route ${route.id} (${route.origin}→${route.destination}) failed:`,
        e,
      );
    }
  }
}

main().catch((e) => {
  console.error('[watch] fatal:', e);
  process.exit(1);
});
