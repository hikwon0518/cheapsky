// 뽐뿌 크롤러 단위 테스트.
//
// 검증 항목 (step3.md "검증 절차"):
// - parseList 가 고정 픽스처에서 기대 개수 item 추출
// - isAllowedPath 가 ALLOWED_PATHS 밖 URL 차단
// - fetch mock 으로 요청 간 1초 대기 검증 (fake timer)
// - 500 응답·throw → 빈 배열 반환 (fail-soft)
// - 작성자 필드가 RawPost / ParsedListItem 에 부재

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ALLOWED_PATHS,
  LIST_URL,
  crawlPpomppu,
  isAllowedPath,
  parseDetail,
  parseList,
  parsePostedAt,
} from './ppomppu';
import type { RawPost } from '@/types/deal';
import type { ParsedListItem } from './types';

const FIXTURE_DIR = resolve(__dirname, '../../../__fixtures__');
const LIST_FIXTURE = readFileSync(
  resolve(FIXTURE_DIR, 'ppomppu-list-2026-04-18.html'),
  'utf-8',
);
const DETAIL_FIXTURE = readFileSync(
  resolve(FIXTURE_DIR, 'ppomppu-detail-sample.html'),
  'utf-8',
);

const FIXED_NOW = new Date('2026-04-18T12:00:00Z');

describe('ALLOWED_PATHS', () => {
  it('contains only /zboard/zboard.php and /zboard/view.php', () => {
    expect([...ALLOWED_PATHS].sort()).toEqual([
      '/zboard/view.php',
      '/zboard/zboard.php',
    ]);
  });
});

describe('isAllowedPath', () => {
  it('accepts LIST_URL', () => {
    expect(isAllowedPath(LIST_URL)).toBe(true);
  });

  it('accepts view.php absolute URL', () => {
    expect(
      isAllowedPath(
        'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu4&no=500001',
      ),
    ).toBe(true);
  });

  it('rejects /login.php', () => {
    expect(
      isAllowedPath('https://www.ppomppu.co.kr/login.php?mb_id=foo'),
    ).toBe(false);
  });

  it('rejects admin/search paths', () => {
    expect(isAllowedPath('/admin/config')).toBe(false);
    expect(isAllowedPath('/search.php?q=hello')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isAllowedPath('')).toBe(false);
  });
});

describe('parsePostedAt', () => {
  it('parses HH:MM onto the `now` date', () => {
    const d = parsePostedAt('10:22', FIXED_NOW);
    expect(d).not.toBeNull();
    expect(d!.getHours()).toBe(10);
    expect(d!.getMinutes()).toBe(22);
  });

  it('parses YY/MM/DD as 2000s UTC', () => {
    const d = parsePostedAt('26/04/18', FIXED_NOW);
    expect(d!.getUTCFullYear()).toBe(2026);
    expect(d!.getUTCMonth()).toBe(3); // 0-indexed April
    expect(d!.getUTCDate()).toBe(18);
  });

  it('returns null for garbage', () => {
    expect(parsePostedAt('asdf', FIXED_NOW)).toBeNull();
    expect(parsePostedAt('', FIXED_NOW)).toBeNull();
    expect(parsePostedAt('25:99', FIXED_NOW)).toBeNull();
  });
});

describe('parseList', () => {
  it('extracts 17 valid items from fixture (one row is a login link, 1016)', () => {
    const items = parseList(LIST_FIXTURE, FIXED_NOW);
    expect(items.length).toBe(17);
  });

  it('skips rows whose href is not view.php', () => {
    const items = parseList(LIST_FIXTURE, FIXED_NOW);
    const urls = items.map((i) => i.sourceUrl);
    expect(urls.every((u) => u.includes('/zboard/view.php'))).toBe(true);
    expect(urls.some((u) => u.includes('login.php'))).toBe(false);
  });

  it('deduplicates by sourceId', () => {
    const html = `
      <table><tbody>
        <tr class="list1"><td><a href="/zboard/view.php?id=ppomppu4&no=1">A</a></td></tr>
        <tr class="list1"><td><a href="/zboard/view.php?id=ppomppu4&no=1">A dup</a></td></tr>
        <tr class="list1"><td><a href="/zboard/view.php?id=ppomppu4&no=2">B</a></td></tr>
      </tbody></table>
    `;
    const items = parseList(html, FIXED_NOW);
    expect(items.length).toBe(2);
  });

  it('returns empty array for empty html', () => {
    expect(parseList('', FIXED_NOW)).toEqual([]);
  });

  it('fixture first item is the 대한항공 오사카 post', () => {
    const items = parseList(LIST_FIXTURE, FIXED_NOW);
    expect(items[0].sourceId).toBe('500001');
    expect(items[0].title).toContain('대한항공');
    expect(items[0].title).toContain('오사카');
  });
});

describe('parseDetail', () => {
  it('extracts body text from fixture', () => {
    const { body } = parseDetail(DETAIL_FIXTURE);
    expect(body.length).toBeGreaterThan(100);
    expect(body).toContain('135,000원');
    expect(body).toContain('오사카');
  });

  it('returns empty body for garbage html', () => {
    expect(parseDetail('<html><body>nothing</body></html>').body).toBe('');
    expect(parseDetail('').body).toBe('');
  });
});

describe('crawlPpomppu (fail-soft)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns [] when fetch impl is absent', async () => {
    // Node 18+ 에선 globalThis.fetch 가 존재해 fallback 이 실제 네트워크로 나간다.
    // 이 테스트 의도 ("주입·전역 모두 없음 → 빈 배열") 를 위해 일시 stub.
    const g = globalThis as { fetch?: typeof fetch };
    const originalFetch = g.fetch;
    g.fetch = undefined;
    try {
      const out = await crawlPpomppu({
        userAgent: 'Cheapsky/test',
        fetch: undefined as unknown as typeof fetch,
      });
      expect(out).toEqual([]);
    } finally {
      g.fetch = originalFetch;
    }
  });

  it('returns [] when list fetch responds 500 (no throw)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('', { status: 500 }),
    );
    const out = await crawlPpomppu({
      userAgent: 'Cheapsky/test',
      fetch: mockFetch as unknown as typeof fetch,
    });
    expect(out).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1); // only list attempt
  });

  it('returns [] when list fetch throws (no throw to caller)', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network down'));
    const out = await crawlPpomppu({
      userAgent: 'Cheapsky/test',
      fetch: mockFetch as unknown as typeof fetch,
    });
    expect(out).toEqual([]);
  });

  it('skips individual detail fetch 403 without throwing', async () => {
    const listHtml = `
      <table><tbody>
        <tr class="list1"><td><a href="/zboard/view.php?id=ppomppu4&no=1">OK deal</a></td><td><span class="list_time">10:22</span></td></tr>
        <tr class="list1"><td><a href="/zboard/view.php?id=ppomppu4&no=2">Bad deal</a></td><td><span class="list_time">10:22</span></td></tr>
      </tbody></table>
    `;
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url === LIST_URL) {
        return Promise.resolve(new Response(listHtml, { status: 200 }));
      }
      if (url.includes('no=1')) {
        return Promise.resolve(
          new Response(DETAIL_FIXTURE, { status: 200 }),
        );
      }
      if (url.includes('no=2')) {
        return Promise.resolve(new Response('', { status: 403 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });

    const run = crawlPpomppu({
      userAgent: 'Cheapsky/test',
      minDelayMs: 1000,
      fetch: mockFetch as unknown as typeof fetch,
    });
    // 2 detail delays × 1000ms.
    await vi.advanceTimersByTimeAsync(5000);
    const out = await run;
    expect(out.length).toBe(1);
    expect(out[0].sourceId).toBe('1');
  });

  it('enforces ≥ 1000ms between requests (ADR-008)', async () => {
    const listHtml = `
      <table><tbody>
        <tr class="list1"><td><a href="/zboard/view.php?id=ppomppu4&no=1">A</a></td><td><span class="list_time">10:00</span></td></tr>
        <tr class="list1"><td><a href="/zboard/view.php?id=ppomppu4&no=2">B</a></td><td><span class="list_time">10:01</span></td></tr>
      </tbody></table>
    `;
    const callTimes: number[] = [];
    const start = Date.now();
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      callTimes.push(Date.now() - start);
      if (url === LIST_URL) {
        return Promise.resolve(new Response(listHtml, { status: 200 }));
      }
      return Promise.resolve(
        new Response(DETAIL_FIXTURE, { status: 200 }),
      );
    });

    const run = crawlPpomppu({
      userAgent: 'Cheapsky/test',
      // even if caller tries 100ms, crawler clamps to 1000ms
      minDelayMs: 100,
      fetch: mockFetch as unknown as typeof fetch,
    });

    await vi.advanceTimersByTimeAsync(3000);
    await run;

    // list fetch at ~t=0, detail[0] at ≥ 1000ms, detail[1] at ≥ 2000ms.
    expect(callTimes[0]).toBe(0);
    expect(callTimes[1]).toBeGreaterThanOrEqual(1000);
    expect(callTimes[2]).toBeGreaterThanOrEqual(2000);
  });

  it('injects user-agent header on every request', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url === LIST_URL) {
        return Promise.resolve(new Response('<table></table>', { status: 200 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });
    await crawlPpomppu({
      userAgent: 'Cheapsky/0.1 (+mailto:test)',
      fetch: mockFetch as unknown as typeof fetch,
    });
    const headers = mockFetch.mock.calls[0][1]?.headers as
      | Record<string, string>
      | undefined;
    expect(headers?.['user-agent']).toBe('Cheapsky/0.1 (+mailto:test)');
  });

  it('respects maxPosts cap', async () => {
    // Build a list with 5 posts, cap at 2.
    const rows = [1, 2, 3, 4, 5]
      .map(
        (n) => `
          <tr class="list1">
            <td><a href="/zboard/view.php?id=ppomppu4&no=${n}">title ${n}</a></td>
            <td><span class="list_time">10:0${n}</span></td>
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
    const run = crawlPpomppu({
      userAgent: 'Cheapsky/test',
      maxPosts: 2,
      fetch: mockFetch as unknown as typeof fetch,
    });
    await vi.advanceTimersByTimeAsync(5000);
    const out = await run;
    expect(out.length).toBe(2);
  });
});

describe('red line — RawPost has no author field', () => {
  it('RawPost type does not contain `author`', () => {
    const post: RawPost = {
      source: 'ppomppu',
      sourceId: 's1',
      sourceUrl: 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu4&no=1',
      title: 't',
      body: 'b',
      postedAt: FIXED_NOW,
    };
    // TS 레벨: RawPost 의 키에 'author' 없음. 런타임 확인도 함께.
    expect(Object.prototype.hasOwnProperty.call(post, 'author')).toBe(false);
    // `as any` 캐스팅으로 런타임에 author 가 설정되지 않았음을 확인.
    expect((post as unknown as Record<string, unknown>).author).toBeUndefined();
  });

  it('ParsedListItem does not contain `author`', () => {
    const item: ParsedListItem = {
      sourceId: '1',
      sourceUrl: 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu4&no=1',
      title: 't',
      postedAt: FIXED_NOW,
    };
    expect(
      (item as unknown as Record<string, unknown>).author,
    ).toBeUndefined();
  });
});
