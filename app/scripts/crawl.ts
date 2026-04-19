/**
 * Cheapsky crawl pipeline (Core + Stretch 1 — ADR-004 / ADR-011 / ADR-022).
 *
 * 실행:
 *   pnpm tsx scripts/crawl.ts
 *
 * 파이프라인 (docs/ARCHITECTURE.md 데이터 흐름 (2) 교차):
 *   FOR each source of [ppomppu (Core), ruliweb (Stretch 1), playwings (Stretch 1)]:
 *     1. crawler_runs INSERT (source, started_at=now, success=false)
 *     2. crawler(config) → RawPost[]  (순수 함수, ADR-008 red line)
 *     3. 각 RawPost 를 parser/rules → normalize → dedupe → baseline → score →
 *        deals UPSERT + price_observations INSERT
 *     4. (ruliweb) views 기반 상대 판정:
 *          이번 회차 수집 항목 중 views top 20% → social_signal='hot'
 *          다음 20% → 'trending', 나머지 → null
 *        같은 dedupe_key 에 여러 소스가 붙으면 max-priority 유지 (hot > trending > null).
 *     5. crawler_runs UPDATE (finished_at, processed, saved, errors, success=true)
 *   DONE sources → 관측 재집계 1회 + 본문 TTL 청소 1회.
 *
 * Hard red lines:
 *   - 크롤러는 이 스크립트에서만 호출 (CLAUDE.md).
 *   - 필수 필드 (origin / destination / priceKrw) 중 하나라도 null 이면 skip.
 *   - 한 소스가 실패해도 다음 소스는 계속 실행 (fail-soft).
 *   - 전체 크래시 → 현재 진행 중 source 의 crawler_runs.success=false 후 exit(1).
 *   - LLM / Anthropic / OpenAI import 전면 금지 (Core).
 *   - ADR-022: source='api' / 'amadeus' 분기 / 테이블 필터 금지.
 *   - RawPost 스키마에 views/comments 필드 추가 금지 — ParsedListItem 만 사용.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type {
  CarrierClass,
  DealDraft,
  RawPost,
  Source,
} from '@/types/deal';
import { dedupeKey } from '@/lib/dedupe';
import { classOf } from '@/lib/airlines';
import { normalizeRoute } from '@/lib/route-map';
import { score } from '@/lib/scorer';
import { resolveBaseline } from '@/services/baseline';
import { crawlPpomppu } from '@/services/crawlers/ppomppu';
import { crawlPlaywings } from '@/services/crawlers/playwings';
import {
  crawlRuliweb,
  crawlRuliwebWithSignals,
} from '@/services/crawlers/ruliweb';
import { crawlClien } from '@/services/crawlers/clien';
import type { Crawler, ParsedListItem } from '@/services/crawlers/types';
import { parseRules } from '@/services/parser/rules';
import {
  computeSocialSignals,
  maxSocialSignal,
  type SocialSignalLabel,
} from '@/services/social-signal';
import { createBudget, type BudgetTracker } from '@/lib/llm-budget';
// ADR-005: parser/llm 은 Stretch 2 이상에서만 동적으로 로드.
// Core 빌드에 정적 import 유출 금지 — isStretchStage() 분기 내에서만 import.
import type { parseLlm as ParseLlmFn } from '@/services/parser/llm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..');
dotenvConfig({ path: resolve(appRoot, '.env.local') });

const BODY_TTL_DAYS = 7;
const DEAL_EXPIRY_DAYS = 30; // 기본 만료 창 (verify 로 조기 만료 가능)
const MIXED_THRESHOLD = 10; // ADR-011: 재집계 하한

/** CHEAPSKY_STAGE=stretch 일 때만 LLM 파서 폴백 분기 (ADR-005). */
function isStretchStage(): boolean {
  return (process.env.CHEAPSKY_STAGE ?? '').toLowerCase() === 'stretch';
}

/**
 * 규칙 파서가 필수 필드(origin/destination/priceKrw) 중 하나라도 못 채웠는가?
 * 이 때만 LLM 폴백 대상.
 */
function isIncompleteDraft(d: DealDraft): boolean {
  return !d.origin || !d.destination || d.priceKrw == null;
}

/**
 * Row type for deals (snake_case mirror of the Postgres table).
 */
type DealRow = {
  dedupe_key: string;
  sources: string[];
  source_urls: string[];
  title: string;
  body: string | null;
  origin: string;
  destination: string;
  trip_type: 'oneway' | 'roundtrip';
  depart_from: string | null;
  depart_to: string | null;
  return_from: string | null;
  return_to: string | null;
  price_krw: number;
  carrier_code: string | null;
  carrier_class: CarrierClass;
  baseline_krw: number | null;
  baseline_source: 'observed' | 'seed' | 'mixed' | null;
  baseline_confidence: 'low' | 'medium' | 'high' | null;
  discount_rate: number | null;
  price_percentile: number | null;
  hot_deal: boolean;
  parsed_by: 'rules' | 'llm' | null;
  verification_status: string;
  verified_at: string | null;
  verification_fail_count: number;
  posted_at: string;
  expires_at: string;
  body_expires_at: string;
};

/**
 * 한 회차에서 실행할 소스 묶음. 순서 유지 (ppomppu → ruliweb → playwings → clien).
 * playwings 는 ADR-025 방어 조항 준수 — 구조화 피드(sitemap) 우선, 본문 500자 cut,
 * 작성자 미수집, 운영자 이의 제기 시 즉시 비활성 (운영 절차).
 * clien (Stretch 3, ADR-030): 알뜰구매 게시판 항공권 밀도가 낮지만 교차 매칭 N=3
 * 승격에 기여하는 4번째 소스.
 */
type SourceEntry = {
  source: Source;
  crawler: Crawler;
  /**
   * 선택: 이 소스의 리스트 parseList 결과를 social_signal 상대 판정 입력으로 쓸지.
   * ruliweb 만 true. ppomppu 는 현재 views 신뢰도 낮아 Core 스코프 밖.
   */
  collectSocialSignal?: boolean;
};

const SOURCES: SourceEntry[] = [
  { source: 'ppomppu', crawler: crawlPpomppu },
  { source: 'ruliweb', crawler: crawlRuliweb, collectSocialSignal: true },
  { source: 'playwings', crawler: crawlPlaywings },
  { source: 'clien', crawler: crawlClien },
];

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} not set in .env.local`);
  }
  return v;
}

function toDateISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * DealDraft → 필수 필드 검증 후 UPSERT 가능한 형태로 변환.
 * origin / destination / priceKrw / tripType 중 하나라도 null → null 반환 (skip).
 */
function draftToReady(
  draft: DealDraft,
):
  | null
  | {
      origin: string;
      destination: string;
      priceKrw: number;
      carrierClass: CarrierClass;
      carrierCode: string | null;
      tripType: 'oneway' | 'roundtrip';
      departFrom: Date | null;
      departTo: Date | null;
      returnFrom: Date | null;
      returnTo: Date | null;
      postedAt: Date;
      title: string;
      sourceUrl: string;
      source: string;
      sourceId: string;
      parsedBy: 'rules' | 'llm' | null;
    } {
  const { origin: o, destination: d } = normalizeRoute(
    draft.origin,
    draft.destination,
  );
  if (!o || !d) return null;
  if (draft.priceKrw == null || !Number.isFinite(draft.priceKrw)) return null;
  if (draft.priceKrw <= 0) return null;

  const tripType = draft.tripType ?? 'roundtrip';
  const carrierClass: CarrierClass = draft.carrierCode
    ? classOf(draft.carrierCode)
    : draft.carrierClass ?? 'mixed';

  return {
    origin: o,
    destination: d,
    priceKrw: Math.round(draft.priceKrw),
    carrierClass,
    carrierCode: draft.carrierCode,
    tripType,
    departFrom: draft.departFrom,
    departTo: draft.departTo,
    returnFrom: draft.returnFrom,
    returnTo: draft.returnTo,
    postedAt: draft.postedAt,
    title: draft.title,
    sourceUrl: draft.sourceUrl,
    source: draft.source,
    sourceId: draft.sourceId,
    parsedBy: draft.parsedBy,
  };
}

/**
 * dedupe_key 계산용 "대표 월" 산출.
 * departFrom 이 있으면 그 달. 없으면 postedAt 달을 사용 (파싱 실패 딜이라도
 * 완전한 키를 만들 수 있도록). 두 경우 모두 동일 노선·월·가격대면 동일 해시.
 */
function representativeYearMonth(d: {
  departFrom: Date | null;
  postedAt: Date;
}): { year: number; month: number } {
  const anchor = d.departFrom ?? d.postedAt;
  return {
    year: anchor.getUTCFullYear(),
    month: anchor.getUTCMonth() + 1,
  };
}

/**
 * deals UPSERT — dedupe_key 충돌 시 merge 규칙:
 *  - sources / source_urls: union (중복 제거)
 *  - price_krw: min(old, new)
 *  - verification_status / verified_at / verification_fail_count: 보존
 *  - posted_at: earliest
 *  - social_signal: max-priority (hot > trending > null), 기존·신규 둘 다 고려
 *  - 나머지: new 값
 *
 *  실제 PostgreSQL 은 upsert 시 복잡 merge 를 잘 못 해서, 여기서는
 *  먼저 SELECT → 머지 → UPSERT 순으로 처리 (행 수가 많지 않음).
 *
 * 반환: 저장된 deal 의 id (uuid).
 */
async function upsertDeal(
  client: SupabaseClient,
  row: DealRow,
  newSignal: SocialSignalLabel,
): Promise<string> {
  const existing = await client
    .from('deals')
    .select(
      'id, sources, source_urls, price_krw, verification_status, verified_at, verification_fail_count, posted_at, social_signal',
    )
    .eq('dedupe_key', row.dedupe_key)
    .maybeSingle();

  if (existing.error) {
    throw new Error(`deals select: ${existing.error.message}`);
  }

  if (existing.data) {
    const prev = existing.data as {
      id: string;
      sources: string[];
      source_urls: string[];
      price_krw: number;
      verification_status: string;
      verified_at: string | null;
      verification_fail_count: number;
      posted_at: string;
      social_signal: 'hot' | 'trending' | null;
    };

    const mergedSources = Array.from(new Set([...prev.sources, ...row.sources]));
    const mergedUrls = Array.from(
      new Set([...prev.source_urls, ...row.source_urls]),
    );
    const minPrice = Math.min(prev.price_krw, row.price_krw);
    const earliestPosted =
      new Date(prev.posted_at).getTime() < new Date(row.posted_at).getTime()
        ? prev.posted_at
        : row.posted_at;

    const mergedSignal = maxSocialSignal(prev.social_signal, newSignal);

    const updated = {
      ...row,
      sources: mergedSources,
      source_urls: mergedUrls,
      price_krw: minPrice,
      verification_status: prev.verification_status,
      verified_at: prev.verified_at,
      verification_fail_count: prev.verification_fail_count,
      posted_at: earliestPosted,
      social_signal: mergedSignal,
    };
    const up = await client.from('deals').update(updated).eq('id', prev.id);
    if (up.error) throw new Error(`deals update: ${up.error.message}`);
    return prev.id;
  }

  const insertRow = { ...row, social_signal: newSignal };
  const ins = await client
    .from('deals')
    .insert(insertRow)
    .select('id')
    .maybeSingle();
  if (ins.error) throw new Error(`deals insert: ${ins.error.message}`);
  if (!ins.data) throw new Error('deals insert returned no id');
  return (ins.data as { id: string }).id;
}

/**
 * price_observations INSERT — 매 UPSERT 당 1 건 추가.
 */
async function insertObservation(
  client: SupabaseClient,
  params: {
    origin: string;
    destination: string;
    tripType: 'oneway' | 'roundtrip';
    carrierClass: CarrierClass;
    priceKrw: number;
    observedAt: Date;
    dealId: string | null;
  },
): Promise<void> {
  const res = await client.from('price_observations').insert({
    origin: params.origin,
    destination: params.destination,
    trip_type: params.tripType,
    carrier_class: params.carrierClass,
    price_krw: params.priceKrw,
    observed_at: params.observedAt.toISOString(),
    source_deal_id: params.dealId,
  });
  if (res.error) {
    throw new Error(`observations insert: ${res.error.message}`);
  }
}

/**
 * 관측 재집계 — 최근 30일 관측 ≥ 10 건인 (origin, destination, carrier_class)
 * 조합마다 route_market_data 를 source='observed' 로 UPSERT.
 */
async function reaggregateObservations(
  client: SupabaseClient,
  now: Date,
): Promise<number> {
  const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const res = await client
    .from('price_observations')
    .select('origin, destination, carrier_class, price_krw')
    .gte('observed_at', windowStart.toISOString());

  if (res.error) {
    throw new Error(`observations aggregate: ${res.error.message}`);
  }

  type Row = {
    origin: string;
    destination: string;
    carrier_class: CarrierClass;
    price_krw: number;
  };
  const rows = (res.data ?? []) as Row[];
  const groups = new Map<string, number[]>();

  for (const r of rows) {
    const key = `${r.origin}|${r.destination}|${r.carrier_class}`;
    const arr = groups.get(key) ?? [];
    arr.push(Number(r.price_krw));
    groups.set(key, arr);
  }

  let upserts = 0;
  for (const [key, prices] of groups) {
    if (prices.length < MIXED_THRESHOLD) continue;
    const [origin, destination, carrier_class] = key.split('|') as [
      string,
      string,
      CarrierClass,
    ];
    const sorted = prices.sort((a, b) => a - b);
    const q = (p: number) => {
      const idx = p * (sorted.length - 1);
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      if (lo === hi) return sorted[lo];
      const frac = idx - lo;
      return sorted[lo] * (1 - frac) + sorted[hi] * frac;
    };

    const payload = {
      origin,
      destination,
      carrier_class,
      p5_krw: Math.round(q(0.05)),
      p10_krw: Math.round(q(0.1)),
      p25_krw: Math.round(q(0.25)),
      p50_krw: Math.round(q(0.5)),
      p90_krw: Math.round(q(0.9)),
      cheapest_today_krw: null,
      cheapest_today_carrier: null,
      sampled_at: now.toISOString(),
      ttl_hours: 24,
      source: 'observed' as const,
    };
    const up = await client
      .from('route_market_data')
      .upsert(payload, { onConflict: 'origin,destination,carrier_class' });
    if (up.error) {
      throw new Error(`route_market_data upsert: ${up.error.message}`);
    }
    upserts++;
  }
  return upserts;
}

/**
 * 한 소스의 크롤 + 저장 루프. 실패해도 다음 소스로 진행 가능하도록 throw 하지 않음.
 * 반환: { runId, processed, saved, errors }.
 */
type LlmFallback = {
  parse: typeof ParseLlmFn;
  budget: BudgetTracker;
  apiKey: string;
};

async function runOneSource(
  client: SupabaseClient,
  entry: SourceEntry,
  userAgent: string,
  now: Date,
  llm: LlmFallback | null,
): Promise<{
  runId: number | null;
  processed: number;
  saved: number;
  errors: string[];
  success: boolean;
}> {
  // 1) crawler_runs INSERT
  const runIns = await client
    .from('crawler_runs')
    .insert({
      source: entry.source,
      started_at: now.toISOString(),
      processed_count: 0,
      saved_count: 0,
      errors: [],
      success: false,
    })
    .select('id')
    .single();
  if (runIns.error || !runIns.data) {
    console.error(
      `[crawl:${entry.source}] crawler_runs insert failed:`,
      runIns.error?.message,
    );
    return {
      runId: null,
      processed: 0,
      saved: 0,
      errors: [runIns.error?.message ?? 'unknown'],
      success: false,
    };
  }
  const runId = (runIns.data as { id: number }).id;

  const errors: string[] = [];
  let processed = 0;
  let saved = 0;

  try {
    // 2) 크롤 (ruliweb 는 social_signal 판정용 views 도 함께 받는다)
    let rawPosts: RawPost[];
    let listItems: ParsedListItem[] = [];
    if (entry.collectSocialSignal && entry.source === 'ruliweb') {
      const out = await crawlRuliwebWithSignals({
        userAgent,
        maxPosts: 40,
      });
      rawPosts = out.posts;
      listItems = out.items;
    } else {
      rawPosts = await entry.crawler({
        userAgent,
        maxPosts: 40,
      });
    }
    processed = rawPosts.length;
    console.log(`[crawl:${entry.source}] fetched ${rawPosts.length} raw posts`);

    // 2b) 사회적 신호 판정 — step0.md: 이번 회차 내 views 상위 20% → hot,
    //     다음 20% → trending. views null 항목은 판정 대상에서 제외(null 유지).
    const signalBySourceId = computeSocialSignals(listItems);

    // 3) 파싱 + 저장 루프
    for (const post of rawPosts) {
      try {
        let draft = parseRules(post);

        // Stretch 2 (ADR-005): 규칙 실패분에만 LLM 폴백. 예산 없으면 skip.
        if (llm && isIncompleteDraft(draft) && (await llm.budget.canSpend())) {
          const llmDraft = await llm.parse(post, {
            apiKey: llm.apiKey,
            budget: llm.budget,
          });
          if (
            llmDraft.origin &&
            llmDraft.destination &&
            llmDraft.priceKrw != null
          ) {
            draft = llmDraft;
          }
        }

        const ready = draftToReady(draft);
        if (!ready) continue;

        const ym = representativeYearMonth({
          departFrom: ready.departFrom,
          postedAt: ready.postedAt,
        });
        const dk = dedupeKey({
          origin: ready.origin,
          destination: ready.destination,
          priceKrw: ready.priceKrw,
          departYear: ym.year,
          departMonth: ym.month,
          carrierClass: ready.carrierClass,
        });

        const baseline = await resolveBaseline({
          origin: ready.origin,
          destination: ready.destination,
          carrierClass: ready.carrierClass,
          client,
          now,
        });
        const s = score({
          priceKrw: ready.priceKrw,
          baseline,
        });

        const expiresAt = addDays(ready.postedAt, DEAL_EXPIRY_DAYS);
        const bodyExpiresAt = addDays(ready.postedAt, BODY_TTL_DAYS);

        const row: DealRow = {
          dedupe_key: dk,
          sources: [ready.source],
          source_urls: [ready.sourceUrl],
          title: ready.title,
          body: (post.body ?? '').slice(0, 2000) || null,
          origin: ready.origin,
          destination: ready.destination,
          trip_type: ready.tripType,
          depart_from: ready.departFrom ? toDateISO(ready.departFrom) : null,
          depart_to: ready.departTo ? toDateISO(ready.departTo) : null,
          return_from: ready.returnFrom ? toDateISO(ready.returnFrom) : null,
          return_to: ready.returnTo ? toDateISO(ready.returnTo) : null,
          price_krw: ready.priceKrw,
          carrier_code: ready.carrierCode,
          carrier_class: ready.carrierClass,
          baseline_krw: baseline.p50Krw,
          baseline_source: baseline.source,
          baseline_confidence: baseline.confidence,
          discount_rate: s.discountRate,
          price_percentile: s.pricePercentile,
          hot_deal: s.hotDeal,
          parsed_by: ready.parsedBy,
          verification_status: 'unchecked',
          verified_at: null,
          verification_fail_count: 0,
          posted_at: ready.postedAt.toISOString(),
          expires_at: expiresAt.toISOString(),
          body_expires_at: bodyExpiresAt.toISOString(),
        };

        const newSignal =
          signalBySourceId.get(ready.sourceId) ?? null;

        const dealId = await upsertDeal(client, row, newSignal);
        await insertObservation(client, {
          origin: ready.origin,
          destination: ready.destination,
          tripType: ready.tripType,
          carrierClass: ready.carrierClass,
          priceKrw: ready.priceKrw,
          observedAt: now,
          dealId,
        });
        saved++;
      } catch (err) {
        const msg = `post ${post.sourceId}: ${err instanceof Error ? err.message : String(err)}`;
        console.warn(`[crawl:${entry.source}] ${msg}`);
        errors.push(msg);
      }
    }

    // 4) crawler_runs UPDATE (success=true)
    const finishRes = await client
      .from('crawler_runs')
      .update({
        finished_at: new Date().toISOString(),
        processed_count: processed,
        saved_count: saved,
        errors,
        success: true,
      })
      .eq('id', runId);
    if (finishRes.error) {
      console.warn(
        `[crawl:${entry.source}] crawler_runs update failed:`,
        finishRes.error.message,
      );
    }

    console.log(
      `[crawl:${entry.source}] done — processed=${processed} saved=${saved} errors=${errors.length}`,
    );
    return { runId, processed, saved, errors, success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[crawl:${entry.source}] FATAL:`, msg);
    errors.push(`fatal: ${msg}`);
    try {
      await client
        .from('crawler_runs')
        .update({
          finished_at: new Date().toISOString(),
          processed_count: processed,
          saved_count: saved,
          errors,
          success: false,
        })
        .eq('id', runId);
    } catch {
      // swallow — 이미 exit 경로.
    }
    return { runId, processed, saved, errors, success: false };
  }
}

async function main() {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const userAgent =
    process.env.CRAWLER_USER_AGENT ?? 'Cheapsky/0.1 (+mailto:dev)';
  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date();
  const summary: Array<{ source: Source; processed: number; saved: number; errors: number; success: boolean }> = [];
  let anyFailed = false;

  // ADR-005: Stretch 2 진입 시 LLM 폴백 활성. Core 에선 null → 분기 안 탐.
  let llm: LlmFallback | null = null;
  if (isStretchStage()) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn(
        '[crawl] CHEAPSKY_STAGE=stretch 인데 ANTHROPIC_API_KEY 미설정 — LLM 폴백 비활성.',
      );
    } else {
      // Dynamic import: Core 빌드에 @anthropic-ai/sdk 정적 import 유출 방지.
      const mod = await import('@/services/parser/llm');
      llm = {
        parse: mod.parseLlm,
        budget: createBudget(client, { now }),
        apiKey,
      };
      console.log(
        `[crawl] LLM fallback enabled (model=claude-haiku-4-5, remaining≈${await llm.budget.remaining()})`,
      );
    }
  }

  for (const entry of SOURCES) {
    const r = await runOneSource(client, entry, userAgent, now, llm);
    summary.push({
      source: entry.source,
      processed: r.processed,
      saved: r.saved,
      errors: r.errors.length,
      success: r.success,
    });
    if (!r.success) anyFailed = true;
  }

  // 관측 재집계 (모든 소스 완료 후 1회)
  let aggregated = 0;
  try {
    aggregated = await reaggregateObservations(client, now);
    console.log(
      `[crawl] reaggregated ${aggregated} route(s) into route_market_data (observed)`,
    );
  } catch (err) {
    console.warn(
      `[crawl] reaggregate: ${err instanceof Error ? err.message : String(err)}`,
    );
    anyFailed = true;
  }

  // 본문 TTL 청소
  try {
    const ttlRes = await client
      .from('deals')
      .update({ body: null })
      .lt('body_expires_at', now.toISOString())
      .not('body', 'is', null);
    if (ttlRes.error) {
      throw new Error(ttlRes.error.message);
    }
  } catch (err) {
    console.warn(
      `[crawl] body ttl: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  console.log('[crawl] summary:');
  for (const s of summary) {
    console.log(
      `  ${s.source}: processed=${s.processed} saved=${s.saved} errors=${s.errors} success=${s.success}`,
    );
  }
  console.log(`[crawl] reaggregated routes: ${aggregated}`);

  // 모든 소스가 적어도 실행은 되었으면 exit 0 — 한 소스 실패가 다른 소스를 막지 않음 (fail-soft).
  // Core 시절 요구인 "전체 크래시 시 exit(1)" 보존 — anyFailed 이지만 최소 한 소스 성공이면 0.
  const anySuccess = summary.some((s) => s.success);
  process.exit(anySuccess ? 0 : 1);
}

main().catch((err) => {
  console.error('[crawl] unhandled:', err);
  process.exit(1);
});
