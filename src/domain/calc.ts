import { daysBetween, dateName } from './dates';
import { emptyPlan } from './seed';
import type {
  AppState,
  Cruise,
  ExtraItem,
  Flight,
  GroupId,
  Hotel,
  ItemCategory,
  Owner,
  PassengerSlot,
  Passengers,
  PersonPrices,
  Plan,
  Room,
} from './types';

// ---------- money helpers ----------
// All sums are done in integer cents, so 0.1 + 0.2 style float errors never reach the screen.

/** Empty / invalid input counts as 0. */
export function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export const toCents = (v: unknown): number => Math.round(num(v) * 100);
const fromCents = (c: number): number => c / 100;

/** True when the user actually typed a number (0 included). */
export function isFilled(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function activeGroups(state: AppState): GroupId[] {
  return state.groupBEnabled ? ['A', 'B'] : ['A'];
}

export function groupSize(p: Passengers): number {
  return Math.max(0, p.adults) + Math.max(0, p.infants);
}

/** "מבוגר 1", "מבוגר 2", "תינוק" – one slot per traveller of the group. */
export function passengerSlots(p: Passengers): PassengerSlot[] {
  const slots: PassengerSlot[] = [];
  const adults = Math.max(0, Math.floor(num(p.adults)));
  const infants = Math.max(0, Math.floor(num(p.infants)));
  for (let i = 1; i <= adults; i++) slots.push({ id: `adult-${i}`, kind: 'adult', label: `מבוגר ${i}` });
  for (let i = 1; i <= infants; i++) {
    slots.push({ id: `infant-${i}`, kind: 'infant', label: infants === 1 ? 'תינוק' : `תינוק ${i}` });
  }
  return slots;
}

/** Split a shared amount (in cents) so the two parts always add up exactly. */
export function halfShare(cents: number, group: GroupId): number {
  const a = Math.round(cents / 2);
  return group === 'A' ? a : cents - a;
}

function ownerShareCents(owner: Owner, cents: number, group: GroupId): number | null {
  if (owner === group) return cents;
  if (owner === 'both') return halfShare(cents, group);
  return null; // not this group's cost
}

// ---------- flights ----------

export interface FlightCost {
  fare: number;
  seats: number;
  baggage: number;
  total: number;
  /** Something was typed in the row (any passenger). */
  fareEntered: boolean;
  seatsEntered: boolean;
  baggageEntered: boolean;
  /** Adults whose fare is empty (counted as 0 – needs a check). */
  missingAdultFare: string[];
  /** Infants without a fare – they are NOT charged. */
  infantNotCharged: string[];
  /** The fare is the airline cart total (cartTotal), not the sum of the per-person prices. */
  usesCartTotal: boolean;
  /** Per-person prices were typed too, but add up to something else than the cart total. */
  cartMismatch: boolean;
}

function rowCents(prices: PersonPrices, slots: PassengerSlot[]): { cents: number; entered: boolean } {
  let cents = 0;
  let entered = false;
  for (const s of slots) {
    const v = prices[s.id];
    if (isFilled(v)) entered = true;
    cents += toCents(v);
  }
  return { cents, entered };
}

/** Cost of one flight option for the passengers of a group. Empty = 0, infants pay only if a price was typed. */
export function flightCost(flight: Flight, pax: Passengers): FlightCost {
  const slots = passengerSlots(pax);
  const fare = rowCents(flight.fare ?? {}, slots);
  const seats = rowCents(flight.seat ?? {}, slots);
  const baggage = rowCents(flight.baggage ?? {}, slots);
  // The fare counts as entered once an adult price was typed (an infant-only "$0" is not a flight price).
  const adults = slots.filter((s) => s.kind === 'adult');
  const perPersonEntered = adults.length > 0 ? adults.some((s) => isFilled(flight.fare?.[s.id])) : fare.entered;
  // The airline cart total, when typed, is the truth for the whole ticket – never recalculated from the details.
  const usesCartTotal = isFilled(flight.cartTotal);
  const fareCents = usesCartTotal ? toCents(flight.cartTotal) : fare.cents;
  return {
    fare: fromCents(fareCents),
    seats: fromCents(seats.cents),
    baggage: fromCents(baggage.cents),
    total: fromCents(fareCents + seats.cents + baggage.cents),
    fareEntered: usesCartTotal || perPersonEntered,
    seatsEntered: seats.entered,
    baggageEntered: baggage.entered,
    missingAdultFare: usesCartTotal
      ? []
      : slots.filter((s) => s.kind === 'adult' && !isFilled(flight.fare?.[s.id])).map((s) => s.label),
    infantNotCharged: usesCartTotal
      ? []
      : slots.filter((s) => s.kind === 'infant' && !isFilled(flight.fare?.[s.id])).map((s) => s.label),
    usesCartTotal,
    cartMismatch: usesCartTotal && perPersonEntered && Math.abs(fare.cents - fareCents) > 1,
  };
}

export function flightHasPrice(flight: Flight): boolean {
  return isFilled(flight.cartTotal) || [flight.fare, flight.seat, flight.baggage].some((row) => Object.values(row ?? {}).some(isFilled));
}

/** Outbound slot accepts one-way outbound or round-trip tickets; return slot accepts one-way return. */
export function flightFitsSlot(flight: Flight, slot: 'out' | 'back'): boolean {
  return slot === 'out' ? flight.direction === 'out' || flight.direction === 'round' : flight.direction === 'back';
}

export function flightsFor(state: AppState, cruiseId: string, group: GroupId, slot: 'out' | 'back'): Flight[] {
  return state.flights.filter((f) => f.cruiseId === cruiseId && f.group === group && flightFitsSlot(f, slot));
}

export interface Itinerary {
  legs: Flight[];
  fare: number;
  seats: number;
  baggage: number;
  total: number;
  /** Only one direction is known so far. */
  oneWayOnly: boolean;
}

/** A flight option is "priced" when every adult fare was typed. */
export function flightFullyPriced(flight: Flight, pax: Passengers): boolean {
  const c = flightCost(flight, pax);
  return c.fareEntered && c.missingAdultFare.length === 0;
}

/**
 * Cheapest complete trip for a group on a date: a round-trip ticket, or the cheapest
 * one-way outbound + one-way return pair – compared on the full cost (fare + seats + baggage).
 * Options with missing adult fares are ignored, so a half-filled option never looks cheapest.
 */
export function cheapestItinerary(state: AppState, cruiseId: string, group: GroupId): Itinerary | null {
  const pax = state.passengers[group];
  const priced = state.flights.filter((f) => f.cruiseId === cruiseId && f.group === group && flightFullyPriced(f, pax));
  const make = (legs: Flight[], oneWayOnly: boolean): Itinerary => {
    const costs = legs.map((f) => flightCost(f, pax));
    const sum = (k: 'fare' | 'seats' | 'baggage') => fromCents(costs.reduce((t, c) => t + toCents(c[k]), 0));
    return {
      legs,
      fare: sum('fare'),
      seats: sum('seats'),
      baggage: sum('baggage'),
      total: fromCents(costs.reduce((t, c) => t + toCents(c.total), 0)),
      oneWayOnly,
    };
  };
  const cheapest = (list: Flight[]) =>
    list.reduce<Flight | null>((best, f) => (best === null || flightCost(f, pax).total < flightCost(best, pax).total ? f : best), null);

  const candidates: Itinerary[] = priced.filter((f) => f.direction === 'round').map((f) => make([f], false));
  const out = cheapest(priced.filter((f) => f.direction === 'out'));
  const back = cheapest(priced.filter((f) => f.direction === 'back'));
  if (out && back) candidates.push(make([out, back], false));
  if (candidates.length > 0) return candidates.reduce((best, c) => (toCents(c.total) < toCents(best.total) ? c : best));
  if (out || back) return make([(out ?? back)!], true);
  return null;
}

// ---------- hotels ----------

export function hotelNights(hotel: Hotel): { nights: number; fromDates: boolean } {
  const diff = daysBetween(hotel.checkIn, hotel.checkOut);
  if (diff !== null && diff > 0) return { nights: diff, fromDates: true };
  return { nights: Math.max(0, Math.floor(num(hotel.manualNights))), fromDates: false };
}

/** Total of the stay in the hotel's OWN currency (what the hotel shows). */
export function hotelTotalCents(hotel: Hotel): number {
  const { nights } = hotelNights(hotel);
  return (
    nights * toCents(hotel.pricePerNight) +
    toCents(hotel.taxes) +
    toCents(hotel.cityTax) +
    toCents(hotel.breakfast) +
    toCents(hotel.resortFee) +
    toCents(hotel.other)
  );
}

/** Total in the hotel's own currency, e.g. €300. */
export function hotelNativeCost(hotel: Hotel): number {
  return fromCents(hotelTotalCents(hotel));
}

/**
 * Total in USD, in cents. USD hotels: the total itself. Other currencies: ONLY the USD amount the user typed
 * after converting by hand – no exchange rate is ever invented. null = conversion still missing.
 */
export function hotelUsdCents(hotel: Hotel): number | null {
  if (!hotel.currency || hotel.currency === 'USD') return hotelTotalCents(hotel);
  return isFilled(hotel.usdTotal) ? toCents(hotel.usdTotal) : null;
}

/** USD total of the stay (0 while a conversion is missing – check hotelNeedsConversion). */
export function hotelCost(hotel: Hotel): number {
  return fromCents(hotelUsdCents(hotel) ?? 0);
}

export function hotelNeedsConversion(hotel: Hotel): boolean {
  return !!hotel.currency && hotel.currency !== 'USD' && !isFilled(hotel.usdTotal) && hotelHasPrice(hotel);
}

/** At least one price field of the hotel was typed. */
export function hotelHasPrice(hotel: Hotel): boolean {
  return [hotel.pricePerNight, hotel.taxes, hotel.cityTax, hotel.breakfast, hotel.resortFee, hotel.other].some(isFilled);
}

export function hotelServesGroup(hotel: Hotel, group: GroupId): boolean {
  return hotel.owner === 'both' || hotel.owner === group;
}

export interface HotelShare {
  amount: number;
  /** Problem that makes this share unreliable (shown in red). */
  problem: string | null;
}

/** What ONE group pays for a hotel. Shared hotels are split 50/50 or by the amount entered for group A. */
export function hotelShare(hotel: Hotel, group: GroupId): HotelShare {
  const usd = hotelUsdCents(hotel);
  if (usd === null) {
    // The hotel price is in another currency and has not been converted yet.
    return { amount: 0, problem: null };
  }
  const total = usd;
  if (hotel.owner !== 'both') {
    return { amount: hotel.owner === group ? fromCents(total) : 0, problem: null };
  }
  if (hotel.split !== 'custom') return { amount: fromCents(halfShare(total, group)), problem: null };
  if (!isFilled(hotel.shareA)) return { amount: 0, problem: 'לא הוזן כמה מהמלון המשותף שייך לקבוצה A' };
  const a = toCents(hotel.shareA);
  if (a < 0 || a > total) return { amount: 0, problem: 'החלוקה של המלון המשותף לא מסתדרת עם הסכום הכולל' };
  return { amount: fromCents(group === 'A' ? a : total - a), problem: null };
}

export function hotelIssues(hotel: Hotel, cruise: Cruise | undefined): string[] {
  const issues: string[] = [];
  const d = daysBetween(hotel.checkIn, hotel.checkOut);
  if (hotel.checkIn && hotel.checkOut && (d === null || d <= 0)) {
    issues.push('תאריך היציאה חייב להיות אחרי תאריך הכניסה');
  }
  if (cruise && hotel.phase !== 'after') {
    const after = daysBetween(cruise.start, hotel.checkOut);
    if (after !== null && after > 0) issues.push('היציאה מהמלון היא אחרי תחילת הקרוז');
  }
  if (cruise && hotel.phase === 'after') {
    const before = daysBetween(cruise.end, hotel.checkIn);
    if (before !== null && before < 0) issues.push('הכניסה למלון היא לפני סוף הקרוז');
  }
  return issues;
}

// ---------- cruise ----------

export function cruiseNights(cruise: Cruise): number | null {
  const d = daysBetween(cruise.start, cruise.end);
  return d !== null && d > 0 ? d : null;
}

export function cruiseDatesValid(cruise: Cruise): boolean {
  return cruiseNights(cruise) !== null;
}

// ---------- extra items (transport / other) ----------

export function itemShare(item: ExtraItem, group: GroupId): number | null {
  const c = ownerShareCents(item.owner, toCents(item.amount), group);
  return c === null ? null : fromCents(c);
}

function itemsLine(state: AppState, cruiseId: string, group: GroupId, category: ItemCategory): Line {
  let cents = 0;
  let entered = false;
  for (const item of state.items) {
    if (item.cruiseId !== cruiseId || item.category !== category) continue;
    const share = ownerShareCents(item.owner, toCents(item.amount), group);
    if (share === null) continue;
    if (isFilled(item.amount)) entered = true;
    cents += share;
  }
  return { amount: fromCents(cents), entered };
}

// ---------- plan totals ----------

export const LINE_KEYS = [
  'cruise',
  'flights',
  'seats',
  'baggage',
  'hotel',
  'hotelAfter',
  'tips',
  'agentFee',
  'drinks',
  'internet',
  'transport',
  'other',
] as const;
export type LineKey = (typeof LINE_KEYS)[number];

export const LINE_LABEL: Record<LineKey, string> = {
  cruise: 'קרוז',
  flights: 'טיסות',
  seats: 'מושבים',
  baggage: 'מזוודות',
  hotel: 'מלון בברצלונה לפני הקרוז',
  hotelAfter: 'מלון בברצלונה אחרי הקרוז',
  tips: 'טיפים לצוות',
  agentFee: 'עמלת סוכן',
  drinks: 'משקאות',
  internet: 'אינטרנט',
  transport: 'תחבורה',
  other: 'אחרות',
};

export interface Line {
  amount: number;
  /** false = nothing typed yet → show "טרם הוזן", never "$0". */
  entered: boolean;
  /** Replaces the amount in the UI, e.g. "לא צריך" for a group that needs no hotel. */
  label?: string;
}
export type Lines = Record<LineKey, Line>;

export type Severity = 'red' | 'yellow' | 'blue';

export type NoticeCode =
  | 'dates'
  | 'room'
  | 'roomPrice'
  | 'flight'
  | 'fare'
  | 'infantFare'
  | 'hotelUndecided'
  | 'hotelPrice'
  | 'hotelDates'
  | 'hotelSplit'
  | 'hotelCurrency'
  | 'hotelAfterUndecided'
  | 'unverifiedFlight'
  | 'fareMismatch'
  | 'sharedHotel'
  | 'sharedItems'
  | 'tips'
  | 'fee';

export interface Notice {
  code: NoticeCode;
  severity: Severity;
  text: string;
}

export function hasNotice(r: PlanResult, code: NoticeCode): boolean {
  return r.notices.some((n) => n.code === code);
}

export type PlanStatus = 'red' | 'yellow' | 'green';

export interface PlanResult {
  cruiseId: string;
  group: GroupId;
  room: Room | null;
  out: Flight | null;
  /** null also when the outbound flight is a round-trip ticket. */
  back: Flight | null;
  roundTrip: boolean;
  hotel: Hotel | null;
  hotelAfter: Hotel | null;
  lines: Lines;
  cruiseOnly: number;
  /** Everything except the cruise price. */
  extras: number;
  total: number;
  notices: Notice[];
  status: PlanStatus;
}

function findFlight(state: AppState, id: string | null, cruiseId: string, group: GroupId, slot: 'out' | 'back') {
  if (!id) return null;
  return (
    state.flights.find(
      (f) => f.id === id && f.cruiseId === cruiseId && f.group === group && flightFitsSlot(f, slot),
    ) ?? null
  );
}

export function tipsAmountCents(plan: Plan, pax: Passengers): number {
  if (!isFilled(plan.tips)) return 0;
  if (plan.tipsMode !== 'person') return toCents(plan.tips);
  return toCents(plan.tips) * tipsPeople(plan, pax);
}

export function tipsPeople(plan: Plan, pax: Passengers): number {
  return isFilled(plan.tipsPeople) ? Math.max(0, Math.floor(plan.tipsPeople)) : Math.max(0, pax.adults);
}

/**
 * Total for ONE group on ONE cruise date.
 * Reads only: that group's plan, passengers, rooms, flights, and the hotel/items of the same date
 * (shared costs are split). It never reads the other group's choices.
 * `roomId` overrides the selected room (used to price "what if I pick room X").
 */
export function computePlan(state: AppState, cruiseId: string, group: GroupId, roomId?: string | null): PlanResult {
  const cruise = state.cruises.find((c) => c.id === cruiseId);
  const plan: Plan = { ...emptyPlan(), ...(state.plans[cruiseId]?.[group] ?? {}) };
  const pax = state.passengers[group];
  const notices: Notice[] = [];

  const chosenRoomId = roomId === undefined ? plan.roomId : roomId;
  const room = cruise?.rooms[group].find((r) => r.id === chosenRoomId) ?? null;

  const out = findFlight(state, plan.outFlightId, cruiseId, group, 'out');
  const roundTrip = out?.direction === 'round';
  const back = roundTrip ? null : findFlight(state, plan.backFlightId, cruiseId, group, 'back');
  const findHotel = (id: string | null, phase: Hotel['phase']) =>
    state.hotels.find(
      (h) => h.id === id && h.cruiseId === cruiseId && hotelServesGroup(h, group) && (h.phase ?? 'before') === phase,
    ) ?? null;
  const hotel = findHotel(plan.hotelId, 'before');
  const hotelAfter = findHotel(plan.hotelAfterId, 'after');

  const lines = {} as Lines;

  // Cruise
  lines.cruise = { amount: fromCents(toCents(room?.price)), entered: !!room && isFilled(room.price) };
  if (cruise && !cruiseDatesValid(cruise)) notices.push({ code: 'dates', severity: 'red', text: 'תאריכי ההפלגה לא תקינים' });
  if (!room) notices.push({ code: 'room', severity: 'red', text: 'חסר חדר' });
  else if (!isFilled(room.price)) notices.push({ code: 'roomPrice', severity: 'red', text: 'לחדר שנבחר אין מחיר' });

  // Flights, seats, baggage
  let fare = 0;
  let seats = 0;
  let baggage = 0;
  let fareEntered = false;
  let seatsEntered = false;
  let baggageEntered = false;
  const legs: { flight: Flight; name: string }[] = [];
  if (out) legs.push({ flight: out, name: roundTrip ? 'הלוך-חזור' : 'הלוך' });
  if (back) legs.push({ flight: back, name: 'חזור' });
  for (const { flight, name } of legs) {
    const c = flightCost(flight, pax);
    fare += toCents(c.fare);
    seats += toCents(c.seats);
    baggage += toCents(c.baggage);
    fareEntered ||= c.fareEntered;
    seatsEntered ||= c.seatsEntered;
    baggageEntered ||= c.baggageEntered;
    if (c.missingAdultFare.length > 0) {
      notices.push({ code: 'fare', severity: 'yellow', text: `חסר מחיר טיסה (${name}): ${c.missingAdultFare.join(', ')}` });
    }
    if (!flight.verified) {
      notices.push({
        code: 'unverifiedFlight',
        severity: 'yellow',
        text: `מחיר הטיסה (${name}) לא מאומת – לא להתייחס אליו כהצעה ודאית`,
      });
    }
    if (c.cartMismatch) {
      notices.push({
        code: 'fareMismatch',
        severity: 'blue',
        text: `בטיסה (${name}) סכום הנוסעים שונה מסה״כ העגלה – נספר סה״כ העגלה`,
      });
    }
    if (c.infantNotCharged.length > 0) {
      notices.push({
        code: 'infantFare',
        severity: 'blue',
        text: `${c.infantNotCharged.join(', ')}: לא הוזן מחיר טיסה (${name}) – לא חויב`,
      });
    }
  }
  if (!out && !back) notices.push({ code: 'flight', severity: 'yellow', text: 'חסרה טיסה' });
  else if (!out) notices.push({ code: 'flight', severity: 'yellow', text: 'חסרה טיסת הלוך' });
  else if (!roundTrip && !back) notices.push({ code: 'flight', severity: 'yellow', text: 'חסרה טיסת חזור' });

  // A selected flight without any typed fare is still "not entered", never "$0".
  lines.flights = { amount: fromCents(fare), entered: fareEntered };
  lines.seats = { amount: fromCents(seats), entered: seatsEntered };
  lines.baggage = { amount: fromCents(baggage), entered: baggageEntered };

  // Hotel before the cruise
  lines.hotel = hotelLine(hotel, plan.noHotel, 'before');
  // Hotel after the cruise
  lines.hotelAfter = hotelLine(hotelAfter, plan.noHotelAfter, 'after');

  function hotelLine(h: Hotel | null, noHotel: boolean, phase: Hotel['phase']): Line {
    const isAfter = phase === 'after';
    const where = isAfter ? 'אחרי הקרוז' : 'לפני הקרוז';
    if (h) {
      const share = hotelShare(h, group);
      const priced = hotelHasPrice(h);
      const { nights } = hotelNights(h);
      const missingNights = isFilled(h.pricePerNight) && nights === 0;
      const needsConversion = hotelNeedsConversion(h);
      if (!priced) {
        notices.push({ code: 'hotelPrice', severity: 'yellow', text: `למלון שנבחר (${where}) אין עדיין מחיר` });
      }
      if (missingNights) notices.push({ code: 'hotelPrice', severity: 'yellow', text: `מלון ${where} – חסר מספר לילות` });
      if (needsConversion) {
        notices.push({
          code: 'hotelCurrency',
          severity: 'yellow',
          text: `מלון ${where}: המחיר ב-${h.currency} – הזינו מחיר לאחר המרה ל-USD (לא ממציאים שער)`,
        });
      }
      for (const issue of hotelIssues(h, cruise)) {
        notices.push({ code: 'hotelDates', severity: 'red', text: `מלון ${where}: ${issue}` });
      }
      if (share.problem) notices.push({ code: 'hotelSplit', severity: 'red', text: share.problem });
      if (h.owner === 'both') {
        const other: GroupId = group === 'A' ? 'B' : 'A';
        const otherPlan = state.plans[cruiseId]?.[other];
        const otherUses = state.groupBEnabled && (isAfter ? otherPlan?.hotelAfterId : otherPlan?.hotelId) === h.id;
        if (!otherUses) {
          notices.push({
            code: 'sharedHotel',
            severity: 'blue',
            text: state.groupBEnabled
              ? 'מלון משותף, אבל הקבוצה השנייה לא בחרה אותו – רק החלק של הקבוצה הזו נספר'
              : 'המלון מסומן כמשותף – אם קבוצה B לא מגיעה, שנו אותו ל"קבוצה A"',
          });
        }
      }
      return {
        amount: share.amount,
        entered: priced && !missingNights && !needsConversion && !share.problem,
      };
    }
    if (noHotel) return { amount: 0, entered: true, label: 'לא צריך' };
    if (isAfter) {
      notices.push({ code: 'hotelAfterUndecided', severity: 'blue', text: 'מלון אחרי הקרוז – טרם הוחלט (אופציונלי)' });
    } else {
      notices.push({ code: 'hotelUndecided', severity: 'yellow', text: 'מלון – טרם הוחלט' });
    }
    return { amount: 0, entered: false };
  }

  // Tips, fee, drinks, internet
  lines.tips = { amount: fromCents(tipsAmountCents(plan, pax)), entered: isFilled(plan.tips) };
  if (!lines.tips.entered) notices.push({ code: 'tips', severity: 'yellow', text: 'טיפים לצוות – טרם הוזן' });
  lines.agentFee = { amount: fromCents(toCents(plan.agentFee)), entered: isFilled(plan.agentFee) };
  if (!lines.agentFee.entered) notices.push({ code: 'fee', severity: 'yellow', text: 'עמלת סוכן – טרם הוזנה' });
  lines.drinks = { amount: fromCents(toCents(plan.drinks)), entered: isFilled(plan.drinks) };
  lines.internet = { amount: fromCents(toCents(plan.internet)), entered: isFilled(plan.internet) };

  // Transport / other rows
  lines.transport = itemsLine(state, cruiseId, group, 'transport');
  lines.other = itemsLine(state, cruiseId, group, 'other');
  if (!state.groupBEnabled && state.items.some((i) => i.cruiseId === cruiseId && i.owner === 'both' && isFilled(i.amount))) {
    notices.push({
      code: 'sharedItems',
      severity: 'blue',
      text: 'יש עלויות משותפות (חצי-חצי) – כשקבוצה B לא מגיעה נספר רק החצי. אפשר לשנות אותן ל"קבוצה A"',
    });
  }

  const cruiseCents = toCents(lines.cruise.amount);
  const extrasCents = LINE_KEYS.filter((k) => k !== 'cruise').reduce((sum, k) => sum + toCents(lines[k].amount), 0);

  const status: PlanStatus = notices.some((n) => n.severity === 'red')
    ? 'red'
    : notices.some((n) => n.severity === 'yellow')
      ? 'yellow'
      : 'green';

  return {
    cruiseId,
    group,
    room,
    out,
    back,
    roundTrip,
    hotel,
    hotelAfter,
    lines,
    cruiseOnly: fromCents(cruiseCents),
    extras: fromCents(extrasCents),
    total: fromCents(cruiseCents + extrasCents),
    notices,
    status,
  };
}

/** Cheapest room that actually has a price. An unpriced room is never "cheapest". Ties: first listed. */
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

/** Informational only: both groups together on one date. null if group B is off or a room is missing. */
export function bothGroupsTotal(state: AppState, cruiseId: string): number | null {
  if (!state.groupBEnabled) return null;
  const a = computePlan(state, cruiseId, 'A');
  const b = computePlan(state, cruiseId, 'B');
  if (!a.room || !b.room) return null;
  return fromCents(toCents(a.total) + toCents(b.total));
}

/** Gap between two totals, always positive. */
export function gap(a: number, b: number): number {
  return Math.abs(toCents(a) - toCents(b)) / 100;
}

// ---------- date comparison ----------

export interface DateColumn {
  cruise: Cruise;
  /** Selected room when chosen, otherwise the cheapest room of the date (basis 'cheapest'). */
  result: PlanResult | null;
  basis: 'selected' | 'cheapest' | 'none';
}

export interface DateComparison {
  group: GroupId;
  columns: DateColumn[];
  /** index of the cheapest column, when at least two dates have a price */
  cheapestIndex: number | null;
  /** cheapest vs the second cheapest */
  gap: number | null;
  partial: boolean;
  reasons: string[];
}

export function compareDates(state: AppState, group: GroupId): DateComparison {
  const columns: DateColumn[] = state.cruises.map((cruise) => {
    const selected = computePlan(state, cruise.id, group);
    // A selected room without a price cannot be compared (it would look like a $0 cruise).
    if (selected.room) return isFilled(selected.room.price) ? { cruise, result: selected, basis: 'selected' } : { cruise, result: null, basis: 'none' };
    const cheap = cheapestRoom(state, cruise.id, group);
    return cheap ? { cruise, result: cheap, basis: 'cheapest' } : { cruise, result: null, basis: 'none' };
  });

  const priced = columns
    .map((c, i) => ({ c, i }))
    .filter((x): x is { c: DateColumn & { result: PlanResult }; i: number } => x.c.result !== null);

  const reasons: string[] = [];
  for (const c of columns) {
    const name = dateName(c.cruise.start);
    if (c.basis === 'none') reasons.push(`ב-${name} אין חדר עם מחיר`);
    if (c.basis === 'cheapest') reasons.push(`ב-${name} טרם נבחר חדר (חושב לפי החדר הזול)`);
    const r = c.result;
    if (!r) continue;
    if (hasNotice(r, 'flight')) reasons.push(`ב-${name} חסרות טיסות`);
    else if (hasNotice(r, 'fare')) reasons.push(`ב-${name} חסר מחיר טיסה`);
    if (hasNotice(r, 'hotelSplit') || hasNotice(r, 'hotelDates')) reasons.push(`ב-${name} יש בעיה בנתוני המלון`);
    if (hasNotice(r, 'unverifiedFlight')) reasons.push(`ב-${name} מחיר הטיסה לא מאומת`);
    const missing = [
      hasNotice(r, 'hotelUndecided') || hasNotice(r, 'hotelPrice') || hasNotice(r, 'hotelCurrency') ? 'מלון' : null,
      hasNotice(r, 'tips') ? 'טיפים' : null,
      hasNotice(r, 'fee') ? 'עמלת סוכן' : null,
    ].filter(Boolean);
    if (missing.length > 0) reasons.push(`ב-${name} חסר: ${missing.join(', ')}`);
  }
  // A line typed for one date but not for another makes the totals not comparable.
  if (priced.length > 1) {
    for (const key of LINE_KEYS) {
      if (key === 'cruise' || key === 'flights') continue;
      const enteredIn = priced.filter((p) => p.c.result.lines[key].entered);
      if (enteredIn.length > 0 && enteredIn.length < priced.length) {
        const names = enteredIn.map((p) => dateName(p.c.cruise.start)).join(', ');
        reasons.push(`${LINE_LABEL[key]} הוזנו רק ב-${names}`);
      }
    }
  }

  let cheapestIndex: number | null = null;
  let gapValue: number | null = null;
  if (priced.length > 1) {
    const sorted = [...priced].sort((x, y) => toCents(x.c.result.total) - toCents(y.c.result.total) || x.i - y.i);
    cheapestIndex = sorted[0]!.i;
    gapValue = gap(sorted[1]!.c.result.total, sorted[0]!.c.result.total);
  }

  return {
    group,
    columns,
    cheapestIndex,
    gap: gapValue,
    partial: reasons.length > 0,
    reasons: [...new Set(reasons)],
  };
}

/** "05/09 זול ב-$420" / "שני התאריכים באותו מחיר" – the sentence only, no certainty claims added. */
export function comparisonSentence(cmp: DateComparison, money: (n: number) => string): string | null {
  if (cmp.cheapestIndex === null || cmp.gap === null) return null;
  const name = dateName(cmp.columns[cmp.cheapestIndex]!.cruise.start);
  if (cmp.gap === 0) return 'אותו מחיר בשני התאריכים';
  return `${name} זול ב-${money(cmp.gap)}`;
}

// ---------- "what now?" ----------

export interface Todo {
  id: string;
  text: string;
  screen: 'summary' | 'entry' | 'details';
}

export function todoList(state: AppState): Todo[] {
  const groups = activeGroups(state);
  const todos: Todo[] = [];
  const plans = state.cruises.flatMap((c) => groups.map((g) => computePlan(state, c.id, g)));

  for (const c of state.cruises) {
    if (!cruiseDatesValid(c)) {
      todos.push({ id: `dates-${c.id}`, text: `תקנו את תאריכי ההפלגה (${dateName(c.start)})`, screen: 'entry' });
    }
  }
  if (plans.some((p) => !p.room)) {
    todos.push({ id: 'rooms', text: 'בחרו חדר לכל קבוצה ותאריך', screen: 'summary' });
  }
  if (plans.some((p) => hasNotice(p, 'roomPrice'))) {
    todos.push({ id: 'room-price', text: 'הזינו מחיר לחדר שנבחר (מחירי הסוכן)', screen: 'entry' });
  }
  for (const c of state.cruises) {
    const name = dateName(c.start);
    // Options are per group: a group with no flight options must be told to check flights.
    const groupsWithout = groups.filter((g) => !state.flights.some((f) => f.cruiseId === c.id && f.group === g));
    const datePlans = plans.filter((p) => p.cruiseId === c.id);
    if (groupsWithout.length > 0) {
      const who = groupsWithout.length === groups.length ? '' : ` (${groupsWithout.map((g) => `קבוצה ${g}`).join(', ')})`;
      todos.push({ id: `flights-${c.id}`, text: `בדקו טיסות ל-${name}${who}`, screen: 'entry' });
    } else if (datePlans.some((p) => hasNotice(p, 'flight'))) {
      todos.push({ id: `pick-flights-${c.id}`, text: `בחרו טיסת הלוך וחזור ל-${name}`, screen: 'entry' });
    } else if (datePlans.some((p) => hasNotice(p, 'fare'))) {
      todos.push({ id: `fare-${c.id}`, text: `השלימו מחיר טיסה ל-${name}`, screen: 'entry' });
    }
  }
  if (plans.some((p) => hasNotice(p, 'unverifiedFlight'))) {
    todos.push({ id: 'verify-flights', text: 'אמתו מחיר טיסה באתר חברת התעופה (המחיר שנבחר לא מאומת)', screen: 'entry' });
  }
  if (plans.some((p) => hasNotice(p, 'hotelCurrency'))) {
    todos.push({ id: 'hotel-currency', text: 'המירו ל-USD את מחיר המלון (הוזן במטבע אחר)', screen: 'entry' });
  }
  if (plans.some((p) => hasNotice(p, 'hotelUndecided') || hasNotice(p, 'hotelPrice'))) {
    todos.push({ id: 'hotel', text: 'בדקו מלון בברצלונה (או סמנו "לא צריך מלון")', screen: 'entry' });
  }
  if (plans.some((p) => hasNotice(p, 'hotelSplit') || hasNotice(p, 'hotelDates'))) {
    todos.push({ id: 'hotel-fix', text: 'תקנו את נתוני המלון (תאריכים או חלוקה)', screen: 'entry' });
  }
  if (plans.some((p) => !p.lines.tips.entered)) {
    todos.push({ id: 'tips', text: 'בררו עלות טיפים לצוות (Crew tips)', screen: 'entry' });
  }
  if (plans.some((p) => !p.lines.agentFee.entered)) {
    todos.push({ id: 'fee', text: 'בררו את עמלת הסוכן', screen: 'entry' });
  }
  const openTerms = state.terms.filter((t) => t.status === 'clarify' && (t.id === 't-deposit' || t.id === 't-cancel'));
  if (openTerms.length > 0) {
    todos.push({ id: 'terms', text: 'בררו תנאי מקדמה וביטול (לקבל בכתב)', screen: 'details' });
  }
  return todos;
}

// ---------- included / not included ----------

export interface InclusionItem {
  text: string;
  severity: Severity | 'green';
}

/** What the cruise price includes, according to the agent, plus what is still missing in the data. */
export function inclusionList(state: AppState): { included: InclusionItem[]; notIncluded: InclusionItem[] } {
  const groups = activeGroups(state);
  const plans = state.cruises.flatMap((c) => groups.map((g) => computePlan(state, c.id, g)));
  const notIncluded: InclusionItem[] = [
    { text: 'טיפים לצוות (Crew tips)', severity: plans.every((p) => p.lines.tips.entered) ? 'blue' : 'yellow' },
    { text: 'חבילת משקאות (אופציונלי)', severity: 'blue' },
    { text: 'אינטרנט (אופציונלי)', severity: 'blue' },
  ];
  if (!state.flights.some((f) => groups.includes(f.group))) notIncluded.push({ text: 'טיסות – עדיין לא נבדקו', severity: 'yellow' });
  else notIncluded.push({ text: 'טיסות – מוזנות בנפרד', severity: 'blue' });
  const anyHotelPriced = plans.some((p) => p.lines.hotel.entered && !p.lines.hotel.label);
  const allNoHotel = plans.length > 0 && plans.every((p) => p.lines.hotel.label);
  if (anyHotelPriced) notIncluded.push({ text: 'מלון – מוזן בנפרד', severity: 'blue' });
  else if (allNoHotel) notIncluded.push({ text: 'מלון – לא נדרש', severity: 'blue' });
  else notIncluded.push({ text: 'מלון – עדיין לא הוזן', severity: 'yellow' });
  if (plans.some((p) => !p.lines.agentFee.entered)) notIncluded.push({ text: 'עמלת סוכן – עדיין לא ידועה', severity: 'yellow' });
  return {
    included: [{ text: 'מיסים (לפי הסוכן)', severity: 'green' }],
    notIncluded,
  };
}

// ---------- flight rating (a recommendation with reasons – never a decision) ----------

export type RatingLevel = 'recommended' | 'compromise' | 'bad' | 'unknown';

export interface FlightRating {
  level: RatingLevel;
  icon: string;
  label: string;
  /** Why – shown next to the label, so it is never just "recommended". */
  reasons: string[];
  /** 🟢 very good price among the verified options of the same kind. */
  goodPrice: boolean;
  /** Days between arrival and the cruise start (null = unknown). */
  outBuffer: number | null;
  /** Days between disembarking and the flight home (null = unknown). */
  backBuffer: number | null;
}

interface Leg {
  kind: 'out' | 'back';
  date: string;
  dep: string;
  arr: string;
  stops: number | null;
}

function flightLegs(f: Flight): Leg[] {
  if (f.direction === 'round') {
    return [
      { kind: 'out', date: f.date, dep: f.depTime, arr: f.arrTime, stops: f.stops },
      { kind: 'back', date: f.returnDate, dep: f.returnDepTime, arr: f.returnArrTime, stops: f.returnStops },
    ];
  }
  return [{ kind: f.direction, date: f.date, dep: f.depTime, arr: f.arrTime, stops: f.stops }];
}

const daysWord = (n: number): string => (n === 1 ? 'יום' : n === 2 ? 'יומיים' : `${n} ימים`);

function hourOf(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
}

function isDirect(f: Flight): boolean {
  return flightLegs(f).every((l) => l.stops === 0);
}

/**
 * Verified, fully priced options of the same kind: round trips with round trips, one-ways with one-ways,
 * and direct flights with direct flights (a flight with a stop is naturally cheaper and is judged on its own).
 */
function priceComparables(state: AppState, flight: Flight): Flight[] {
  const pax = state.passengers[flight.group];
  return state.flights.filter(
    (f) =>
      f.cruiseId === flight.cruiseId &&
      f.group === flight.group &&
      f.direction === flight.direction &&
      isDirect(f) === isDirect(flight) &&
      f.verified &&
      flightFullyPriced(f, pax),
  );
}

export function rateFlight(state: AppState, flight: Flight): FlightRating {
  const cruise = state.cruises.find((c) => c.id === flight.cruiseId);
  const pax = state.passengers[flight.group];
  const legs = flightLegs(flight);
  const bad: string[] = [];
  const compromise: string[] = [];
  const good: string[] = [];
  const unknown: string[] = [];
  let outBuffer: number | null = null;
  let backBuffer: number | null = null;

  for (const leg of legs) {
    const word = leg.kind === 'out' ? 'הלוך' : 'חזור';
    // Stops
    if (leg.stops === null) unknown.push(`מספר עצירות (${word}) לא הוזן`);
    else if (leg.stops >= 2) bad.push(`${leg.stops} עצירות ב${word}`);
    else if (leg.stops === 1) compromise.push(`עצירה ב${word}`);
    // Buffer against the cruise
    if (cruise) {
      if (leg.kind === 'out') {
        outBuffer = daysBetween(leg.date, cruise.start);
        if (outBuffer === null) unknown.push('תאריך הלוך לא הוזן');
        else if (outBuffer === 0) bad.push('מגיעה ביום יציאת הקרוז – סיכון להחמיץ את ההפלגה');
        else if (outBuffer < 0) bad.push('מגיעה אחרי יציאת הקרוז');
        else if (outBuffer > 2) compromise.push(`מגיעה ${daysWord(outBuffer)} לפני הקרוז (לילות מלון נוספים)`);
        else good.push(`מגיעה ${daysWord(outBuffer)} לפני הקרוז`);
      } else {
        backBuffer = daysBetween(cruise.end, leg.date);
        if (backBuffer === null) unknown.push('תאריך חזור לא הוזן');
        else if (backBuffer === 0) bad.push('חוזרת ביום הירידה מהאונייה');
        else if (backBuffer < 0) bad.push('חוזרת לפני סוף הקרוז');
        else if (backBuffer > 2) compromise.push(`חוזרת ${daysWord(backBuffer)} אחרי הקרוז (לילות מלון נוספים)`);
        else good.push(`חוזרת ${daysWord(backBuffer)} אחרי הירידה`);
      }
    }
    // Hours: a very early departure or a very late arrival is hard with a baby
    const dep = hourOf(leg.dep);
    const arr = hourOf(leg.arr);
    if ((dep !== null && dep < 6) || (arr !== null && arr >= 23)) compromise.push(`שעות פחות נוחות (${word})`);
  }

  const directKnown = legs.every((l) => l.stops === 0);
  if (directKnown) good.unshift(legs.length === 2 ? 'ישירה בשני הכיוונים' : 'ישירה');

  // Price relative to the other verified options
  let goodPrice = false;
  const comparables = priceComparables(state, flight);
  if (flight.verified && flightFullyPriced(flight, pax) && comparables.length >= 2) {
    const mine = flightCost(flight, pax).total;
    const cheapest = Math.min(...comparables.map((f) => flightCost(f, pax).total));
    if (cheapest > 0) {
      const ratio = mine / cheapest;
      if (ratio > 1.5) bad.push('מחיר חריג – יקרה ב-50% ויותר מהאפשרות הזולה');
      else if (ratio > 1.2) compromise.push(`יקרה ב-${Math.round((ratio - 1) * 100)}% מהאפשרות הזולה`);
      else if (ratio <= 1.05) goodPrice = true;
    }
  }
  // A flight with a stop can be much cheaper than the direct one – say so, but it stays a compromise.
  if (!isDirect(flight) && flight.verified && flightFullyPriced(flight, pax)) {
    const directs = state.flights.filter(
      (f) =>
        f.cruiseId === flight.cruiseId &&
        f.group === flight.group &&
        f.direction === flight.direction &&
        isDirect(f) &&
        f.verified &&
        flightFullyPriced(f, pax),
    );
    if (directs.length > 0) {
      const cheapestDirect = Math.min(...directs.map((f) => flightCost(f, pax).total));
      const diff = Math.round((cheapestDirect - flightCost(flight, pax).total) * 100) / 100;
      if (diff > 0) compromise.push(`זולה ב-$${diff.toLocaleString('en-US')} מהישירה, אבל פחות נוחה`);
    }
  }
  if (!flight.verified) compromise.push('מחיר לא מאומת');

  let level: RatingLevel;
  let reasons: string[];
  if (bad.length > 0) {
    level = 'bad';
    reasons = bad;
  } else if (compromise.length > 0) {
    level = 'compromise';
    reasons = [...compromise, ...good.filter((g) => !g.startsWith('ישירה'))];
  } else if (unknown.length > 0) {
    level = 'unknown';
    reasons = unknown;
  } else {
    level = 'recommended';
    reasons = [...good];
    if (comparables.length < 2) reasons.push('אין עדיין אפשרויות לשוות למחיר');
    else reasons.push('מחיר סביר');
  }
  const meta: Record<RatingLevel, { icon: string; label: string }> = {
    recommended: { icon: '⭐', label: 'מומלץ' },
    compromise: { icon: '🟡', label: 'פשרה' },
    bad: { icon: '🔴', label: 'לא מומלץ' },
    unknown: { icon: '⚪', label: 'לא מדורג' },
  };
  return { level, ...meta[level], reasons, goodPrice, outBuffer, backBuffer };
}

// ---------- trip timeline ----------

export interface TimelineEvent {
  kind: 'flight' | 'hotel' | 'cruise';
  /** ISO date, '' when not entered. */
  from: string;
  to: string;
  text: string;
}

/** Flight out → hotel → cruise → hotel → flight home, from what this group selected. */
export function tripTimeline(state: AppState, cruiseId: string, group: GroupId): TimelineEvent[] {
  const cruise = state.cruises.find((c) => c.id === cruiseId);
  if (!cruise) return [];
  const r = computePlan(state, cruiseId, group);
  const events: TimelineEvent[] = [];
  if (r.out) {
    events.push({ kind: 'flight', from: r.out.date, to: '', text: `טיסה ${r.out.airline || ''} ${r.out.fromAirport || ''}→${r.out.toAirport || ''}`.replace(/\s+/g, ' ').trim() });
  }
  if (r.hotel) events.push({ kind: 'hotel', from: r.hotel.checkIn, to: r.hotel.checkOut, text: r.hotel.name || 'מלון' });
  events.push({ kind: 'cruise', from: cruise.start, to: cruise.end, text: 'קרוז' });
  if (r.hotelAfter) events.push({ kind: 'hotel', from: r.hotelAfter.checkIn, to: r.hotelAfter.checkOut, text: r.hotelAfter.name || 'מלון' });
  const home = r.roundTrip ? r.out : r.back;
  if (home) {
    const date = r.roundTrip ? home.returnDate : home.date;
    events.push({ kind: 'flight', from: date, to: '', text: `חזרה ${home.airline || ''} ${home.toAirport || 'BCN'}→${home.fromAirport || 'TLV'}`.replace(/\s+/g, ' ').trim() });
  }
  return events;
}

// ---------- secondary information ----------

/** Total divided by adults. The baby's cost stays inside the total. Secondary information only. */
export function perAdult(total: number, pax: Passengers): number | null {
  return pax.adults > 0 ? Math.round((total * 100) / pax.adults) / 100 : null;
}

// ---------- cruise price vs. total trip ----------

export interface CruiseVsTrip {
  cruiseCheapest: number | null;
  cruiseGap: number | null;
  tripCheapest: number | null;
  tripGap: number | null;
  /** The cheaper cruise is not the cheaper holiday. */
  differs: boolean;
}

export function cruiseVsTrip(cmp: DateComparison): CruiseVsTrip {
  const priced = cmp.columns
    .map((c, i) => ({ c, i }))
    .filter((x) => x.c.result && x.c.result.lines.cruise.entered);
  if (priced.length < 2) return { cruiseCheapest: null, cruiseGap: null, tripCheapest: cmp.cheapestIndex, tripGap: cmp.gap, differs: false };
  const byCruise = [...priced].sort((a, b) => toCents(a.c.result!.cruiseOnly) - toCents(b.c.result!.cruiseOnly) || a.i - b.i);
  const cruiseCheapest = byCruise[0]!.i;
  const cruiseGap = gap(byCruise[1]!.c.result!.cruiseOnly, byCruise[0]!.c.result!.cruiseOnly);
  return {
    cruiseCheapest: cruiseGap === 0 ? null : cruiseCheapest,
    cruiseGap,
    tripCheapest: cmp.cheapestIndex,
    tripGap: cmp.gap,
    differs: cruiseGap > 0 && cmp.cheapestIndex !== null && (cmp.gap ?? 0) > 0 && cruiseCheapest !== cmp.cheapestIndex,
  };
}

// ---------- the recommendation ----------

export interface Recommendation {
  status: 'recommend' | 'early' | 'none';
  cruiseId: string | null;
  index: number | null;
  /** Why this option (or why none). */
  reasons: string[];
  /** What is still missing (for "too early to choose"). */
  missing: string[];
  /** Things to be aware of, e.g. the cheapest date was passed over. */
  cautions: string[];
}

const MISSING_BY_CODE: [NoticeCode[], string][] = [
  [['room', 'roomPrice'], 'חדר'],
  [['flight', 'fare'], 'טיסות'],
  [['unverifiedFlight'], 'אימות מחיר טיסה'],
  [['hotelUndecided', 'hotelPrice', 'hotelCurrency'], 'מלון'],
  [['tips'], 'טיפים'],
  [['fee'], 'עמלה'],
];

export function recommendation(state: AppState, group: GroupId): Recommendation {
  const cmp = compareDates(state, group);
  const none: Recommendation = { status: 'none', cruiseId: null, index: null, reasons: [], missing: [], cautions: [] };

  const missing: string[] = [];
  if (cmp.columns.some((c) => c.basis !== 'selected')) missing.push('חדר');
  for (const [codes, label] of MISSING_BY_CODE) {
    if (cmp.columns.some((c) => c.result && codes.some((code) => hasNotice(c.result!, code))) && !missing.includes(label)) {
      missing.push(label);
    }
  }

  if (cmp.cheapestIndex === null || cmp.partial) {
    return { ...none, status: 'early', missing, reasons: cmp.reasons };
  }

  // Final comparison: drop dates whose flights are rated "not recommended".
  const info = cmp.columns.map((c, i) => {
    const r = c.result!;
    const ratings = [r.out, r.back].filter((f): f is Flight => f !== null).map((f) => rateFlight(state, f));
    return { i, c, r, ratings, bad: ratings.some((x) => x.level === 'bad') };
  });
  const byTotal = [...info].sort((a, b) => toCents(a.r.total) - toCents(b.r.total) || a.i - b.i);
  const cautions: string[] = [];
  const cheapest = byTotal[0]!;
  let pick = cheapest;
  if (cheapest.bad) {
    const alternative = byTotal.find((x) => !x.bad);
    if (!alternative) return { ...none, cautions: ['הטיסות בכל התאריכים בדירוג "לא מומלץ" – אין המלצה'] };
    cautions.push(`${dateName(cheapest.c.cruise.start)} הוא הזול ביותר, אבל הטיסות שלו בדירוג "לא מומלץ": ${cheapest.ratings.flatMap((x) => x.reasons).join(', ')}`);
    pick = alternative;
  }
  const others = info.filter((x) => x.i !== pick.i);
  if ((cmp.gap ?? 0) === 0 && others.length === 1 && toCents(others[0]!.r.total) === toCents(pick.r.total)) {
    return { ...none, reasons: ['אותו מחיר בשני התאריכים – אין המלצה לפי מחיר'], cautions };
  }

  const reasons: string[] = [];
  for (const x of pick.ratings) for (const reason of x.reasons) if (!reasons.includes(reason)) reasons.push(reason);
  if (pick.r.hotel && pick.r.lines.hotel.entered) {
    reasons.push(`מלון ${pick.r.hotel.name || ''} – ${hotelNights(pick.r.hotel).nights} לילות`.replace('  ', ' '));
  }
  const other = others[0];
  if (other) {
    const cruiseDiff = toCents(other.r.cruiseOnly) - toCents(pick.r.cruiseOnly);
    reasons.push(
      cruiseDiff > 0
        ? `הקרוז זול ב-$${(cruiseDiff / 100).toLocaleString('en-US')} מהתאריך השני`
        : cruiseDiff < 0
          ? `הקרוז יקר ב-$${(-cruiseDiff / 100).toLocaleString('en-US')} מהתאריך השני, אבל כל הטיול זול יותר`
          : 'מחיר הקרוז זהה בשני התאריכים',
    );
    const tripDiff = toCents(other.r.total) - toCents(pick.r.total);
    if (tripDiff > 0) reasons.push(`כל הטיול זול ב-$${(tripDiff / 100).toLocaleString('en-US')}`);
  }
  return { status: 'recommend', cruiseId: pick.c.cruise.id, index: pick.i, reasons, missing: [], cautions };
}
