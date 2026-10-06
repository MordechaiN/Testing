import { ltr, shortDate } from './dates';
import type { Flight, GroupId, Owner } from './types';

/** 4805 -> "4,805", 1234.5 -> "1,234.50" */
export function fmt(n: number): string {
  const whole = Number.isInteger(n);
  return n.toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** "$4,805" – always USD, no conversion. */
export function usd(n: number): string {
  return n < 0 ? `-$${fmt(-n)}` : `$${fmt(n)}`;
}

/** usd() wrapped for use inside Hebrew sentences. */
export function usdText(n: number): string {
  return ltr(usd(n));
}

export const GROUP_SHORT: Record<GroupId, string> = {
  A: 'זוג + תינוק',
  B: 'זוג',
};

export const GROUP_LABEL: Record<GroupId, string> = {
  A: 'קבוצה A – זוג + תינוק',
  B: 'קבוצה B – זוג',
};

export const OWNER_LABEL: Record<Owner, string> = {
  A: GROUP_LABEL.A,
  B: GROUP_LABEL.B,
  both: 'שתי הקבוצות',
};

export const DIRECTION_LABEL = {
  out: 'הלוך',
  back: 'חזור',
  round: 'הלוך-חזור',
} as const;

export function flightLabel(f: Flight): string {
  const name = [f.airline.trim(), f.flightNo.trim()].filter(Boolean).join(' ');
  return name || 'טיסה (ללא שם)';
}

export function stopsLabel(stops: number | null): string {
  if (stops === null) return '';
  return stops === 0 ? 'ישירה' : stops === 1 ? 'עצירה אחת' : `${stops} עצירות`;
}

/** One line of flight details: "05/09 · 06:10→09:45 · TLV→BCN · ישירה · 4:35". */
export function flightDetails(f: Flight): string {
  const times = f.depTime && f.arrTime ? `${f.depTime}→${f.arrTime}` : f.depTime || f.arrTime;
  const route = f.fromAirport && f.toAirport ? `${f.fromAirport}→${f.toAirport}` : f.fromAirport || f.toAirport;
  const parts = [shortDate(f.date), times, route, stopsLabel(f.stops), f.duration].filter(Boolean);
  return parts.length ? ltr(parts.join(' · ')) : '';
}
