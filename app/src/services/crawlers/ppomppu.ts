// 뽐뿌 해외여행 게시판 크롤러 (Core — ADR-004).
//
// Hard red lines (CLAUDE.md / ADR-008):
// - 이 파일은 순수 함수. DB·Supabase·파일 IO 전면 금지.
// - 요청 간격 ≥ 1000ms, 동시성 1. UA 는 config.userAgent (위장 금지).
// - 작성자 식별자(닉네임·uid) 수집·반환 금지 — RawPost 에 author 필드 없음.
// - robots 화이트리스트(ALLOWED_PATHS) 를 fetch 전 반드시 검사.
// - 파서 실패·HTTP 에러는 throw 하지 않고 해당 항목만 skip (fail-soft).
// - 이후 step 4 의 `scripts/crawl.ts` 가 이 함수의 반환을 받아 파싱·UPSERT 수행.

import { parse, type HTMLElement } from 'node-html-parser';

import type { RawPost } from '@/types/deal';
import type { Crawler, ParsedListItem } from './types';

export const LIST_URL =
  'https://www.ppomppu.co.kr/zboard/zboard.php?id=ppomppu4';

/**
 * robots 화이트리스트. fetch 전 URL path 가 아래 중 하나로 시작해야 호출 허용.
 * 그 외 경로(관리자·로그인·검색 등) 는 skip + 경고 로그.
 */
export const ALLOWED_PATHS: readonly string[] = [
  '/zboard/zboard.php',
  '/zboard/view.php',
] as const;

const DEFAULT_MAX_POSTS = 40;
const DEFAULT_MIN_DELAY_MS = 1000;
const MIN_ENFORCED_DELAY_MS = 1000; // ADR-008: 1초 미만 조정 금지

const PPOMPPU_HOST = 'www.ppomppu.co.kr';

/**
 * URL 이 허용 경로에 속하는지 검사. 도메인 상관없이 path 만 체크.
 * (테스트에서 file:// 또는 상대 경로도 넣을 수 있어 관대하게 처리)
 */
export function isAllowedPath(urlOrPath: string): boolean {
  if (!urlOrPath) return false;
  let pathname: string;
  try {
    pathname = new URL(urlOrPath, `https://${PPOMPPU_HOST}`).pathname;
  } catch {
    return false;
  }
  return ALLOWED_PATHS.some((p) => pathname === p || pathname.startsWith(p));
}

/**
 * 고정 대기. 테스트는 fake timer 로 추월 가능.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 뽐뿌는 `charset=euc-kr`. 기본 `res.text()` 는 UTF-8 로 해석해 한글이 전부 깨진다.
 * Content-Type 헤더에서 charset 을 추출해 적절한 TextDecoder 로 decode.
 * 모르는 charset 이면 euc-kr 폴백 (뽐뿌 고정), 그것도 실패하면 utf-8.
 */
async function decodeResponse(res: Response): Promise<string> {
  const ct = res.headers.get('content-type') ?? '';
  const m = ct.match(/charset=([^;]+)/i);
  const charset = (m?.[1] ?? 'euc-kr').toLowerCase().trim();
  const buf = await res.arrayBuffer();
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buf);
  } catch {
    try {
      return new TextDecoder('euc-kr', { fatal: false }).decode(buf);
    } catch {
      return new TextDecoder('utf-8', { fatal: false }).decode(buf);
    }
  }
}

/**
 * `zboard/view.php?id=ppomppu4&no=XXXXXX` 패턴에서 `no=` 값을 뽑는다.
 * 형식이 다르면 null.
 */
function extractSourceId(href: string): string | null {
  try {
    const url = new URL(href, `https://${PPOMPPU_HOST}`);
    const no = url.searchParams.get('no');
    if (!no || !/^\d+$/.test(no)) return null;
    return no;
  } catch {
    return null;
  }
}

/**
 * 리스트 페이지의 한 행에서 제목/URL/sourceId/postedAt 추출.
 * 실패하면 null (caller skip).
 */
function parseListRow(row: HTMLElement, now: Date): ParsedListItem | null {
  // 제목 앵커: view.php 링크 찾기.
  // 실제 뽐뿌는 <a class="baseList-title"> 가 제목. <a class="baseList-thumb"> 는 썸네일(제목 없음).
  // 현재 게시판(ppomppu4=해외뽐뿌) 의 `view.php` 링크만 수집. 상대·절대 href 둘 다 허용.
  const anchors = row.querySelectorAll('a');
  let titleAnchor: HTMLElement | null = null;
  let href = '';
  for (const a of anchors) {
    const rawHref = a.getAttribute('href') ?? '';
    if (!rawHref.includes('view.php')) continue;
    if (!rawHref.includes('id=ppomppu4')) continue;
    // 썸네일 앵커는 텍스트 없음 → skip. baseList-title 또는 자유 앵커 모두 수용.
    const cls = (a.getAttribute('class') ?? '').toLowerCase();
    if (cls.includes('baselist-thumb')) continue;
    titleAnchor = a;
    href = rawHref;
    break;
  }
  if (!titleAnchor) return null;

  // 제목 텍스트 — 공백·개행 정리. <em class="subject_preface">[특가]</em> 같은 prefix 태그 포함.
  const titleRaw = titleAnchor.text.replace(/\s+/g, ' ').trim();
  if (!titleRaw) return null;

  const sourceId = extractSourceId(href);
  if (!sourceId) return null;

  // 상대 URL → 절대 URL. LIST_URL 기준으로 해석 (뽐뿌는 `view.php?...` 상대경로 빈번).
  let sourceUrl: string;
  try {
    sourceUrl = new URL(href, LIST_URL).toString();
  } catch {
    return null;
  }

  // 등록 시간: `time` 엘리먼트 혹은 특정 클래스. 실패 시 now() 로 폴백.
  // 뽐뿌는 `HH:MM` 또는 `YY/MM/DD` 형태의 텍스트를 사용.
  let postedAt = now;
  const timeEl =
    row.querySelector('time') ||
    row.querySelector('.list_time') ||
    row.querySelector('.date');
  if (timeEl) {
    const txt = timeEl.text.trim();
    const parsed = parsePostedAt(txt, now);
    if (parsed) postedAt = parsed;
  }

  return {
    sourceId,
    sourceUrl,
    title: titleRaw,
    postedAt,
  };
}

/**
 * 뽐뿌 리스트 시간 텍스트 파서 (fail-soft).
 * - `HH:MM` → 오늘 날짜 + 시:분 (KST 기준, now 날짜 사용)
 * - `YY/MM/DD` → 과거 날짜
 * - 그 외 → null
 */
export function parsePostedAt(raw: string, now: Date): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // HH:MM
  const mHM = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (mHM) {
    const h = Number(mHM[1]);
    const mn = Number(mHM[2]);
    if (h < 0 || h > 23 || mn < 0 || mn > 59) return null;
    const d = new Date(now);
    d.setHours(h, mn, 0, 0);
    return d;
  }

  // YY/MM/DD (2자리 연도 → 2000 대)
  const mYMD = trimmed.match(/^(\d{2})\/(\d{1,2})\/(\d{1,2})$/);
  if (mYMD) {
    const yy = Number(mYMD[1]);
    const mo = Number(mYMD[2]);
    const dd = Number(mYMD[3]);
    if (mo < 1 || mo > 12 || dd < 1 || dd > 31) return null;
    return new Date(Date.UTC(2000 + yy, mo - 1, dd));
  }

  // YYYY-MM-DD
  const mISO = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (mISO) {
    return new Date(`${trimmed}T00:00:00Z`);
  }

  return null;
}

/**
 * 리스트 HTML → ParsedListItem[].
 * 실패 행은 skip. 동일 sourceId 중복도 최초 한 건만 유지.
 */
export function parseList(html: string, now: Date): ParsedListItem[] {
  if (!html) return [];
  let root: HTMLElement;
  try {
    root = parse(html);
  } catch {
    return [];
  }

  // 뽐뿌는 다중 class (예: "baseList bbs_new1") 사용. node-html-parser 는
  // `tr.baseList` 로 다중 class 의 한 단어 매칭이 동작한다.
  // 과거 레이아웃 호환도 유지 (tr.list1 / tr.list0 / tr.common-list*).
  const rows = root.querySelectorAll(
    'tr.baseList, tr.list1, tr.list0, tr.common-list1, tr.common-list0',
  );
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
 * 상세 페이지 HTML → { body } (텍스트만).
 * 뽐뿌 본문 컨테이너(#quote, .board_main, td.board-contents 등) 중 하나에서 텍스트 추출.
 * 실패 시 `{ body: '' }` (throw 금지).
 */
export function parseDetail(html: string): { body: string } {
  if (!html) return { body: '' };
  let root: HTMLElement;
  try {
    root = parse(html);
  } catch {
    return { body: '' };
  }

  const candidates = [
    'td.board-contents',
    '.board_main',
    '#quote',
    '.view_body',
    '#contents_wrap',
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
 * ppomppu 크롤러 본체. 순수 함수 — DB / 파일 IO 없음.
 *
 * 동작:
 *  1) LIST_URL fetch (UA = config.userAgent). ALLOWED_PATHS 검사.
 *  2) parseList 로 리스트 아이템 최대 maxPosts 개 추출.
 *  3) 각 아이템마다 1초 대기 후 상세 fetch → parseDetail → body 결합.
 *  4) RawPost[] 반환. 4xx/5xx·예외는 해당 항목 skip.
 */
export const crawlPpomppu: Crawler = async (config) => {
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
    console.warn('[crawlPpomppu] fetch impl 이 없습니다. 빈 배열 반환.');
    return [];
  }

  // 1) 리스트 페이지.
  if (!isAllowedPath(LIST_URL)) {
    console.warn(`[crawlPpomppu] LIST_URL 이 ALLOWED_PATHS 밖입니다: ${LIST_URL}`);
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
      console.warn(`[crawlPpomppu] 리스트 페이지 ${res.status}. 빈 배열 반환.`);
      return [];
    }
    listHtml = await decodeResponse(res);
  } catch (err) {
    console.warn(`[crawlPpomppu] 리스트 fetch 실패: ${String(err)}`);
    return [];
  }

  const listItems = parseList(listHtml, nowFn()).slice(0, maxPosts);
  if (listItems.length === 0) return [];

  const posts: RawPost[] = [];
  for (let i = 0; i < listItems.length; i++) {
    const item = listItems[i];

    // 2) 요청 간 최소 대기 (첫 항목도 리스트 fetch 직후라 1초 대기).
    await sleep(delayMs);

    // 3) 상세 URL 화이트리스트 재검사.
    if (!isAllowedPath(item.sourceUrl)) {
      console.warn(`[crawlPpomppu] 차단된 경로 skip: ${item.sourceUrl}`);
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
          `[crawlPpomppu] 상세 ${item.sourceId} → ${res.status} skip`,
        );
        continue;
      }
      const detailHtml = await decodeResponse(res);
      body = parseDetail(detailHtml).body;
    } catch (err) {
      console.warn(
        `[crawlPpomppu] 상세 fetch 실패 ${item.sourceId}: ${String(err)}`,
      );
      continue;
    }

    posts.push({
      source: 'ppomppu',
      sourceId: item.sourceId,
      sourceUrl: item.sourceUrl,
      title: item.title,
      body,
      postedAt: item.postedAt,
    });
  }

  return posts;
};
