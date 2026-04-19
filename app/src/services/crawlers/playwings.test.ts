// 플레이윙즈 크롤러 단위 테스트 (Stretch 1 — step1.md).
//
// 검증 범위:
// - parseRssItems: sitemap `<urlset>` / RSS `<rss>` / Atom `<feed>` 모두 파싱.
// - parseRssItems: `/deals/<id>` 가 아닌 경로(articles/magazine/faq)는 skip.
// - parseRssItems: 잘못된 XML → [] (throw 없음).
// - parseListHtml: HTML 폴백 경로. 작성자·로그인 링크는 skip, dup id 제거.
// - parseDetailHtml: og:title / og:description 추출, `.author .nickname` 은 body 에 포함되지 않음.
// - crawlPlaywings: 요청 간격 ≥ 1000ms, UA 주입, 500/throw → 빈 배열, skip 개별.
// - 순수 함수 — db/supabase import 금지.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ALLOWED_PATHS,
  BASE_URL,
  LIST_URL,
  RSS_URL,
  crawlPlaywings,
  isAllowedPath,
  parseDetailHtml,
  parseListHtml,
  parseRssItems,
} from './playwings';
import type { RawPost } from '@/types/deal';
import type { ParsedListItem } from './types';

const FIXTURE_DIR = resolve(__dirname, '../../../__fixtures__');
const FEED_FIXTURE = readFileSync(
  resolve(FIXTURE_DIR, 'playwings-feed-sample.xml'),
  'utf-8',
);
const LIST_FIXTURE = readFileSync(
  resolve(FIXTURE_DIR, 'playwings-list-sample.html'),
  'utf-8',
);
const DETAIL_FIXTURE = readFileSync(
  resolve(FIXTURE_DIR, 'playwings-detail-sample.html'),
  'utf-8',
);

const FIXED_NOW = new Date('2026-04-19T12:00:00Z');

describe('URLs / constants', () => {
  it('BASE_URL uses www.playwings.co.kr https', () => {
    expect(BASE_URL).toBe('https://www.playwings.co.kr');
  });

  it('RSS_URL (sitemap) path starts with /sitemap-', () => {
    expect(new URL(RSS_URL).pathname).toMatch(/^\/sitemap-/);
  });

  it('LIST_URL points to /deals/', () => {
    expect(new URL(LIST_URL).pathname).toMatch(/^\/deals\/?$/);
  });
});

describe('ALLOWED_PATHS', () => {
  it('contains sitemap and deals paths', () => {
    expect(ALLOWED_PATHS).toContain('/sitemap-index.xml');
    expect(ALLOWED_PATHS.some((p) => p.startsWith('/sitemap-'))).toBe(true);
    expect(ALLOWED_PATHS.some((p) => p.startsWith('/deals'))).toBe(true);
  });
});

describe('isAllowedPath', () => {
  it('accepts RSS_URL and LIST_URL', () => {
    expect(isAllowedPath(RSS_URL)).toBe(true);
    expect(isAllowedPath(LIST_URL)).toBe(true);
  });

  it('accepts /deals/<id> detail URL', () => {
    expect(
      isAllowedPath('https://www.playwings.co.kr/deals/1hedzavMqZG9IZVm426Bbx'),
    ).toBe(true);
  });

  it('accepts /sitemap-0.xml', () => {
    expect(
      isAllowedPath('https://www.playwings.co.kr/sitemap-0.xml'),
    ).toBe(true);
  });

  it('rejects /login, /mypage, /articles, /magazine', () => {
    expect(
      isAllowedPath('https://www.playwings.co.kr/login/'),
    ).toBe(false);
    expect(
      isAllowedPath('https://www.playwings.co.kr/mypage/'),
    ).toBe(false);
    expect(
      isAllowedPath('https://www.playwings.co.kr/articles/6JCG'),
    ).toBe(false);
    expect(
      isAllowedPath('https://www.playwings.co.kr/magazine/'),
    ).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isAllowedPath('')).toBe(false);
  });
});

describe('parseRssItems (sitemap XML)', () => {
  it('extracts only /deals/<id> entries from fixture (articles/magazine/faq skipped)', () => {
    const items = parseRssItems(FEED_FIXTURE, FIXED_NOW);
    expect(items.length).toBe(5);
    for (const it of items) {
      expect(it.sourceUrl).toMatch(/\/deals\/[A-Za-z0-9]{10,}$/);
    }
  });

  it('first item has expected sourceId and absolute URL', () => {
    const items = parseRssItems(FEED_FIXTURE, FIXED_NOW);
    expect(items[0].sourceId).toBe('2T3MFhIlBWMZryLMsNZwqt');
    expect(items[0].sourceUrl).toBe(
      'https://www.playwings.co.kr/deals/2T3MFhIlBWMZryLMsNZwqt',
    );
  });

  it('sitemap has no <title> → title defaults to empty string (detail fetch fills later)', () => {
    const items = parseRssItems(FEED_FIXTURE, FIXED_NOW);
    expect(items[0].title).toBe('');
  });

  it('defaults postedAt to now when <lastmod> absent', () => {
    const items = parseRssItems(FEED_FIXTURE, FIXED_NOW);
    for (const it of items) {
      expect(it.postedAt.getTime()).toBe(FIXED_NOW.getTime());
    }
  });

  it('parses RSS <item><link><title><pubDate> format', () => {
    const rss = `
      <?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <item>
            <title>오사카 특가</title>
            <link>https://www.playwings.co.kr/deals/abcdefghij1234567890</link>
            <pubDate>Mon, 18 Apr 2026 09:00:00 GMT</pubDate>
          </item>
          <item>
            <title>skip me</title>
            <link>https://www.playwings.co.kr/articles/notdeal</link>
            <pubDate>Mon, 18 Apr 2026 10:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>`;
    const items = parseRssItems(rss, FIXED_NOW);
    expect(items.length).toBe(1);
    expect(items[0].sourceId).toBe('abcdefghij1234567890');
    expect(items[0].title).toBe('오사카 특가');
    expect(items[0].postedAt.toISOString()).toBe('2026-04-18T09:00:00.000Z');
  });

  it('parses Atom <entry> format', () => {
    const atom = `
      <?xml version="1.0" encoding="UTF-8"?>
      <feed>
        <entry>
          <title>방콕 특가</title>
          <link href="https://www.playwings.co.kr/deals/atomatomatomatomatom01"/>
          <updated>2026-04-10T00:00:00Z</updated>
        </entry>
      </feed>`;
    const items = parseRssItems(atom, FIXED_NOW);
    expect(items.length).toBe(1);
    expect(items[0].sourceId).toBe('atomatomatomatomatom01');
    expect(items[0].title).toBe('방콕 특가');
  });

  it('returns [] for empty / garbage XML', () => {
    expect(parseRssItems('', FIXED_NOW)).toEqual([]);
    expect(parseRssItems('<html>not xml</html>', FIXED_NOW)).toEqual([]);
    expect(parseRssItems('<<broken', FIXED_NOW)).toEqual([]);
  });

  it('deduplicates by sourceId across blocks', () => {
    const xml = `
      <urlset>
        <url><loc>https://www.playwings.co.kr/deals/dupdupdupdupdupdup01</loc></url>
        <url><loc>https://www.playwings.co.kr/deals/dupdupdupdupdupdup01</loc></url>
        <url><loc>https://www.playwings.co.kr/deals/uniqueuniqueuniq02</loc></url>
      </urlset>`;
    const items = parseRssItems(xml, FIXED_NOW);
    expect(items.length).toBe(2);
  });
});

describe('parseListHtml', () => {
  it('extracts /deals/<id> anchors only (articles / login skipped)', () => {
    const items = parseListHtml(LIST_FIXTURE, FIXED_NOW);
    // fixture has 4 unique /deals/ ids and 1 dup.
    expect(items.length).toBe(4);
    for (const it of items) {
      expect(it.sourceUrl).toMatch(/\/deals\/[A-Za-z0-9]{10,}$/);
    }
  });

  it('deduplicates same sourceId', () => {
    const items = parseListHtml(LIST_FIXTURE, FIXED_NOW);
    const ids = items.map((i) => i.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('captures anchor text as title (trimmed)', () => {
    const items = parseListHtml(LIST_FIXTURE, FIXED_NOW);
    const timeAttack = items.find(
      (i) => i.sourceId === '1hedzavMqZG9IZVm426Bbx',
    );
    expect(timeAttack).toBeDefined();
    expect(timeAttack!.title).toBe('타임어택 특가');
  });

  it('returns [] on empty html', () => {
    expect(parseListHtml('', FIXED_NOW)).toEqual([]);
  });
});

describe('parseDetailHtml', () => {
  it('extracts og:title and og:description from fixture', () => {
    const { title, body } = parseDetailHtml(DETAIL_FIXTURE);
    expect(title).toBe('타임어택 특가 - 플레이윙즈');
    expect(body).toContain('편도 최저가');
    expect(body).toContain('제주 16,600원');
  });

  it('caps body at 500 chars', () => {
    const longDesc = '가'.repeat(1000);
    const html = `<html><head><meta property="og:title" content="t"/><meta property="og:description" content="${longDesc}"/></head></html>`;
    const { body } = parseDetailHtml(html);
    expect(body.length).toBe(500);
  });

  it('does not leak author / nickname text from body elements', () => {
    const { body } = parseDetailHtml(DETAIL_FIXTURE);
    expect(body).not.toContain('플레이윙즈 운영팀');
    expect(body).not.toContain('nickname');
  });

  it('decodes HTML entities in og content', () => {
    const html = `<html><head>
      <meta property="og:title" content="Kim &amp; Lee &#39;travel&#39;"/>
      <meta property="og:description" content="Tokyo &amp; Osaka"/>
    </head></html>`;
    const { title, body } = parseDetailHtml(html);
    expect(title).toBe("Kim & Lee 'travel'");
    expect(body).toBe('Tokyo & Osaka');
  });

  it('falls back to <title> when og:title absent', () => {
    const html = '<html><head><title>Fallback Title</title></head></html>';
    const { title } = parseDetailHtml(html);
    expect(title).toBe('Fallback Title');
  });

  it('returns empty strings on empty / garbage html', () => {
    expect(parseDetailHtml('')).toEqual({ title: '', body: '' });
    expect(parseDetailHtml('<not html>').body).toBe('');
  });
});

describe('crawlPlaywings (fail-soft)', () => {
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
      const out = await crawlPlaywings({
        userAgent: 'Cheapsky/test',
        fetch: undefined as unknown as typeof fetch,
      });
      expect(out).toEqual([]);
    } finally {
      g.fetch = originalFetch;
    }
  });

  it('returns [] when both sitemap and HTML list fail', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 500 }));
    const run = crawlPlaywings({
      userAgent: 'Cheapsky/test',
      fetch: mockFetch as unknown as typeof fetch,
    });
    await vi.advanceTimersByTimeAsync(5000);
    const out = await run;
    expect(out).toEqual([]);
  });

  it('uses sitemap as primary path, HTML as fallback when sitemap empty', async () => {
    const emptySitemap =
      '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url === RSS_URL) {
        return Promise.resolve(new Response(emptySitemap, { status: 200 }));
      }
      if (url === LIST_URL) {
        return Promise.resolve(new Response(LIST_FIXTURE, { status: 200 }));
      }
      if (url.includes('/deals/')) {
        return Promise.resolve(new Response(DETAIL_FIXTURE, { status: 200 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });

    const run = crawlPlaywings({
      userAgent: 'Cheapsky/test',
      maxPosts: 2,
      fetch: mockFetch as unknown as typeof fetch,
    });
    await vi.advanceTimersByTimeAsync(20000);
    const out = await run;

    expect(out.length).toBe(2);
    expect(out[0].source).toBe('playwings');
  });

  it('enforces ≥ 1000ms between requests (ADR-008)', async () => {
    const callTimes: number[] = [];
    const start = Date.now();
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      callTimes.push(Date.now() - start);
      if (url === RSS_URL) {
        return Promise.resolve(new Response(FEED_FIXTURE, { status: 200 }));
      }
      return Promise.resolve(new Response(DETAIL_FIXTURE, { status: 200 }));
    });

    const run = crawlPlaywings({
      userAgent: 'Cheapsky/test',
      maxPosts: 2,
      minDelayMs: 100, // caller tries 100, crawler clamps to 1000
      fetch: mockFetch as unknown as typeof fetch,
    });
    await vi.advanceTimersByTimeAsync(10000);
    await run;

    // sitemap first → wait 1000 → detail #1 → wait 1000 → detail #2
    expect(callTimes[0]).toBe(0);
    expect(callTimes[1]).toBeGreaterThanOrEqual(1000);
    expect(callTimes[2]).toBeGreaterThanOrEqual(2000);
  });

  it('skips individual detail 404 without throwing', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url === RSS_URL) {
        return Promise.resolve(new Response(FEED_FIXTURE, { status: 200 }));
      }
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(new Response(DETAIL_FIXTURE, { status: 200 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });

    const run = crawlPlaywings({
      userAgent: 'Cheapsky/test',
      maxPosts: 3,
      fetch: mockFetch as unknown as typeof fetch,
    });
    await vi.advanceTimersByTimeAsync(20000);
    const out = await run;
    expect(out.length).toBe(1);
  });

  it('injects user-agent on every request', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url === RSS_URL) {
        return Promise.resolve(new Response(FEED_FIXTURE, { status: 200 }));
      }
      return Promise.resolve(new Response(DETAIL_FIXTURE, { status: 200 }));
    });
    const run = crawlPlaywings({
      userAgent: 'Cheapsky/0.1 (+mailto:test)',
      maxPosts: 1,
      fetch: mockFetch as unknown as typeof fetch,
    });
    await vi.advanceTimersByTimeAsync(5000);
    await run;

    for (const call of mockFetch.mock.calls) {
      const headers = call[1]?.headers as Record<string, string> | undefined;
      expect(headers?.['user-agent']).toBe('Cheapsky/0.1 (+mailto:test)');
    }
  });

  it('respects maxPosts cap', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url === RSS_URL) {
        return Promise.resolve(new Response(FEED_FIXTURE, { status: 200 }));
      }
      return Promise.resolve(new Response(DETAIL_FIXTURE, { status: 200 }));
    });
    const run = crawlPlaywings({
      userAgent: 'Cheapsky/test',
      maxPosts: 2,
      fetch: mockFetch as unknown as typeof fetch,
    });
    await vi.advanceTimersByTimeAsync(10000);
    const out = await run;
    expect(out.length).toBe(2);
  });

  it('all posts have source="playwings", no author fields', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url === RSS_URL) {
        return Promise.resolve(new Response(FEED_FIXTURE, { status: 200 }));
      }
      return Promise.resolve(new Response(DETAIL_FIXTURE, { status: 200 }));
    });
    const run = crawlPlaywings({
      userAgent: 'Cheapsky/test',
      maxPosts: 2,
      fetch: mockFetch as unknown as typeof fetch,
    });
    await vi.advanceTimersByTimeAsync(10000);
    const out = await run;

    for (const p of out) {
      expect(p.source).toBe('playwings');
      const r = p as unknown as Record<string, unknown>;
      expect(r.author).toBeUndefined();
      expect(r.writer).toBeUndefined();
      expect(r.nickname).toBeUndefined();
      // body capped at 500
      expect(p.body.length).toBeLessThanOrEqual(500);
    }
  });
});

describe('red line — no author field in RawPost / ParsedListItem', () => {
  it('RawPost from playwings has no author key', () => {
    const post: RawPost = {
      source: 'playwings',
      sourceId: 'abcdefghij1234567890',
      sourceUrl: 'https://www.playwings.co.kr/deals/abcdefghij1234567890',
      title: 't',
      body: 'b',
      postedAt: FIXED_NOW,
    };
    expect(Object.prototype.hasOwnProperty.call(post, 'author')).toBe(false);
  });

  it('ParsedListItem from playwings has no author', () => {
    const item: ParsedListItem = {
      sourceId: 'abcdefghij1234567890',
      sourceUrl: 'https://www.playwings.co.kr/deals/abcdefghij1234567890',
      title: 't',
      postedAt: FIXED_NOW,
    };
    const r = item as unknown as Record<string, unknown>;
    expect(r.author).toBeUndefined();
    expect(r.nickname).toBeUndefined();
  });
});

describe('red line — playwings.ts is a pure function (no db imports)', () => {
  it('does not import @/lib/db or @supabase/supabase-js', () => {
    const src = readFileSync(resolve(__dirname, 'playwings.ts'), 'utf-8');
    expect(src).not.toMatch(/from\s+['"]@\/lib\/db['"]/);
    expect(src).not.toMatch(/from\s+['"]@supabase\/supabase-js['"]/);
    expect(src).not.toMatch(/createClient\(/);
  });
});
