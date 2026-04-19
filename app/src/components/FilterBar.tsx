'use client';

// 필터 바 (ADR-007, ADR-020) — `useSearchParams` + `router.replace` + 300ms debounce.
// Preset chip 은 `<Link>` 로 즉시 네비게이션 (router.replace 가 Suspense 경계에서 실패하는 이슈 회피).
// **전역 상태 라이브러리 금지** — Zustand/Redux/SWR/TanStack Query 전부 사용 안 함.
//
// 5 필터 (ADR-020):
//   - 국가/지역   (Select)
//   - 최대 가격    (Select)
//   - 출발 월      (Select, 'YYYY-MM')
//   - 최소 할인율  (Select)
//   - 신선도       (Segmented: 24h / 7d / 30d / 전체)
//
// 모바일 < 640px: FilterDrawer bottom-sheet 로 수납. 이 파일 내부에 포함.
// 초기화 버튼: 기본값일 때 disabled.

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  DEFAULT_FILTERS,
  isDefaultFilters,
  MAX_PRICE_OPTIONS,
  MIN_DISCOUNT_OPTIONS,
  REGION_LABELS,
  SINCE_LABELS,
  parseFilters,
  serializeFilters,
  type Filters,
  type RegionCode,
  type SinceCode,
} from '@/lib/filters';
import {
  applyPreset,
  getPresets,
  presetActive,
  presetHref,
} from '@/lib/presets';

const REGION_CODES: readonly RegionCode[] = [
  'all',
  'JP',
  'SEA',
  'CN',
  'TW',
  'HK',
  'US',
  'GU',
];
const SINCE_CODES: readonly SinceCode[] = ['24h', '7d', '30d', 'all'];

const DEBOUNCE_MS = 300;

/**
 * 출발 월 옵션: 현재 월 + 이후 11개월.
 * 컴포넌트 첫 마운트 시점 기준으로 고정 (실시간 변환은 UX 요구 없음).
 */
function useMonthOptions(): readonly { value: string; label: string }[] {
  return useMemo(() => {
    const now = new Date();
    const opts: { value: string; label: string }[] = [
      { value: 'all', label: '전체' },
    ];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const mm = m < 10 ? `0${m}` : `${m}`;
      const val = `${y}-${mm}`;
      opts.push({ value: val, label: val });
    }
    return opts;
  }, []);
}

function selectClass(): string {
  return 'rounded-md bg-surface border border-line px-3 py-2 text-sm text-ink focus:border-ink-4 focus:outline-none';
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] text-ink-4 uppercase tracking-wide">
      {children}
    </span>
  );
}

type FilterInnerProps = {
  filters: Filters;
  onChange: (next: Filters) => void;
  onReset: () => void;
  monthOptions: readonly { value: string; label: string }[];
};

function FilterInner({
  filters,
  onChange,
  onReset,
  monthOptions,
}: FilterInnerProps) {
  const resetDisabled = isDefaultFilters(filters);
  return (
    <>
      <label className="flex flex-col gap-1">
        <FieldLabel>지역</FieldLabel>
        <select
          value={filters.region}
          onChange={(e) =>
            onChange({ ...filters, region: e.target.value as RegionCode })
          }
          className={selectClass()}
        >
          {REGION_CODES.map((r) => (
            <option key={r} value={r}>
              {REGION_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <FieldLabel>최대 가격</FieldLabel>
        <select
          value={filters.maxPrice === null ? 'all' : String(filters.maxPrice)}
          onChange={(e) => {
            const v = e.target.value;
            onChange({
              ...filters,
              maxPrice: v === 'all' ? null : parseInt(v, 10),
            });
          }}
          className={selectClass()}
        >
          {MAX_PRICE_OPTIONS.map((opt) => (
            <option
              key={opt.label}
              value={opt.value === null ? 'all' : String(opt.value)}
            >
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <FieldLabel>출발 월</FieldLabel>
        <select
          value={filters.month ?? 'all'}
          onChange={(e) => {
            const v = e.target.value;
            onChange({ ...filters, month: v === 'all' ? null : v });
          }}
          className={selectClass()}
        >
          {monthOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <FieldLabel>최소 할인율</FieldLabel>
        <select
          value={String(filters.minDiscount)}
          onChange={(e) =>
            onChange({ ...filters, minDiscount: parseInt(e.target.value, 10) })
          }
          className={selectClass()}
        >
          {MIN_DISCOUNT_OPTIONS.map((opt) => (
            <option key={opt.value} value={String(opt.value)}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-col gap-1">
        <FieldLabel>신선도</FieldLabel>
        <div
          role="group"
          aria-label="신선도"
          className="inline-flex rounded-md border border-line bg-surface p-0.5"
        >
          {SINCE_CODES.map((s) => {
            const active = filters.since === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => onChange({ ...filters, since: s })}
                className={`px-2.5 py-1 text-xs rounded-sm tabular-nums ${
                  active
                    ? 'bg-ink text-white'
                    : 'text-ink-3 hover:text-ink'
                }`}
              >
                {SINCE_LABELS[s]}
              </button>
            );
          })}
        </div>
      </div>
      <div className="ml-auto self-end">
        <button
          type="button"
          onClick={onReset}
          disabled={resetDisabled}
          className={`text-xs ${
            resetDisabled
              ? 'text-ink-5 cursor-not-allowed'
              : 'text-ink-3 hover:text-ink underline underline-offset-2'
          }`}
        >
          초기화
        </button>
      </div>
    </>
  );
}

const FILTER_KEYS = ['region', 'maxPrice', 'month', 'minDiscount', 'since'] as const;

export function FilterBar({ initial }: { initial: Filters }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<Filters>(initial);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // 상세 필터 기본 접힘. v5 "+ 자세히 설정" 토글.
  const [detailOpen, setDetailOpen] = useState(false);
  const presets = useMemo(() => getPresets(), []);

  // Filters → URL 동기. preset 클릭 같은 즉시 반영이 필요할 때 호출.
  const applyFiltersToUrl = (next: Filters) => {
    const q = serializeFilters(next).toString();
    const preserved = new URLSearchParams();
    if (searchParams) {
      for (const [k, v] of searchParams.entries()) {
        if (!(FILTER_KEYS as readonly string[]).includes(k)) {
          preserved.append(k, v);
        }
      }
    }
    const combined = new URLSearchParams(q);
    for (const [k, v] of preserved.entries()) combined.append(k, v);
    const qStr = combined.toString();
    router.replace(qStr ? `/?${qStr}` : '/', { scroll: false });
  };

  // URL 이 외부에서 바뀌었을 때 동기화 (Back/Forward, 초기 로드).
  useEffect(() => {
    const next = parseFilters(searchParams ?? new URLSearchParams());
    setFilters((prev) => {
      if (
        prev.region === next.region &&
        prev.maxPrice === next.maxPrice &&
        prev.month === next.month &&
        prev.minDiscount === next.minDiscount &&
        prev.since === next.since
      ) {
        return prev;
      }
      return next;
    });
  }, [searchParams]);

  // 300ms debounce 후 router.replace.
  const lastQRef = useRef<string | null>(null);
  useEffect(() => {
    const handle = window.setTimeout(() => {
      const q = serializeFilters(filters).toString();
      // 외부 키(t=shareToken 등) 보존.
      const preserved = new URLSearchParams();
      if (searchParams) {
        for (const [k, v] of searchParams.entries()) {
          if (
            k !== 'region' &&
            k !== 'maxPrice' &&
            k !== 'month' &&
            k !== 'minDiscount' &&
            k !== 'since'
          ) {
            preserved.append(k, v);
          }
        }
      }
      // merge
      const combined = new URLSearchParams(q);
      for (const [k, v] of preserved.entries()) combined.append(k, v);
      const qStr = combined.toString();
      if (qStr === lastQRef.current) return;
      lastQRef.current = qStr;
      router.replace(qStr ? `/?${qStr}` : '/', { scroll: false });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [filters, router, searchParams]);

  const monthOptions = useMonthOptions();

  const onChange = (next: Filters) => setFilters(next);
  const onReset = () => setFilters(DEFAULT_FILTERS);

  return (
    <div
      className="sticky top-14 z-20 bg-page/90 backdrop-blur-sm border-b border-line animate-fade-in"
      aria-label="필터"
    >
      {/* Row 1: Preset chips — 항상 노출, 첫 방문자 학습 비용 완화 */}
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 flex flex-wrap items-center gap-2 overflow-x-auto">
        <span className="text-[11px] text-ink-4 mr-1 uppercase tracking-wider shrink-0">
          빠른 필터
        </span>
        {presets.map((p) => {
          const active = presetActive(filters, p);
          const href = presetHref(filters, p, searchParams);
          return (
            <Link
              key={p.id}
              href={href}
              replace
              scroll={false}
              prefetch={false}
              data-on={active ? 'true' : 'false'}
              className="preset shrink-0"
              aria-pressed={active}
            >
              {p.prefix ? (
                <span aria-hidden="true">{p.prefix}</span>
              ) : null}
              <span>{p.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setDetailOpen((v) => !v)}
          className="preset shrink-0"
          style={{ borderStyle: 'dashed' }}
          aria-expanded={detailOpen}
        >
          {detailOpen ? '− 상세 필터 닫기' : '+ 자세히 설정'}
        </button>
      </div>

      {/* Row 2: 상세 필터 (접힘 기본, Row 1 토글로 노출) */}
      {detailOpen ? (
        <>
          {/* 데스크톱: 가로 배치 */}
          <div className="hidden md:flex max-w-6xl mx-auto px-4 md:px-6 pb-3 gap-3 flex-wrap items-end">
            <FilterInner
              filters={filters}
              onChange={onChange}
              onReset={onReset}
              monthOptions={monthOptions}
            />
          </div>
          {/* 모바일: Drawer 토글 */}
          <div className="md:hidden max-w-6xl mx-auto px-4 pb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setDrawerOpen((v) => !v)}
              className="w-full rounded-md border border-line bg-surface py-2 text-sm text-ink-2 flex items-center justify-between px-3"
              aria-expanded={drawerOpen}
            >
              <span>필터 조건 설정</span>
              <span aria-hidden="true">{drawerOpen ? '∧' : '∨'}</span>
            </button>
          </div>
          {drawerOpen ? (
            <div className="md:hidden max-w-6xl mx-auto px-4 pb-4 grid grid-cols-1 gap-3">
              <FilterInner
                filters={filters}
                onChange={onChange}
                onReset={onReset}
                monthOptions={monthOptions}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
