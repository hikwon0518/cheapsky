// /api/watcher — 감시 노선 CRUD (C1 — 개인 사용 MVP).
//
// 보안: 개인 사용 전제로 WATCHER_OWNER_EMAIL env 의 소유자만 쓰기 허용.
// 현재는 "이 URL 을 아는 사람 = 본인" 가정 (공개 repo 에 URL 노출 안 됨).
// 향후 Supabase Auth 도입 시 session 기반 owner 필터로 교체.
//
// Methods:
//   POST /api/watcher      → 새 감시 노선 등록
//   DELETE /api/watcher?id=... → 감시 노선 삭제

import { NextResponse } from 'next/server';

import { getServiceClient } from '@/lib/db';
import { checkRate, extractIp } from '@/lib/rate-limit';
import { getWatcherOwner } from '@/lib/watcher';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PostBody = {
  origin?: string;
  destination?: string;
  maxPriceKrw?: number;
  carrierClass?: 'fsc' | 'lcc' | 'mixed';
  departMonth?: string | null;
};

const VALID_CLASSES = new Set(['fsc', 'lcc', 'mixed']);
const IATA = /^[A-Z]{3}$/;
const MONTH = /^\d{4}-\d{2}$/;

export async function POST(req: Request): Promise<Response> {
  // Rate limit: IP 당 10 POST/min (스팸·자동등록 방어).
  const ip = extractIp(req);
  const rl = checkRate(`watcher-post:${ip}`, 10);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'rate limited', resetAt: rl.resetAt },
      {
        status: 429,
        headers: {
          'Retry-After': String(
            Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)),
          ),
        },
      },
    );
  }

  const owner = getWatcherOwner();
  if (!owner) {
    return NextResponse.json(
      { error: 'WATCHER_OWNER_EMAIL env 미설정 — 감시 기능 비활성' },
      { status: 503 },
    );
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const origin = (body.origin ?? '').toUpperCase().trim();
  const destination = (body.destination ?? '').toUpperCase().trim();
  const maxPrice = Number(body.maxPriceKrw);
  const carrierClass = body.carrierClass ?? 'mixed';
  const departMonth = body.departMonth ?? null;

  if (!IATA.test(origin) || !IATA.test(destination)) {
    return NextResponse.json(
      { error: 'origin/destination must be 3-letter IATA' },
      { status: 400 },
    );
  }
  if (!Number.isFinite(maxPrice) || maxPrice < 50000 || maxPrice > 10_000_000) {
    return NextResponse.json(
      { error: 'maxPriceKrw must be 50000 ~ 10000000' },
      { status: 400 },
    );
  }
  if (!VALID_CLASSES.has(carrierClass)) {
    return NextResponse.json({ error: 'invalid carrierClass' }, { status: 400 });
  }
  if (departMonth !== null && !MONTH.test(departMonth)) {
    return NextResponse.json({ error: 'invalid departMonth' }, { status: 400 });
  }

  let client;
  try {
    client = getServiceClient();
  } catch {
    return NextResponse.json({ error: 'service role unavailable' }, { status: 503 });
  }

  const res = await client
    .from('watched_routes')
    .insert({
      owner_email: owner,
      origin,
      destination,
      max_price_krw: maxPrice,
      carrier_class: carrierClass,
      depart_month: departMonth,
    })
    .select('id')
    .single();

  if (res.error) {
    return NextResponse.json({ error: res.error.message }, { status: 500 });
  }
  return NextResponse.json({ id: res.data.id });
}

export async function DELETE(req: Request): Promise<Response> {
  const owner = getWatcherOwner();
  if (!owner) {
    return NextResponse.json(
      { error: 'WATCHER_OWNER_EMAIL env 미설정' },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  let client;
  try {
    client = getServiceClient();
  } catch {
    return NextResponse.json({ error: 'service role unavailable' }, { status: 503 });
  }

  const res = await client
    .from('watched_routes')
    .delete()
    .eq('id', id)
    .eq('owner_email', owner);
  if (res.error) {
    return NextResponse.json({ error: res.error.message }, { status: 500 });
  }
  return NextResponse.json({ deleted: true });
}
