/** Empty input = null ("not entered"). A null amount counts as 0 in sums, but the UI shows "טרם הוזן". */
export type Money = number | null;

export type GroupId = 'A' | 'B';
export const GROUPS: readonly GroupId[] = ['A', 'B'];

export interface Passengers {
  adults: number;
  infants: number;
}

/** One traveller of a group: "adult-1" (מבוגר 1), "adult-2" (מבוגר 2), "infant-1" (תינוק). */
export interface PassengerSlot {
  id: string;
  kind: 'adult' | 'infant';
  label: string;
}

export interface Room {
  id: string;
  name: string;
  /** Price quoted by the agent for the whole group. null = not entered yet. */
  price: Money;
}

export interface Cruise {
  id: string;
  /** ISO date, YYYY-MM-DD. Empty string = not entered. */
  start: string;
  end: string;
  rooms: Record<GroupId, Room[]>;
}

/** 'round' = one round-trip ticket that covers both legs. */
export type FlightDirection = 'out' | 'back' | 'round';

/** Price per passenger slot id (see PassengerSlot). Missing key or null = not entered. */
export type PersonPrices = Record<string, Money>;

/** EL AL fare type. '' = a regular flight option (not a fare record). */
export type FareClass = '' | 'lite' | 'classic' | 'flex';

/**
 * Which price counts for a fare record:
 * 'unverified' – nothing is counted (default while the displayed price and the breakdown contradict),
 * 'total' – the verified total the user typed (per group),
 * 'breakdown' – A = 2 × adult + baby, B = 2 × adult, from the per-passenger breakdown.
 */
export type PriceMode = 'unverified' | 'total' | 'breakdown';

/** The price figures of one check, kept so an old check is never lost when a new one is entered. */
export interface FareSnapshot {
  displayedOut: Money;
  displayedBack: Money;
  adultFare: Money;
  carrierSurcharge: Money;
  adultTaxes: Money;
  babyFare: Money;
  babyTaxes: Money;
}

/** "בדיקה קודמת": a snapshot kept when a newer check replaced the figures. */
export interface FareCheck extends FareSnapshot {
  id: string;
  checkedAt: string;
  source: string;
  note: string;
}

/** Verified totals typed by the user. 'all' = the whole party (4 adults + baby); A / B = one group. */
export interface VerifiedTotals {
  all: Money;
  A: Money;
  B: Money;
}

/**
 * A flight option. Regular options belong to ONE group (prices per person of that group).
 * A fare record (fareClass != '') is shared by both groups (group 'both'): its price is derived per group.
 */
export interface Flight {
  id: string;
  cruiseId: string;
  group: Owner;
  direction: FlightDirection;
  airline: string;
  flightNo: string;
  date: string;
  depTime: string;
  arrTime: string;
  fromAirport: string;
  toAirport: string;
  /** null = unknown, 0 = direct */
  stops: number | null;
  duration: string;
  /** Return leg details – used only when direction is 'round'. */
  returnFlightNo: string;
  returnDate: string;
  returnDepTime: string;
  returnArrTime: string;
  returnStops: number | null;
  returnDuration: string;
  baggageInfo: string;
  /** Fare class, e.g. "Lite (N) outbound / Lite (U) return". */
  fareType: string;
  fare: PersonPrices;
  seat: PersonPrices;
  baggage: PersonPrices;
  /**
   * Total fare of the whole ticket for this group exactly as the airline's cart shows it (USD).
   * When filled it is the source of truth and replaces the sum of the per-person fares.
   */
  cartTotal: Money;
  /** Informational split of a round-trip price (never added on top of the total). */
  fareOut: Money;
  fareBack: Money;
  changeTerms: string;
  cancelTerms: string;
  /** Where the price came from, e.g. "EL AL website cart". */
  source: string;
  sourceUrl: string;
  /** ISO date the price was looked at. A checked price is not a guaranteed price. */
  checkedAt: string;
  /** false = price could not be verified; it is shown but never used as a firm offer. (Regular options.) */
  verified: boolean;
  // ----- fare records (EL AL Lite / Classic / Flex) -----
  fareClass: FareClass;
  /** Who the airline was asked about, e.g. "4 מבוגרים + תינוק". */
  searchedFor: string;
  /** Price shown next to each leg, exactly as typed by the user. Never added to the breakdown. */
  displayedOut: Money;
  displayedBack: Money;
  /** Per-passenger breakdown. Adult = fare + surcharge + taxes, baby = fare + taxes. */
  adultFare: Money;
  carrierSurcharge: Money;
  adultTaxes: Money;
  babyFare: Money;
  babyTaxes: Money;
  priceMode: PriceMode;
  verifiedTotal: VerifiedTotals;
  /** Extra seat / bag bought separately (total for the group). Ignored when the fare includes it. */
  extraSeat: Record<GroupId, Money>;
  extraBaggage: Record<GroupId, Money>;
  /** Earlier checks, oldest first. The figures above are the newest check. */
  history: FareCheck[];
  /** Reference offer the other options are compared against. */
  benchmark: boolean;
  notes: string;
}

export type Currency = 'USD' | 'EUR' | 'ILS';
export const CURRENCIES: readonly Currency[] = ['USD', 'EUR', 'ILS'];

export type HotelPhase = 'before' | 'after';

/** Who pays: one group, or both groups together (then the cost is split). */
export type Owner = GroupId | 'both';

export interface Hotel {
  id: string;
  cruiseId: string;
  owner: Owner;
  /** Stay before the cruise (arrival) or after it (before the flight home). */
  phase: HotelPhase;
  address: string;
  currency: Currency;
  /** Only for owner 'both': 'half' = 50/50, 'custom' = group A pays shareA, group B pays the rest. */
  split: 'half' | 'custom';
  shareA: Money;
  name: string;
  checkIn: string;
  checkOut: string;
  /** Used only when check-in/check-out dates are missing or invalid. */
  manualNights: number | null;
  pricePerNight: Money;
  /** The following are totals for the whole stay. */
  taxes: Money;
  cityTax: Money;
  breakfast: Money;
  /** Resort / destination fee, if any (total for the stay). */
  resortFee: Money;
  other: Money;
  /** Total in USD after conversion. Required when the currency is not USD – no rate is ever invented. */
  usdTotal: Money;
  url: string;
  source: string;
  checkedAt: string;
  notes: string;
}

export type ItemCategory = 'transport' | 'other';

/** A free cost row: taxi, train, attraction, meal, parking… Owner 'both' = split 50/50. */
export interface ExtraItem {
  id: string;
  cruiseId: string;
  category: ItemCategory;
  name: string;
  amount: Money;
  owner: Owner;
  note: string;
}

export type TipsMode = 'group' | 'person';

/** What one group has chosen/entered for one cruise date. */
export interface Plan {
  roomId: string | null;
  /** May point to a one-way outbound flight or to a round-trip ticket. */
  outFlightId: string | null;
  backFlightId: string | null;
  hotelId: string | null;
  /** The group decided it does not need a hotel (different from "not decided yet"). */
  noHotel: boolean;
  /** Hotel after the cruise (stay before flying home). */
  hotelAfterId: string | null;
  noHotelAfter: boolean;
  tips: Money;
  tipsMode: TipsMode;
  /** For tipsMode 'person': how many people pay. null = number of adults in the group. */
  tipsPeople: number | null;
  agentFee: Money;
  drinks: Money;
  internet: Money;
}

export type TermStatus = 'clarify' | 'missing' | 'ok' | 'info';

export interface Term {
  id: string;
  topic: string;
  /** What the agent said (quoted, not interpreted). */
  said: string;
  status: TermStatus;
  note: string;
}

export const SCHEMA_VERSION = 4;

export interface AppState {
  version: 4;
  /** When false, group B is hidden everywhere and never calculated into anything. */
  groupBEnabled: boolean;
  passengers: Record<GroupId, Passengers>;
  cruises: Cruise[];
  flights: Flight[];
  hotels: Hotel[];
  items: ExtraItem[];
  /** plans[cruiseId][group] */
  plans: Record<string, Record<GroupId, Plan>>;
  /** Favorite cruise date per group (cruise id) – marked by the user, never by the app. */
  favorite: Record<GroupId, string | null>;
  /** Deposit actually requested, per group. */
  deposit: Record<GroupId, Money>;
  terms: Term[];
  notes: string;
  /** Built-in example data that was already added once (so deleting it is respected). */
  seeds: { elAlBenchmark: boolean; elAlFares: boolean };
}
