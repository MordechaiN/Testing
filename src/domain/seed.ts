import { addDays } from './dates';
import { FARE_ORDER, FARE_RULES, fareTermsText } from './fares';
import type {
  AppState,
  Cruise,
  ExtraItem,
  Flight,
  FareClass,
  FlightDirection,
  GroupId,
  Hotel,
  HotelPhase,
  ItemCategory,
  Owner,
  Plan,
  Term,
} from './types';

let counter = 0;
/** Short unique id. Counter keeps ids unique within one millisecond. */
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function emptyPlan(): Plan {
  return {
    roomId: null,
    outFlightId: null,
    backFlightId: null,
    hotelId: null,
    noHotel: false,
    hotelAfterId: null,
    noHotelAfter: false,
    tips: null,
    tipsMode: 'group',
    tipsPeople: null,
    agentFee: null,
    drinks: null,
    internet: null,
  };
}

export function emptyFlight(cruiseId: string, group: Owner, direction: FlightDirection): Flight {
  return {
    id: uid('f'),
    cruiseId,
    group,
    direction,
    airline: '',
    flightNo: '',
    date: '',
    depTime: '',
    arrTime: '',
    fromAirport: '',
    toAirport: '',
    stops: null,
    duration: '',
    returnFlightNo: '',
    returnDate: '',
    returnDepTime: '',
    returnArrTime: '',
    returnStops: null,
    returnDuration: '',
    baggageInfo: '',
    fareType: '',
    fare: {},
    seat: {},
    baggage: {},
    cartTotal: null,
    fareOut: null,
    fareBack: null,
    changeTerms: '',
    cancelTerms: '',
    source: '',
    sourceUrl: '',
    checkedAt: '',
    verified: true,
    benchmark: false,
    notes: '',
    fareClass: '',
    searchedFor: '',
    displayedOut: null,
    displayedBack: null,
    adultFare: null,
    carrierSurcharge: null,
    adultTaxes: null,
    babyFare: null,
    babyTaxes: null,
    priceMode: 'unverified',
    verifiedTotal: { all: null, A: null, B: null },
    extraSeat: { A: null, B: null },
    extraBaggage: { A: null, B: null },
    history: [],
  };
}

export function emptyHotel(cruiseId: string, owner: Owner, phase: HotelPhase = 'before'): Hotel {
  return {
    id: uid('h'),
    cruiseId,
    owner,
    phase,
    address: '',
    currency: 'USD',
    split: 'half',
    shareA: null,
    name: '',
    checkIn: '',
    checkOut: '',
    manualNights: null,
    pricePerNight: null,
    taxes: null,
    cityTax: null,
    breakfast: null,
    resortFee: null,
    other: null,
    usdTotal: null,
    url: '',
    source: '',
    checkedAt: '',
    notes: '',
  };
}

export function emptyItem(cruiseId: string, category: ItemCategory, owner: Owner): ExtraItem {
  return { id: uid('i'), cruiseId, category, name: '', amount: null, owner, note: '' };
}

export function plansFor(): Record<GroupId, Plan> {
  return { A: emptyPlan(), B: emptyPlan() };
}

function room(id: string, name: string, price: number) {
  return { id, name, price };
}

/** The 12 prices received from the agent – exactly as quoted. Everything else starts empty. */
function initialCruises(): Cruise[] {
  return [
    {
      id: 'c1',
      start: '2027-09-05',
      end: '2027-09-12',
      rooms: {
        A: [
          room('c1-A1', 'מרפסת פנימי', 4805),
          room('c1-A2', 'מרפסת לסנטרל פארק', 5280),
          room('c1-A3', 'מרפסת פונה לים (עם יציאה)', 5880),
        ],
        B: [
          room('c1-B1', 'פנימי (בחירת האונייה)', 3775),
          room('c1-B2', 'פונה לסנטרל פארק', 5140),
          room('c1-B3', 'פונה לים', 4780),
        ],
      },
    },
    {
      id: 'c2',
      start: '2027-09-19',
      end: '2027-09-26',
      rooms: {
        A: [
          room('c2-A1', 'מרפסת פנימי', 5825),
          room('c2-A2', 'מרפסת לסנטרל פארק', 5085),
          room('c2-A3', 'מרפסת לים (עם יציאה למרפסת)', 5505),
        ],
        B: [
          room('c2-B1', 'פנימי (בחירת האונייה)', 3935),
          room('c2-B2', 'פונה לסנטרל פארק', 4920),
          room('c2-B3', 'פונה לים', 6020),
        ],
      },
    },
  ];
}

export function initialTerms(): Term[] {
  return [
    {
      id: 't-deposit',
      topic: 'מקדמה',
      said: '$170 לאדם / $200 לחדר / $540 לזוג רגיל',
      status: 'clarify',
      note: 'הנתונים סותרים ($170 × 2 = $340, לא $540). לא נבחר מספר – יש לברר עם הסוכנת.',
    },
    {
      id: 't-cancel',
      topic: 'ביטול',
      said: 'אפשר לבטל עד 90 יום לפני המועד ואז הלכה המקדמה',
      status: 'clarify',
      note: 'התקבל בעל-פה מהסוכנת. נדרש אישור בכתב.',
    },
    {
      id: 't-fee',
      topic: 'עמלת סוכן',
      said: 'לא נלקחה עמלה, אבל כנראה תהיה עלות נוספת',
      status: 'clarify',
      note: 'הסכום לא ידוע. יש לברר ולהזין בטופס.',
    },
    { id: 't-tax', topic: 'מיסים', said: 'כלולים במחיר', status: 'ok', note: '' },
    {
      id: 't-tips',
      topic: 'טיפים לצוות (Crew tips)',
      said: 'לא כלולים',
      status: 'missing',
      note: 'יש לברר את הסכום ולהזין בטופס.',
    },
    {
      id: 't-drinks',
      topic: 'חבילת משקאות',
      said: 'לא כלולה',
      status: 'info',
      note: 'אופציונלי – מזינים רק אם קונים.',
    },
    {
      id: 't-internet',
      topic: 'אינטרנט',
      said: 'לא כלול',
      status: 'info',
      note: 'אופציונלי – מזינים רק אם קונים.',
    },
    {
      id: 't-flights',
      topic: 'טיסות',
      said: 'עדיין לא נבדקו',
      status: 'missing',
      note: 'יש להוסיף אפשרויות טיסה במסך "הזנת נתונים".',
    },
  ];
}

/** Base state: the 12 agent prices and the agent's terms. Nothing else. */
export function initialState(): AppState {
  const cruises = initialCruises();
  const plans: AppState['plans'] = {};
  for (const c of cruises) plans[c.id] = plansFor();
  return {
    version: 4,
    groupBEnabled: true,
    passengers: {
      A: { adults: 2, infants: 1 },
      B: { adults: 2, infants: 0 },
    },
    cruises,
    flights: [],
    hotels: [],
    items: [],
    plans,
    favorite: { A: null, B: null },
    deposit: { A: null, B: null },
    terms: initialTerms(),
    notes: '',
    seeds: { elAlBenchmark: false, elAlFares: false },
  };
}

// ---------- the EL AL cart found by the user (benchmark) ----------

const BENCHMARK_CHECKED = '2026-10-06';

const BENCHMARK_BREAKDOWN =
  'פירוט מהעגלה: מבוגר – Fare $229 + Carrier surcharge $120 + Taxes/fees $69.88 = $418.88; תינוק – Fare $46 + Taxes/fees $32.20 = $78.20. ' +
  'הלוך Lite (N) $514.26 + חזור Lite (U) $401.70 = $915.96 (Round Trip אחד – לא לסכם פעמיים).';

/** Round trip, 2 adults + infant, exactly as the EL AL cart showed it. Group A = couple + infant. */
export function elAlBenchmarkA(): Flight {
  return {
    ...emptyFlight('c1', 'A', 'round'),
    id: 'bench-elal-A',
    airline: 'EL AL',
    flightNo: '',
    date: '2027-09-03',
    depTime: '14:25',
    arrTime: '18:05',
    fromAirport: 'TLV',
    toAirport: 'BCN',
    stops: 0,
    duration: '4:40',
    returnFlightNo: '',
    returnDate: '2027-09-14',
    returnDepTime: '',
    returnArrTime: '',
    returnStops: 0,
    returnDuration: '',
    baggageInfo: '',
    fareType: 'Lite (N) הלוך / Lite (U) חזור',
    fare: { 'adult-1': 418.88, 'adult-2': 418.88, 'infant-1': 78.2 },
    cartTotal: 915.96,
    fareOut: 514.26,
    fareBack: 401.7,
    source: 'עגלת EL AL (הוזן על ידי המשתמש)',
    checkedAt: BENCHMARK_CHECKED,
    verified: true,
    benchmark: true,
    notes: `${BENCHMARK_BREAKDOWN} לא הוזנו: מספרי טיסה, שעות חזור, כבודה, מושבים, תנאי שינוי וביטול.`,
  };
}

/**
 * Same flight for group B (2 adults). The cart was for 2 adults + infant, so this price is DERIVED from the
 * per-adult breakdown ($418.88 × 2) and is not a cart total – marked as not verified.
 */
export function elAlBenchmarkB(): Flight {
  return {
    ...elAlBenchmarkA(),
    id: 'bench-elal-B',
    group: 'B',
    fare: { 'adult-1': 418.88, 'adult-2': 418.88 },
    cartTotal: null,
    fareOut: null,
    fareBack: null,
    source: 'נגזר מפירוט הנוסעים בעגלת EL AL – לא עגלה נפרדת לשני מבוגרים',
    verified: false,
    notes: `מחיר נגזר ($418.88 × 2 = $837.76), לא אומת בעגלה לשני מבוגרים בלבד. ${BENCHMARK_BREAKDOWN}`,
  };
}

// ---------- the six EL AL fares checked by the user (4 adults + 1 baby) ----------

interface FareSource {
  cruiseId: 'c1' | 'c2';
  fareClass: Exclude<FareClass, ''>;
  displayedOut: number;
  displayedBack: number;
  adultFare: number;
  babyFare: number;
}

/** Exactly as supplied. Carrier surcharge 120, adult taxes 69.88 and baby taxes 32.20 are the same in all six. */
const FARE_SOURCES: FareSource[] = [
  { cruiseId: 'c1', fareClass: 'lite', displayedOut: 262, displayedBack: 178, adultFare: 249, babyFare: 50 },
  { cruiseId: 'c2', fareClass: 'lite', displayedOut: 192, displayedBack: 178, adultFare: 369, babyFare: 74 },
  { cruiseId: 'c1', fareClass: 'classic', displayedOut: 322, displayedBack: 238, adultFare: 369, babyFare: 74 },
  { cruiseId: 'c2', fareClass: 'classic', displayedOut: 252, displayedBack: 238, adultFare: 299, babyFare: 60 },
  { cruiseId: 'c1', fareClass: 'flex', displayedOut: 372, displayedBack: 288, adultFare: 469, babyFare: 94 },
  { cruiseId: 'c2', fareClass: 'flex', displayedOut: 302, displayedBack: 288, adultFare: 399, babyFare: 80 },
];

export const ELAL_SEARCH = '4 מבוגרים + תינוק (A: 2 מבוגרים + תינוק, B: 2 מבוגרים)';

export function elAlFareId(cruiseId: string, fareClass: string): string {
  return `elal-${cruiseId}-${fareClass}`;
}

/** One round-trip fare record, shared by both groups. Nothing that was not supplied is filled in. */
function elAlFare(src: FareSource): Flight {
  const c1 = src.cruiseId === 'c1';
  const terms = fareTermsText(src.fareClass);
  return {
    ...emptyFlight(src.cruiseId, 'both', 'round'),
    id: elAlFareId(src.cruiseId, src.fareClass),
    airline: 'EL AL',
    date: c1 ? '2027-09-03' : '2027-09-17',
    depTime: c1 ? '14:25' : '14:10',
    // 18:05 was supplied for the 03/09 flight only; the other arrival time was not supplied.
    arrTime: c1 ? '18:05' : '',
    fromAirport: 'TLV',
    toAirport: 'BCN',
    stops: 0,
    returnDate: c1 ? '2027-09-13' : '2027-09-27',
    returnDepTime: '22:35',
    returnStops: 0,
    fareType: FARE_RULES[src.fareClass].label,
    fareClass: src.fareClass,
    searchedFor: ELAL_SEARCH,
    displayedOut: src.displayedOut,
    displayedBack: src.displayedBack,
    adultFare: src.adultFare,
    carrierSurcharge: 120,
    adultTaxes: 69.88,
    babyFare: src.babyFare,
    babyTaxes: 32.2,
    priceMode: 'unverified',
    baggageInfo: FARE_RULES[src.fareClass].baggage,
    changeTerms: terms.change,
    cancelTerms: terms.cancel,
    source: 'EL AL (נבדק על ידי המשתמש)',
    notes:
      'הנתונים הוזנו כפי שנמסרו. לא הוזנו: מספרי טיסה, תאריך הבדיקה' +
      (c1 ? ', שעת נחיתה בחזור.' : ', שעות נחיתה.'),
  };
}

export function elAlFares(): Flight[] {
  return FARE_ORDER.flatMap((cls) => FARE_SOURCES.filter((s) => s.fareClass === cls).map(elAlFare));
}

/**
 * Adds the user's data once: the EL AL cart (round 2) and the six EL AL fares (round 3).
 * If the user deletes them later they are not added again.
 */
export function applySeeds(state: AppState): AppState {
  let next = state;
  if (!next.seeds.elAlBenchmark) {
    const cruise = next.cruises.find((c) => c.id === 'c1');
    next = { ...next, seeds: { ...next.seeds, elAlBenchmark: true } };
    if (cruise && cruise.start === '2027-09-05' && !state.flights.some((f) => f.id.startsWith('bench-elal'))) {
      const planA = state.plans.c1?.A;
      next = {
        ...next,
        flights: [...next.flights, elAlBenchmarkA(), elAlBenchmarkB()],
        plans:
          planA && !planA.outFlightId
            ? { ...next.plans, c1: { ...next.plans.c1!, A: { ...planA, outFlightId: 'bench-elal-A' } } }
            : next.plans,
      };
    }
  }
  if (!next.seeds.elAlFares) {
    const known = new Set(next.flights.map((f) => f.id));
    const cruiseOk = (id: string, start: string) => next.cruises.some((c) => c.id === id && c.start === start);
    const add = elAlFares().filter(
      (f) =>
        !known.has(f.id) && cruiseOk(f.cruiseId, f.cruiseId === 'c1' ? '2027-09-05' : '2027-09-19'),
    );
    next = { ...next, flights: [...next.flights, ...add], seeds: { ...next.seeds, elAlFares: true } };
  }
  return next;
}

/** What a new user (or a reset) starts with: base data + the EL AL cart. */
export function freshState(): AppState {
  return applySeeds(initialState());
}

/**
 * A new hotel for a cruise date, with the planned dates pre-filled (2 nights before / after the cruise).
 * These are plan dates the user can change – no price is ever pre-filled.
 */
export function newHotelFor(
  cruise: Cruise | undefined,
  owner: Owner,
  phase: HotelPhase,
  /** Dates derived from the selected flight (see plannedStay) – used instead of the 2-night default. */
  stay?: { checkIn: string; checkOut: string } | null,
): Hotel {
  const h = emptyHotel(cruise?.id ?? '', owner, phase);
  if (!cruise) return h;
  if (stay) return { ...h, checkIn: stay.checkIn, checkOut: stay.checkOut };
  if (phase === 'before') {
    const from = addDays(cruise.start, -2);
    if (from) return { ...h, checkIn: from, checkOut: cruise.start };
  } else {
    const to = addDays(cruise.end, 2);
    if (to) return { ...h, checkIn: cruise.end, checkOut: to };
  }
  return h;
}
