// 플레이윙즈 특가 크롤러 (Stretch 1 — ADR-004 보조 소스, ADR-025 동의 절차).
//
// Hard red lines (CLAUDE.md / ADR-008 / ADR-025):
// - 이 파일은 순수 함수. DB·Supabase·파일 IO 전면 금지.
// - 요청 간격 ≥ 1000ms, 동시성 1. UA 는 config.userAgent (위장 금지).
// - 작성자 식별자(닉네임) 수집 금지 — 본문에서 `.author .nickname` 같은 영역은 따로 읽지 않는다.
// - robots 화이트리스트(ALLOWED_PATHS) 를 fetch 전 반드시 검사.
// - 파서 실패·HTTP 에러는 throw 하지 않고 해당 항목만 skip (fail-soft).
// - **본문은 og:description 한정 (≤ 500자 cut).** ADR-008 저장 범위 제한 · ADR-005 LLM 전송 범위와 일관.
// - ADR-025 방어 조항: 운영자 이의 제기 시 즉시 크롤러 비활성 + 24h 내 저장 데이터 삭제 (운영 절차, 코드 외).
//
// 실사 (2026-04-19, www.playwings.co.kr):
// - 정식 RSS 피드 없음 (`/feed`, `/rss`, `/atom.xml`, HTML head 의 alternate link 모두 부재).
// - robots.txt 은 `User-agent: * / Allow: /` + `Sitemap: /sitemap-index.xml` 한 줄.
// - **"RSS 대체"로 sitemap 을 구조화 피드로 사용**. `/sitemap-0.xml` 의 `<url><loc>` 를 파싱해
//   `/deals/<id>` 만 필터링 → 각 deal 페이지에서 og:title + og:description 수집.
//   ADR-025 의 "구조화 피드 우선" 원칙과 일관 (HTML 리스트 직크롤링보다 안전).
// - 각 `/deals/<id>` 페이지는 Gatsby SSG 로 meta 태그가 pre-render 됨 → JS 실행 없이 수집 가능.
// - HTML 폴백 (`/deals/`) 은 SPA 이므로 실전 반환이 빈약할 수 있으나, 인터페이스 및 테스트 대상으로 유지.

import { parse, type HTMLElement } from 'node-html-parser';

import type { RawPost } from '@/types/deal';
import type { Crawler, ParsedListItem } from './types';

export const BASE_URL = 'https://www.playwings.co.kr';
/**
 * "RSS" 슬롯. playwings 에는 정식 RSS 가 없어 sitemap 을 구조화 피드로 사용.
 * `parseRssItems` 가 `<rss>` 와 `<urlset>` 양쪽을 식별한다.
 */
export const RSS_URL = 'https://www.playwings.co.kr/sitemap-0.xml';
/** HTML 폴백 리스트 페이지 (SPA 이지만 pre-rendered 마크업에 `/deals/<id>` 앵커가 남아 있을 수 있음). */
export const LIST_URL = 'https://www.playwings.co.kr/deals/';

/**
 * robots 화이트리스트. robots.txt 이 `Allow: /` 지만 방어적으로 범위 제한.
 * - sitemap: `/sitemap-index.xml`, `/sitemap-0.xml` (숫자 부록 허용)
 * - 리스트/상세: `/deals/`
 */
export const ALLOWED_PATHS: readonly string[] = [
  '/sitemap-index.xml',
  '/sitemap-',
  '/deals/',
  '/deals',
] as const;

const DEFAULT_MAX_POSTS = 20;
const DEFAULT_MIN_DELAY_MS = 1000;
const MIN_ENFORCED_DELAY_MS = 1000; // ADR-008: 1초 미만 조정 금지

const PLAYWINGS_HOST = 'www.playwings.co.kr';

/**
 * 본문 저장 한도 (ADR-008). og:description 은 보통 200~400자이지만 보수적으로 cut.
 */
const BODY_MAX_CHARS = 500;

/** `/deals/<id>` 의 `<id>` — Gatsby base58 22자 내외. 대략 10~32자 허용. */
const DEAL_ID_RE = /^[A-Za-z0-9]{10,40}$/;

export function isAllowedPath(urlOrPath: string): boolean {
  if (!urlOrPath) return false;
  let pathname: string;
  try {
    pathname = new URL(urlOrPath, `https://${PLAYWINGS_HOST}`).pathname;
  } catch {
    return false;
  }
  return ALLOWED_PATHS.some((p) => pathname === p || pathname.startsWith(p));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function decodeResponse(res: Response): Promise<string> {
  const ct = res.headers.get('content-type') ?? '';
  const m = ct.match(/charset=([^;]+)/i);
  const charset = (m?.[1] ?? 'utf-8').toLowerCase().trim();
  const buf = await res.arrayBuffer();
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buf);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(buf);
  }
}

/**
 * `/deals/<id>` URL → sourceId. 조건 불일치면 null.
 */
function extractDealIdFromUrl(href: string): string | null {
  try {
    const u = new URL(href, BASE_URL);
    if (u.hostname !== PLAYWINGS_HOST && u.hostname !== '') return null;
    const m = u.pathname.match(/^\/deals\/([^/?#]+)\/?$/);
    if (!m) return null;
    const id = m[1];
    if (!DEAL_ID_RE.test(id)) return null;
    return id;
  } catch {
    return null;
  }
}

/**
 * HTML 엔티티 디코드 — og meta content 에서 `&amp;`, `&#39;` 등 처리.
 * node-html-parser 의 텍스트 추출은 엔티티를 decode 하지 않으므로 여기서 직접 처리.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/**
 * RSS 또는 sitemap XML → ParsedListItem[].
 *
 * 지원 형식:
 *   - `<rss><channel><item><link/><title/><pubDate/>`  (정식 RSS)
 *   - `<urlset><url><loc/><lastmod/>` (sitemap.xml — playwings 의 실제 피드)
 *   - Atom `<feed><entry><link href=.../><title/><updated/>` (방어적 폴백)
 *
 * `/deals/<id>` 만 통과시킨다 — /articles, /magazine 등 항공권 특가 외 경로는 skip.
 *
 * XML 이 깨졌거나 root 가 알 수 없으면 빈 배열 (throw 금지).
 */
export function parseRssItems(xml: string, now: Date): ParsedListItem[] {
  if (!xml) return [];

  const items: ParsedListItem[] = [];
  const seen = new Set<string>();

  const push = (href: string, title: string | null, postedAt: Date) => {
    const id = extractDealIdFromUrl(href);
    if (!id) return;
    if (seen.has(id)) return;
    let sourceUrl: string;
    try {
      sourceUrl = new URL(href, BASE_URL).toString();
    } catch {
      return;
    }
    seen.add(id);
    items.push({
      sourceId: id,
      sourceUrl,
      title: (title && decodeEntities(title).trim()) || '',
      postedAt,
    });
  };

  // RSS `<item>` 블록
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/g) ?? [];
  for (const block of itemBlocks) {
    const linkMatch = block.match(/<link>([^<]+)<\/link>/);
    const titleMatch = block.match(
      /<title>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/title>/,
    );
    const pubMatch = block.match(/<pubDate>([^<]+)<\/pubDate>/);
    if (!linkMatch) continue;
    const href = decodeEntities(linkMatch[1].trim());
    const title =
      (titleMatch?.[1] ?? titleMatch?.[2] ?? '').trim() || null;
    let postedAt = now;
    if (pubMatch) {
      const d = new Date(pubMatch[1].trim());
      if (!Number.isNaN(d.getTime())) postedAt = d;
    }
    push(href, title, postedAt);
  }

  // Atom `<entry>` 블록
  const entryBlocks = xml.match(/<entry[\s\S]*?<\/entry>/g) ?? [];
  for (const block of entryBlocks) {
    const linkMatch = block.match(/<link[^>]*href="([^"]+)"/);
    const titleMatch = block.match(
      /<title[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/title>/,
    );
    const upMatch = block.match(/<updated>([^<]+)<\/updated>/);
    if (!linkMatch) continue;
    const href = decodeEntities(linkMatch[1].trim());
    const title =
      (titleMatch?.[1] ?? titleMatch?.[2] ?? '').trim() || null;
    let postedAt = now;
    if (upMatch) {
      const d = new Date(upMatch[1].trim());
      if (!Number.isNaN(d.getTime())) postedAt = d;
    }
    push(href, title, postedAt);
  }

  // sitemap `<url>` 블록
  const urlBlocks = xml.match(/<url[\s>][\s\S]*?<\/url>/g) ?? [];
  for (const block of urlBlocks) {
    const locMatch = block.match(/<loc>([^<]+)<\/loc>/);
    const lastmodMatch = block.match(/<lastmod>([^<]+)<\/lastmod>/);
    if (!locMatch) continue;
    const href = decodeEntities(locMatch[1].trim());
    let postedAt = now;
    if (lastmodMatch) {
      const d = new Date(lastmodMatch[1].trim());
      if (!Number.isNaN(d.getTime())) postedAt = d;
    }
    // sitemap 에는 title 이 없음 → 상세 fetch 시 og:title 로 채움.
    push(href, null, postedAt);
  }

  return items;
}

/**
 * HTML 리스트 페이지 → ParsedListItem[] (RSS/sitemap 폴백 경로).
 * `<a href="/deals/<id>">` 또는 절대 URL 앵커만 수집. 중복 sourceId 제거.
 */
export function parseListHtml(html: string, now: Date): ParsedListItem[] {
  if (!html) return [];
  let root: HTMLElement;
  try {
    root = parse(html);
  } catch {
    return [];
  }
  const anchors = root.querySelectorAll('a');
  const seen = new Set<string>();
  const items: ParsedListItem[] = [];
  for (const a of anchors) {
    const rawHref = a.getAttribute('href') ?? '';
    if (!rawHref) continue;
    const id = extractDealIdFromUrl(rawHref);
    if (!id) continue;
    if (seen.has(id)) continue;
    let sourceUrl: string;
    try {
      sourceUrl = new URL(rawHref, BASE_URL).toString();
    } catch {
      continue;
    }
    const title = a.text.replace(/\s+/g, ' ').trim();
    seen.add(id);
    items.push({
      sourceId: id,
      sourceUrl,
      title,
      postedAt: now,
    });
  }
  return items;
}

/**
 * `/deals/<id>` 상세 HTML → { title, body }.
 *  - title: og:title → <meta name="title"> → <title> 순 폴백
 *  - body : og:description → <meta name="description"> 순 폴백 (≤ BODY_MAX_CHARS)
 *  - 작성자 영역(`.author`, `.nickname`)은 **절대 읽지 않는다** (ADR-008/025).
 *  - 실패 시 빈 문자열 (throw 금지).
 */
export function parseDetailHtml(html: string): { title: string; body: string } {
  if (!html) return { title: '', body: '' };
  let root: HTMLElement;
  try {
    root = parse(html);
  } catch {
    return { title: '', body: '' };
  }

  const getMetaContent = (selectors: string[]): string => {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (!el) continue;
      const c = el.getAttribute('content');
      if (c && c.trim()) {
        return decodeEntities(c.trim());
      }
    }
    return '';
  };

  let title = getMetaContent([
    'meta[property="og:title"]',
    'meta[name="og:title"]',
    'meta[name="title"]',
    'meta[name="twitter:title"]',
  ]);
  if (!title) {
    const t = root.querySelector('title');
    if (t) title = decodeEntities(t.text.trim());
  }

  const descRaw = getMetaContent([
    'meta[property="og:description"]',
    'meta[name="og:description"]',
    'meta[name="description"]',
    'meta[name="twitter:description"]',
  ]);
  const body = descRaw ? descRaw.slice(0, BODY_MAX_CHARS) : '';

  return { title, body };
}

/**
 * 플레이윙즈 크롤러 본체 (순수 함수).
 *
 * 동작:
 *   1) RSS_URL (sitemap) fetch. ALLOWED_PATHS 검사. parseRssItems.
 *      실패(비-OK·throw·빈 배열)면 LIST_URL HTML 폴백으로 parseListHtml.
 *   2) listItems.slice(0, maxPosts) — 각 상세 페이지 fetch (요청 간격 ≥ 1000ms).
 *   3) parseDetailHtml → title/body 로 RawPost 생성.
 *   4) 반환. 4xx/5xx·예외는 해당 항목 skip.
 */
export const crawlPlaywings: Crawler = async (config) => {
  const {
    userAgent,
    maxPosts = DEFAULT_MAX_POSTS,
    minDelayMs = DEFAULT_MIN_DELAY_MS,
    fetch: injectedFetch,
    now: injectedNow,
  } = config;

  const fetchImpl = injectedFetch ?? globalThis.fetch;
  const nowFn = injectedNow ?? (() => new Date());
  const delayMs = Math.max(MIN_ENFORCED_DELAY_MS, minDelayMs);

  if (!fetchImpl) {
    console.warn('[crawlPlaywings] fetch impl 이 없습니다. 빈 배열 반환.');
    return [];
  }

  // 1) Sitemap/RSS 시도.
  let listItems: ParsedListItem[] = [];
  if (isAllowedPath(RSS_URL)) {
    try {
      const res = await fetchImpl(RSS_URL, {
        headers: {
          'user-agent': userAgent,
          accept: 'application/xml,text/xml,*/*',
        },
      });
      if (res.ok) {
        const xml = await decodeResponse(res);
        listItems = parseRssItems(xml, nowFn());
      } else {
        console.warn(`[crawlPlaywings] sitemap ${res.status}, HTML 폴백 시도.`);
      }
    } catch (err) {
      console.warn(
        `[crawlPlaywings] sitemap fetch 실패: ${String(err)}. HTML 폴백 시도.`,
      );
    }
  } else {
    console.warn(
      `[crawlPlaywings] RSS_URL 이 ALLOWED_PATHS 밖입니다: ${RSS_URL}`,
    );
  }

  // 2) RSS 비었으면 HTML 리스트 폴백.
  if (listItems.length === 0 && isAllowedPath(LIST_URL)) {
    await sleep(delayMs);
    try {
      const res = await fetchImpl(LIST_URL, {
        headers: {
          'user-agent': userAgent,
          accept: 'text/html',
        },
      });
      if (res.ok) {
        const html = await decodeResponse(res);
        listItems = parseListHtml(html, nowFn());
      } else {
        console.warn(
          `[crawlPlaywings] 리스트 ${res.status}. 빈 배열 반환.`,
        );
        return [];
      }
    } catch (err) {
      console.warn(`[crawlPlaywings] 리스트 fetch 실패: ${String(err)}`);
      return [];
    }
  }

  if (listItems.length === 0) return [];

  const capped = listItems.slice(0, maxPosts);
  const posts: RawPost[] = [];
  for (const item of capped) {
    await sleep(delayMs);

    if (!isAllowedPath(item.sourceUrl)) {
      console.warn(`[crawlPlaywings] 차단된 경로 skip: ${item.sourceUrl}`);
      continue;
    }

    let title = item.title;
    let body = '';
    try {
      const res = await fetchImpl(item.sourceUrl, {
        headers: {
          'user-agent': userAgent,
          accept: 'text/html',
        },
      });
      if (!res.ok) {
        console.warn(
          `[crawlPlaywings] 상세 ${item.sourceId} → ${res.status} skip`,
        );
        continue;
      }
      const detailHtml = await decodeResponse(res);
      const detail = parseDetailHtml(detailHtml);
      if (detail.title) title = detail.title;
      body = detail.body;
    } catch (err) {
      console.warn(
        `[crawlPlaywings] 상세 fetch 실패 ${item.sourceId}: ${String(err)}`,
      );
      continue;
    }

    if (!title) continue;

    posts.push({
      source: 'playwings',
      sourceId: item.sourceId,
      sourceUrl: item.sourceUrl,
      title,
      body,
      postedAt: item.postedAt,
    });
  }

  return posts;
};
