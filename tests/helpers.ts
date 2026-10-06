import { reducer } from '../src/domain/reducer';
import type { Action } from '../src/domain/reducer';
import { emptyFlight, emptyHotel, emptyItem, initialState } from '../src/domain/seed';
import type {
  AppState,
  ExtraItem,
  Flight,
  FlightDirection,
  GroupId,
  Hotel,
  ItemCategory,
  Owner,
  Plan,
} from '../src/domain/types';

export const run = (state: AppState, ...actions: Action[]): AppState => actions.reduce(reducer, state);

/** The base data (12 prices + terms) WITHOUT the built-in EL AL cart, so scenarios start from an empty trip. */
export const fresh = (): AppState => ({ ...initialState(), seeds: { elAlBenchmark: true } });

export function flight(cruiseId: string, group: GroupId, direction: FlightDirection, patch: Partial<Flight> = {}): Flight {
  return { ...emptyFlight(cruiseId, group, direction), ...patch };
}

export function hotel(cruiseId: string, owner: Owner, patch: Partial<Hotel> = {}): Hotel {
  return { ...emptyHotel(cruiseId, owner), ...patch };
}

export function item(cruiseId: string, category: ItemCategory, owner: Owner, patch: Partial<ExtraItem> = {}): ExtraItem {
  return { ...emptyItem(cruiseId, category, owner), ...patch };
}

export const selectRoom = (cruiseId: string, group: GroupId, roomId: string): Action => ({
  type: 'updatePlan',
  cruiseId,
  group,
  patch: { roomId },
});

export const plan = (cruiseId: string, group: GroupId, patch: Partial<Plan>): Action => ({
  type: 'updatePlan',
  cruiseId,
  group,
  patch,
});

/**
 * The full scenario used across tests (and repeated by hand in the README check):
 *
 * Group A (2 adults + infant), 05/09, room "מרפסת פנימי" $4,805
 *   outbound: adult $385 ×2, infant $0 (typed), seats $35 ×2, bags $70 ×2
 *   return:   adult $420 ×2, infant not typed, seats $35 ×2, bag $70 ×1 (adult 1 only)
 *   hotel (A only): 2 nights × $220 + city tax $14 + breakfast $36 = $490
 *   tips: $18.5 per person × 2 = $37, agent fee $100
 *   flights 1,610 + seats 140 + bags 210 → A total = 4805 + 1610 + 140 + 210 + 490 + 37 + 100 = 7,392
 *
 * Group B (2 adults), 05/09, room "פונה לים" $4,780
 *   round trip: adult $790 ×2, seats $30 ×2, bags $70 ×2
 *   hotel: shared hotel 2 × $300 = $600 split 50/50 → $300
 *   tips $150 (group), agent fee $80
 *   B total = 4780 + 1580 + 60 + 140 + 300 + 150 + 80 = 7,090
 */
export function fullScenario(): { state: AppState; ids: Record<string, string> } {
  const aOut = flight('c1', 'A', 'out', {
    airline: 'El Al',
    flightNo: 'LY395',
    fare: { 'adult-1': 385, 'adult-2': 385, 'infant-1': 0 },
    seat: { 'adult-1': 35, 'adult-2': 35 },
    baggage: { 'adult-1': 70, 'adult-2': 70 },
  });
  const aBack = flight('c1', 'A', 'back', {
    airline: 'El Al',
    flightNo: 'LY396',
    fare: { 'adult-1': 420, 'adult-2': 420 },
    seat: { 'adult-1': 35, 'adult-2': 35 },
    baggage: { 'adult-1': 70 },
  });
  const bRound = flight('c1', 'B', 'round', {
    airline: 'Vueling',
    fare: { 'adult-1': 790, 'adult-2': 790 },
    seat: { 'adult-1': 30, 'adult-2': 30 },
    baggage: { 'adult-1': 70, 'adult-2': 70 },
  });
  const hA = hotel('c1', 'A', { name: 'Hotel A', checkIn: '2027-09-03', checkOut: '2027-09-05', pricePerNight: 220, cityTax: 14, breakfast: 36 });
  const hShared = hotel('c1', 'both', { name: 'Shared', manualNights: 2, pricePerNight: 300, split: 'half' });
  const state = run(
    fresh(),
    { type: 'addFlight', flight: aOut },
    { type: 'addFlight', flight: aBack },
    { type: 'addFlight', flight: bRound },
    { type: 'addHotel', hotel: hA },
    { type: 'addHotel', hotel: hShared },
    plan('c1', 'A', {
      roomId: 'c1-A1',
      outFlightId: aOut.id,
      backFlightId: aBack.id,
      hotelId: hA.id,
      tips: 18.5,
      tipsMode: 'person',
      agentFee: 100,
    }),
    plan('c1', 'B', { roomId: 'c1-B3', outFlightId: bRound.id, hotelId: hShared.id, tips: 150, agentFee: 80 }),
  );
  return { state, ids: { aOut: aOut.id, aBack: aBack.id, bRound: bRound.id, hA: hA.id, hShared: hShared.id } };
}
