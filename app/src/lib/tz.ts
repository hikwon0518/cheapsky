// Timezone helpers (ADR-015) — 저장 UTC / 표시 KST.
// 외부 날짜 라이브러리(date-fns/dayjs/moment) 사용 금지 — Intl API 만.

export const KST = 'Asia/Seoul';

type KstParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Extracts KST wall-clock components from a UTC Date via Intl.
 * Always returns integers in base-10.
 */
function getKstParts(d: Date): KstParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: KST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  // Intl sometimes emits '24' for midnight with hour12:false — normalize.
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0;
  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    hour,
    minute: parseInt(get('minute'), 10),
    second: parseInt(get('second'), 10),
  };
}

/**
 * UTC Date → 'YYYY-MM-DD HH:mm' in KST.
 */
export function toKstIsoString(d: Date): string {
  const p = getKstParts(d);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hour)}:${pad2(
    p.minute,
  )}`;
}

/**
 * UTC Date → 'YYYY-MM-DD' in KST (date portion only).
 */
export function toKstDateOnly(d: Date): string {
  const p = getKstParts(d);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/**
 * Returns a Date representing midnight of d's KST calendar day.
 * (The returned Date's absolute timestamp corresponds to 00:00 KST = 15:00 UTC prev day.)
 *
 * KST offset is a fixed +09:00 — no DST — so we can compute directly.
 */
export function kstStartOfDay(d: Date): Date {
  const p = getKstParts(d);
  // 00:00 KST == 15:00 UTC on the previous calendar day.
  // We express the target instant via Date.UTC with (hours = 0 - 9 = -9)
  // which JavaScript normalizes to 15:00 UTC previous day.
  return new Date(Date.UTC(p.year, p.month - 1, p.day, -9, 0, 0, 0));
}

/**
 * Human-friendly relative time expressed in Korean, KST-anchored.
 * - < 60s → '방금 전'
 * - < 60m → 'N분 전'
 * - < 24h → 'N시간 전'
 * - 1일 전 (same KST calendar yesterday) → '어제 HH:mm'
 * - 그 외 → 'YYYY-MM-DD'
 */
export function formatRelativeKst(d: Date, now?: Date): string {
  const ref = now ?? new Date();
  const diffSec = Math.floor((ref.getTime() - d.getTime()) / 1000);

  if (diffSec < 60) return '방금 전';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}시간 전`;

  const refDay = toKstDateOnly(ref);
  const refParts = getKstParts(ref);
  const yesterdayUtc = new Date(
    Date.UTC(refParts.year, refParts.month - 1, refParts.day - 1, -9, 0, 0, 0),
  );
  const yesterdayKey = toKstDateOnly(yesterdayUtc);
  const dayOfD = toKstDateOnly(d);

  if (dayOfD === yesterdayKey && dayOfD !== refDay) {
    const p = getKstParts(d);
    return `어제 ${pad2(p.hour)}:${pad2(p.minute)}`;
  }

  return dayOfD;
}
