'use client';

// Tweaks 플로팅 패널 (Cheapsky Light v5, dev-only).
//
// 우하단 floating 버튼 → 패널 토글. localStorage 저장 + cookie.
// 프로덕션 빌드에서는 NODE_ENV !== 'production' 으로 렌더 생략.
//
// 현재 토글:
//   - 언어 (ko/ja/en) — cookie `cheapsky_lang`
//   - Density (regular/comfy) — data-density attribute
//   - CTA 모드 (hover/always) — data-ctas attribute
//
// Hard red lines:
// - 'use client' 필수
// - 프로덕션에선 렌더되지 않음 (process.env.NODE_ENV 체크)
// - 상태는 localStorage 에만. 서버 왕복 금지.

import { useEffect, useState } from 'react';

import { getLangFromCookie, setLangCookie, type Lang } from '@/lib/i18n';

type Density = 'regular' | 'comfy';
type CtaMode = 'hover' | 'always';

const TWEAKS_KEY = 'cheapsky_tweaks';

type TweaksState = {
  density: Density;
  ctaMode: CtaMode;
  lang: Lang;
};

const DEFAULT_STATE: TweaksState = {
  density: 'regular',
  ctaMode: 'hover',
  lang: 'ko',
};

function loadTweaks(): TweaksState {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(TWEAKS_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    return {
      density: saved.density === 'comfy' ? 'comfy' : 'regular',
      ctaMode: saved.ctaMode === 'always' ? 'always' : 'hover',
      lang: getLangFromCookie(),
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function saveTweaks(s: TweaksState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      TWEAKS_KEY,
      JSON.stringify({ density: s.density, ctaMode: s.ctaMode }),
    );
  } catch {
    // ignore
  }
}

export function TweaksPanel() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<TweaksState>(DEFAULT_STATE);

  useEffect(() => {
    setMounted(true);
    const s = loadTweaks();
    setState(s);
    applyState(s);
  }, []);

  const apply = (next: Partial<TweaksState>) => {
    const merged = { ...state, ...next };
    setState(merged);
    saveTweaks(merged);
    applyState(merged);
    if (next.lang && next.lang !== state.lang) {
      setLangCookie(next.lang);
    }
  };

  if (!mounted) return null;

  // Dev-only gate
  if (process.env.NODE_ENV === 'production') return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Tweaks 패널 토글"
        className="fixed bottom-[88px] md:bottom-[16px] right-[16px] z-[55] flex items-center gap-2 text-[11.5px] text-ink-2 bg-surface border border-line-2 rounded-full px-3 py-1.5 shadow-[0_4px_12px_-6px_rgba(0,0,0,0.1)] hover:border-ink-3"
      >
        <span
          className="inline-block w-1.5 h-1.5 rounded-full bg-accent"
          aria-hidden="true"
        />
        Tweaks
      </button>
      {open ? (
        <aside
          role="region"
          aria-label="개발자 Tweaks"
          className="fixed right-[16px] bottom-[128px] md:bottom-[56px] z-[60] w-[290px] bg-surface border border-line-2 rounded-xl p-[14px] shadow-[0_20px_40px_-20px_rgba(0,0,0,0.18)] max-h-[72vh] overflow-auto"
        >
          <header className="flex items-center justify-between mb-2">
            <span className="text-[11.5px] text-ink-3 uppercase tracking-wider font-medium">
              Tweaks (dev)
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="닫기"
              className="text-ink-4 hover:text-ink text-[12px]"
            >
              ✕
            </button>
          </header>

          <Row label="언어">
            <Segmented
              options={[
                { value: 'ko', label: '한' },
                { value: 'ja', label: '日' },
                { value: 'en', label: 'EN' },
              ]}
              value={state.lang}
              onChange={(v) => apply({ lang: v as Lang })}
            />
          </Row>

          <Row label="밀도">
            <Segmented
              options={[
                { value: 'regular', label: 'Regular' },
                { value: 'comfy', label: 'Comfy' },
              ]}
              value={state.density}
              onChange={(v) => apply({ density: v as Density })}
            />
          </Row>

          <Row label="CTA 노출">
            <Segmented
              options={[
                { value: 'hover', label: 'Hover' },
                { value: 'always', label: 'Always' },
              ]}
              value={state.ctaMode}
              onChange={(v) => apply({ ctaMode: v as CtaMode })}
            />
          </Row>

          <p className="text-[10.5px] text-ink-4 leading-relaxed mt-3">
            프로덕션 빌드에서는 이 패널이 렌더링되지 않습니다. 언어 변경 시
            페이지 새로고침이 필요할 수 있어요.
          </p>
        </aside>
      ) : null}
    </>
  );
}

function applyState(s: TweaksState): void {
  if (typeof document === 'undefined') return;
  document.body.setAttribute('data-density', s.density);
  document.body.setAttribute('data-ctas', s.ctaMode);
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 mt-[10px]">
      <span className="text-[11.5px] text-ink-3">{label}</span>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-2 py-0.5 text-[11px] rounded-sm ${
            value === o.value
              ? 'bg-ink text-white'
              : 'text-ink-3 hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
