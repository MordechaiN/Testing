import { daysBetween } from './dates';
import type {
  AppState,
  Cruise,
  ExtraKey,
  Flight,
  FlightDirection,
  GroupId,
  Hotel,
  Money,
  Passengers,
  PerPassenger,
  Room,
} from './types';
import { emptyPlan } from './seed';

// ---------- money helpers ----------
// All sums are done in integer cents, so 0.1 + 0.2 style float errors never reach the screen.

/** Empty / invalid input counts as 0. */
export function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

const toCents = (v: unknown): number => Math.round(num(v) * 100);

export function isFilled(v: Money): boolean {
  return typeof v === 'number' && Number.isFinite(v);
}

export function activeGroups(state: AppState): GroupId[] {
  return state.groupBEnabled ? ['A', 'B'] : ['A'];
}

// ---------- flights ----------

export interface FlightCost {
  base: number;
  seats: number;
  baggage: number;
  other: number;
  total: number;
}

function perPassengerCents(price: PerPassenger, pax: Passengers): number {
  return pax.adults * toCents(price.adult) + pax.infants * toCents(price.infant);
}

/** Cost of one flight for ONE group, using that group's passenger counts. */
export function flightCost(flight: Flight, pax: Passengers): FlightCost {
  const base = perPassengerCents(flight.base, pax);
  const seats = perPassengerCents(flight.seat, pax);
  const baggage = perPassengerCents(flight.baggage, pax);
  const other = perPassengerCents(flight.other, pax);
  return {
    base: base / 100,
    seats: seats / 100,
    baggage: baggage / 100,
    other: other / 100,
    total: (base + seats + baggage + other) / 100,
  };
}

/** True when at least one price was entered for the flight. */
export function flightHasPrice(flight: Flight): boolean {
  return [flight.base, flight.seat, flight.baggage, flight.other].some(
    (p) => isFilled(p.adult) || isFilled(p.infant),
  );
}

/** Adult price entered but infant price left empty (infant counted as 0 – worth a check). */
export function infantPriceMissing(flight: Flight): boolean {
  return [flight.base, flight.seat, flight.baggage, flight.other].some(
    (p) => isFilled(p.adult) && !isFilled(p.infant),
  );
}

// ---------- hotels ----------

export function hotelNights(hotel: Hotel): { nights: number; fromDates: boolean } {
  const diff = daysBetween(hotel.checkIn, hotel.checkOut);
  if (diff !== null && diff > 0) return { nights: diff, fromDates: true };
  return { nights: Math.max(0, num(hotel.manualNights)), fromDates: false };
}

export function hotelCost(hotel: Hotel): number {
  const { nights } = hotelNights(hotel);
  const cents =
    Math.round(nights * toCents(hotel.pricePerNight)) +
    toCents(hotel.taxes) +
    toCents(hotel.cityTax) +
    toCents(hotel.breakfast) +
    toCents(hotel.other);
  return cents / 100;
}

export function hotelServesGroup(hotel: Hotel, group: GroupId): boolean {
  return hotel.group === 'both' || hotel.group === group;
}

export function hotelIssues(hotel: Hotel, cruise: Cruise | undefined): string[] {
  const issues: string[] = [];
  const d = daysBetween(hotel.checkIn, hotel.checkOut);
  if (hotel.checkIn && hotel.checkOut && (d === null || d <= 0)) {
    issues.push('תאריך היציאה חייב להיות אחרי תאריך הכניסה');
  }
  if (cruise) {
    const after = daysBetween(cruise.start, hotel.checkOut);
    if (after !== null && after < 0) issues.push('היציאה מהמלון היא אחרי תחילת הקרוז');
  }
  return issues;
}

export function cruiseNights(cruise: Cruise): number | null {
  const d = daysBetween(cruise.start, cruise.end);
  return d !== null && d > 0 ? d : null;
}

export function cruiseDatesValid(cruise: Cruise): boolean {
  return cruiseNights(cruise) !== null;
}

// ---------- plan totals ----------

export interface Breakdown {
  cruise: number;
  flights: number;
  seats: number;
  baggage: number;
  flightExtras: number;
  hotel: number;
  tips: number;
  agentFee: number;
  drinks: number;
  internet: number;
  transport: number;
  other: number;
}

export type MissingKey = 'room' | 'cruisePrice' | 'outFlight' | 'backFlight';
export type NotIncludedKey = 'flights' | 'hotel' | 'tips' | 'agentFee';

export interface PlanResult {
  cruiseId: string;
  group: GroupId;
  room: Room | null;
  breakdown: Breakdown;
  /** Cruise price only. */
  cruiseOnly: number;
  /** Everything except the cruise price. */
  extras: number;
  /** Cruise + everything else. */
  total: number;
  /** Things that make the total unreliable for comparison. */
  missing: MissingKey[];
  /** Things that are simply not part of the total right now. */
  notIncluded: NotIncludedKey[];
}

const EMPTY_BREAKDOWN: Breakdown = {
  cruise: 0,
  flights: 0,
  seats: 0,
  baggage: 0,
  flightExtras: 0,
  hotel: 0,
  tips: 0,
  agentFee: 0,
  drinks: 0,
  internet: 0,
  transport: 0,
  other: 0,
};

function findFlight(state: AppState, id: string | null, cruiseId: string, direction: FlightDirection) {
  if (!id) return null;
  return state.flights.find((f) => f.id === id && f.cruiseId === cruiseId && f.direction === direction) ?? null;
}

/**
 * Total for ONE group on ONE cruise date.
 * Only reads: that group's plan, that group's passengers, that group's rooms,
 * flights/hotels of the same cruise. It never touches the other group's data.
 * `roomId` overrides the selected room (used to price "what if I pick room X").
 */
export function computePlan(
  state: AppState,
  cruiseId: string,
  group: GroupId,
  roomId?: string | null,
): PlanResult {
  const cruise = state.cruises.find((c) => c.id === cruiseId);
  const plan = state.plans[cruiseId]?.[group] ?? emptyPlan();
  const pax = state.passengers[group];

  const chosenRoomId = roomId === undefined ? plan.roomId : roomId;
  const room = cruise?.rooms[group].find((r) => r.id === chosenRoomId) ?? null;

  const out = findFlight(state, plan.outFlightId, cruiseId, 'out');
  const back = findFlight(state, plan.backFlightId, cruiseId, 'back');
  const hotel =
    state.hotels.find(
      (h) => h.id === plan.hotelId && h.cruiseId === cruiseId && hotelServesGroup(h, group),
    ) ?? null;

  const b: Breakdown = { ...EMPTY_BREAKDOWN };
  b.cruise = toCents(room?.price) / 100;

  let flights = 0;
  let seats = 0;
  let baggage = 0;
  let flightExtras = 0;
  for (const f of [out, back]) {
    if (!f) continue;
    const c = flightCost(f, pax);
    flights += Math.round(c.base * 100);
    seats += Math.round(c.seats * 100);
    baggage += Math.round(c.baggage * 100);
    flightExtras += Math.round(c.other * 100);
  }
  b.flights = flights / 100;
  b.seats = seats / 100;
  b.baggage = baggage / 100;
  b.flightExtras = flightExtras / 100;
  b.hotel = hotel ? hotelCost(hotel) : 0;
  for (const key of ['tips', 'agentFee', 'drinks', 'internet', 'transport', 'other'] as ExtraKey[]) {
    b[key] = toCents(plan[key]) / 100;
  }

  const extrasCents = (Object.keys(b) as (keyof Breakdown)[])
    .filter((k) => k !== 'cruise')
    .reduce((sum, k) => sum + Math.round(b[k] * 100), 0);
  const cruiseCents = Math.round(b.cruise * 100);

  const missing: MissingKey[] = [];
  if (!room) missing.push('room');
  else if (!isFilled(room.price)) missing.push('cruisePrice');
  if (!out) missing.push('outFlight');
  if (!back) missing.push('backFlight');

  const notIncluded: NotIncludedKey[] = [];
  if (!out && !back) notIncluded.push('flights');
  if (!hotel) notIncluded.push('hotel');
  if (!isFilled(plan.tips)) notIncluded.push('tips');
  if (!isFilled(plan.agentFee)) notIncluded.push('agentFee');

  return {
    cruiseId,
    group,
    room,
    breakdown: b,
    cruiseOnly: cruiseCents / 100,
    extras: extrasCents / 100,
    total: (cruiseCents + extrasCents) / 100,
    missing,
    notIncluded,
  };
}

/** Cheapest room that actually has a price. An unpriced room is never "cheapest". */
export function cheapestRoom(state: AppState, cruiseId: string, group: GroupId): PlanResult | null {
  const cruise = state.cruises.find((c) => c.id === cruiseId);
  if (!cruise) return null;
  let best: Room | null = null;
  for (const r of cruise.rooms[group]) {
    if (!isFilled(r.price)) continue;
    if (best === null || toCents(r.price) < toCents(best.price)) best = r;
  }
  return best ? computePlan(state, cruiseId, group, best.id) : null;
}

/** Cheapest (cruise date, room) combination for a group, by total trip cost. */
export function cheapestOverall(state: AppState, group: GroupId): PlanResult | null {
  let best: PlanResult | null = null;
  for (const c of state.cruises) {
    const r = cheapestRoom(state, c.id, group);
    if (r && (best === null || r.total < best.total)) best = r;
  }
  return best;
}

/** Selected rooms only. Used for the date-vs-date comparison. */
export function selectedPlans(state: AppState, group: GroupId): PlanResult[] {
  return state.cruises.map((c) => computePlan(state, c.id, group));
}

/** For informational use only: both groups together on one date. null if B is off or a total is unusable. */
export function bothGroupsTotal(state: AppState, cruiseId: string): number | null {
  if (!state.groupBEnabled) return null;
  const a = computePlan(state, cruiseId, 'A');
  const b = computePlan(state, cruiseId, 'B');
  if (a.missing.includes('room') || b.missing.includes('room')) return null;
  return (Math.round(a.total * 100) + Math.round(b.total * 100)) / 100;
}

/** Gap between two totals, always positive. */
export function gap(a: number, b: number): number {
  return Math.abs(Math.round(a * 100) - Math.round(b * 100)) / 100;
}

// ---------- flight ranking ----------

export interface RankedFlight {
  flight: Flight;
  cost: Record<GroupId, FlightCost>;
  cheapest: Record<GroupId, boolean>;
}

/** Flights of one cruise + direction with the cost for each group, cheapest group-cost flagged. */
export function rankFlights(state: AppState, cruiseId: string, direction: FlightDirection): RankedFlight[] {
  const list = state.flights.filter((f) => f.cruiseId === cruiseId && f.direction === direction);
  const rows: RankedFlight[] = list.map((flight) => ({
    flight,
    cost: { A: flightCost(flight, state.passengers.A), B: flightCost(flight, state.passengers.B) },
    cheapest: { A: false, B: false },
  }));
  for (const g of ['A', 'B'] as GroupId[]) {
    const priced = rows.filter((r) => flightHasPrice(r.flight));
    if (priced.length === 0) continue;
    const min = Math.min(...priced.map((r) => Math.round(r.cost[g].total * 100)));
    for (const r of priced) r.cheapest[g] = Math.round(r.cost[g].total * 100) === min;
  }
  return rows.sort((x, y) => x.cost.A.total - y.cost.A.total);
}

// ---------- "what should I do now?" ----------

export interface NextStep {
  text: string;
  screen: 'summary' | 'entry' | 'details';
}

export function nextStep(state: AppState): NextStep | null {
  const groups = activeGroups(state);
  if (state.cruises.length === 0) {
    return { text: 'הוסיפו הצעת קרוז (תאריכים ומחירי חדרים).', screen: 'entry' };
  }
  if (state.flights.length === 0) {
    return { text: 'הוסיפו אפשרויות טיסה – זה הנתון החשוב שחסר.', screen: 'entry' };
  }
  const flightsMissing = state.cruises.some((c) =>
    groups.some((g) => {
      const r = computePlan(state, c.id, g);
      return r.missing.includes('outFlight') || r.missing.includes('backFlight');
    }),
  );
  if (flightsMissing) {
    return { text: 'בחרו טיסת הלוך וחזור לכל קבוצה ותאריך שרוצים להשוות.', screen: 'entry' };
  }
  const roomMissing = state.cruises.some((c) =>
    groups.some((g) => computePlan(state, c.id, g).missing.includes('room')),
  );
  if (roomMissing) {
    return { text: 'בחרו חדר לכל קבוצה ותאריך (בטבלה למטה).', screen: 'summary' };
  }
  const feesMissing = state.cruises.some((c) =>
    groups.some((g) => {
      const r = computePlan(state, c.id, g);
      return r.notIncluded.includes('tips') || r.notIncluded.includes('agentFee');
    }),
  );
  if (feesMissing) {
    return { text: 'הזינו טיפים ועמלת סוכנת (גם אומדן) כדי לקבל מחיר סופי.', screen: 'entry' };
  }
  if (state.terms.some((t) => t.status === 'clarify')) {
    return { text: 'נשארו תנאים שדורשים בירור מול הסוכנת.', screen: 'details' };
  }
  return null;
}
