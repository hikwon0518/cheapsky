// 루리웹 크롤러 단위 테스트 (Stretch 1 — step0.md "테스트" 검증 항목).
//
// 검증 범위:
// - parseList 가 15개 일반 행을 추출 (공지·BEST 2건 skip).
// - ALLOWED_PATHS 가 `/market/board/1020` 계열로 한정.
// - 작성자(`td.writer`) 가 ParsedListItem / RawPost 에 나타나지 않음.
// - views/comments/recommends 파싱 (있으면 number, 없으면 null).
// - 500/403 응답 → 빈 배열 or skip, throw 없음.
// - 요청 간격 ≥ 1000ms 강제 (ADR-008).
// - 순수 함수 — 이 모듈은 db/supabase import 금지.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ALLOWED_PATHS,
  LIST_URL,
  crawlRuliweb,
  isAllowedPath,
  parseDetail,
  parseList,
  parsePostedAt,
} from './ruliweb';
import type { RawPost } from '@/types/deal';
import type { ParsedListItem } from './types';

const FIXTURE_DIR = resolve(__dirname, '../../../__fixtures__');
const LIST_FIXTURE = readFileSync(
  resolve(FIXTURE_DIR, 'ruliweb-list-2026-04-19.html'),
  'utf-8',
);
const DETAIL_FIXTURE = readFileSync(
  resolve(FIXTURE_DIR, 'ruliweb-detail-sample.html'),
  'utf-8',
);

const FIXED_NOW = new Date('2026-04-19T12:00:00Z');

describe('ALLOWED_PATHS', () => {
  it('contains list board path and read detail path', () => {
    expect([...ALLOWED_PATHS].sort()).toEqual([
      '/market/board/1020',
      '/market/board/1020/read/',
    ]);
  });
});

describe('isAllowedPath', () => {
  it('accepts LIST_URL', () => {
    expect(isAllowedPath(LIST_URL)).toBe(true);
  });

  it('accepts read detail URLs', () => {
    expect(
      isAllowedPath('https://bbs.ruliweb.com/market/board/1020/read/200201'),
    ).toBe(true);
    expect(
      isAllowedPath('https://bbs.ruliweb.com/market/board/1020/read/103488?'),
    ).toBe(true);
  });

  it('rejects Disallow: /search /member /timeline /allbbs', () => {
    expect(isAllowedPath('https://bbs.ruliweb.com/search?q=foo')).toBe(false);
    expect(isAllowedPath('https://bbs.ruliweb.com/member/login')).toBe(false);
    expect(isAllowedPath('https://bbs.ruliweb.com/timeline')).toBe(false);
    expect(isAllowedPath('https://bbs.ruliweb.com/allbbs')).toBe(false);
  });

  it('rejects URLs with robots Disallow query keys (cate, view, search_*)', () => {
    expect(
      isAllowedPath('https://bbs.ruliweb.com/market/board/1020?cate=30'),
    ).toBe(false);
    expect(
      isAllowedPath(
        'https://bbs.ruliweb.com/market/board/1020?view=detail',
      ),
    ).toBe(false);
    expect(
      isAllowedPath(
        'https://bbs.ruliweb.com/market/board/1020?search_type=member_srl',
      ),
    ).toBe(false);
    expect(
      isAllowedPath(
        'https://bbs.ruliweb.com/market/board/1020?orderby=hit',
      ),
    ).toBe(false);
  });

  it('rejects unrelated boards', () => {
    expect(isAllowedPath('https://bbs.ruliweb.com/market/board/1021')).toBe(
      false,
    );
    expect(isAllowedPath('https://bbs.ruliweb.com/family/1/200001')).toBe(
      false,
    );
  });

  it('rejects empty string', () => {
    expect(isAllowedPath('')).toBe(false);
  });
});

describe('parsePostedAt', () => {
  it('parses HH:MM as today', () => {
    const d = parsePostedAt('12:30', FIXED_NOW);
    expect(d).not.toBeNull();
    expect(d!.getHours()).toBe(12);
    expect(d!.getMinutes()).toBe(30);
  });

  it('parses YYYY.MM.DD as UTC midnight', () => {
    const d = parsePostedAt('2026.04.18', FIXED_NOW);
    expect(d!.getUTCFullYear()).toBe(2026);
    expect(d!.getUTCMonth()).toBe(3);
    expect(d!.getUTCDate()).toBe(18);
  });

  it('parses YYYY.MM.DD HH:MM', () => {
    const d = parsePostedAt('2026.04.18 09:30', FIXED_NOW);
    expect(d!.getUTCFullYear()).toBe(2026);
    expect(d!.getUTCHours()).toBe(9);
  });

  it('returns null for garbage', () => {
    expect(parsePostedAt('yesterday', FIXED_NOW)).toBeNull();
    expect(parsePostedAt('25:99', FIXED_NOW)).toBeNull();
    expect(parsePostedAt('', FIXED_NOW)).toBeNull();
  });
});

describe('parseList', () => {
  it('extracts 15 items (notice + best skipped)', () => {
    const items = parseList(LIST_FIXTURE, FIXED_NOW);
    expect(items.length).toBe(15);
  });

  it('first item is the 대한항공 airfare post', () => {
    const items = parseList(LIST_FIXTURE, FIXED_NOW);
    expect(items[0].sourceId).toBe('200201');
    expect(items[0].title).toContain('대한항공');
    expect(items[0].title).toContain('오사카');
    expect(items[0].sourceUrl).toBe(
      'https://bbs.ruliweb.com/market/board/1020/read/200201?',
    );
  });

  it('strips num_reply parentheses from title (no " (N)" suffix)', () => {
    const items = parseList(LIST_FIXTURE, FIXED_NOW);
    // Airfare title ends with `(5~6월)` which is legitimate; ensure only reply-count
    // suffix (` (12)`) is removed — title must not end with `(<digits>)`.
    expect(items[0].title).not.toMatch(/\(\s*\d+\s*\)\s*$/);
    // sanity: the shape containing 항공 info is preserved
    expect(items[0].title).toContain('250,000원');
  });

  it('parses views/comments/recommends as numbers', () => {
    const items = parseList(LIST_FIXTURE, FIXED_NOW);
    const airfare = items[0];
    expect(airfare.views).toBe(12345);
    expect(airfare.comments).toBe(12);
    expect(airfare.recommends).toBe(88);
  });

  it('handles missing views gracefully (null when non-numeric)', () => {
    const items = parseList(LIST_FIXTURE, FIXED_NOW);
    // 200213 has `<td class="hit">-</td>` and no .num_reply.
    const item = items.find((i) => i.sourceId === '200213');
    expect(item).toBeDefined();
    expect(item!.views).toBeNull();
    expect(item!.comments).toBeNull();
    expect(item!.recommends).toBe(3); // recomd cell has "3"
  });

  it('deduplicates by sourceId', () => {
    const html = `
      <table><tbody>
        <tr class="table_body"><td class="subject"><a class="subject_link" href="https://bbs.ruliweb.com/market/board/1020/read/1?">A</a></td><td class="time">09:00</td></tr>
        <tr class="table_body"><td class="subject"><a class="subject_link" href="https://bbs.ruliweb.com/market/board/1020/read/1?">A dup</a></td><td class="time">09:00</td></tr>
        <tr class="table_body"><td class="subject"><a class="subject_link" href="https://bbs.ruliweb.com/market/board/1020/read/2?">B</a></td><td class="time">09:01</td></tr>
      </tbody></table>
    `;
    const items = parseList(html, FIXED_NOW);
    expect(items.length).toBe(2);
  });

  it('skips rows whose href lacks /read/<id>', () => {
    const html = `
      <table><tbody>
        <tr class="table_body"><td class="subject"><a class="subject_link" href="https://bbs.ruliweb.com/market/board/1020?cate=31">nope</a></td></tr>
        <tr class="table_body"><td class="subject"><a class="subject_link" href="https://bbs.ruliweb.com/market/board/1020/read/999?">ok</a></td><td class="time">09:00</td></tr>
      </tbody></table>
    `;
    const items = parseList(html, FIXED_NOW);
    expect(items.length).toBe(1);
    expect(items[0].sourceId).toBe('999');
  });

  it('returns empty array for empty html', () => {
    expect(parseList('', FIXED_NOW)).toEqual([]);
  });

  it('does not expose writer/author data', () => {
    const items = parseList(LIST_FIXTURE, FIXED_NOW);
    for (const item of items) {
      // No 'author' / 'writer' / 'nickname' / 'member_srl' fields.
      const r = item as unknown as Record<string, unknown>;
      expect(r.author).toBeUndefined();
      expect(r.writer).toBeUndefined();
      expect(r.nickname).toBeUndefined();
      expect(r.memberSrl).toBeUndefined();
      expect(r.member_srl).toBeUndefined();
    }
  });
});

describe('parseDetail', () => {
  it('extracts body text from fixture', () => {
    const { body } = parseDetail(DETAIL_FIXTURE);
    expect(body.length).toBeGreaterThan(30);
    expect(body).toContain('오사카');
    expect(body).toContain('대한항공');
  });

  it('returns empty body for garbage html', () => {
    expect(parseDetail('<html><body>nothing here</body></html>').body).toBe(
      '',
    );
    expect(parseDetail('').body).toBe('');
  });
});

describe('crawlRuliweb (fail-soft)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns [] when fetch impl is absent', async () => {
    const g = globalThis as { fetch?: typeof fetch };
    const originalFetch = g.fetch;
    g.fetch = undefined;
    try {
      const out = await crawlRuliweb({
        userAgent: 'Cheapsky/test',
        fetch: undefined as unknown as typeof fetch,
      });
      expect(out).toEqual([]);
    } finally {
      g.fetch = originalFetch;
    }
  });

  it('returns [] when list fetch responds 500 (no throw)', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 500 }));
    const out = await crawlRuliweb({
      userAgent: 'Cheapsky/test',
      fetch: mockFetch as unknown as typeof fetch,
    });
    expect(out).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns [] when list fetch throws', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('enotfound'));
    const out = await crawlRuliweb({
      userAgent: 'Cheapsky/test',
      fetch: mockFetch as unknown as typeof fetch,
    });
    expect(out).toEqual([]);
  });

  it('skips individual detail fetch 403 without throwing', async () => {
    const listHtml = `
      <table><tbody>
        <tr class="table_body">
          <td class="subject"><a class="subject_link" href="https://bbs.ruliweb.com/market/board/1020/read/1?">OK deal</a></td>
          <td class="time">12:00</td>
        </tr>
        <tr class="table_body">
          <td class="subject"><a class="subject_link" href="https://bbs.ruliweb.com/market/board/1020/read/2?">Bad deal</a></td>
          <td class="time">12:00</td>
        </tr>
      </tbody></table>
    `;
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url === LIST_URL) {
        return Promise.resolve(new Response(listHtml, { status: 200 }));
      }
      if (url.includes('/read/1')) {
        return Promise.resolve(new Response(DETAIL_FIXTURE, { status: 200 }));
      }
      if (url.includes('/read/2')) {
        return Promise.resolve(new Response('', { status: 403 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });

    const run = crawlRuliweb({
      userAgent: 'Cheapsky/test',
      minDelayMs: 1000,
      fetch: mockFetch as unknown as typeof fetch,
    });
    await vi.advanceTimersByTimeAsync(5000);
    const out = await run;
    expect(out.length).toBe(1);
    expect(out[0].sourceId).toBe('1');
    expect(out[0].source).toBe('ruliweb');
  });

  it('enforces ≥ 1000ms between requests (ADR-008)', async () => {
    const listHtml = `
      <table><tbody>
        <tr class="table_body">
          <td class="subject"><a class="subject_link" href="https://bbs.ruliweb.com/market/board/1020/read/1?">A</a></td>
          <td class="time">12:00</td>
        </tr>
        <tr class="table_body">
          <td class="subject"><a class="subject_link" href="https://bbs.ruliweb.com/market/board/1020/read/2?">B</a></td>
          <td class="time">12:01</td>
        </tr>
      </tbody></table>
    `;
    const callTimes: number[] = [];
    const start = Date.now();
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      callTimes.push(Date.now() - start);
      if (url === LIST_URL) {
        return Promise.resolve(new Response(listHtml, { status: 200 }));
      }
      return Promise.resolve(new Response(DETAIL_FIXTURE, { status: 200 }));
    });

    const run = crawlRuliweb({
      userAgent: 'Cheapsky/test',
      // even if caller tries 100ms, crawler clamps to 1000ms
      minDelayMs: 100,
      fetch: mockFetch as unknown as typeof fetch,
    });
    await vi.advanceTimersByTimeAsync(3000);
    await run;

    expect(callTimes[0]).toBe(0);
    expect(callTimes[1]).toBeGreaterThanOrEqual(1000);
    expect(callTimes[2]).toBeGreaterThanOrEqual(2000);
  });

  it('injects user-agent on every request', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url === LIST_URL) {
        return Promise.resolve(
          new Response('<table></table>', { status: 200 }),
        );
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });
    await crawlRuliweb({
      userAgent: 'Cheapsky/0.1 (+mailto:test)',
      fetch: mockFetch as unknown as typeof fetch,
    });
    const headers = mockFetch.mock.calls[0][1]?.headers as
      | Record<string, string>
      | undefined;
    expect(headers?.['user-agent']).toBe('Cheapsky/0.1 (+mailto:test)');
  });

  it('respects maxPosts cap', async () => {
    const rows = [1, 2, 3, 4, 5]
      .map(
        (n) => `
          <tr class="table_body">
            <td class="subject"><a class="subject_link" href="https://bbs.ruliweb.com/market/board/1020/read/${n}?">title ${n}</a></td>
            <td class="time">12:0${n}</td>
          </tr>`,
      )
      .join('');
    const listHtml = `<table><tbody>${rows}</tbody></table>`;
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url === LIST_URL) {
        return Promise.resolve(new Response(listHtml, { status: 200 }));
      }
      return Promise.resolve(new Response(DETAIL_FIXTURE, { status: 200 }));
    });
    const run = crawlRuliweb({
      userAgent: 'Cheapsky/test',
      maxPosts: 2,
      fetch: mockFetch as unknown as typeof fetch,
    });
    await vi.advanceTimersByTimeAsync(5000);
    const out = await run;
    expect(out.length).toBe(2);
  });
});

describe('red line — no author field in RawPost / ParsedListItem', () => {
  it('RawPost from ruliweb has no author key', () => {
    const post: RawPost = {
      source: 'ruliweb',
      sourceId: 's1',
      sourceUrl: 'https://bbs.ruliweb.com/market/board/1020/read/1',
      title: 't',
      body: 'b',
      postedAt: FIXED_NOW,
    };
    expect(Object.prototype.hasOwnProperty.call(post, 'author')).toBe(false);
    expect((post as unknown as Record<string, unknown>).author).toBeUndefined();
  });

  it('ParsedListItem has no author even with social-signal extensions', () => {
    const item: ParsedListItem = {
      sourceId: '1',
      sourceUrl: 'https://bbs.ruliweb.com/market/board/1020/read/1',
      title: 't',
      postedAt: FIXED_NOW,
      views: 100,
      comments: 5,
      recommends: 10,
    };
    const r = item as unknown as Record<string, unknown>;
    expect(r.author).toBeUndefined();
    expect(r.writer).toBeUndefined();
    expect(r.nickname).toBeUndefined();
  });
});

describe('red line — ruliweb.ts is a pure function (no db imports)', () => {
  it('does not import @/lib/db or @supabase/supabase-js', () => {
    const src = readFileSync(resolve(__dirname, 'ruliweb.ts'), 'utf-8');
    expect(src).not.toMatch(/from\s+['"]@\/lib\/db['"]/);
    expect(src).not.toMatch(/from\s+['"]@supabase\/supabase-js['"]/);
    expect(src).not.toMatch(/createClient\(/);
  });
});
