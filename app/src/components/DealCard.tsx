// Server Component. 딜 카드 (ADR-027 딜 유형).
//
// 레이아웃 (UI_GUIDE 딜 카드 섹션):
//   상단  : 노선 (ICN → KIX) + 항공사 + ShareButton
//   중단  : 가격 + PriceBadge
//   하단 1: CurationLine (Core: 규칙 기반)
//   하단 2: 경과시간
//   최하단: SourceTag
//
// Hard red lines:
// - 원문 링크 <a target="_blank" rel="nofollow noopener"> — ADR-008 트래픽 환원
// - 모서리는 `rounded-md` (UI_GUIDE 표준), 대형 둥근 모서리 표준화 금지
// - snapshot 상태는 opacity 0.5 + grayscale italic + 클릭 비활성
// - 🔥 외 이모지 사용 금지

import Link from 'next/link';

import { CurationLine } from '@/components/CurationLine';
import { DetailButton } from '@/components/DetailButton';
import { PriceBadge } from '@/components/PriceBadge';
import { RouteFrequency } from '@/components/RouteFrequency';
import { SaveButton } from '@/components/SaveButton';
import { ShareButton } from '@/components/ShareButton';
import { SourceTag } from '@/components/SourceTag';
import { Sparkline } from '@/components/Sparkline';
import { lookupCarrier } from '@/lib/airlines';
import { cityName, formatStayDuration } from '@/lib/city-names';
import { formatKrw, formatVerdict } from '@/lib/format';
import { buildSkyscannerSearchUrl } from '@/lib/skyscanner-url';
import { formatRelativeKst } from '@/lib/tz';
import type { FrequencyInfo } from '@/services/route-frequency';
import type { Deal, Source } from '@/types/deal';

const SOURCE_LABEL: Record<Source, string> = {
  ppomppu: '뽐뿌',
  ruliweb: '루리웹',
  playwings: '플레이윙즈',
};

type DealCardProps = {
  deal: Deal;
  variant?: 'hero' | 'list';
  /** 현재 페이지의 쿼리 스트링 (필터 + share token). ShareButton 에 주입. */
  shareQuery?: string;
  now?: Date;
  /** CommunityPicks 섹션에서만 true — HOT/TRENDING 라벨 표시. */
  showSocialSignalLabel?: boolean;
  /** list 변형에서만 노출되는 노선 빈도 마이크로 지표. 히어로 제외 (UI_GUIDE). */
  freqInfo?: FrequencyInfo;
  /** 아카이브 페이지(`/archive/[date]`)에서만 true — '당시 가격' 라벨 노출. */
  showArchivedLabel?: boolean;
};

function carrierLabel(code: string | null, klass: Deal['carrierClass']): string {
  const classText = klass === 'fsc' ? 'FSC' : klass === 'lcc' ? 'LCC' : '혼합';
  if (!code) return classText;
  const info = lookupCarrier(code);
  if (!info) return `${code} · ${classText}`;
  return `${info.info.name} · ${classText}`;
}

export function DealCard({
  deal,
  variant = 'list',
  shareQuery = '',
  now,
  showSocialSignalLabel = false,
  freqInfo,
  showArchivedLabel = false,
}: DealCardProps) {
  const href = deal.sourceUrls[0] ?? '#';
  const isSnapshot = deal.verificationStatus === 'snapshot';
  const priceChanged = deal.verificationStatus === 'price_changed';

  const isHero = variant === 'hero';

  const bg = 'bg-card';
  const minH = isHero ? 'min-h-[220px]' : 'min-h-[180px]';
  const padding = isHero ? 'p-5' : 'p-4';
  const priceText = isHero
    ? 'text-3xl font-semibold text-ink tabular-nums tracking-tight'
    : 'text-2xl font-semibold text-ink tabular-nums tracking-tight';

  // 아카이브 페이지에서는 snapshot 도 링크 유지 (ARCHITECTURE.md "아카이브 페이지 렌더 정책":
  // "원문 링크는 유지. 404면 snapshot 라벨만 덧붙임"). 일반 리스트는 기존대로 클릭 비활성.
  const disabled = isSnapshot && !showArchivedLabel;

  const shareUrl = shareQuery ? `/?${shareQuery}` : '/';

  const relative = formatRelativeKst(deal.postedAt, now);

  const innerContent = (
    <>
      {/* Row 1: 노선 + 항공사 + 공유 */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {isHero ? (
            <>
              <div className="text-[15px] font-semibold text-ink truncate">
                {cityName(deal.destination)}
              </div>
              <div className="text-[11px] text-ink-4 tabular-nums mt-0.5">
                {deal.origin} → {deal.destination}
                {formatStayDuration(deal.departFrom, deal.departTo) ? (
                  <>
                    <span className="dotsep"></span>
                    {formatStayDuration(deal.departFrom, deal.departTo)}
                  </>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-medium text-ink-2">
                {deal.origin} → {deal.destination}
              </div>
              <div className="text-[11px] text-ink-4 mt-0.5 truncate">
                {carrierLabel(deal.carrierCode, deal.carrierClass)}
              </div>
            </>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {showArchivedLabel ? (
            <span className="text-[10px] text-ink-4">당시 가격</span>
          ) : null}
          {showSocialSignalLabel && deal.socialSignal ? (
            <span className="text-[10px] text-ink-4 uppercase tracking-wide">
              {deal.socialSignal === 'hot' ? 'HOT' : 'TRENDING'}
            </span>
          ) : null}
          {isHero && deal.destination ? (
            <SaveButton destination={deal.destination} />
          ) : null}
          <ShareButton url={shareUrl} title={deal.title} />
        </div>
      </div>

      {/* Row 2: 가격 + PriceBadge */}
      <div className="mt-3 flex items-end justify-between gap-2">
        <span
          className={priceText}
          aria-label={`가격 ${formatKrw(deal.priceKrw)}`}
        >
          {formatKrw(deal.priceKrw)}
        </span>
        <div className="shrink-0">
          {!isSnapshot ? (
            <PriceBadge
              discountRate={deal.discountRate}
              pricePercentile={deal.pricePercentile}
              baselineKrw={deal.baselineKrw}
              priceKrw={deal.priceKrw}
              carrierClass={deal.carrierClass}
              baselineSource={deal.baselineSource}
              baselineConfidence={deal.baselineConfidence}
              hotDeal={deal.hotDeal}
              priceChanged={priceChanged}
            />
          ) : null}
        </div>
      </div>

      {/* Row 3a: Hero verdict (hot deal or >=30% 에서만). */}
      {isHero ? (() => {
        const v = formatVerdict({
          hotDeal: deal.hotDeal,
          discountRate: deal.discountRate,
          baselineKrw: deal.baselineKrw,
        });
        if (!v.tone) return null;
        const viCls = v.tone === 'hot' ? 'vi vi-hot' : 'vi vi-good';
        return (
          <div className="verdict mt-3">
            <span className={viCls} aria-hidden="true">
              {v.tone === 'hot' ? '🔥' : '✓'}
            </span>
            <span>
              <b>{v.headline}</b>
              {v.from ? (
                <span className="text-ink-3 ml-1">
                  평소 <span className="from">{v.from}</span>이던 노선이에요.
                </span>
              ) : null}
            </span>
          </div>
        );
      })() : null}

      {/* Row 3b: CurationLine — Stretch 2 LLM 큐레이션이 있으면 override 로 전달. */}
      <div className="mt-2">
        <CurationLine deal={deal} override={deal.curationText ?? undefined} />
      </div>

      {/* Row 4: Sparkline — list 변형 + 활성 카드에만. 히어로 / snapshot 제외. */}
      {!isHero && !isSnapshot ? (
        <div className="mt-2">
          <Sparkline dealId={deal.id} />
        </div>
      ) : null}

      {/* Row 5: RouteFrequency — list 변형에만. 히어로 제외 (UI_GUIDE). */}
      {!isHero && freqInfo ? (
        <div className="mt-1">
          <RouteFrequency info={freqInfo} />
        </div>
      ) : null}

      {/* Row 6a: Hero dual CTA (hover reveal) */}
      {isHero && !isSnapshot ? (() => {
        const primarySource = deal.sources[0];
        const primaryLabel = primarySource
          ? `원문 · ${SOURCE_LABEL[primarySource] ?? primarySource}`
          : '원문 보기';
        const skyUrl = buildSkyscannerSearchUrl({
          origin: deal.origin ?? 'ICN',
          destination: deal.destination ?? 'NRT',
          now,
        });
        return (
          <div className="mt-4 pt-3 border-t border-line card-ctas flex gap-2 flex-wrap">
            <a
              href={href}
              target="_blank"
              rel="nofollow noopener"
              className="btn btn-primary flex-1 min-w-[120px]"
            >
              {primaryLabel}
            </a>
            <a
              href={skyUrl}
              target="_blank"
              rel="nofollow noopener"
              className="btn btn-ghost flex-1 min-w-[120px]"
            >
              스카이스캐너
            </a>
            {deal.origin && deal.destination ? (
              <DetailButton
                dealId={deal.id}
                origin={deal.origin}
                destination={deal.destination}
              />
            ) : null}
          </div>
        );
      })() : null}

      {/* Row 6b: 경과시간 */}
      <div className="mt-auto pt-2 flex items-center justify-between text-[11px] text-ink-4">
        <span>{relative}</span>
        <SourceTag sources={deal.sources} />
      </div>

      {isSnapshot ? (
        <span className="absolute left-3 top-3 text-[10px] text-ink-4 uppercase tracking-wide">
          원문 삭제됨
        </span>
      ) : null}
    </>
  );

  const cardCls = [
    'relative flex flex-col deal',
    bg,
    minH,
    padding,
    isHero
      ? 'rounded-xl border border-line-2 shadow-[0_1px_0_rgba(0,0,0,.02),0_24px_48px_-32px_rgba(20,20,20,.14)]'
      : 'rounded-lg border border-line',
    'transition-colors duration-[120ms]',
    !isSnapshot
      ? 'hover:border-line-2'
      : 'opacity-50 grayscale italic cursor-not-allowed',
    'animate-fade-in',
  ]
    .filter(Boolean)
    .join(' ');

  if (disabled) {
    return (
      <div
        className={cardCls}
        aria-label={`원문 삭제된 딜 ${deal.origin} → ${deal.destination}`}
      >
        {innerContent}
      </div>
    );
  }

  // Hero variant: article 로 카드 자체는 링크 아님. 내부에 dual CTA 포함.
  // list variant: 카드 전체를 <Link> 로 감싸 원문 새 탭 유지 (기존 UX 보존).
  if (isHero) {
    return (
      <article
        className={cardCls}
        aria-label={`${cityName(deal.destination)} 딜 ${formatKrw(deal.priceKrw)}`}
      >
        {innerContent}
      </article>
    );
  }

  return (
    <Link
      href={href}
      target="_blank"
      rel="nofollow noopener"
      className={cardCls}
      prefetch={false}
    >
      {innerContent}
    </Link>
  );
}
