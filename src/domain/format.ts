import type { Flight, GroupId } from './types';

/** 4805 -> "4,805", 1234.5 -> "1,234.50" */
export function fmt(n: number): string {
  const whole = Number.isInteger(n);
  return n.toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function usd(n: number): string {
  return n < 0 ? `-$${fmt(-n)}` : `$${fmt(n)}`;
}

export const GROUP_SHORT: Record<GroupId, string> = {
  A: 'זוג + תינוק',
  B: 'זוג',
};

export const GROUP_LABEL: Record<GroupId, string> = {
  A: 'קבוצה A – זוג + תינוק',
  B: 'קבוצה B – זוג',
};

export function flightLabel(f: Flight): string {
  const name = [f.airline.trim(), f.flightNo.trim()].filter(Boolean).join(' ');
  return name || 'טיסה (ללא שם)';
}

export function stopsLabel(stops: number | null): string {
  if (stops === null) return '';
  return stops === 0 ? 'ישירה' : stops === 1 ? 'עצירה אחת' : `${stops} עצירות`;
}
