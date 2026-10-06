import { passengerSlots } from './calc';
import { isFareClass } from './fares';
import { applySeeds, emptyFlight, emptyHotel, emptyPlan, freshState, initialState, initialTerms, plansFor } from './seed';
import type {
  AppState,
  Cruise,
  ExtraItem,
  FareCheck,
  Flight,
  GroupId,
  Hotel,
  Money,
  Passengers,
  PersonPrices,
  Plan,
  TermStatus,
} from './types';
import { GROUPS } from './types';

export const STORAGE_KEY = 'cruise-compare-v1';

type Obj = Record<string, unknown>;

function isObject(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const money = (v: unknown): Money => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const idOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function passengers(raw: unknown, fallback: Passengers): Passengers {
  if (!isObject(raw)) return fallback;
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : d);
  return { adults: n(raw.adults, fallback.adults), infants: n(raw.infants, fallback.infants) };
}

function cruises(raw: unknown): Cruise[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Cruise[] = [];
  for (const c of raw) {
    if (!isObject(c) || typeof c.id !== 'string' || !isObject(c.rooms)) return null;
    const rooms = c.rooms;
    if (!Array.isArray(rooms.A) || !Array.isArray(rooms.B)) return null;
    const mapRooms = (list: unknown[]) =>
      list.filter(isObject).map((r) => ({ id: str(r.id), name: str(r.name), price: money(r.price) }));
    out.push({ id: c.id, start: str(c.start), end: str(c.end), rooms: { A: mapRooms(rooms.A), B: mapRooms(rooms.B) } });
  }
  return out;
}

function prices(raw: unknown): PersonPrices {
  const out: PersonPrices = {};
  if (!isObject(raw)) return out;
  for (const [k, v] of Object.entries(raw)) out[k] = money(v);
  return out;
}

function planFrom(raw: unknown): Plan {
  const p = isObject(raw) ? raw : {};
  return {
    ...emptyPlan(),
    roomId: idOrNull(p.roomId),
    outFlightId: idOrNull(p.outFlightId),
    backFlightId: idOrNull(p.backFlightId),
    hotelId: idOrNull(p.hotelId),
    noHotel: p.noHotel === true,
    hotelAfterId: idOrNull(p.hotelAfterId),
    noHotelAfter: p.noHotelAfter === true,
    tips: money(p.tips),
    tipsMode: p.tipsMode === 'person' ? 'person' : 'group',
    tipsPeople: money(p.tipsPeople),
    agentFee: money(p.agentFee),
    drinks: money(p.drinks),
    internet: money(p.internet),
  };
}

// ---------- v1 -> v2 ----------
// v1: flights were shared by both groups with one price per adult / per infant,
// a hotel marked "both" meant EACH group pays the full amount, and plans had
// single transport/other amounts. Totals are preserved exactly.

function sumMoney(a: unknown, b: unknown): Money {
  const x = money(a);
  const y = money(b);
  if (x === null && y === null) return null;
  return Math.round(((x ?? 0) + (y ?? 0)) * 100) / 100;
}

function perPersonFromV1(row: unknown, extra: unknown, pax: Passengers): PersonPrices {
  const r = isObject(row) ? row : {};
  const e = isObject(extra) ? extra : {};
  const out: PersonPrices = {};
  for (const slot of passengerSlots(pax)) {
    out[slot.id] = slot.kind === 'adult' ? sumMoney(r.adult, e.adult) : sumMoney(r.infant, e.infant);
  }
  return out;
}

function migrateV1(raw: Obj): Obj | null {
  const cs = cruises(raw.cruises);
  if (!cs || !Array.isArray(raw.flights) || !Array.isArray(raw.hotels) || !isObject(raw.plans)) return null;
  const base = initialState();
  const pax: Record<GroupId, Passengers> = {
    A: passengers(isObject(raw.passengers) ? raw.passengers.A : null, base.passengers.A),
    B: passengers(isObject(raw.passengers) ? raw.passengers.B : null, base.passengers.B),
  };
  const oldPlans = raw.plans as Record<string, Obj>;

  const flights: Flight[] = [];
  const flightMap: Record<GroupId, Record<string, string>> = { A: {}, B: {} };
  for (const f of raw.flights) {
    if (!isObject(f) || typeof f.id !== 'string') continue;
    for (const g of GROUPS) {
      const id = `${f.id}-${g}`;
      flightMap[g][f.id] = id;
      flights.push({
        ...emptyFlight(str(f.cruiseId), g, f.direction === 'back' ? 'back' : 'out'),
        id,
        cruiseId: str(f.cruiseId),
        group: g,
        direction: f.direction === 'back' ? 'back' : 'out',
        airline: str(f.airline),
        flightNo: str(f.flightNo),
        date: str(f.date),
        depTime: str(f.depTime),
        arrTime: str(f.arrTime),
        fromAirport: str(f.airport),
        toAirport: '',
        stops: money(f.stops),
        duration: str(f.duration),
        returnFlightNo: '',
        returnDate: '',
        returnDepTime: '',
        returnArrTime: '',
        returnStops: null,
        returnDuration: '',
        baggageInfo: str(f.baggageInfo),
        // v1 "other" per passenger is folded into the fare so the total stays identical.
        fare: perPersonFromV1(f.base, f.other, pax[g]),
        seat: perPersonFromV1(f.seat, null, pax[g]),
        baggage: perPersonFromV1(f.baggage, null, pax[g]),
        notes: str(f.notes),
      });
    }
  }

  const hotels: Hotel[] = [];
  const hotelMap: Record<GroupId, Record<string, string>> = { A: {}, B: {} };
  for (const h of raw.hotels) {
    if (!isObject(h) || typeof h.id !== 'string') continue;
    const owners: GroupId[] = h.group === 'A' ? ['A'] : h.group === 'B' ? ['B'] : ['A', 'B'];
    for (const g of owners) {
      const id = owners.length > 1 ? `${h.id}-${g}` : h.id;
      hotelMap[g][h.id] = id;
      hotels.push({
        ...emptyHotel(str(h.cruiseId), g),
        id,
        cruiseId: str(h.cruiseId),
        owner: g,
        split: 'half',
        shareA: null,
        name: str(h.name),
        checkIn: str(h.checkIn),
        checkOut: str(h.checkOut),
        manualNights: money(h.manualNights),
        pricePerNight: money(h.pricePerNight),
        taxes: money(h.taxes),
        cityTax: money(h.cityTax),
        breakfast: money(h.breakfast),
        other: money(h.other),
        notes: str(h.notes),
      });
    }
  }

  const items: ExtraItem[] = [];
  const plans: AppState['plans'] = {};
  for (const c of cs) {
    const byGroup = isObject(oldPlans[c.id]) ? oldPlans[c.id]! : {};
    const next = plansFor();
    for (const g of GROUPS) {
      const p = isObject(byGroup[g]) ? (byGroup[g] as Obj) : {};
      next[g] = {
        ...planFrom(p),
        outFlightId: typeof p.outFlightId === 'string' ? (flightMap[g][p.outFlightId] ?? null) : null,
        backFlightId: typeof p.backFlightId === 'string' ? (flightMap[g][p.backFlightId] ?? null) : null,
        hotelId: typeof p.hotelId === 'string' ? (hotelMap[g][p.hotelId] ?? null) : null,
      };
      for (const [key, category, name] of [
        ['transport', 'transport', 'תחבורה'],
        ['other', 'other', 'אחר'],
      ] as const) {
        const amount = money(p[key]);
        if (amount === null) continue;
        items.push({
          id: `${c.id}-${g}-${key}`,
          cruiseId: c.id,
          category,
          name,
          amount,
          owner: g,
          note: 'הועבר מגרסה קודמת',
        });
      }
    }
    plans[c.id] = next;
  }

  return { ...raw, version: 2, cruises: cs, flights, hotels, items, plans, passengers: pax, notes: '' };
}

// ---------- v2 normalisation ----------

function perGroup(raw: unknown): Record<GroupId, Money> {
  const r = isObject(raw) ? raw : {};
  return { A: money(r.A), B: money(r.B) };
}

function checkFrom(c: unknown): FareCheck | null {
  if (!isObject(c)) return null;
  return {
    id: str(c.id) || `chk_${Math.random().toString(36).slice(2, 8)}`,
    checkedAt: str(c.checkedAt),
    source: str(c.source),
    note: str(c.note),
    displayedOut: money(c.displayedOut),
    displayedBack: money(c.displayedBack),
    adultFare: money(c.adultFare),
    carrierSurcharge: money(c.carrierSurcharge),
    adultTaxes: money(c.adultTaxes),
    babyFare: money(c.babyFare),
    babyTaxes: money(c.babyTaxes),
  };
}

function flightFrom(f: Obj): Flight | null {
  if (typeof f.id !== 'string') return null;
  const fareClass = isFareClass(f.fareClass) ? f.fareClass : '';
  // Only fare records may be shared; a regular option always belongs to one group.
  const group = f.group === 'A' || f.group === 'B' ? f.group : f.group === 'both' && fareClass ? 'both' : null;
  if (group === null) return null;
  const vt = isObject(f.verifiedTotal) ? f.verifiedTotal : {};
  return {
    id: f.id,
    cruiseId: str(f.cruiseId),
    group,
    direction: f.direction === 'back' ? 'back' : f.direction === 'round' ? 'round' : 'out',
    airline: str(f.airline),
    flightNo: str(f.flightNo),
    date: str(f.date),
    depTime: str(f.depTime),
    arrTime: str(f.arrTime),
    fromAirport: str(f.fromAirport),
    toAirport: str(f.toAirport),
    stops: money(f.stops),
    duration: str(f.duration),
    returnFlightNo: str(f.returnFlightNo),
    returnDate: str(f.returnDate),
    returnDepTime: str(f.returnDepTime),
    returnArrTime: str(f.returnArrTime),
    returnStops: money(f.returnStops),
    returnDuration: str(f.returnDuration),
    baggageInfo: str(f.baggageInfo),
    fareType: str(f.fareType),
    fare: prices(f.fare),
    seat: prices(f.seat),
    baggage: prices(f.baggage),
    cartTotal: money(f.cartTotal),
    fareOut: money(f.fareOut),
    fareBack: money(f.fareBack),
    changeTerms: str(f.changeTerms),
    cancelTerms: str(f.cancelTerms),
    source: str(f.source),
    sourceUrl: str(f.sourceUrl),
    checkedAt: str(f.checkedAt),
    verified: f.verified !== false,
    benchmark: f.benchmark === true,
    notes: str(f.notes),
    fareClass,
    searchedFor: str(f.searchedFor),
    displayedOut: money(f.displayedOut),
    displayedBack: money(f.displayedBack),
    adultFare: money(f.adultFare),
    carrierSurcharge: money(f.carrierSurcharge),
    adultTaxes: money(f.adultTaxes),
    babyFare: money(f.babyFare),
    babyTaxes: money(f.babyTaxes),
    priceMode: f.priceMode === 'total' || f.priceMode === 'breakdown' ? f.priceMode : 'unverified',
    verifiedTotal: { all: money(vt.all), A: money(vt.A), B: money(vt.B) },
    extraSeat: perGroup(f.extraSeat),
    extraBaggage: perGroup(f.extraBaggage),
    history: Array.isArray(f.history) ? f.history.map(checkFrom).filter((c): c is FareCheck => c !== null) : [],
  };
}

const owner = (v: unknown): GroupId | 'both' => (v === 'A' || v === 'B' ? v : 'both');

const termStatus = (v: unknown): TermStatus =>
  v === 'clarify' || v === 'missing' || v === 'ok' || v === 'info' ? v : 'clarify';

function hotelFrom(h: Obj): Hotel | null {
  if (typeof h.id !== 'string') return null;
  return {
    id: h.id,
    cruiseId: str(h.cruiseId),
    owner: owner(h.owner),
    phase: h.phase === 'after' ? 'after' : 'before',
    address: str(h.address),
    currency: h.currency === 'EUR' || h.currency === 'ILS' ? h.currency : 'USD',
    split: h.split === 'custom' ? 'custom' : 'half',
    shareA: money(h.shareA),
    name: str(h.name),
    checkIn: str(h.checkIn),
    checkOut: str(h.checkOut),
    manualNights: money(h.manualNights),
    pricePerNight: money(h.pricePerNight),
    taxes: money(h.taxes),
    cityTax: money(h.cityTax),
    breakfast: money(h.breakfast),
    resortFee: money(h.resortFee),
    other: money(h.other),
    usdTotal: money(h.usdTotal),
    url: str(h.url),
    source: str(h.source),
    checkedAt: str(h.checkedAt),
    notes: str(h.notes),
  };
}

function itemFrom(i: Obj): ExtraItem | null {
  if (typeof i.id !== 'string') return null;
  return {
    id: i.id,
    cruiseId: str(i.cruiseId),
    category: i.category === 'transport' ? 'transport' : 'other',
    name: str(i.name),
    amount: money(i.amount),
    owner: owner(i.owner),
    note: str(i.note),
  };
}

/**
 * Accepts anything (localStorage content or an imported backup) and returns a valid state,
 * or null if it is not a cruise-compare backup. Older versions are migrated, never discarded.
 */
export function normalizeState(input: unknown): AppState | null {
  if (!isObject(input)) return null;
  let raw: Obj | null = input;
  if (raw.version === 1) raw = migrateV1(raw);
  // Version 2 and 3 saves are read by the same code: the fields added later get safe defaults below.
  if (!raw || (raw.version !== 2 && raw.version !== 3 && raw.version !== 4)) return null;

  const cs = cruises(raw.cruises);
  if (!cs || !Array.isArray(raw.flights) || !Array.isArray(raw.hotels)) return null;
  const base = initialState();

  const rawPlans = isObject(raw.plans) ? raw.plans : {};
  const plans: AppState['plans'] = {};
  for (const c of cs) {
    const byGroup = isObject(rawPlans[c.id]) ? (rawPlans[c.id] as Obj) : {};
    plans[c.id] = { A: planFrom(byGroup.A), B: planFrom(byGroup.B) };
  }

  const rawPassengers = isObject(raw.passengers) ? raw.passengers : {};
  const fav = isObject(raw.favorite) ? raw.favorite : {};
  const dep = isObject(raw.deposit) ? raw.deposit : {};
  const terms = Array.isArray(raw.terms)
    ? raw.terms.filter(isObject).map((t) => ({
        id: str(t.id),
        topic: str(t.topic),
        said: str(t.said),
        status: termStatus(t.status),
        note: str(t.note),
      }))
    : initialTerms();
  const cruiseIds = new Set(cs.map((c) => c.id));
  const favOf = (g: GroupId) => (typeof fav[g] === 'string' && cruiseIds.has(fav[g] as string) ? (fav[g] as string) : null);

  const seeds = isObject(raw.seeds) ? raw.seeds : {};
  return applySeeds({
    version: 4,
    groupBEnabled: raw.groupBEnabled !== false,
    passengers: {
      A: passengers(rawPassengers.A, base.passengers.A),
      B: passengers(rawPassengers.B, base.passengers.B),
    },
    cruises: cs,
    flights: raw.flights.filter(isObject).map(flightFrom).filter((f): f is Flight => f !== null),
    hotels: raw.hotels.filter(isObject).map(hotelFrom).filter((h): h is Hotel => h !== null),
    items: Array.isArray(raw.items)
      ? raw.items.filter(isObject).map(itemFrom).filter((i): i is ExtraItem => i !== null)
      : [],
    plans,
    favorite: { A: favOf('A'), B: favOf('B') },
    deposit: { A: money(dep.A), B: money(dep.B) },
    terms,
    notes: str(raw.notes),
    seeds: { elAlBenchmark: seeds.elAlBenchmark === true, elAlFares: seeds.elAlFares === true },
  });
}

export function loadState(): AppState {
  let text: string | null;
  try {
    text = localStorage.getItem(STORAGE_KEY);
  } catch {
    return freshState(); // storage blocked – the app still works, without autosave
  }
  if (!text) return freshState();
  try {
    const parsed = normalizeState(JSON.parse(text));
    if (parsed) return parsed;
  } catch {
    // corrupt JSON – handled below
  }
  // Unreadable data is kept aside instead of being silently overwritten.
  try {
    localStorage.setItem(`${STORAGE_KEY}-unreadable-${Date.now()}`, text);
  } catch {
    // nothing more we can do
  }
  return freshState();
}

export function saveState(state: AppState): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    // Storage blocked (private window, quota) – the app keeps working, just without autosave.
    return false;
  }
}

export function exportJson(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

export function importJson(text: string): AppState | null {
  try {
    return normalizeState(JSON.parse(text));
  } catch {
    return null;
  }
}
