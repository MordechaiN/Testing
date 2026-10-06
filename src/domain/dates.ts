const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse YYYY-MM-DD into a UTC timestamp (ms). Returns null for empty/invalid input. */
export function parseDate(iso: string): number | null {
  const m = ISO.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t;
}

const DAY_MS = 86_400_000;

/** Whole days from a to b (b - a). null if either date is invalid. */
export function daysBetween(a: string, b: string): number | null {
  const ta = parseDate(a);
  const tb = parseDate(b);
  if (ta === null || tb === null) return null;
  return Math.round((tb - ta) / DAY_MS);
}

export function addDays(iso: string, days: number): string | null {
  const t = parseDate(iso);
  if (t === null) return null;
  const d = new Date(t + days * DAY_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// Left-to-right isolate: keeps dates in reading order inside Hebrew (RTL) text,
// so "05/09/2027 → 12/09/2027" never turns into "12/09/2027 ← 05/09/2027".
const LRI = '⁦';
const PDI = '⁩';

export function ltr(text: string): string {
  return `${LRI}${text}${PDI}`;
}

/** 2027-09-05 -> 05/09 */
export function shortDate(iso: string): string {
  const m = ISO.exec(iso);
  return m && parseDate(iso) !== null ? `${m[3]}/${m[2]}` : '';
}

/** 2027-09-05 -> 05/09/2027 */
export function longDate(iso: string): string {
  const m = ISO.exec(iso);
  return m && parseDate(iso) !== null ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Compact column title: "05/09 → 12/09". */
export function rangeLabel(start: string, end: string): string {
  if (!shortDate(start) && !shortDate(end)) return 'תאריכים לא הוזנו';
  return ltr(`${shortDate(start) || '??'} → ${shortDate(end) || '??'}`);
}

/** Full label: "05/09/2027 → 12/09/2027". */
export function rangeLabelLong(start: string, end: string): string {
  if (!longDate(start) && !longDate(end)) return 'תאריכים לא הוזנו';
  return ltr(`${longDate(start) || '??'} → ${longDate(end) || '??'}`);
}

/** Short name of a cruise date used in sentences: "05/09". */
export function dateName(start: string): string {
  return shortDate(start) ? ltr(shortDate(start)) : 'תאריך ללא שם';
}
