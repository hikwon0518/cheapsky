// Next.js 15 middleware (ADR-019 Share Token 단일 인증, ADR-008 noindex).
//
// 흐름 (docs/ARCHITECTURE.md "접근 제어"):
//   1. `?t=<token>` → verifyShareToken(token, parseShareTokens(SHARE_TOKENS))
//        통과 → 쿠키 cheapsky_auth 설정 (HttpOnly·Secure·SameSite=Strict·Max-Age=7d)
//   2. 쿠키에 유효 토큰 있으면 통과
//   3. 전부 실패 → 401 (본문에 토큰·파일 경로 없음)
//   4. 통과 시 헤더:
//        X-Robots-Tag: noindex, nofollow
//        Cache-Control: private, max-age=60
//
// Hard red lines:
//   - runtime 'nodejs' 명시 (edge 와 timingSafeEqual 호환성)
//   - 401 응답에 토큰·파일 경로 노출 금지
//   - timing-safe 비교는 share-token.ts 의 verifyShareToken 재사용
//   - Basic Auth fallback 제거 (ADR-019 Updated 2026-04-19) — Share Token 단일 경로

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { parseShareTokens, verifyShareToken } from '@/lib/share-token';

export const runtime = 'nodejs';

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
};

const COOKIE_NAME = 'cheapsky_auth';
const COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

// 401 본문 — 고정 HTML. 토큰·파일 경로 어떤 힌트도 포함하지 않음.
const UNAUTHORIZED_BODY = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex,nofollow">
<title>Cheapsky</title>
</head>
<body style="font-family:system-ui,sans-serif;background:#fafaf9;color:#0b0b0c;padding:2rem;">
<h1 style="font-size:1.25rem;margin:0 0 1rem;">접근 권한이 필요합니다</h1>
<p style="font-size:0.875rem;color:#5c5c5f;">공유받은 링크로 접속해주세요.</p>
</body>
</html>`;

function applyCommonHeaders(res: NextResponse): NextResponse {
  // 검색엔진 노출 차단 (ADR-008). 모든 /api/* 응답도 포함.
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  res.headers.set('Cache-Control', 'private, max-age=60');
  return res;
}

function unauthorizedResponse(): NextResponse {
  return new NextResponse(UNAUTHORIZED_BODY, {
    status: 401,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'no-store',
    },
  });
}

export function middleware(req: NextRequest): NextResponse {
  const allowedTokens = parseShareTokens(process.env.SHARE_TOKENS);

  // 1) ?t=<token> — 쿼리 토큰 검증.
  const urlToken = req.nextUrl.searchParams.get('t');
  if (urlToken && verifyShareToken(urlToken, allowedTokens)) {
    const res = applyCommonHeaders(NextResponse.next());
    res.cookies.set({
      name: COOKIE_NAME,
      value: urlToken,
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: COOKIE_MAX_AGE_SECONDS,
    });
    return res;
  }

  // 2) 쿠키 — 기존 세션.
  const cookieToken = req.cookies.get(COOKIE_NAME)?.value;
  if (cookieToken && verifyShareToken(cookieToken, allowedTokens)) {
    return applyCommonHeaders(NextResponse.next());
  }

  // 3) 실패 → 401.
  return unauthorizedResponse();
}
