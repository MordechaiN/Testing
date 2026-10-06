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
  return {
    fare: fromCents(fare.cents),
    seats: fromCents(seats.cents),
    baggage: fromCents(baggage.cents),
    total: fromCents(fare.cents + seats.cents + baggage.cents),
    fareEntered: fare.entered,
    seatsEntered: seats.entered,
    baggageEntered: baggage.entered,
    missingAdultFare: slots.filter((s) => s.kind === 'adult' && !isFilled(flight.fare?.[s.id])).map((s) => s.label),
    infantNotCharged: slots.filter((s) => s.kind === 'infant' && !isFilled(flight.fare?.[s.id])).map((s) => s.label),
  };
}

export function flightHasPrice(flight: Flight): boolean {
  return [flight.fare, flight.seat, flight.baggage].some((row) => Object.values(row ?? {}).some(isFilled));
}

/** Outbound slot accepts one-way outbound or round-trip tickets; return slot accepts one-way return. */
export function flightFitsSlot(flight: Flight, slot: 'out' | 'back'): boolean {
  return slot === 'out' ? flight.direction === 'out' || flight.direction === 'round' : flight.direction === 'back';
}

export function flightsFor(state: AppState, cruiseId: string, group: GroupId, slot: 'out' | 'back'): Flight[] {
  return state.flights.filter((f) => f.cruiseId === cruiseId && f.group === group && flightFitsSlot(f, slot));
}

// ---------- hotels ----------

export function hotelNights(hotel: Hotel): { nights: number; fromDates: boolean } {
  const diff = daysBetween(hotel.checkIn, hotel.checkOut);
  if (diff !== null && diff > 0) return { nights: diff, fromDates: true };
  return { nights: Math.max(0, Math.floor(num(hotel.manualNights))), fromDates: false };
}

export function hotelTotalCents(hotel: Hotel): number {
  const { nights } = hotelNights(hotel);
  return (
    nights * toCents(hotel.pricePerNight) +
    toCents(hotel.taxes) +
    toCents(hotel.cityTax) +
    toCents(hotel.breakfast) +
    toCents(hotel.other)
  );
}

export function hotelCost(hotel: Hotel): number {
  return fromCents(hotelTotalCents(hotel));
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
  const total = hotelTotalCents(hotel);
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
  if (cruise) {
    const after = daysBetween(cruise.start, hotel.checkOut);
    if (after !== null && after > 0) issues.push('היציאה מהמלון היא אחרי תחילת הקרוז');
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
  hotel: 'מלון',
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
  | 'hotelSplit'
  | 'sharedHotel'
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
  const hotel =
    state.hotels.find((h) => h.id === plan.hotelId && h.cruiseId === cruiseId && hotelServesGroup(h, group)) ?? null;

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

  // Hotel
  if (hotel) {
    const share = hotelShare(hotel, group);
    lines.hotel = { amount: share.amount, entered: !share.problem };
    if (share.problem) notices.push({ code: 'hotelSplit', severity: 'red', text: share.problem });
    if (hotel.owner === 'both' && !state.groupBEnabled && group === 'A') {
      notices.push({
        code: 'sharedHotel',
        severity: 'blue',
        text: 'המלון מסומן כמשותף – אם קבוצה B לא מגיעה, שנו אותו ל"קבוצה A"',
      });
    }
  } else if (plan.noHotel) {
    lines.hotel = { amount: 0, entered: true, label: 'לא צריך' };
  } else {
    lines.hotel = { amount: 0, entered: false };
    notices.push({ code: 'hotelUndecided', severity: 'yellow', text: 'מלון – טרם הוחלט' });
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
    if (selected.room) return { cruise, result: selected, basis: 'selected' };
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
    if (hasNotice(r, 'roomPrice')) reasons.push(`ב-${name} לחדר שנבחר אין מחיר`);
    if (hasNotice(r, 'flight')) reasons.push(`ב-${name} חסרות טיסות`);
    else if (hasNotice(r, 'fare')) reasons.push(`ב-${name} חסר מחיר טיסה`);
    if (hasNotice(r, 'hotelSplit')) reasons.push(`ב-${name} חלוקת המלון לא שלמה`);
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
    reasons,
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

  if (plans.some((p) => !p.room)) {
    todos.push({ id: 'rooms', text: 'בחרו חדר לכל קבוצה ותאריך', screen: 'summary' });
  }
  for (const c of state.cruises) {
    const name = dateName(c.start);
    const hasOptions = state.flights.some((f) => f.cruiseId === c.id && groups.includes(f.group));
    const datePlans = plans.filter((p) => p.cruiseId === c.id);
    if (!hasOptions) {
      todos.push({ id: `flights-${c.id}`, text: `בדקו טיסות ל-${name}`, screen: 'entry' });
    } else if (datePlans.some((p) => hasNotice(p, 'flight'))) {
      todos.push({ id: `pick-flights-${c.id}`, text: `בחרו טיסת הלוך וחזור ל-${name}`, screen: 'entry' });
    } else if (datePlans.some((p) => hasNotice(p, 'fare'))) {
      todos.push({ id: `fare-${c.id}`, text: `השלימו מחיר טיסה ל-${name}`, screen: 'entry' });
    }
  }
  if (plans.some((p) => hasNotice(p, 'hotelUndecided'))) {
    todos.push({ id: 'hotel', text: 'בדקו מלון בברצלונה (או סמנו "לא צריך מלון")', screen: 'entry' });
  }
  if (plans.some((p) => hasNotice(p, 'hotelSplit'))) {
    todos.push({ id: 'hotel-split', text: 'השלימו את חלוקת המלון המשותף', screen: 'entry' });
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
  if (state.flights.length === 0) notIncluded.push({ text: 'טיסות – עדיין לא נבדקו', severity: 'yellow' });
  else notIncluded.push({ text: 'טיסות – מוזנות בנפרד', severity: 'blue' });
  if (plans.every((p) => !p.hotel)) notIncluded.push({ text: 'מלון – עדיין לא הוזן', severity: 'yellow' });
  else notIncluded.push({ text: 'מלון – מוזן בנפרד', severity: 'blue' });
  if (plans.some((p) => !p.lines.agentFee.entered)) notIncluded.push({ text: 'עמלת סוכן – עדיין לא ידועה', severity: 'yellow' });
  return {
    included: [{ text: 'מיסים (לפי הסוכן)', severity: 'green' }],
    notIncluded,
  };
}
