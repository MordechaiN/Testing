import { ltr, shortDate } from './dates';
import type { Currency, Flight, GroupId, Hotel, Owner, Passengers } from './types';
import { flightCost, hotelNativeCost } from './calc';
import { FARE_CLASS_LABEL } from './fares';

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
  const fareName = f.fareClass ? FARE_CLASS_LABEL[f.fareClass] : '';
  const name = [f.airline.trim(), fareName, f.flightNo.trim()].filter(Boolean).join(' ');
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

/** Price shown next to a flight option: the fare only (seats/baggage are separate lines), or "חסר מחיר". */
export function flightPriceText(f: Flight, pax: Passengers): string {
  const group: GroupId = f.group === 'B' ? 'B' : 'A';
  const c = flightCost(f, pax, group);
  if (!c.fareEntered) return f.fareClass ? 'נדרש אימות מחיר' : 'חסר מחיר';
  return `טיסה ${usd(c.fare)}${c.missingAdultFare.length > 0 ? ' (חלקי)' : ''}`;
}

/** "כן" when every leg is known to be direct, "לא" when any leg has stops, "—" when unknown. */
export function directLabel(f: Flight): string {
  const stops = f.direction === 'round' ? [f.stops, f.returnStops] : [f.stops];
  if (stops.some((x) => x !== null && x > 0)) return 'לא';
  if (stops.every((x) => x === 0)) return 'כן';
  return '—';
}

export function passengersLabel(p: Passengers): string {
  return `${p.adults} מבוגרים${p.infants > 0 ? ` + ${p.infants === 1 ? 'תינוק' : `${p.infants} תינוקות`}` : ''}`;
}

export const CURRENCY_SYMBOL: Record<Currency, string> = { USD: '$', EUR: '€', ILS: '₪' };

/** The hotel total in its own currency, e.g. "€300". */
export function hotelNativeText(h: Hotel): string {
  const symbol = CURRENCY_SYMBOL[h.currency ?? 'USD'];
  return `${symbol}${fmt(hotelNativeCost(h))}`;
}
