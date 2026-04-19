// 간단 in-memory IP token bucket (단일 Vercel function instance 내).
// 완벽한 분산 rate limit 는 아니지만 1명이 burst 때리는 걸 1차 방어.
// 분산 방어가 필요하면 Upstash Redis + @upstash/ratelimit 로 업그레이드.

const BUCKETS = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000; // 1분
const MAX_REQ = 60; // 분당 60 req/IP → 초당 1 req 수준

export function extractIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

/**
 * 초과 시 false, 통과 시 true.
 * resetAt 지나면 bucket reset.
 */
export function checkRate(ip: string, maxReq: number = MAX_REQ): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
} {
  const now = Date.now();
  const bucket = BUCKETS.get(ip);
  if (!bucket || bucket.resetAt < now) {
    BUCKETS.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: maxReq - 1, resetAt: now + WINDOW_MS };
  }
  if (bucket.count >= maxReq) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }
  bucket.count += 1;
  return {
    allowed: true,
    remaining: maxReq - bucket.count,
    resetAt: bucket.resetAt,
  };
}
