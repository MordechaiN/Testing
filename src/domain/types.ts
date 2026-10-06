/** Empty input = null. A null amount is always treated as 0 in calculations. */
export type Money = number | null;

export type GroupId = 'A' | 'B';
export const GROUPS: readonly GroupId[] = ['A', 'B'];

export interface Passengers {
  adults: number;
  infants: number;
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

export type FlightDirection = 'out' | 'back';

/** All per-passenger prices. Adult and infant are entered separately (an infant may pay 0). */
export interface PerPassenger {
  adult: Money;
  infant: Money;
}

export interface Flight {
  id: string;
  cruiseId: string;
  direction: FlightDirection;
  airline: string;
  flightNo: string;
  date: string;
  depTime: string;
  arrTime: string;
  airport: string;
  /** null = unknown, 0 = direct */
  stops: number | null;
  duration: string;
  baggageInfo: string;
  /** Per passenger */
  base: PerPassenger;
  seat: PerPassenger;
  baggage: PerPassenger;
  other: PerPassenger;
  notes: string;
}

/** 'both' = the same hotel offer is available to each group (each group pays the full amount below). */
export type HotelGroup = GroupId | 'both';

export interface Hotel {
  id: string;
  cruiseId: string;
  group: HotelGroup;
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

export const EXTRA_KEYS = ['tips', 'agentFee', 'drinks', 'internet', 'transport', 'other'] as const;
export type ExtraKey = (typeof EXTRA_KEYS)[number];

/** What one group has chosen/entered for one cruise date. */
export interface Plan {
  roomId: string | null;
  outFlightId: string | null;
  backFlightId: string | null;
  hotelId: string | null;
  tips: Money;
  agentFee: Money;
  drinks: Money;
  internet: Money;
  transport: Money;
  other: Money;
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

export interface AppState {
  version: 1;
  /** When false, group B is hidden everywhere and never calculated into anything. */
  groupBEnabled: boolean;
  passengers: Record<GroupId, Passengers>;
  cruises: Cruise[];
  flights: Flight[];
  hotels: Hotel[];
  /** plans[cruiseId][group] */
  plans: Record<string, Record<GroupId, Plan>>;
  /** Favorite cruise date per group (cruise id) */
  favorite: Record<GroupId, string | null>;
  /** Deposit actually requested, per group. */
  deposit: Record<GroupId, Money>;
  terms: Term[];
}
