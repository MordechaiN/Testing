import { describe, expect, it } from 'vitest';
import {
  bothGroupsTotal,
  cheapestOverall,
  cheapestRoom,
  computePlan,
  flightCost,
  gap,
  hotelCost,
  hotelNights,
  nextStep,
  rankFlights,
} from '../src/domain/calc';
import { reducer } from '../src/domain/reducer';
import { emptyFlight, emptyHotel, initialState } from '../src/domain/seed';
import type { Action } from '../src/domain/reducer';
import type { AppState, Flight, GroupId, Hotel } from '../src/domain/types';

// ---- helpers ----
const run = (state: AppState, ...actions: Action[]) => actions.reduce(reducer, state);

const roomId = (cruise: 'c1' | 'c2', group: GroupId, n: 1 | 2 | 3) => `${cruise}-${group}${n}`;

function flight(cruiseId: string, direction: 'out' | 'back', patch: Partial<Flight> = {}): Flight {
  return { ...emptyFlight(cruiseId, direction), ...patch };
}

function hotel(cruiseId: string, group: Hotel['group'], patch: Partial<Hotel> = {}): Hotel {
  return { ...emptyHotel(cruiseId, group), ...patch };
}

const select = (cruiseId: string, group: GroupId, id: string): Action => ({
  type: 'updatePlan',
  cruiseId,
  group,
  patch: { roomId: id },
});

describe('seed data', () => {
  it('contains all 12 prices from the agent, exactly', () => {
    const s = initialState();
    const prices = (cid: string, g: GroupId) => s.cruises.find((c) => c.id === cid)!.rooms[g].map((r) => r.price);
    expect(prices('c1', 'A')).toEqual([4805, 5280, 5880]);
    expect(prices('c1', 'B')).toEqual([3775, 5140, 4780]);
    expect(prices('c2', 'A')).toEqual([5825, 5085, 5505]);
    expect(prices('c2', 'B')).toEqual([3935, 4920, 6020]);
  });

  it('starts with no flights, hotels, tips, fees or selected rooms', () => {
    const s = initialState();
    expect(s.flights).toEqual([]);
    expect(s.hotels).toEqual([]);
    for (const c of s.cruises) for (const g of ['A', 'B'] as const) {
      expect(s.plans[c.id]![g].roomId).toBeNull();
      expect(s.plans[c.id]![g].tips).toBeNull();
      expect(s.plans[c.id]![g].agentFee).toBeNull();
    }
  });

  it('does not decide the deposit: it is flagged as needing clarification', () => {
    const t = initialState().terms.find((x) => x.id === 't-deposit')!;
    expect(t.status).toBe('clarify');
    expect(initialState().deposit).toEqual({ A: null, B: null });
  });
});

describe('1-2. group totals', () => {
  it('group A total = selected room price when nothing else is entered', () => {
    const s = run(initialState(), select('c1', 'A', roomId('c1', 'A', 1)));
    const r = computePlan(s, 'c1', 'A');
    expect(r.total).toBe(4805);
    expect(r.cruiseOnly).toBe(4805);
    expect(r.extras).toBe(0);
  });

  it('group B total = selected room price when nothing else is entered', () => {
    const s = run(initialState(), select('c1', 'B', roomId('c1', 'B', 3)));
    expect(computePlan(s, 'c1', 'B').total).toBe(4780);
  });

  it('matches the example from the brief (4805 + 1200 + 400 + 150 + 120 + 250 + 100 = 7025)', () => {
    let s = initialState();
    // Flights 1200 for group A: 3 passengers with adult 400 and infant 400 -> use out 600 + back 600 via adult/infant.
    // Keep it simple: 2 adults x 300 + 1 infant x 0 = 600 per leg.
    const out = flight('c1', 'out', { base: { adult: 300, infant: null } });
    const back = flight('c1', 'back', { base: { adult: 300, infant: null } });
    const h = hotel('c1', 'A', { manualNights: 2, pricePerNight: 200 });
    s = run(
      s,
      select('c1', 'A', roomId('c1', 'A', 1)),
      { type: 'addFlight', flight: out },
      { type: 'addFlight', flight: back },
      { type: 'addHotel', hotel: h },
      {
        type: 'updatePlan',
        cruiseId: 'c1',
        group: 'A',
        patch: {
          outFlightId: out.id,
          backFlightId: back.id,
          hotelId: h.id,
          tips: 250,
          agentFee: 100,
        },
      },
    );
    const r = computePlan(s, 'c1', 'A');
    expect(r.breakdown.cruise).toBe(4805);
    expect(r.breakdown.flights).toBe(1200);
    expect(r.breakdown.hotel).toBe(400);
    expect(r.total).toBe(4805 + 1200 + 400 + 250 + 100);
  });
});

describe('3-4. group B can be absent and never affects group A', () => {
  it('disabling group B keeps group A identical', () => {
    const base = run(
      initialState(),
      select('c1', 'A', roomId('c1', 'A', 2)),
      select('c1', 'B', roomId('c1', 'B', 3)),
      { type: 'updatePlan', cruiseId: 'c1', group: 'A', patch: { tips: 111 } },
    );
    const off = run(base, { type: 'setGroupBEnabled', enabled: false });
    expect(computePlan(off, 'c1', 'A')).toEqual(computePlan(base, 'c1', 'A'));
    expect(cheapestOverall(off, 'A')).toEqual(cheapestOverall(base, 'A'));
  });

  it('there is no combined total when group B is disabled', () => {
    const s = run(
      initialState(),
      select('c1', 'A', roomId('c1', 'A', 1)),
      select('c1', 'B', roomId('c1', 'B', 1)),
    );
    expect(bothGroupsTotal(s, 'c1')).toBe(4805 + 3775);
    expect(bothGroupsTotal(run(s, { type: 'setGroupBEnabled', enabled: false }), 'c1')).toBeNull();
  });

  it('nextStep ignores group B when it is disabled', () => {
    let s = run(initialState(), { type: 'setGroupBEnabled', enabled: false });
    const out = flight('c1', 'out');
    const back = flight('c1', 'back');
    const out2 = flight('c2', 'out');
    const back2 = flight('c2', 'back');
    s = run(s, ...([out, back, out2, back2].map((f) => ({ type: 'addFlight', flight: f }) as Action)));
    for (const [cid, o, b] of [['c1', out, back], ['c2', out2, back2]] as const) {
      s = run(s, {
        type: 'updatePlan', cruiseId: cid, group: 'A',
        patch: { outFlightId: o.id, backFlightId: b.id, roomId: `${cid}-A1`, tips: 0, agentFee: 0 },
      });
    }
    // Group B has nothing selected, but is disabled -> only terms remain.
    expect(nextStep(s)?.screen).toBe('details');
    expect(nextStep(run(s, { type: 'setGroupBEnabled', enabled: true }))?.screen).toBe('entry');
  });
});

describe('5-8. flights, seats, baggage, hotel', () => {
  const pax = { adults: 2, infants: 1 };

  it('flight price is added per passenger type', () => {
    const f = flight('c1', 'out', { base: { adult: 300, infant: 50 } });
    expect(flightCost(f, pax).base).toBe(2 * 300 + 50);
    expect(flightCost(f, { adults: 2, infants: 0 }).base).toBe(600);
  });

  it('infant that is not priced counts as 0 (never assumed to pay)', () => {
    const f = flight('c1', 'out', { base: { adult: 300, infant: null } });
    expect(flightCost(f, pax).total).toBe(600);
  });

  it('flight price is added to the group total', () => {
    const f = flight('c1', 'out', { base: { adult: 300, infant: null } });
    const s = run(
      initialState(),
      { type: 'addFlight', flight: f },
      select('c1', 'A', roomId('c1', 'A', 1)),
      { type: 'updatePlan', cruiseId: 'c1', group: 'A', patch: { outFlightId: f.id } },
    );
    const r = computePlan(s, 'c1', 'A');
    expect(r.breakdown.flights).toBe(600);
    expect(r.total).toBe(4805 + 600);
  });

  it('seats are added separately from the flight price', () => {
    const f = flight('c1', 'out', { base: { adult: 300, infant: null }, seat: { adult: 25, infant: null } });
    const s = run(
      initialState(),
      { type: 'addFlight', flight: f },
      select('c1', 'A', roomId('c1', 'A', 1)),
      { type: 'updatePlan', cruiseId: 'c1', group: 'A', patch: { outFlightId: f.id } },
    );
    const r = computePlan(s, 'c1', 'A');
    expect(r.breakdown.flights).toBe(600);
    expect(r.breakdown.seats).toBe(50);
    expect(r.total).toBe(4805 + 600 + 50);
  });

  it('baggage is added separately and uses the group passenger count (3 vs 2)', () => {
    const f = flight('c1', 'back', { baggage: { adult: 60, infant: 60 } });
    const s = run(
      initialState(),
      { type: 'addFlight', flight: f },
      select('c1', 'A', roomId('c1', 'A', 1)),
      select('c1', 'B', roomId('c1', 'B', 1)),
      { type: 'updatePlan', cruiseId: 'c1', group: 'A', patch: { backFlightId: f.id } },
      { type: 'updatePlan', cruiseId: 'c1', group: 'B', patch: { backFlightId: f.id } },
    );
    expect(computePlan(s, 'c1', 'A').breakdown.baggage).toBe(180);
    expect(computePlan(s, 'c1', 'B').breakdown.baggage).toBe(120);
    expect(computePlan(s, 'c1', 'A').total).toBe(4805 + 180);
    expect(computePlan(s, 'c1', 'B').total).toBe(3775 + 120);
  });

  it('hotel total = nights x rate + taxes + city tax + breakfast + other', () => {
    const h = hotel('c1', 'A', {
      checkIn: '2027-09-03',
      checkOut: '2027-09-05',
      pricePerNight: 250,
      taxes: 30,
      cityTax: 12.5,
      breakfast: 40,
      other: 5,
    });
    expect(hotelNights(h)).toEqual({ nights: 2, fromDates: true });
    expect(hotelCost(h)).toBe(500 + 30 + 12.5 + 40 + 5);
  });

  it('hotel is added to the group total', () => {
    const h = hotel('c1', 'A', { manualNights: 2, pricePerNight: 500 });
    const s = run(
      initialState(),
      { type: 'addHotel', hotel: h },
      select('c1', 'A', roomId('c1', 'A', 1)),
      { type: 'updatePlan', cruiseId: 'c1', group: 'A', patch: { hotelId: h.id } },
    );
    expect(computePlan(s, 'c1', 'A').breakdown.hotel).toBe(1000);
    expect(computePlan(s, 'c1', 'A').total).toBe(4805 + 1000);
  });

  it('manual nights are ignored once valid dates exist', () => {
    const h = hotel('c1', 'A', { checkIn: '2027-09-02', checkOut: '2027-09-05', manualNights: 9, pricePerNight: 100 });
    expect(hotelNights(h).nights).toBe(3);
  });

  it('a hotel for group B cannot be counted in group A, even if referenced', () => {
    const h = hotel('c1', 'B', { manualNights: 2, pricePerNight: 450 });
    let s = run(initialState(), { type: 'addHotel', hotel: h }, select('c1', 'A', roomId('c1', 'A', 1)));
    // Force a stale reference straight into the state (the UI can never do this).
    s = { ...s, plans: { ...s.plans, c1: { ...s.plans.c1!, A: { ...s.plans.c1!.A, hotelId: h.id } } } };
    expect(computePlan(s, 'c1', 'A').breakdown.hotel).toBe(0);
  });

  it('a hotel marked "both" is counted for each group separately', () => {
    const h = hotel('c1', 'both', { manualNights: 2, pricePerNight: 100 });
    const s = run(
      initialState(),
      { type: 'addHotel', hotel: h },
      { type: 'updatePlan', cruiseId: 'c1', group: 'A', patch: { hotelId: h.id } },
      { type: 'updatePlan', cruiseId: 'c1', group: 'B', patch: { hotelId: h.id } },
    );
    expect(computePlan(s, 'c1', 'A').breakdown.hotel).toBe(200);
    expect(computePlan(s, 'c1', 'B').breakdown.hotel).toBe(200);
  });

  it('changing a hotel from "both" to B clears it from group A selection', () => {
    const h = hotel('c1', 'both', { manualNights: 1, pricePerNight: 100 });
    const s = run(
      initialState(),
      { type: 'addHotel', hotel: h },
      { type: 'updatePlan', cruiseId: 'c1', group: 'A', patch: { hotelId: h.id } },
      { type: 'updatePlan', cruiseId: 'c1', group: 'B', patch: { hotelId: h.id } },
      { type: 'updateHotel', id: h.id, patch: { group: 'B' } },
    );
    expect(s.plans.c1!.A.hotelId).toBeNull();
    expect(s.plans.c1!.B.hotelId).toBe(h.id);
  });
});

describe('9-11. tips, agent fee, empty = 0', () => {
  it('tips are added', () => {
    const s = run(
      initialState(),
      select('c1', 'A', roomId('c1', 'A', 1)),
      { type: 'updatePlan', cruiseId: 'c1', group: 'A', patch: { tips: 250 } },
    );
    expect(computePlan(s, 'c1', 'A').total).toBe(4805 + 250);
  });

  it('agent fee is added', () => {
    const s = run(
      initialState(),
      select('c1', 'A', roomId('c1', 'A', 1)),
      { type: 'updatePlan', cruiseId: 'c1', group: 'A', patch: { agentFee: 100 } },
    );
    expect(computePlan(s, 'c1', 'A').total).toBe(4805 + 100);
  });

  it('drinks, internet, transport and other are added', () => {
    const s = run(
      initialState(),
      select('c1', 'A', roomId('c1', 'A', 1)),
      { type: 'updatePlan', cruiseId: 'c1', group: 'A', patch: { drinks: 10, internet: 20, transport: 30, other: 40 } },
    );
    expect(computePlan(s, 'c1', 'A').total).toBe(4805 + 100);
  });

  it('empty fields (null / NaN / undefined) count as 0 and never break the total', () => {
    let s = run(initialState(), select('c1', 'A', roomId('c1', 'A', 1)));
    expect(computePlan(s, 'c1', 'A').total).toBe(4805);
    s = run(s, {
      type: 'updatePlan', cruiseId: 'c1', group: 'A',
      patch: { tips: Number.NaN, agentFee: undefined as unknown as null, other: Infinity },
    });
    const r = computePlan(s, 'c1', 'A');
    expect(r.total).toBe(4805);
    expect(Number.isFinite(r.total)).toBe(true);
  });

  it('an empty hotel / flight record contributes 0', () => {
    const h = hotel('c1', 'A');
    const f = flight('c1', 'out');
    const s = run(
      initialState(),
      { type: 'addHotel', hotel: h },
      { type: 'addFlight', flight: f },
      select('c1', 'A', roomId('c1', 'A', 1)),
      { type: 'updatePlan', cruiseId: 'c1', group: 'A', patch: { hotelId: h.id, outFlightId: f.id } },
    );
    expect(computePlan(s, 'c1', 'A').total).toBe(4805);
  });

  it('decimal amounts do not produce float noise', () => {
    const s = run(
      initialState(),
      select('c1', 'A', roomId('c1', 'A', 1)),
      { type: 'updatePlan', cruiseId: 'c1', group: 'A', patch: { tips: 0.1, agentFee: 0.2 } },
    );
    expect(computePlan(s, 'c1', 'A').total).toBe(4805.3);
    expect(gap(0.3, 0.1 + 0.2)).toBe(0);
  });

  it('flags what is missing / not included instead of guessing', () => {
    const r = computePlan(initialState(), 'c1', 'A');
    expect(r.missing).toEqual(['room', 'outFlight', 'backFlight']);
    expect(r.notIncluded).toEqual(['flights', 'hotel', 'tips', 'agentFee']);
  });
});

describe('12-15. dates and groups stay separate', () => {
  it('changing the room for 05/09 does not touch 19/09', () => {
    const s0 = run(initialState(), select('c1', 'A', roomId('c1', 'A', 1)), select('c2', 'A', roomId('c2', 'A', 2)));
    const before = computePlan(s0, 'c2', 'A');
    const s1 = run(s0, select('c1', 'A', roomId('c1', 'A', 3)));
    expect(computePlan(s1, 'c1', 'A').total).toBe(5880);
    expect(computePlan(s1, 'c2', 'A')).toEqual(before);
  });

  it('changing the room of group A leaves group B untouched', () => {
    const s0 = run(initialState(), select('c1', 'A', roomId('c1', 'A', 1)), select('c1', 'B', roomId('c1', 'B', 1)));
    const before = computePlan(s0, 'c1', 'B');
    const s1 = run(s0, select('c1', 'A', roomId('c1', 'A', 3)));
    expect(computePlan(s1, 'c1', 'B')).toEqual(before);
  });

  it('extras entered for 05/09 do not leak into 19/09', () => {
    const s = run(
      initialState(),
      select('c1', 'A', roomId('c1', 'A', 1)),
      select('c2', 'A', roomId('c2', 'A', 1)),
      { type: 'updatePlan', cruiseId: 'c1', group: 'A', patch: { tips: 500, agentFee: 100 } },
    );
    expect(computePlan(s, 'c1', 'A').total).toBe(4805 + 600);
    expect(computePlan(s, 'c2', 'A').total).toBe(5825);
  });

  it('flights of 05/09 are not counted on 19/09 even if referenced', () => {
    const f = flight('c1', 'out', { base: { adult: 300, infant: 300 } });
    let s = run(initialState(), { type: 'addFlight', flight: f }, select('c2', 'A', roomId('c2', 'A', 1)));
    s = { ...s, plans: { ...s.plans, c2: { ...s.plans.c2!, A: { ...s.plans.c2!.A, outFlightId: f.id } } } };
    expect(computePlan(s, 'c2', 'A').breakdown.flights).toBe(0);
  });

  it('the scenario from the brief: each group/date picks a different room', () => {
    const s = run(
      initialState(),
      select('c1', 'A', roomId('c1', 'A', 1)), // 05/09 A = balcony inner
      select('c1', 'B', roomId('c1', 'B', 3)), // 05/09 B = ocean view
      select('c2', 'A', roomId('c2', 'A', 2)), // 19/09 A = central park balcony
      select('c2', 'B', roomId('c2', 'B', 1)), // 19/09 B = inner
    );
    expect(computePlan(s, 'c1', 'A').total).toBe(4805);
    expect(computePlan(s, 'c1', 'B').total).toBe(4780);
    expect(computePlan(s, 'c2', 'A').total).toBe(5085);
    expect(computePlan(s, 'c2', 'B').total).toBe(3935);
  });

  it('group B data (rooms, hotel, flights, tips) never enters the group A total', () => {
    const f = flight('c1', 'out', { base: { adult: 1000, infant: 1000 } });
    const h = hotel('c1', 'B', { manualNights: 5, pricePerNight: 999 });
    const s = run(
      initialState(),
      select('c1', 'A', roomId('c1', 'A', 1)),
      { type: 'addFlight', flight: f },
      { type: 'addHotel', hotel: h },
      select('c1', 'B', roomId('c1', 'B', 2)),
      { type: 'updatePlan', cruiseId: 'c1', group: 'B', patch: { outFlightId: f.id, hotelId: h.id, tips: 777, agentFee: 333, drinks: 5, internet: 6, transport: 7, other: 8 } },
    );
    const a = computePlan(s, 'c1', 'A');
    expect(a.total).toBe(4805);
    expect(a.extras).toBe(0);
    const b = computePlan(s, 'c1', 'B');
    expect(b.total).toBe(5140 + 2000 + 4995 + 777 + 333 + 26);
  });

  it('cruise-only price is reported separately from the total trip', () => {
    const s = run(
      initialState(),
      select('c1', 'A', roomId('c1', 'A', 1)),
      { type: 'updatePlan', cruiseId: 'c1', group: 'A', patch: { tips: 250 } },
    );
    const r = computePlan(s, 'c1', 'A');
    expect(r.cruiseOnly).toBe(4805);
    expect(r.total).toBe(5055);
  });
});

describe('rooms: no assumptions from room names', () => {
  it('cheapest room is found by price, not by name (05/09 B: ocean view < central park)', () => {
    const r = cheapestRoom(initialState(), 'c1', 'B')!;
    expect(r.room!.id).toBe('c1-B1'); // inner 3775
    // And between the two non-inner rooms ocean view (4780) beats central park (5140).
    const s = initialState();
    const cruise = s.cruises[0]!;
    expect(cruise.rooms.B[2]!.price!).toBeLessThan(cruise.rooms.B[1]!.price!);
  });

  it('19/09 A: central park balcony is cheaper than the inner balcony', () => {
    const r = cheapestRoom(initialState(), 'c2', 'A')!;
    expect(r.room!.id).toBe('c2-A2');
    expect(r.total).toBe(5085);
  });

  it('cheapest overall per group picks the right date', () => {
    const s = initialState();
    expect(cheapestOverall(s, 'A')!.cruiseId).toBe('c1');
    expect(cheapestOverall(s, 'A')!.total).toBe(4805);
    expect(cheapestOverall(s, 'B')!.cruiseId).toBe('c1');
    expect(cheapestOverall(s, 'B')!.total).toBe(3775);
  });

  it('a room without a price is never "cheapest"', () => {
    let s = initialState();
    s = run(s, { type: 'addRoom', cruiseId: 'c1', group: 'A', id: 'new' });
    expect(cheapestRoom(s, 'c1', 'A')!.room!.id).toBe('c1-A1');
    const r = computePlan(run(s, select('c1', 'A', 'new')), 'c1', 'A');
    expect(r.missing).toContain('cruisePrice');
  });

  it('extras of a cruise date are the same for every room of that date', () => {
    const s = run(initialState(), { type: 'updatePlan', cruiseId: 'c1', group: 'A', patch: { tips: 100 } });
    expect(computePlan(s, 'c1', 'A', 'c1-A1').total).toBe(4905);
    expect(computePlan(s, 'c1', 'A', 'c1-A3').total).toBe(5980);
  });

  it('removing a selected room clears the selection of that group only', () => {
    const s = run(
      initialState(),
      select('c1', 'A', roomId('c1', 'A', 1)),
      select('c1', 'B', roomId('c1', 'B', 1)),
      { type: 'removeRoom', cruiseId: 'c1', group: 'A', roomId: 'c1-A1' },
    );
    expect(s.plans.c1!.A.roomId).toBeNull();
    expect(s.plans.c1!.B.roomId).toBe('c1-B1');
  });
});

describe('flight ranking', () => {
  it('marks the cheapest priced flight per group and ignores unpriced flights', () => {
    const cheap = flight('c1', 'out', { airline: 'cheap', base: { adult: 200, infant: null } });
    const pricey = flight('c1', 'out', { airline: 'pricey', base: { adult: 350, infant: null } });
    const blank = flight('c1', 'out', { airline: 'blank' });
    const s = run(initialState(), ...[pricey, blank, cheap].map((f) => ({ type: 'addFlight', flight: f }) as Action));
    const ranked = rankFlights(s, 'c1', 'out');
    expect(ranked[0]!.flight.airline).toBe('blank');
    const marked = ranked.filter((r) => r.cheapest.A).map((r) => r.flight.airline);
    expect(marked).toEqual(['cheap']);
  });

  it('only returns flights for the requested cruise and direction', () => {
    const f1 = flight('c1', 'out');
    const f2 = flight('c2', 'out');
    const f3 = flight('c1', 'back');
    const s = run(initialState(), ...[f1, f2, f3].map((f) => ({ type: 'addFlight', flight: f }) as Action));
    expect(rankFlights(s, 'c1', 'out').map((r) => r.flight.id)).toEqual([f1.id]);
  });

  it('removing a flight clears it from every plan', () => {
    const f = flight('c1', 'out', { base: { adult: 100, infant: 0 } });
    const s = run(
      initialState(),
      { type: 'addFlight', flight: f },
      { type: 'updatePlan', cruiseId: 'c1', group: 'A', patch: { outFlightId: f.id } },
      { type: 'updatePlan', cruiseId: 'c1', group: 'B', patch: { outFlightId: f.id } },
      { type: 'removeFlight', id: f.id },
    );
    expect(s.plans.c1!.A.outFlightId).toBeNull();
    expect(s.plans.c1!.B.outFlightId).toBeNull();
  });
});

describe('cruise management', () => {
  it('adding a cruise copies room names but not prices', () => {
    const s = run(initialState(), { type: 'addCruise', id: 'c3' });
    const c3 = s.cruises.find((c) => c.id === 'c3')!;
    expect(c3.rooms.A.map((r) => r.name)).toEqual(s.cruises[1]!.rooms.A.map((r) => r.name));
    expect(c3.rooms.A.every((r) => r.price === null)).toBe(true);
    expect(s.plans.c3).toBeDefined();
  });

  it('removing a cruise removes its flights, hotels, plans and favorites, and nothing else', () => {
    const f = flight('c1', 'out');
    const keep = flight('c2', 'out');
    const s = run(
      initialState(),
      { type: 'addFlight', flight: f },
      { type: 'addFlight', flight: keep },
      { type: 'setFavorite', group: 'A', cruiseId: 'c1' },
      { type: 'removeCruise', id: 'c1' },
    );
    expect(s.cruises.map((c) => c.id)).toEqual(['c2']);
    expect(s.flights.map((x) => x.id)).toEqual([keep.id]);
    expect(s.plans.c1).toBeUndefined();
    expect(s.favorite.A).toBeNull();
  });
});
