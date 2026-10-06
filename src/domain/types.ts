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

/** A flight option belongs to ONE group, so prices are entered per person of that group. */
export interface Flight {
  id: string;
  cruiseId: string;
  group: GroupId;
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
  fare: PersonPrices;
  seat: PersonPrices;
  baggage: PersonPrices;
  notes: string;
}

/** Who pays: one group, or both groups together (then the cost is split). */
export type Owner = GroupId | 'both';

export interface Hotel {
  id: string;
  cruiseId: string;
  owner: Owner;
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
  other: Money;
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

export const SCHEMA_VERSION = 2;

export interface AppState {
  version: 2;
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
}
