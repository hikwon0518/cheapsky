// Cheapsky 데이터 모델 (docs/ARCHITECTURE.md "데이터 모델" 그대로 TS 이식).
//
// 주의 (ADR-022 Rejected 2026-04-19, ADR-030 Phase 3 2026-04-19):
// - `Source` 는 커뮤니티/블로그 소스만. amadeus · duffel · kiwi 등 외부 시세 API 소스는
//   영구 금지 (ADR-022 Rejected).
// - `RouteMarketData.source` 는 'seed' | 'observed' 두 개뿐. 복원은 신규 ADR 로만.
// - Phase 3 (3-community-expansion) 에서 'clien' 추가 (ADR-030). 디시는 robots.txt
//   차단으로 영구 skip (step0 preflight 2026-04-20).

export type Source = 'ppomppu' | 'ruliweb' | 'playwings' | 'clien';

export type CarrierClass = 'fsc' | 'lcc' | 'mixed';

export type VerificationStatus =
  | 'active'
  | 'snapshot'
  | 'price_changed'
  | 'unchecked';

export type TripType = 'oneway' | 'roundtrip';

export type BaselineSource = 'observed' | 'seed' | 'mixed';

export type BaselineConfidence = 'low' | 'medium' | 'high';

export type ParsedBy = 'rules' | 'llm';

export type SocialSignal = 'hot' | 'trending';

export type RawPost = {
  source: Source;
  sourceId: string;
  sourceUrl: string;
  title: string;
  body: string;
  postedAt: Date;
};

export type DealDraft = {
  source: Source;
  sourceId: string;
  sourceUrl: string;
  title: string;
  origin: string | null;
  destination: string | null;
  tripType: TripType | null;
  departFrom: Date | null;
  departTo: Date | null;
  returnFrom: Date | null;
  returnTo: Date | null;
  priceKrw: number | null;
  carrierCode: string | null;
  carrierClass: CarrierClass | null;
  postedAt: Date;
  parsedBy: ParsedBy | null;
};

export type Deal = {
  id: string;
  dedupeKey: string;
  sources: Source[];
  sourceUrls: string[];
  title: string;
  origin: string;
  destination: string;
  tripType: TripType;
  departFrom: Date | null;
  departTo: Date | null;
  returnFrom: Date | null;
  returnTo: Date | null;
  priceKrw: number;
  carrierCode: string | null;
  carrierClass: CarrierClass;
  baselineKrw: number | null;
  baselineSource: BaselineSource | null;
  baselineConfidence: BaselineConfidence | null;
  discountRate: number | null;
  pricePercentile: number | null;
  hotDeal: boolean;
  curationText: string | null;
  curationGeneratedAt: Date | null;
  verificationStatus: VerificationStatus;
  verifiedAt: Date | null;
  verificationFailCount: number;
  socialSignal: SocialSignal | null;
  postedAt: Date;
  expiresAt: Date;
  bodyExpiresAt: Date;
  createdAt: Date;
};

export type RouteMarketData = {
  origin: string;
  destination: string;
  carrierClass: CarrierClass;
  p5Krw: number | null;
  p10Krw: number | null;
  p25Krw: number | null;
  p50Krw: number | null;
  p90Krw: number | null;
  cheapestTodayKrw: number | null;
  cheapestTodayCarrier: string | null;
  sampledAt: Date;
  ttlHours: number;
  // ADR-022 Deprecated: 'api' 금지. Stretch 3-stretch-market-api + 신규 ADR 승인 후 확장.
  source: 'seed' | 'observed';
};

export type PriceObservation = {
  id: number;
  origin: string;
  destination: string;
  tripType: TripType;
  carrierClass: CarrierClass;
  priceKrw: number;
  observedAt: Date;
  sourceDealId: string | null;
};

export type CrawlerRun = {
  id: number;
  source: Source | 'curator' | 'verifier' | 'archiver' | 'cost_check';
  startedAt: Date;
  finishedAt: Date | null;
  processedCount: number;
  savedCount: number;
  errors: string[];
  success: boolean;
};

export type DealVerification = {
  id: number;
  dealId: string;
  checkedAt: Date;
  httpStatus: number | null;
  status: VerificationStatus;
  note: string | null;
};

export type ArchiveSnapshot = {
  date: string;
  dealIds: string[];
  capturedAt: Date;
};

export type ApiUsageDaily = {
  date: string;
  anthropicTokensIn: number;
  anthropicTokensOut: number;
  supabaseRowsTotal: number | null;
};

/**
 * `data/baseline_seed.json` 의 엔트리 스키마.
 * (20 노선 × FSC/LCC/mixed 최대 3 엔트리, methodology.md 기준 수동 조사)
 */
export type BaselineSeedEntry = {
  origin: string;
  destination: string;
  carrierClass: CarrierClass;
  baselineKrw: number;
  p10Krw: number;
  p50Krw: number;
  p90Krw: number;
  confidence: BaselineConfidence;
  sampledAt: string; // 'YYYY-MM-DD'
  source: 'seed';
};
