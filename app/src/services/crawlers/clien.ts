// 클리앙 '알뜰구매'(jirum) 게시판 크롤러 (Stretch 3 — ADR-004 / ADR-030).
//
// Hard red lines (CLAUDE.md / ADR-008):
// - 이 파일은 순수 함수. DB·Supabase·파일 IO 전면 금지.
// - 요청 간격 ≥ 1000ms, 동시성 1. UA 는 config.userAgent (위장 금지).
// - 작성자 식별자(닉네임·uid) 수집·반환 금지.
// - robots 화이트리스트 (ALLOWED_PATHS) 를 fetch 전 반드시 검사.
// - 파서 실패·HTTP 에러는 throw 하지 않고 해당 항목만 skip (fail-soft).
// - ppomppu.ts / ruliweb.ts 레퍼런스 참조. 단, 구조가 다르므로 복붙·추상화 하지 않음.
//
// 클리앙 DOM 특성 (2026-04-20 실사 fixture 기준):
// - 리스트 행: `<div class="list_item">`. `list_item notice` 공지는 skip.
// - 제목 앵커: `<a class="list_subject">`. 내부 `<span class="subject_fixed" title="...">` 또는 own text.
// - 상세 URL: `/service/board/jirum/<post_id>`. robots `Disallow: /*?*` 때문에 canonical path 만 따름.
// - 시간: `<span class="timestamp">YYYY-MM-DD HH:MM:SS</span>`.
// - 인코딩: UTF-8.
//
// robots.txt (2026-04-20 실사):
//   User-agent: *
//   Allow: /service/board/
//   Disallow: /*?*
//   Disallow: /service/search*
// Cheapsky UA 명시 차단 없음. 쿼리 스트링 포함 URL 은 전부 거절 (isAllowedPath 가 체크).

import { parse, type HTMLElement } from 'node-html-parser';

import type { RawPost } from '@/types/deal';
import type { Crawler, ParsedListItem } from './types';

export const LIST_URL = 'https://www.clien.net/service/board/jirum';

/**
 * robots 화이트리스트. 실제 clien.net/robots.txt (2026-04-20):
 *   User-agent: *
 *   Allow: /service/board/
 *   Disallow: /*?*     (쿼리 스트링 포함 URL 전부 차단)
 * canonical path `/service/board/jirum` 와 `/service/board/jirum/<post_id>` 만 사용.
 */
export const ALLOWED_PATHS: readonly string[] = [
  '/service/board/jirum',
] as const;

const DEFAULT_MAX_POSTS = 30;
const DEFAULT_MIN_DELAY_MS = 1000;
const MIN_ENFORCED_DELAY_MS = 1000; // ADR-008: 1초 미만 조정 금지

const CLIEN_HOST = 'www.clien.net';

/**
 * URL 이 허용 경로에 속하는지 검사.
 * robots.txt `Disallow: /*?*` 에 따라 쿼리 스트링이 있으면 거절.
 */
export function isAllowedPath(urlOrPath: string): boolean {
  if (!urlOrPath) return false;
  let u: URL;
  try {
    u = new URL(urlOrPath, `https://${CLIEN_HOST}`);
  } catch {
    return false;
  }
  if (u.search && u.search.length > 0) return false;
  const pathname = u.pathname;
  return ALLOWED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `/service/board/jirum/<post_id>` 에서 숫자 id 추출.
 * 쿼리 스트링은 무시 (canonical path 만 사용). 실제 robots 검증은
 * `isAllowedPath` 가 canonical sourceUrl 에 대해 수행.
 */
function extractSourceId(href: string): string | null {
  try {
    const u = new URL(href, `https://${CLIEN_HOST}`);
    const m = u.pathname.match(/^\/service\/board\/jirum\/(\d+)$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * 클리앙 timestamp 파서.
 * - `YYYY-MM-DD HH:MM:SS` (클리앙 기본 포맷, KST 전제)
 * - `HH:MM` (당일)
 * - 실패 시 null.
 */
export function parsePostedAt(raw: string, now: Date): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // YYYY-MM-DD HH:MM:SS (KST 로 해석)
  const mFull = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (mFull) {
    const y = Number(mFull[1]);
    const mo = Number(mFull[2]);
    const d = Number(mFull[3]);
    const h = Number(mFull[4]);
    const mi = Number(mFull[5]);
    const s = mFull[6] ? Number(mFull[6]) : 0;
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) {
      return null;
    }
    // KST (UTC+9) → UTC 로 환산 저장
    return new Date(Date.UTC(y, mo - 1, d, h - 9, mi, s));
  }

  // HH:MM (당일)
  const mHM = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (mHM) {
    const h = Number(mHM[1]);
    const mi = Number(mHM[2]);
    if (h > 23 || mi > 59) return null;
    const d = new Date(now);
    d.setHours(h, mi, 0, 0);
    return d;
  }

  return null;
}

/**
 * 한 개 리스트 아이템(div.list_item) 에서 제목/URL/id/postedAt 추출.
 * 공지·광고·고정글·blocked 는 null 반환 → caller skip.
 *
 * clien DOM (2026-04-20 실사):
 *   <div class="list_item symph_row jirum ..." data-role="list-row">
 *     <span class="list_subject" title="...전체 제목...">
 *       <a href="/service/board/jirum/{id}?od=T31..." data-role="list-title-text">제목</a>
 *       <a class="list_reply reply_symph" href="...#comment-point">...</a>
 *     </span>
 *     ...
 *     <span class="timestamp">YYYY-MM-DD HH:MM:SS</span>
 *   </div>
 *
 * 주의: `data-author-id` 등 작성자 식별 attr 는 절대 읽지 않음 (ADR-008).
 */
function parseListRow(row: HTMLElement, now: Date): ParsedListItem | null {
  const clsRaw = row.getAttribute('class') ?? '';
  const cls = clsRaw.toLowerCase();
  // 공지 · 광고성 · 판매완료 · 차단된 글 · 홍보 skip
  if (
    cls.includes('notice') ||
    cls.includes('blocked') ||
    cls.includes('rule') ||
    cls.includes('hongbo') ||
    cls.includes('sold_out')
  ) {
    return null;
  }

  // 제목: <span class="list_subject" title="...">. title 속성이 전체 제목 (실제 표시 텍스트는 cut 될 수 있음).
  const subjectSpan = row.querySelector('span.list_subject');
  if (!subjectSpan) return null;

  // 제목 anchor: data-role="list-title-text" 또는 subjectSpan 안의 첫 <a>
  let titleAnchor: HTMLElement | null =
    subjectSpan.querySelector('a[data-role="list-title-text"]') ?? null;
  if (!titleAnchor) {
    const allAnchors = subjectSpan.querySelectorAll('a');
    // `list_reply` 댓글 카운트 anchor 는 제외
    for (const a of allAnchors) {
      const ac = (a.getAttribute('class') ?? '').toLowerCase();
      if (ac.includes('list_reply') || ac.includes('reply_symph')) continue;
      titleAnchor = a;
      break;
    }
  }
  if (!titleAnchor) return null;
  const href = titleAnchor.getAttribute('href') ?? '';
  if (!href) return null;

  const sourceId = extractSourceId(href);
  if (!sourceId) return null;

  // 절대 URL 화 (쿼리 없는 canonical 만).
  let sourceUrl: string;
  try {
    const u = new URL(href, LIST_URL);
    u.search = '';
    u.hash = '';
    sourceUrl = u.toString();
  } catch {
    return null;
  }
  if (!isAllowedPath(sourceUrl)) return null;

  // 제목: subjectSpan title 속성 우선 (전체 제목), 없으면 anchor 텍스트
  let title = (subjectSpan.getAttribute('title') ?? '').trim();
  if (!title) {
    title = titleAnchor.text.replace(/\s+/g, ' ').trim();
  }
  if (!title) return null;

  // 시간
  let postedAt = now;
  const timeEl =
    row.querySelector('.timestamp') ||
    row.querySelector('.time') ||
    row.querySelector('.date');
  if (timeEl) {
    const parsed = parsePostedAt(timeEl.text, now);
    if (parsed) postedAt = parsed;
  }

  return {
    sourceId,
    sourceUrl,
    title,
    postedAt,
  };
}

/**
 * HTML 전처리 — script / style / noscript / SVG inline 등을 제거해서
 * node-html-parser 가 깊이 중단 없이 끝까지 파싱하도록 돕는다.
 * 클리앙 페이지는 페이지 헤더/네비에 복잡한 inline script/svg 가 많아 raw parse 가
 * 초반에 멈추는 사례가 있어서 우선적으로 제거한다.
 */
function sanitizeHtmlForParse(html: string): string {
  return html
    .replace(/^\uFEFF/, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * 리스트 HTML → ParsedListItem[]. 동일 sourceId 중복 시 최초 한 건 유지.
 */
export function parseList(html: string, now: Date): ParsedListItem[] {
  if (!html) return [];
  let root: HTMLElement;
  try {
    root = parse(sanitizeHtmlForParse(html));
  } catch {
    return [];
  }
  const rows = root.querySelectorAll('div.list_item');
  const items: ParsedListItem[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const item = parseListRow(row, now);
    if (!item) continue;
    if (seen.has(item.sourceId)) continue;
    seen.add(item.sourceId);
    items.push(item);
  }
  return items;
}

/**
 * 상세 페이지 본문 추출. 실패 시 `{ body: '' }`.
 * 클리앙 본문은 `.post_content` / `.post_article` / `article` 중 하나.
 */
export function parseDetail(html: string): { body: string } {
  if (!html) return { body: '' };
  let root: HTMLElement;
  try {
    root = parse(sanitizeHtmlForParse(html));
  } catch {
    return { body: '' };
  }
  const candidates = [
    'div.post_content',
    'div.post_article',
    'article.post_article',
    'div.post_view',
  ];
  for (const sel of candidates) {
    const el = root.querySelector(sel);
    if (el) {
      const text = el.text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      if (text) return { body: text };
    }
  }
  return { body: '' };
}

/**
 * 클리앙 크롤러 본체. 순수 함수 — DB / 파일 IO 없음.
 *
 * 동작:
 *  1) LIST_URL fetch (UA = config.userAgent). ALLOWED_PATHS 검사.
 *  2) parseList 로 리스트 아이템 최대 maxPosts 개 추출 (제목 필터는 caller 단계).
 *  3) 각 아이템마다 1초 대기 후 상세 fetch → parseDetail → body 결합.
 *  4) RawPost[] 반환. 4xx/5xx·예외는 해당 항목 skip.
 *
 * Note (ADR-030 step0 실사):
 *   알뜰구매(jirum) 게시판 샘플 29 titles 중 항공권 키워드 hit 0.
 *   Cheapsky 본체(scripts/crawl.ts)가 제목 + 본문에서 '항공'/'비행'/항공사명 키워드 필터 후
 *   route-map 파서로 노선 추출. 대부분의 post 는 filter 단계에서 배제됨 (기대).
 */
export const crawlClien: Crawler = async (config) => {
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
    console.warn('[crawlClien] fetch impl 이 없습니다. 빈 배열 반환.');
    return [];
  }

  if (!isAllowedPath(LIST_URL)) {
    console.warn(`[crawlClien] LIST_URL 이 ALLOWED_PATHS 밖입니다: ${LIST_URL}`);
    return [];
  }

  let listHtml = '';
  try {
    const res = await fetchImpl(LIST_URL, {
      headers: {
        'user-agent': userAgent,
        accept: 'text/html',
      },
    });
    if (!res.ok) {
      console.warn(`[crawlClien] 리스트 페이지 ${res.status}. 빈 배열 반환.`);
      return [];
    }
    listHtml = await res.text();
  } catch (err) {
    console.warn(`[crawlClien] 리스트 fetch 실패: ${String(err)}`);
    return [];
  }

  const listItems = parseList(listHtml, nowFn()).slice(0, maxPosts);
  if (listItems.length === 0) return [];

  const posts: RawPost[] = [];
  for (let i = 0; i < listItems.length; i++) {
    const item = listItems[i];

    await sleep(delayMs);

    if (!isAllowedPath(item.sourceUrl)) {
      console.warn(`[crawlClien] 차단된 경로 skip: ${item.sourceUrl}`);
      continue;
    }

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
          `[crawlClien] 상세 ${item.sourceId} → ${res.status} skip`,
        );
        continue;
      }
      const detailHtml = await res.text();
      body = parseDetail(detailHtml).body;
    } catch (err) {
      console.warn(
        `[crawlClien] 상세 fetch 실패 ${item.sourceId}: ${String(err)}`,
      );
      continue;
    }

    posts.push({
      source: 'clien',
      sourceId: item.sourceId,
      sourceUrl: item.sourceUrl,
      title: item.title,
      body,
      postedAt: item.postedAt,
    });
  }

  return posts;
};
