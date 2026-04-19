import { describe, expect, it } from 'vitest';

import {
  extractPricesKrw,
  verifyUrl,
  verifyUrlPrecise,
} from './verifier';

function mockFetch(
  responder: (url: string, init?: RequestInit) => Promise<Response> | Response,
): typeof fetch {
  return ((url: string, init?: RequestInit) => {
    return Promise.resolve(responder(url, init));
  }) as unknown as typeof fetch;
}

describe('verifyUrl (ADR-018 Core, HEAD-only)', () => {
  it('200 → active', async () => {
    const f = mockFetch(() => new Response(null, { status: 200 }));
    const r = await verifyUrl('https://example.com', { fetch: f });
    expect(r.status).toBe('active');
    expect(r.httpStatus).toBe(200);
  });

  it('301 → active (redirect code treated as live)', async () => {
    const f = mockFetch(() => new Response(null, { status: 301 }));
    const r = await verifyUrl('https://example.com', { fetch: f });
    expect(r.status).toBe('active');
    expect(r.httpStatus).toBe(301);
  });

  it('404 → snapshot', async () => {
    const f = mockFetch(() => new Response(null, { status: 404 }));
    const r = await verifyUrl('https://example.com', { fetch: f });
    expect(r.status).toBe('snapshot');
    expect(r.httpStatus).toBe(404);
  });

  it('410 → snapshot', async () => {
    const f = mockFetch(() => new Response(null, { status: 410 }));
    const r = await verifyUrl('https://example.com', { fetch: f });
    expect(r.status).toBe('snapshot');
    expect(r.httpStatus).toBe(410);
  });

  it('500 → unchecked', async () => {
    const f = mockFetch(() => new Response(null, { status: 500 }));
    const r = await verifyUrl('https://example.com', { fetch: f });
    expect(r.status).toBe('unchecked');
    expect(r.httpStatus).toBe(500);
  });

  it('403 → unchecked (access denied, not proof of deletion)', async () => {
    const f = mockFetch(() => new Response(null, { status: 403 }));
    const r = await verifyUrl('https://example.com', { fetch: f });
    expect(r.status).toBe('unchecked');
    expect(r.httpStatus).toBe(403);
  });

  it('network error → unchecked, httpStatus null', async () => {
    const f = mockFetch(() => {
      throw new Error('ECONNRESET');
    });
    const r = await verifyUrl('https://example.com', { fetch: f });
    expect(r.status).toBe('unchecked');
    expect(r.httpStatus).toBeNull();
  });

  it('uses HEAD method and respects timeoutMs (AbortController)', async () => {
    let capturedInit: RequestInit | undefined;
    const f = mockFetch((_url, init) => {
      capturedInit = init;
      return new Response(null, { status: 200 });
    });
    await verifyUrl('https://example.com', { fetch: f, timeoutMs: 1000 });
    expect(capturedInit?.method).toBe('HEAD');
    expect(capturedInit?.signal).toBeDefined();
  });

  it('no fetch impl → unchecked, null', async () => {
    const original = globalThis.fetch;
    try {
      (globalThis as unknown as { fetch: undefined }).fetch = undefined;
      const r = await verifyUrl('https://example.com');
      expect(r.status).toBe('unchecked');
      expect(r.httpStatus).toBeNull();
    } finally {
      (globalThis as unknown as { fetch: typeof fetch }).fetch = original;
    }
  });

  it('timeout aborts and returns unchecked', async () => {
    const f = mockFetch((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        const sig = init?.signal;
        if (sig) {
          sig.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }
      });
    });
    const r = await verifyUrl('https://example.com', { fetch: f, timeoutMs: 10 });
    expect(r.status).toBe('unchecked');
    expect(r.httpStatus).toBeNull();
  });
});

describe('extractPricesKrw', () => {
  it('추출: 쉼표 / 평문 원 / 천원 suffix', () => {
    const body = '오늘의 특가 135,000원 · 어제 180000원 · 참고 200천원';
    const prices = extractPricesKrw(body);
    expect(prices).toContain(135000);
    expect(prices).toContain(180000);
    expect(prices).toContain(200000);
  });

  it('범위 필터: 10,000 미만·10,000,000 초과 제외', () => {
    const body = 'buy 500 for 15,000,000 total or 3,000 each';
    const prices = extractPricesKrw(body);
    // 500, 3000 은 최소 미만. 15,000,000 은 최대 초과.
    expect(prices).toHaveLength(0);
  });

  it('빈 본문 → 빈 배열', () => {
    expect(extractPricesKrw('')).toEqual([]);
  });
});

/** ReadableStream 본문을 가진 Response 를 만들어주는 헬퍼. */
function streamResponse(bodyText: string, status = 200): Response {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(bodyText);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // 8 KB 청크로 쪼개 push → reader loop 가 여러 번 돌도록 함.
      const CHUNK = 8 * 1024;
      for (let i = 0; i < encoded.byteLength; i += CHUNK) {
        controller.enqueue(encoded.subarray(i, Math.min(i + CHUNK, encoded.byteLength)));
      }
      controller.close();
    },
  });
  return new Response(stream, { status });
}

describe('verifyUrlPrecise (ADR-018 Stretch, GET + 20KB cap)', () => {
  it('200 + 본문에 expected ±10% 포함 → matched / active', async () => {
    const f = mockFetch(() => streamResponse('공지 · 오사카 편도 135,000원 오늘까지'));
    const r = await verifyUrlPrecise('https://example.com', 135000, { fetch: f });
    expect(r.status).toBe('active');
    expect(r.priceSignal).toBe('matched');
    expect(r.httpStatus).toBe(200);
  });

  it('200 + 본문에 ±10% 밖 가격만 있음 → drifted / price_changed', async () => {
    // expected=135000, tolerance ±10% = [121500, 148500].
    // 본문에는 185,000 만 존재 → 범위 밖.
    const f = mockFetch(() => streamResponse('가격 인상 · 185,000원 으로 변경'));
    const r = await verifyUrlPrecise('https://example.com', 135000, { fetch: f });
    expect(r.status).toBe('price_changed');
    expect(r.priceSignal).toBe('drifted');
    expect(r.httpStatus).toBe(200);
  });

  it('200 + 본문에 가격 패턴 없음 → missing / active (보수적 유지)', async () => {
    const f = mockFetch(() => streamResponse('광고문 또는 인코딩 깨짐 상태 · 가격 텍스트 없음'));
    const r = await verifyUrlPrecise('https://example.com', 135000, { fetch: f });
    expect(r.status).toBe('active');
    expect(r.priceSignal).toBe('missing');
  });

  it('본문 100 KB 중 20 KB 만 스캔 — 20 KB 넘어가는 위치의 matched 는 감지 안 됨', async () => {
    // 앞 25 KB 에는 가격 패턴 없음. 25 KB 지점에 expected 가격을 배치.
    // 20 KB cap 이 정상이라면 이 가격은 스캔되지 않아야 함.
    const filler = 'x'.repeat(25 * 1024);
    const bodyText = `${filler} 135,000원 오사카`;
    let readerCancelled = false;
    const f = mockFetch(() => {
      const encoder = new TextEncoder();
      const encoded = encoder.encode(bodyText);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const CHUNK = 8 * 1024;
          for (let i = 0; i < encoded.byteLength; i += CHUNK) {
            controller.enqueue(encoded.subarray(i, Math.min(i + CHUNK, encoded.byteLength)));
          }
          controller.close();
        },
        cancel() {
          readerCancelled = true;
        },
      });
      return new Response(stream, { status: 200 });
    });
    const r = await verifyUrlPrecise('https://example.com', 135000, { fetch: f });
    // 20 KB cap 때문에 matched 가 될 수 없음.
    expect(r.priceSignal).not.toBe('matched');
    expect(readerCancelled).toBe(true);
  });

  it('404 → snapshot / missing', async () => {
    const f = mockFetch(() => new Response(null, { status: 404 }));
    const r = await verifyUrlPrecise('https://example.com', 135000, { fetch: f });
    expect(r.status).toBe('snapshot');
    expect(r.priceSignal).toBe('missing');
    expect(r.httpStatus).toBe(404);
  });

  it('5xx → unchecked', async () => {
    const f = mockFetch(() => new Response(null, { status: 502 }));
    const r = await verifyUrlPrecise('https://example.com', 135000, { fetch: f });
    expect(r.status).toBe('unchecked');
    expect(r.priceSignal).toBe('missing');
    expect(r.httpStatus).toBe(502);
  });

  it('timeout → unchecked, httpStatus null', async () => {
    const f = mockFetch((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        const sig = init?.signal;
        if (sig) {
          sig.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }
      });
    });
    const r = await verifyUrlPrecise('https://example.com', 135000, {
      fetch: f,
      timeoutMs: 10,
    });
    expect(r.status).toBe('unchecked');
    expect(r.httpStatus).toBeNull();
    expect(r.priceSignal).toBe('missing');
  });

  it('GET 메서드 + User-Agent 헤더 전송 (UA 위장 금지)', async () => {
    let captured: RequestInit | undefined;
    const f = mockFetch((_url, init) => {
      captured = init;
      return streamResponse('135,000원', 200);
    });
    await verifyUrlPrecise('https://example.com', 135000, { fetch: f });
    expect(captured?.method).toBe('GET');
    const headers = (captured?.headers ?? {}) as Record<string, string>;
    expect(headers['User-Agent']).toBeTruthy();
    expect(String(headers['User-Agent'])).toMatch(/Cheapsky/);
  });
});
