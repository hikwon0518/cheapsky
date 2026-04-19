// 루리웹 핫딜 게시판 크롤러 (Stretch 1 — ADR-004 보조 소스).
//
// Hard red lines (CLAUDE.md / ADR-008):
// - 이 파일은 순수 함수. DB·Supabase·파일 IO 전면 금지.
// - 요청 간격 ≥ 1000ms, 동시성 1. UA 는 config.userAgent (위장·rotation 금지).
// - 작성자 식별자(닉네임·member_srl) 수집·반환 금지. `td.writer` 는 읽지 않음.
// - robots 화이트리스트(ALLOWED_PATHS) 를 fetch 전 반드시 검사. 실제 robots.txt 에서 허용된
//   `/market/board/1020` 하위 경로만 사용.
// - 파서 실패·HTTP 에러는 throw 하지 않고 해당 항목만 skip (fail-soft).
// - ppomppu.ts 레퍼런스 참조. 단, 구조가 다르므로 복붙·추상화 하지 않음
//   (CLAUDE.md: "3번 비슷한 코드 > 잘못된 추상화 1개").
//
// 루리웹 DOM 특성 (실사 확인, 2026-04):
// - 리스트 행: `tr.table_body`. `.notice`, `.best` 클래스가 붙은 행은 공지/BEST 복제라 skip.
// - 제목 앵커: `a.subject_link`. 제목 텍스트는 내부 `strong` 혹은 앵커 own text.
//   `.num_reply` (댓글 수) 가 앵커 내부에 함께 있어 제목에서 제거.
// - 상세 URL: `/market/board/1020/read/<id>?` — `read/<id>` path.
// - 사회적 신호:
//   - `td.recomd` (추천수)
//   - `td.hit` (조회수)
//   - `a.num_reply` 텍스트 `(N)` 에서 N (댓글수)
// - 시간 텍스트: `HH:MM` (당일) 또는 `YYYY.MM.DD`.
// - 인코딩: UTF-8 (content-type 에서 확인). 다만 ppomppu 와 동일 헬퍼로 동적 decode.

import { parse, type HTMLElement } from 'node-html-parser';

import type { RawPost } from '@/types/deal';
import type { Crawler, ParsedListItem } from './types';

export const LIST_URL = 'https://bbs.ruliweb.com/market/board/1020';

/**
 * robots 화이트리스트. 실제 bbs.ruliweb.com/robots.txt (2026-04 실사):
 *   User-agent: *
 *   Disallow: /search /timeline /allbbs /member /*cate= /*view= ...
 * `/market/board/1020` 과 `/market/board/1020/read/<id>` 는 명시적 차단 없음 → 허용.
 * cate= (카테고리 파라미터) 는 Disallow 패턴에 걸리므로 사용하지 않는다.
 */
export const ALLOWED_PATHS: readonly string[] = [
  '/market/board/1020',
  '/market/board/1020/read/',
] as const;

const DEFAULT_MAX_POSTS = 40;
const DEFAULT_MIN_DELAY_MS = 1000;
const MIN_ENFORCED_DELAY_MS = 1000; // ADR-008: 1초 미만 조정 금지

const RULIWEB_HOST = 'bbs.ruliweb.com';

/**
 * URL 이 허용 경로에 속하는지 검사. 도메인 상관없이 path 만 체크.
 * (테스트에서 상대 경로도 넣을 수 있어 관대하게 처리)
 * robots.txt Disallow 패턴(`/*cate=`, `/*view=` 등) 에 걸리는 query 는 거절.
 */
export function isAllowedPath(urlOrPath: string): boolean {
  if (!urlOrPath) return false;
  let u: URL;
  try {
    u = new URL(urlOrPath, `https://${RULIWEB_HOST}`);
  } catch {
    return false;
  }
  const pathname = u.pathname;
  // path 가 허용 목록에 매치하는지.
  const pathAllowed = ALLOWED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p),
  );
  if (!pathAllowed) return false;

  // robots.txt Disallow 중 쿼리 기반 패턴 재점검:
  //   /*cate= /*view= /*view_cert= /*view_best= /*search_type= /*search_key= /*orderby= /*range= /*custom_list=
  // 이들은 URL 전체에 해당 키가 등장하면 차단.
  const blockedQueryKeys = [
    'cate',
    'view',
    'view_cert',
    'view_best',
    'search_type',
    'search_key',
    'orderby',
    'range',
    'custom_list',
  ];
  for (const key of blockedQueryKeys) {
    if (u.searchParams.has(key)) return false;
  }
  return true;
}

/**
 * 고정 대기. 테스트는 fake timer 로 추월 가능.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 루리웹은 UTF-8 이 기본이지만 Content-Type header 에서 charset 을 동적 추출해
 * ppomppu.ts 와 동일 패턴으로 decode (장기적 안정성).
 * 모르는 charset 이면 utf-8 폴백, 그것도 실패하면 euc-kr 2차 폴백.
 */
async function decodeResponse(res: Response): Promise<string> {
  const ct = res.headers.get('content-type') ?? '';
  const m = ct.match(/charset=([^;]+)/i);
  const charset = (m?.[1] ?? 'utf-8').toLowerCase().trim();
  const buf = await res.arrayBuffer();
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buf);
  } catch {
    try {
      return new TextDecoder('utf-8', { fatal: false }).decode(buf);
    } catch {
      return new TextDecoder('euc-kr', { fatal: false }).decode(buf);
    }
  }
}

/**
 * 상세 URL(`/market/board/1020/read/<id>?`) 에서 `<id>` 숫자 추출.
 * 형식이 다르면 null.
 */
function extractSourceId(href: string): string | null {
  try {
    const url = new URL(href, `https://${RULIWEB_HOST}`);
    const m = url.pathname.match(/\/market\/board\/1020\/read\/(\d+)/);
    if (!m) return null;
    return m[1];
  } catch {
    return null;
  }
}

/**
 * 정수 텍스트(예: "12,345" "988") 를 안전 변환.
 * 숫자가 아니거나 음수면 null.
 */
function parseIntLoose(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[,\s]/g, '');
  if (!/^-?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * `(12)` 형태의 댓글수 텍스트에서 숫자 추출. 없으면 null.
 */
function parseCommentCount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/\((\d+)\)/);
  if (!m) return null;
  return parseIntLoose(m[1]);
}

/**
 * 루리웹 리스트 시간 텍스트 파서 (fail-soft).
 * - `HH:MM` → 오늘 날짜 + 시:분 (now 의 로컬 날짜 기준)
 * - `YYYY.MM.DD` → 해당 UTC 자정
 * - `YYYY.MM.DD HH:MM` → UTC 해당 일시
 * - 그 외 → null
 */
export function parsePostedAt(raw: string, now: Date): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // HH:MM (당일)
  const mHM = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (mHM) {
    const h = Number(mHM[1]);
    const mn = Number(mHM[2]);
    if (h < 0 || h > 23 || mn < 0 || mn > 59) return null;
    const d = new Date(now);
    d.setHours(h, mn, 0, 0);
    return d;
  }

  // YYYY.MM.DD HH:MM
  const mDateTime = trimmed.match(
    /^(\d{4})\.(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2})$/,
  );
  if (mDateTime) {
    const y = Number(mDateTime[1]);
    const mo = Number(mDateTime[2]);
    const dd = Number(mDateTime[3]);
    const h = Number(mDateTime[4]);
    const mn = Number(mDateTime[5]);
    if (mo < 1 || mo > 12 || dd < 1 || dd > 31) return null;
    return new Date(Date.UTC(y, mo - 1, dd, h, mn));
  }

  // YYYY.MM.DD
  const mDate = trimmed.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
  if (mDate) {
    const y = Number(mDate[1]);
    const mo = Number(mDate[2]);
    const dd = Number(mDate[3]);
    if (mo < 1 || mo > 12 || dd < 1 || dd > 31) return null;
    return new Date(Date.UTC(y, mo - 1, dd));
  }

  return null;
}

/**
 * 한 행에서 제목 텍스트만 깔끔하게 추출.
 *  - `a.subject_link > strong` 이 있으면 그 텍스트 우선 (공지/BEST 포맷).
 *  - 아니면 앵커 own text — 단, 내부 `.num_reply` 괄호 숫자는 제거.
 *  - 연속 공백/개행 정리.
 */
function extractTitle(anchor: HTMLElement): string {
  const strong = anchor.querySelector('strong');
  if (strong) {
    const s = strong.text.replace(/\s+/g, ' ').trim();
    if (s) return s;
  }
  const numReply = anchor.querySelector('.num_reply');
  let raw = anchor.text;
  if (numReply) {
    raw = raw.replace(numReply.text, '');
  }
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * 리스트 페이지의 한 행에서 제목/URL/sourceId/postedAt/사회적 신호 추출.
 * 실패하면 null (caller skip).
 * 작성자(`td.writer`) 는 읽지 않는다 (ADR-008).
 */
function parseListRow(row: HTMLElement, now: Date): ParsedListItem | null {
  const anchor = row.querySelector('a.subject_link');
  if (!anchor) return null;
  const href = anchor.getAttribute('href') ?? '';
  if (!href) return null;

  const sourceId = extractSourceId(href);
  if (!sourceId) return null;

  const title = extractTitle(anchor);
  if (!title) return null;

  // href 가 상대 경로면 LIST_URL 기준으로 절대화.
  let sourceUrl: string;
  try {
    sourceUrl = new URL(href, LIST_URL).toString();
  } catch {
    return null;
  }

  // 시간
  let postedAt = now;
  const timeEl = row.querySelector('td.time');
  if (timeEl) {
    const parsed = parsePostedAt(timeEl.text.trim(), now);
    if (parsed) postedAt = parsed;
  }

  // 사회적 신호 raw (ADR-023 / UI_GUIDE: 숫자 자체 UI 노출 금지. 상대 판정 입력용)
  const views = parseIntLoose(row.querySelector('td.hit')?.text?.trim());
  const recommends = parseIntLoose(row.querySelector('td.recomd')?.text?.trim());
  const commentRaw =
    row.querySelector('.num_reply')?.text?.trim() ??
    row.querySelector('a.num_reply')?.text?.trim() ??
    null;
  const comments = parseCommentCount(commentRaw);

  return {
    sourceId,
    sourceUrl,
    title,
    postedAt,
    views,
    comments,
    recommends,
  };
}

/**
 * 리스트 HTML → ParsedListItem[].
 * 공지(`.notice`)·BEST 복제(`.best`) 행은 제외.
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

  const rows = root.querySelectorAll('tr.table_body');
  const items: ParsedListItem[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const cls = (row.getAttribute('class') ?? '').toLowerCase();
    // 공지·BEST 는 일반 리스트에 중복 노출되는 고정 행이라 skip.
    if (cls.split(/\s+/).includes('notice')) continue;
    if (cls.split(/\s+/).includes('best')) continue;
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
 * 루리웹 본문 컨테이너 (`div.view_content` / `div.board_main_view` / `article`) 중
 * 하나에서 텍스트 추출. 실패 시 `{ body: '' }` (throw 금지).
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
    'div.view_content',
    'div.board_main_view',
    '.view_content',
    'article',
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
 * 루리웹 크롤러 본체 (순수 함수 시그니처) — RawPost[] 만 반환.
 *
 * RawPost 에는 views/comments/recommends 가 포함되지 않는다 (step0 금지). caller 가
 * 사회적 신호(top 20% → hot / 다음 20% → trending) 판정을 하려면 `crawlRuliwebWithSignals`
 * 를 사용해 ParsedListItem[] 을 함께 받는다. 여기서 별도 export 를 두는 이유는 순수 함수 인터페이스
 * `Crawler = (config) => Promise<RawPost[]>` 를 깨지 않기 위함.
 */
export const crawlRuliweb: Crawler = async (config) => {
  const { posts } = await crawlRuliwebWithSignals(config);
  return posts;
};

/**
 * 크롤 + 리스트 파싱 결과를 함께 반환하는 변형. `scripts/crawl.ts` 에서 `social_signal`
 * 상대 판정 용도로만 사용. 이 함수도 순수 — DB 접근 없음, 로깅(console.warn) 은
 * 기존 ppomppu.ts 와 동일한 예외.
 *
 * 반환 객체:
 *   - posts: RawPost[] (상세 본문 포함)
 *   - items: ParsedListItem[] (views 등 사회적 신호 raw 포함. RawPost 와 sourceId 로 매핑)
 */
export async function crawlRuliwebWithSignals(
  config: Parameters<Crawler>[0],
): Promise<{ posts: RawPost[]; items: ParsedListItem[] }> {
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
    console.warn('[crawlRuliweb] fetch impl 이 없습니다. 빈 배열 반환.');
    return { posts: [], items: [] };
  }

  if (!isAllowedPath(LIST_URL)) {
    console.warn(`[crawlRuliweb] LIST_URL 이 ALLOWED_PATHS 밖입니다: ${LIST_URL}`);
    return { posts: [], items: [] };
  }

  // 1) 리스트 페이지.
  let listHtml = '';
  try {
    const res = await fetchImpl(LIST_URL, {
      headers: {
        'user-agent': userAgent,
        accept: 'text/html',
      },
    });
    if (!res.ok) {
      console.warn(`[crawlRuliweb] 리스트 페이지 ${res.status}. 빈 배열 반환.`);
      return { posts: [], items: [] };
    }
    listHtml = await decodeResponse(res);
  } catch (err) {
    console.warn(`[crawlRuliweb] 리스트 fetch 실패: ${String(err)}`);
    return { posts: [], items: [] };
  }

  const listItems = parseList(listHtml, nowFn()).slice(0, maxPosts);
  if (listItems.length === 0) return { posts: [], items: [] };

  const posts: RawPost[] = [];
  for (const item of listItems) {
    // 2) 요청 간 최소 대기 (첫 항목도 리스트 fetch 직후라 1초 대기).
    await sleep(delayMs);

    // 3) 상세 URL 화이트리스트 재검사.
    if (!isAllowedPath(item.sourceUrl)) {
      console.warn(`[crawlRuliweb] 차단된 경로 skip: ${item.sourceUrl}`);
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
          `[crawlRuliweb] 상세 ${item.sourceId} → ${res.status} skip`,
        );
        continue;
      }
      const detailHtml = await decodeResponse(res);
      body = parseDetail(detailHtml).body;
    } catch (err) {
      console.warn(
        `[crawlRuliweb] 상세 fetch 실패 ${item.sourceId}: ${String(err)}`,
      );
      continue;
    }

    posts.push({
      source: 'ruliweb',
      sourceId: item.sourceId,
      sourceUrl: item.sourceUrl,
      title: item.title,
      body,
      postedAt: item.postedAt,
    });
  }

  return { posts, items: listItems };
}
