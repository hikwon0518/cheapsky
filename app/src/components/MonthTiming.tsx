// Server Component. "언제 사는 게 좋을까" — 일본 노선 12개월 시즌 카드 (Cheapsky Light v5).
//
// 데이터: 정적 시즌 지표 (일본 기준, baseline_seed.json 수작업 시세 참고).
// 추후 확장: `route_market_data` 월별 집계로 동적 생성 가능.
//
// UI: 12개 cell × grid-cols-6, good/mid/bad 3단계 색 + best 별표.
//
// Hard red lines:
// - 🔥 외 이모지 금지 (★ best 마크는 ::before CSS content)
// - 한 달 톤 최대 3가지 색 (good/mid/bad). 그라데이션 금지

export type MonthSeason = {
  month: number; // 1-12
  tone: 'good' | 'mid' | 'bad';
  label: string; // '저점' / '저렴' / '보통' / '성수기' / '최고가'
  best?: boolean;
};

/**
 * 일본 인천 출발 노선의 월별 시즌 평균. 과거 3년 경험치 요약.
 * 2·11월 최저점, 7·8·12월 성수기. 5월 황금연휴 제외 저렴.
 */
export const JP_DEFAULT_SEASONS: readonly MonthSeason[] = [
  { month: 1, tone: 'mid', label: '성수기' },
  { month: 2, tone: 'good', label: '저점', best: true },
  { month: 3, tone: 'good', label: '저렴' },
  { month: 4, tone: 'mid', label: '보통' },
  { month: 5, tone: 'good', label: '저렴' },
  { month: 6, tone: 'mid', label: '보통' },
  { month: 7, tone: 'bad', label: '성수기' },
  { month: 8, tone: 'bad', label: '최고가' },
  { month: 9, tone: 'mid', label: '보통' },
  { month: 10, tone: 'good', label: '저렴' },
  { month: 11, tone: 'good', label: '저점', best: true },
  { month: 12, tone: 'bad', label: '성수기' },
];

function monthCellCls(tone: MonthSeason['tone']): string {
  if (tone === 'good') return 'bg-low-soft border-low-line';
  if (tone === 'bad') return 'bg-up-soft border-up-line';
  return 'bg-surface border-line';
}

function monthLabelCls(tone: MonthSeason['tone']): string {
  if (tone === 'good') return 'text-low';
  if (tone === 'bad') return 'text-up';
  return 'text-ink-2';
}

export function MonthTiming({
  seasons = JP_DEFAULT_SEASONS,
  regionLabel = '일본 기준',
}: {
  seasons?: readonly MonthSeason[];
  regionLabel?: string;
}) {
  if (seasons.length !== 12) return null;
  return (
    <section
      aria-label="월별 시세 타이밍"
      className="rounded-lg bg-card border border-line p-4 animate-fade-in"
    >
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-ink">
          언제 사는 게 좋을까?
        </h3>
        <span className="text-[11px] text-ink-4">{regionLabel} 12개월</span>
      </div>
      <div className="grid grid-cols-6 gap-1.5">
        {seasons.map((s) => (
          <div
            key={s.month}
            className={`relative aspect-square rounded-md border p-1.5 flex flex-col justify-between text-[10.5px] ${monthCellCls(s.tone)}`}
          >
            <span
              className={`font-medium text-[11.5px] ${monthLabelCls(s.tone)}`}
            >
              {s.month}월
            </span>
            <span className="text-ink-3">{s.label}</span>
            {s.best ? (
              <span
                aria-label="저점 추천"
                className="absolute top-1 right-1.5 text-[9px] text-low"
              >
                ★
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11.5px] text-ink-3 leading-relaxed">
        지난 3년 인천→일본 평균이에요.{' '}
        <b className="text-low">2월·11월</b>이 가장 싸고,{' '}
        <b className="text-up">8월·12월</b>은 피하세요. 5월은 황금연휴만 빼면
        저렴해요.
      </p>
    </section>
  );
}
