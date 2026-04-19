// 항공사 코드·한글명 → FSC/LCC 분류 (ADR-024).

import airlinesData from '@/data/airlines.json';
import type { CarrierClass } from '@/types/deal';

export type AirlineInfo = {
  name: string;
  class: 'fsc' | 'lcc';
  country: string;
};

type AirlinesMap = Record<string, AirlineInfo>;

const AIRLINES: AirlinesMap = airlinesData as AirlinesMap;

// 한글명 역인덱스 (lazy 초기화).
let nameIndex: Map<string, string> | null = null;
function getNameIndex(): Map<string, string> {
  if (nameIndex) return nameIndex;
  nameIndex = new Map<string, string>();
  for (const [code, info] of Object.entries(AIRLINES)) {
    nameIndex.set(info.name, code);
  }
  return nameIndex;
}

/**
 * Look up an airline by IATA code (e.g. 'KE') or Korean name (e.g. '대한항공').
 * Case-insensitive for codes; exact match for Korean names.
 * Returns null when not found.
 */
export function lookupCarrier(
  codeOrName: string,
): { code: string; info: AirlineInfo } | null {
  if (!codeOrName) return null;
  const trimmed = codeOrName.trim();
  if (!trimmed) return null;

  // 1) 코드 조회 (대소문자 무시)
  const upper = trimmed.toUpperCase();
  const byCode = AIRLINES[upper];
  if (byCode) return { code: upper, info: byCode };

  // 2) 한글명 역방향
  const byName = getNameIndex().get(trimmed);
  if (byName) return { code: byName, info: AIRLINES[byName] };

  return null;
}

/**
 * Classify a carrier code into FSC/LCC. Unknown or null → 'mixed'.
 * (ADR-024: 매칭 실패 → mixed, 단일 판정 금지)
 */
export function classOf(code: string | null | undefined): CarrierClass {
  if (!code) return 'mixed';
  const trimmed = code.trim();
  if (!trimmed) return 'mixed';
  const entry = AIRLINES[trimmed.toUpperCase()];
  if (!entry) return 'mixed';
  return entry.class;
}
