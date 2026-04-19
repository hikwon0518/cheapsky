// ADR-030 cross-source matching UI 검증. 순수 포맷터 로직만 단위 테스트.
// 실제 React 렌더는 스냅샷/브라우저 테스트에서 다룸 (현재 스코프 밖).

import { describe, expect, it } from 'vitest';

import { formatSourcesLabel } from './SourceTag';
import type { Source } from '@/types/deal';

describe('formatSourcesLabel', () => {
  it('empty sources → empty string', () => {
    expect(formatSourcesLabel([])).toBe('');
  });

  it('1 source → label only, no suffix', () => {
    const t = formatSourcesLabel(['ppomppu']);
    expect(t).toBe('PPOMPPU');
    expect(t).not.toContain('동시 등장');
  });

  it('2 sources → "A · B · 2곳 동시 등장"', () => {
    expect(formatSourcesLabel(['ppomppu', 'ruliweb'])).toBe(
      'PPOMPPU · RULIWEB · 2곳 동시 등장',
    );
  });

  it('3 sources → "A · B · C · 3곳 동시 등장" (ADR-030 hot 승격 임계)', () => {
    expect(formatSourcesLabel(['ppomppu', 'ruliweb', 'clien'])).toBe(
      'PPOMPPU · RULIWEB · CLIEN · 3곳 동시 등장',
    );
  });

  it('4 sources → 상위 3 + "(외 N곳)" overflow', () => {
    expect(
      formatSourcesLabel(['ppomppu', 'ruliweb', 'playwings', 'clien']),
    ).toBe('PPOMPPU · RULIWEB · PLAYWINGS (외 1곳) · 4곳 동시 등장');
  });

  it('duplicates in input are de-duplicated', () => {
    expect(formatSourcesLabel(['ppomppu', 'ppomppu', 'ruliweb'])).toBe(
      'PPOMPPU · RULIWEB · 2곳 동시 등장',
    );
  });

  it('unknown source label falls back to raw id', () => {
    expect(
      formatSourcesLabel(['ppomppu', 'unknown' as unknown as Source]),
    ).toBe('PPOMPPU · unknown · 2곳 동시 등장');
  });
});
