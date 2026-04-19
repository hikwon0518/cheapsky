'use client';

// Command Palette (⌘K) — Cheapsky Light v5.
// 20 목적지 + 프리셋 검색. ↑↓ Enter 네비게이션.
//
// Hard red lines:
// - 'use client' 필수
// - 모든 이동은 router.push (필터 URL). 외부 링크 없음
// - ESC 로 닫기, backdrop 클릭으로 닫기

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { CITY_NAMES } from '@/lib/city-names';
import { getPresets } from '@/lib/presets';

type Item = {
  id: string;
  label: string;
  subtitle: string;
  href: string;
};

function buildItems(): Item[] {
  const items: Item[] = [];
  // Destinations (IATA → city)
  for (const [code, name] of Object.entries(CITY_NAMES)) {
    if (code === 'ICN' || code === 'GMP') continue;
    items.push({
      id: `dest-${code}`,
      label: name,
      subtitle: `ICN → ${code}`,
      href: `/?region=all&dest=${code}`,
    });
  }
  // Presets
  for (const p of getPresets()) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(p.set)) {
      if (v !== null && v !== undefined) {
        params.set(k, String(v));
      }
    }
    items.push({
      id: `preset-${p.id}`,
      label: p.label,
      subtitle: '빠른 필터',
      href: `/?${params.toString()}`,
    });
  }
  return items;
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const allItems = useMemo(() => buildItems(), []);

  const filtered = useMemo(() => {
    if (!q.trim()) return allItems.slice(0, 12);
    const low = q.toLowerCase();
    return allItems
      .filter(
        (it) =>
          it.label.toLowerCase().includes(low) ||
          it.subtitle.toLowerCase().includes(low),
      )
      .slice(0, 20);
  }, [q, allItems]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (!open) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIdx((i) => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const sel = filtered[idx];
        if (sel) {
          router.push(sel.href);
          setOpen(false);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, idx, router]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 10);
      setQ('');
      setIdx(0);
    }
  }, [open]);

  useEffect(() => {
    setIdx(0);
  }, [q]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center pt-[10vh] bg-black/45 backdrop-blur-[2px]"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        className="w-[560px] max-w-[92vw] bg-surface rounded-xl border border-line-2 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.3)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="빠른 검색"
      >
        <input
          ref={inputRef}
          type="text"
          placeholder="도시 · IATA 코드 · 프리셋 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full px-4 py-[14px] text-[14px] border-b border-line outline-none bg-transparent text-ink"
        />
        <ul className="max-h-[320px] overflow-auto">
          {filtered.length === 0 ? (
            <li className="px-4 py-3 text-[13px] text-ink-4">
              일치하는 항목이 없어요.
            </li>
          ) : (
            filtered.map((it, i) => (
              <li
                key={it.id}
                data-hover={i === idx ? 'true' : undefined}
                onMouseEnter={() => setIdx(i)}
                onClick={() => {
                  router.push(it.href);
                  setOpen(false);
                }}
                className={`flex items-center gap-[10px] px-4 py-[10px] text-[13px] cursor-pointer ${
                  i === idx ? 'bg-surface-2' : ''
                }`}
              >
                <span className="text-ink font-medium">{it.label}</span>
                <span className="text-[10.5px] text-ink-4 ml-auto tabular-nums">
                  {it.subtitle}
                </span>
              </li>
            ))
          )}
        </ul>
        <div className="px-4 py-2 border-t border-line flex items-center gap-3 text-[10.5px] text-ink-4">
          <span>
            <kbd className="font-mono border border-line-2 rounded px-[5px] py-0 text-[10px]">
              ↑↓
            </kbd>{' '}
            이동
          </span>
          <span>
            <kbd className="font-mono border border-line-2 rounded px-[5px] py-0 text-[10px]">
              Enter
            </kbd>{' '}
            선택
          </span>
          <span>
            <kbd className="font-mono border border-line-2 rounded px-[5px] py-0 text-[10px]">
              Esc
            </kbd>{' '}
            닫기
          </span>
          <span className="ml-auto text-ink-5">
            <kbd className="font-mono border border-line-2 rounded px-[5px] py-0 text-[10px]">
              ⌘K
            </kbd>
          </span>
        </div>
      </div>
    </div>
  );
}
