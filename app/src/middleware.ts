// Next.js 15 middleware (ADR-019 Share Token + Basic Auth, ADR-008 noindex).
//
// 흐름 (docs/ARCHITECTURE.md "접근 제어"):
//   1. `?t=<token>` → verifyShareToken(token, parseShareTokens(SHARE_TOKENS))
//        통과 → 쿠키 cheapsky_auth 설정 (HttpOnly·Secure·SameSite=Strict·Max-Age=7d)
//   2. 쿠키에 유효 토큰 있으면 통과
//   3. Authorization: Basic … 헤더 파싱 → bcrypt.compare + user timingSafeEqual
//   4. 전부 실패 → 401 WWW-Authenticate: Basic realm="Cheapsky"
//        (본문에는 토큰·해시·파일 경로 없음 — 최소 안내문)
//   5. 통과 시 헤더:
//        X-Robots-Tag: noindex, nofollow
//        Cache-Control: private, max-age=60
//
// Hard red lines (step6.md "금지사항"):
//   - runtime 'nodejs' 명시 (bcryptjs edge 비호환)
//   - 401 응답에 토큰·해시·파일 경로 노출 금지
//   - timing-safe 비교는 share-token.ts 의 verifyShareToken 재사용

import { timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { type NextRequest, NextResponse } from 'next/server';

import { parseShareTokens, verifyShareToken } from '@/lib/share-token';

export const runtime = 'nodejs';

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
};

const COOKIE_NAME = 'cheapsky_auth';
const COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

// 401 본문 — 고정 HTML. 토큰·해시·파일 경로 어떤 힌트도 포함하지 않음.
const UNAUTHORIZED_BODY = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex,nofollow">
<title>Cheapsky</title>
</head>
<body style="font-family:system-ui,sans-serif;background:#0a0a0a;color:#d4d4d4;padding:2rem;">
<h1 style="font-size:1.25rem;margin:0 0 1rem;">접근 권한이 필요합니다</h1>
<p style="font-size:0.875rem;color:#a3a3a3;">이 페이지는 친구 평가용 비공개 프로젝트입니다.</p>
</body>
</html>`;

/**
 * Authorization: Basic <base64(user:pass)> 를 파싱해 { user, pass } 반환.
 * 실패 시 null.
 */
function parseBasicAuth(
  header: string | null,
): { user: string; pass: string } | null {
  if (!header) return null;
  const prefix = 'Basic ';
  if (!header.startsWith(prefix)) return null;
  const b64 = header.slice(prefix.length).trim();
  if (!b64) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return null;
  }
  const sep = decoded.indexOf(':');
  if (sep === -1) return null;
  return {
    user: decoded.slice(0, sep),
    pass: decoded.slice(sep + 1),
  };
}

/**
 * user 일치 timing-safe 비교. 길이 mismatch 는 false.
 */
function userMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function applyCommonHeaders(res: NextResponse): NextResponse {
  // 검색엔진 노출 차단 (ADR-008). 모든 /api/* 응답도 포함.
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  res.headers.set('Cache-Control', 'private, max-age=60');
  return res;
}

function unauthorizedResponse(): NextResponse {
  const res = new NextResponse(UNAUTHORIZED_BODY, {
    status: 401,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'WWW-Authenticate': 'Basic realm="Cheapsky"',
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'no-store',
    },
  });
  return res;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
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

  // 3) Basic Auth 폴백.
  const basic = parseBasicAuth(req.headers.get('authorization'));
  if (basic) {
    const expectedUser = process.env.BASIC_AUTH_USER;
    const expectedHash = process.env.BASIC_AUTH_PASS;
    if (expectedUser && expectedHash) {
      const userOk = userMatches(basic.user, expectedUser);
      // 항상 compare 호출해 user 불일치 시 timing 누수 최소화.
      let passOk = false;
      try {
        passOk = await bcrypt.compare(basic.pass, expectedHash);
      } catch {
        passOk = false;
      }
      if (userOk && passOk) {
        return applyCommonHeaders(NextResponse.next());
      }
    }
  }

  // 4) 전부 실패 → 401.
  return unauthorizedResponse();
}
