import type { FareClass } from './types';

/** What each EL AL fare includes – ONLY as supplied by the user. "?" = not stated, never assumed. */
export interface FareRule {
  id: Exclude<FareClass, ''>;
  label: string;
  personalBag: string;
  trolley: string;
  /** The fare includes a checked bag → a bag is never charged again on top. */
  includesBaggage: boolean;
  baggage: string;
  /** The fare includes a seat → a seat is never charged again on top. */
  includesSeat: boolean;
  seat: string;
  change: string;
  cancellation: string;
  voucher: string;
}

export const FARE_RULES: Record<Exclude<FareClass, ''>, FareRule> = {
  lite: {
    id: 'lite',
    label: 'Lite',
    personalBag: '✓',
    trolley: '✓ (כפי שמוגדר בתעריף)',
    includesBaggage: false,
    baggage: '? לא כלול / לא ידוע',
    includesSeat: false,
    seat: '? לא כלול / לא ידוע',
    change: '✗',
    cancellation: '✗ אין ביטול ואין החזר',
    voucher: '—',
  },
  classic: {
    id: 'classic',
    label: 'Classic',
    personalBag: '✓',
    trolley: '✓',
    includesBaggage: true,
    baggage: '✓ כלולה',
    includesSeat: true,
    seat: 'מושב רגיל כלול',
    change: 'בתשלום',
    cancellation: 'החזר בניכוי דמי ביטול',
    voucher: '✓ שובר זיכוי בביטול',
  },
  flex: {
    id: 'flex',
    label: 'Flex',
    personalBag: '✓',
    trolley: '✓',
    includesBaggage: true,
    baggage: '✓ כלולה',
    includesSeat: true,
    seat: 'כל סוג מושב כלול',
    change: 'חינם',
    cancellation: 'החזר בניכוי דמי ביטול מופחתים',
    voucher: '✓ שובר זיכוי בביטול',
  },
};

export const FARE_ORDER: readonly Exclude<FareClass, ''>[] = ['lite', 'classic', 'flex'];

export const FARE_CLASS_LABEL: Record<FareClass, string> = {
  '': '',
  lite: 'Lite',
  classic: 'Classic',
  flex: 'Flex',
};

export function isFareClass(v: unknown): v is Exclude<FareClass, ''> {
  return v === 'lite' || v === 'classic' || v === 'flex';
}

/** The sentence about what the fare lets you do, built from the rule – nothing added. */
export function fareTermsText(c: Exclude<FareClass, ''>): { change: string; cancel: string; baggage: string } {
  const r = FARE_RULES[c];
  return {
    change: `שינוי: ${r.change}`,
    cancel: `ביטול: ${r.cancellation}${r.voucher.startsWith('✓') ? '; שובר זיכוי בביטול' : ''}`,
    baggage: `תיק אישי: ${r.personalBag}; טרולי: ${r.trolley}; מזוודה: ${r.baggage}; מושב: ${r.seat}`,
  };
}
