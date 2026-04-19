// 공통 크롤러 타입 정의.
//
// CLAUDE.md red line:
// - 크롤러는 (config) => Promise<RawPost[]> 순수 함수.
//   DB 접근·파일 IO·로깅 부수효과 금지 (console.log 는 예외 — 테스트가 캡처).
// - `fetch` / `now` 는 config 로 주입 가능해야 테스트 가능.
// - 작성자 식별자 필드 금지 (ADR-008).

import type { RawPost } from '@/types/deal';

export type CrawlerConfig = {
  userAgent: string;
  /** 최대 수집 게시글 수. 기본 40. */
  maxPosts?: number;
  /** 요청 간 최소 간격(ms). ADR-008 에 따라 최소 1000. 기본 1000. */
  minDelayMs?: number;
  /** 테스트 주입용. 기본 globalThis.fetch. */
  fetch?: typeof fetch;
  /** 테스트 주입용. 기본 () => new Date(). */
  now?: () => Date;
};

export type Crawler = (config: CrawlerConfig) => Promise<RawPost[]>;

/**
 * 리스트 페이지에서 뽑아낸 게시글 메타데이터. 본문(body) 은 상세 fetch 후 병합.
 * 작성자 필드는 절대 포함하지 않는다 (ADR-008).
 *
 * 사회적 신호 필드 (views/comments/recommends):
 * - Stretch 1 (루리웹) 에서 `parseList` 단계의 일회성 raw 수치로만 수집.
 * - `RawPost` / DB 스키마에는 저장되지 않음 — caller(`scripts/crawl.ts`) 가
 *   "크롤 회차 내 상대 판정"(상위 20% → hot / 다음 20% → trending) 으로 변환해
 *   `deals.social_signal` 에만 반영.
 * - 소스 간 스케일이 다르므로 숫자 자체를 UI 에 노출 금지 (ADR-023 / UI_GUIDE).
 * - 기존 ppomppu.ts 의 parseList 반환과 호환 유지 — 전부 optional.
 */
export type ParsedListItem = {
  sourceId: string;
  sourceUrl: string;
  title: string;
  postedAt: Date;
  /** 조회수 (루리웹 `td.hit` 등). 파싱 실패·미수집 시 null 또는 undefined. */
  views?: number | null;
  /** 댓글수 (루리웹 `.num_reply` 괄호 안 숫자 등). */
  comments?: number | null;
  /** 추천수 (루리웹 `td.recomd` 등). */
  recommends?: number | null;
};
