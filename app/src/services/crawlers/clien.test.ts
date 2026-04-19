// 클리앙 크롤러 단위 테스트 (Stretch 3 — ADR-030).
//
// 검증 항목:
// - parseList 가 고정 픽스처에서 공지 제외 + 실 post 추출
// - isAllowedPath: `/service/board/jirum` 허용, 쿼리 스트링 URL 거절
// - extractSourceId: 쿼리 없는 canonical path 만 매치
// - fetch mock: 요청 간 1초 대기, fail-soft 400/500
// - 작성자 필드가 ParsedListItem / RawPost 에 부재
// - UA · ALLOWED_PATHS 상수 검증

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ALLOWED_PATHS,
  LIST_URL,
  crawlClien,
  isAllowedPath,
  parseDetail,
  parseList,
  parsePostedAt,
} from './clien';
import type { RawPost } from '@/types/deal';

const FIXTURE_DIR = resolve(__dirname, '../../../__fixtures__');
const LIST_FIXTURE = readFileSync(
  resolve(FIXTURE_DIR, 'clien-list.html'),
  'utf-8',
);
const DETAIL_FIXTURE = readFileSync(
  resolve(FIXTURE_DIR, 'clien-detail.html'),
  'utf-8',
);

const FIXED_NOW = new Date('2026-04-20T12:00:00Z');

describe('ALLOWED_PATHS', () => {
  it('has only /service/board/jirum', () => {
    expect([...ALLOWED_PATHS]).toEqual(['/service/board/jirum']);
  });
});

describe('isAllowedPath', () => {
  it('accepts LIST_URL', () => {
    expect(isAllowedPath(LIST_URL)).toBe(true);
  });

  it('accepts canonical post URL without query', () => {
    expect(
      isAllowedPath('https://www.clien.net/service/board/jirum/19176790'),
    ).toBe(true);
  });

  it('rejects URL with any query string (robots.txt Disallow /*?*)', () => {
    expect(
      isAllowedPath(
        'https://www.clien.net/service/board/jirum/19176790?od=T31&po=0',
      ),
    ).toBe(false);
  });

  it('rejects search paths', () => {
    expect(
      isAllowedPath('https://www.clien.net/service/search?q=항공권'),
    ).toBe(false);
  });

  it('rejects /service/board/sold and other disallowed boards', () => {
    expect(
      isAllowedPath('https://www.clien.net/service/board/sold/12345'),
    ).toBe(false);
  });

  it('rejects empty and malformed', () => {
    expect(isAllowedPath('')).toBe(false);
    expect(isAllowedPath(' ')).toBe(false);
  });
});

describe('parsePostedAt', () => {
  it('parses YYYY-MM-DD HH:MM:SS as KST → UTC', () => {
    const d = parsePostedAt('2026-04-20 14:30:00', FIXED_NOW);
    expect(d).not.toBeNull();
    // KST 14:30 = UTC 05:30
    expect(d!.toISOString()).toBe('2026-04-20T05:30:00.000Z');
  });

  it('parses HH:MM onto now date', () => {
    const d = parsePostedAt('10:22', FIXED_NOW);
    expect(d).not.toBeNull();
    expect(d!.getHours()).toBe(10);
    expect(d!.getMinutes()).toBe(22);
  });

  it('returns null for invalid shapes', () => {
    expect(parsePostedAt('yesterday', FIXED_NOW)).toBeNull();
    expect(parsePostedAt('', FIXED_NOW)).toBeNull();
    expect(parsePostedAt('25:99', FIXED_NOW)).toBeNull();
  });
});

describe('parseList', () => {
  it('extracts non-notice items from fixture', () => {
    const items = parseList(LIST_FIXTURE, FIXED_NOW);
    // 공지 제외하고 실 포스트 다수 (fixture 29 list_item 중 notice 일부 제외)
    expect(items.length).toBeGreaterThan(10);
  });

  it('skips .list_item.notice rows', () => {
    const html = `
      <div class="list_item notice">
        <span class="list_subject" title="공지">
          <a href="/service/board/jirum/10963221" data-role="list-title-text">공지</a>
        </span>
      </div>
      <div class="list_item symph_row jirum">
        <span class="list_subject" title="실 딜">
          <a href="/service/board/jirum/12345" data-role="list-title-text">실 딜</a>
        </span>
        <span class="timestamp">2026-04-20 09:00:00</span>
      </div>
    `;
    const items = parseList(html, FIXED_NOW);
    expect(items.map((i) => i.sourceId)).toEqual(['12345']);
  });

  it('returns empty for empty HTML', () => {
    expect(parseList('', FIXED_NOW)).toEqual([]);
  });

  it('dedupes same sourceId', () => {
    const html = `
      <div class="list_item symph_row jirum">
        <span class="list_subject" title="A">
          <a href="/service/board/jirum/111" data-role="list-title-text">A</a>
        </span>
      </div>
      <div class="list_item symph_row jirum">
        <span class="list_subject" title="A (dup)">
          <a href="/service/board/jirum/111" data-role="list-title-text">A (dup)</a>
        </span>
      </div>
    `;
    const items = parseList(html, FIXED_NOW);
    expect(items.length).toBe(1);
  });

  it('normalizes URL — strips query string from anchor href', () => {
    const html = `
      <div class="list_item symph_row jirum">
        <span class="list_subject" title="Q">
          <a href="/service/board/jirum/999?od=T31&amp;po=0" data-role="list-title-text">Q</a>
        </span>
      </div>
    `;
    const items = parseList(html, FIXED_NOW);
    expect(items.length).toBe(1);
    expect(items[0].sourceUrl).toBe(
      'https://www.clien.net/service/board/jirum/999',
    );
  });

  it('skips items without matching sourceId (rule board etc.)', () => {
    const html = `
      <div class="list_item symph_row">
        <span class="list_subject" title="이용규칙">
          <a href="/service/board/rule/10963221" data-role="list-title-text">이용규칙</a>
        </span>
      </div>
    `;
    const items = parseList(html, FIXED_NOW);
    expect(items).toEqual([]);
  });

  it('uses span.list_subject title attr when present (전체 제목)', () => {
    const html = `
      <div class="list_item symph_row jirum">
        <span class="list_subject" title="긴 제목 전체 원문">
          <a href="/service/board/jirum/555" data-role="list-title-text">긴 제목...</a>
        </span>
      </div>
    `;
    const items = parseList(html, FIXED_NOW);
    expect(items[0].title).toBe('긴 제목 전체 원문');
  });

  it('ignores list_reply comment-count anchor inside list_subject', () => {
    const html = `
      <div class="list_item symph_row jirum">
        <span class="list_subject" title="정상 제목">
          <a href="/service/board/jirum/777" data-role="list-title-text">정상 제목</a>
          <a class="list_reply reply_symph" href="/service/board/jirum/777#comment-point">(3)</a>
        </span>
      </div>
    `;
    const items = parseList(html, FIXED_NOW);
    expect(items.length).toBe(1);
    expect(items[0].sourceId).toBe('777');
    expect(items[0].title).toBe('정상 제목');
  });

  it('does NOT include author fields on items (ADR-008)', () => {
    const items = parseList(LIST_FIXTURE, FIXED_NOW);
    // ParsedListItem 타입 자체에 author 필드가 없지만, 런타임에서도 확인
    for (const it of items) {
      const anyIt = it as Record<string, unknown>;
      expect(anyIt.author).toBeUndefined();
      expect(anyIt.nickname).toBeUndefined();
      expect(anyIt.uid).toBeUndefined();
    }
  });
});

describe('parseDetail', () => {
  it('does not throw on real fixture (graceful, may return empty on image-only posts)', () => {
    // 알뜰구매 post 중 이미지 위주 글은 body 가 짧거나 빈 문자열일 수 있음.
    // 파서는 fail-soft: 절대 throw 하지 않고 빈 문자열 반환해도 OK.
    // 실 airline 딜 post 는 가격·출발지 등 텍스트가 있어 body 가 채워짐 (empirical).
    expect(() => parseDetail(DETAIL_FIXTURE)).not.toThrow();
    const { body } = parseDetail(DETAIL_FIXTURE);
    expect(typeof body).toBe('string');
  });

  it('extracts body from minimal .post_content HTML', () => {
    const html =
      '<html><body><div class="post_content">본문 샘플 가격 199,000원</div></body></html>';
    const { body } = parseDetail(html);
    expect(body).toContain('본문 샘플 가격 199,000원');
  });

  it('returns empty for empty HTML', () => {
    expect(parseDetail('').body).toBe('');
  });

  it('returns empty for HTML without candidate containers', () => {
    expect(parseDetail('<html><body>no post here</body></html>').body).toBe(
      '',
    );
  });
});

describe('crawlClien', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty array when list fetch fails (fail-soft)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => '',
    } as unknown as Response);
    const posts = await crawlClien({
      userAgent: 'Cheapsky/0.2 (+mailto:test)',
      fetch: mockFetch,
      now: () => FIXED_NOW,
    });
    expect(posts).toEqual([]);
  });

  it('returns empty when list throws (fail-soft)', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('net down'));
    const posts = await crawlClien({
      userAgent: 'Cheapsky/0.2 (+mailto:test)',
      fetch: mockFetch,
      now: () => FIXED_NOW,
    });
    expect(posts).toEqual([]);
  });

  it('sends UA header on fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html></html>',
    } as unknown as Response);
    await crawlClien({
      userAgent: 'Cheapsky/0.2 (+mailto:test)',
      fetch: mockFetch,
      now: () => FIXED_NOW,
    });
    expect(mockFetch).toHaveBeenCalled();
    const callArgs = mockFetch.mock.calls[0];
    const headers = (callArgs[1] as RequestInit | undefined)?.headers as
      | Record<string, string>
      | undefined;
    expect(headers?.['user-agent']).toBe('Cheapsky/0.2 (+mailto:test)');
  });

  it('skips individual detail 404 but continues with others', async () => {
    // fake list with 2 items, using real clien DOM shape
    const listHtml = `
      <div class="list_item symph_row jirum">
        <span class="list_subject" title="A">
          <a href="/service/board/jirum/1001" data-role="list-title-text">A</a>
        </span>
      </div>
      <div class="list_item symph_row jirum">
        <span class="list_subject" title="B">
          <a href="/service/board/jirum/1002" data-role="list-title-text">B</a>
        </span>
      </div>
    `;
    const detailOk = '<div class="post_content">본문 OK</div>';
    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => listHtml,
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => '',
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => detailOk,
      } as unknown as Response);

    const promise = crawlClien({
      userAgent: 'Cheapsky/0.2 (+mailto:test)',
      fetch: mockFetch,
      now: () => FIXED_NOW,
      minDelayMs: 1000,
    });
    // advance fake timers for sleep(1000) between details
    await vi.advanceTimersByTimeAsync(5000);
    const posts = (await promise) as RawPost[];
    expect(posts.length).toBe(1);
    expect(posts[0].sourceId).toBe('1002');
    expect(posts[0].source).toBe('clien');
  });
});
