// Saved routes localStorage helpers (Cheapsky Light v5).
//
// 사용자가 관심 노선 (destination IATA) 을 로컬에 저장/불러오기.
// 사용자 인증 시스템 없음 — 브라우저별 별도 상태.
//
// 저장: 최대 10개, FIFO.

const KEY = 'cheapsky_saved_routes';
const MAX = 10;

export function loadSavedRoutes(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === 'string').slice(0, MAX);
  } catch {
    return [];
  }
}

export function saveRoutes(routes: readonly string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(routes.slice(0, MAX)));
  } catch {
    // quota exceeded / private mode — ignore
  }
}

export function toggleRoute(dest: string, current: readonly string[]): string[] {
  if (current.includes(dest)) {
    return current.filter((d) => d !== dest);
  }
  return [dest, ...current.filter((d) => d !== dest)].slice(0, MAX);
}
