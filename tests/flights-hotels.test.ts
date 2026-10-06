import { describe, expect, it } from 'vitest';
import {
  cruiseVsTrip,
  compareDates,
  computePlan,
  flightCost,
  hasNotice,
  hotelCost,
  hotelNativeCost,
  hotelNeedsConversion,
  hotelNights,
  hotelShare,
  perAdult,
  rateFlight,
  recommendation,
  tripTimeline,
} from '../src/domain/calc';
import { applySeeds, elAlBenchmarkA, freshState, initialState, newHotelFor } from '../src/domain/seed';
import { exportJson, importJson, normalizeState } from '../src/domain/storage';
import type { AppState, Flight } from '../src/domain/types';
import { flight, fresh, hotel, plan, run, selectRoom } from './helpers';

const strip = (s: string) => s.replace(/[⁦⁩]/g, '');

/** A direct EL AL-style round trip for group A. */
function round(cruiseId: string, patch: Partial<Flight> = {}): Flight {
  const c2 = cruiseId === 'c2';
  return flight(cruiseId, 'A', 'round', {
    airline: 'EL AL',
    date: c2 ? '2027-09-17' : '2027-09-03',
    depTime: '14:25',
    arrTime: '18:05',
    fromAirport: 'TLV',
    toAirport: 'BCN',
    stops: 0,
    returnDate: c2 ? '2027-09-28' : '2027-09-14',
    returnStops: 0,
    cartTotal: 900,
    ...patch,
  });
}

describe('EL AL cart from the user (benchmark)', () => {
  it('is in the starting data: group A selected, group B derived and not selected', () => {
    const s = freshState();
    expect(s.flights.map((f) => [f.id, f.group, f.verified, f.benchmark])).toEqual([
      ['bench-elal-A', 'A', true, true],
      ['bench-elal-B', 'B', false, true],
    ]);
    expect(s.plans.c1!.A.outFlightId).toBe('bench-elal-A');
    expect(s.plans.c1!.B.outFlightId).toBeNull();
  });

  it('records the details exactly as given – and invents nothing', () => {
    const f = elAlBenchmarkA();
    expect([f.airline, f.date, f.depTime, f.arrTime, f.fromAirport, f.toAirport, f.stops, f.duration]).toEqual([
      'EL AL', '2027-09-03', '14:25', '18:05', 'TLV', 'BCN', 0, '4:40',
    ]);
    expect([f.returnDate, f.returnStops]).toEqual(['2027-09-14', 0]);
    expect([f.flightNo, f.returnFlightNo, f.returnDepTime, f.returnArrTime, f.baggageInfo]).toEqual(['', '', '', '', '']);
    expect([f.cartTotal, f.fareOut, f.fareBack, f.fareType]).toEqual([915.96, 514.26, 401.7, 'Lite (N) הלוך / Lite (U) חזור']);
    expect(f.checkedAt).toBe('2026-10-06');
    expect(f.source).toContain('EL AL');
  });

  it('is ONE round trip: $915.96, never $1,831.92', () => {
    const s = run(freshState(), selectRoom('c1', 'A', 'c1-A1'));
    const a = computePlan(s, 'c1', 'A');
    expect(a.roundTrip).toBe(true);
    expect(a.out!.id).toBe('bench-elal-A');
    expect(a.back).toBeNull();
    expect(a.lines.flights.amount).toBe(915.96);
    expect(a.total).toBe(4805 + 915.96);
    expect(a.total).not.toBe(4805 + 1831.92);
  });

  it('the cart total is the source of truth – the per-person details are not recalculated', () => {
    const f = elAlBenchmarkA();
    expect(flightCost(f, { adults: 2, infants: 1 }).fare).toBe(915.96);
    // The breakdown 229+120+69.88 per adult and 46+32.20 for the infant happens to add up to the same number…
    expect(418.88 * 2 + 78.2).toBeCloseTo(915.96, 2);
    // …but if it did not, the cart total still wins and the user is told.
    const odd = { ...f, fare: { 'adult-1': 100, 'adult-2': 100, 'infant-1': 0 } };
    const c = flightCost(odd, { adults: 2, infants: 1 });
    expect(c.fare).toBe(915.96);
    expect(c.cartMismatch).toBe(true);
  });

  it('the legs ($514.26 + $401.70) are information only and are not added on top', () => {
    const s = run(freshState(), selectRoom('c1', 'A', 'c1-A1'));
    expect(computePlan(s, 'c1', 'A').lines.flights.amount).toBe(915.96);
    expect(514.26 + 401.7).toBeCloseTo(915.96, 2);
  });

  it('seats and baggage stay separate lines on top of the cart total', () => {
    const s = run(
      freshState(),
      selectRoom('c1', 'A', 'c1-A1'),
      { type: 'setFlightPrice', id: 'bench-elal-A', row: 'seat', slotId: 'adult-1', value: 35 },
      { type: 'setFlightPrice', id: 'bench-elal-A', row: 'seat', slotId: 'adult-2', value: 35 },
      { type: 'setFlightPrice', id: 'bench-elal-A', row: 'baggage', slotId: 'adult-1', value: 70 },
    );
    const a = computePlan(s, 'c1', 'A');
    expect(a.lines.flights.amount).toBe(915.96);
    expect(a.lines.seats.amount).toBe(70);
    expect(a.lines.baggage.amount).toBe(70);
    expect(a.total).toBe(4805 + 915.96 + 70 + 70);
  });

  it('the baby gets no seat and no bag unless a price is typed', () => {
    const c = flightCost(elAlBenchmarkA(), { adults: 2, infants: 1 });
    expect([c.seats, c.baggage, c.seatsEntered, c.baggageEntered]).toEqual([0, 0, false, false]);
  });

  it('group B: derived price is $837.76, marked unverified, and group A is untouched', () => {
    const s = run(freshState(), selectRoom('c1', 'A', 'c1-A1'), selectRoom('c1', 'B', 'c1-B1'), plan('c1', 'B', { outFlightId: 'bench-elal-B' }));
    const b = computePlan(s, 'c1', 'B');
    expect(b.lines.flights.amount).toBe(837.76);
    expect(hasNotice(b, 'unverifiedFlight')).toBe(true);
    expect(computePlan(s, 'c1', 'A').total).toBe(4805 + 915.96);
    // changing B's flight leaves A alone
    const s2 = run(s, { type: 'setFlightPrice', id: 'bench-elal-B', row: 'fare', slotId: 'adult-1', value: 1 });
    expect(computePlan(s2, 'c1', 'A').total).toBe(4805 + 915.96);
  });

  it('the 05/09 flight never leaks into 19/09', () => {
    const s = run(freshState(), selectRoom('c2', 'A', 'c2-A1'));
    expect(computePlan(s, 'c2', 'A').lines.flights.entered).toBe(false);
    expect(computePlan(s, 'c2', 'A').total).toBe(5825);
  });

  it('seeding happens once: a deleted benchmark does not come back', () => {
    const removed = run(freshState(), { type: 'removeFlight', id: 'bench-elal-A' }, { type: 'removeFlight', id: 'bench-elal-B' });
    expect(applySeeds(removed).flights).toEqual([]);
    expect(importJson(exportJson(removed))!.flights).toEqual([]);
  });

  it('an older backup (version 2) gets the cart once, without changing its own data', () => {
    const v2 = { ...initialState(), version: 2, seeds: undefined } as unknown as Record<string, unknown>;
    const n = normalizeState(v2)!;
    expect(n.version).toBe(3);
    expect(n.flights.map((f) => f.id)).toEqual(['bench-elal-A', 'bench-elal-B']);
    expect(n.seeds.elAlBenchmark).toBe(true);
  });
});

describe('flight rating – a recommendation with reasons', () => {
  it('benchmark: direct, 2 days before, 2 days after → ⭐ with the reasons', () => {
    const r = rateFlight(freshState(), elAlBenchmarkA());
    expect(r.level).toBe('recommended');
    expect(r.icon).toBe('⭐');
    expect(r.reasons).toContain('ישירה בשני הכיוונים');
    expect(r.reasons).toContain('מגיעה יומיים לפני הקרוז');
    expect(r.reasons).toContain('חוזרת יומיים אחרי הירידה');
    expect([r.outBuffer, r.backBuffer]).toEqual([2, 2]);
  });

  it('arriving on the cruise day is 🔴', () => {
    const r = rateFlight(fresh(), round('c1', { date: '2027-09-05' }));
    expect(r.level).toBe('bad');
    expect(r.reasons.join(' ')).toContain('ביום יציאת הקרוז');
  });

  it('returning on the disembark day is 🔴', () => {
    const r = rateFlight(fresh(), round('c1', { returnDate: '2027-09-12' }));
    expect(r.level).toBe('bad');
    expect(r.reasons.join(' ')).toContain('ביום הירידה');
  });

  it('two stops is 🔴; one stop is 🟡 and never ⭐', () => {
    expect(rateFlight(fresh(), round('c1', { stops: 2 })).level).toBe('bad');
    const one = rateFlight(fresh(), round('c1', { stops: 1 }));
    expect(one.level).toBe('compromise');
    expect(one.icon).toBe('🟡');
    expect(one.reasons).toContain('עצירה בהלוך');
  });

  it('a one-stop flight ranks below a similar direct one even when cheaper', () => {
    const direct = round('c1', { airline: 'DIRECT', cartTotal: 900 });
    const stop = round('c1', { airline: 'STOP', cartTotal: 650, stops: 1 });
    const s = run(fresh(), { type: 'addFlight', flight: direct }, { type: 'addFlight', flight: stop });
    expect(rateFlight(s, direct).level).toBe('recommended');
    expect(rateFlight(s, stop).level).toBe('compromise');
  });

  it('too many buffer days is 🟡 (extra hotel nights), 1 day is fine', () => {
    expect(rateFlight(fresh(), round('c1', { date: '2027-08-30' })).level).toBe('compromise');
    expect(rateFlight(fresh(), round('c1', { date: '2027-09-04' })).level).toBe('recommended');
  });

  it('very early departure / very late arrival is 🟡', () => {
    expect(rateFlight(fresh(), round('c1', { depTime: '05:45' })).level).toBe('compromise');
    expect(rateFlight(fresh(), round('c1', { arrTime: '23:30' })).level).toBe('compromise');
  });

  it('missing dates or stops → not rated (never guessed)', () => {
    expect(rateFlight(fresh(), round('c1', { date: '' })).level).toBe('unknown');
    expect(rateFlight(fresh(), round('c1', { stops: null })).level).toBe('unknown');
  });

  it('an unverified price can never be ⭐', () => {
    const r = rateFlight(fresh(), round('c1', { verified: false }));
    expect(r.level).toBe('compromise');
    expect(r.reasons).toContain('מחיר לא מאומת');
  });

  it('price: 🟢 good price for the cheapest, 🟡 for 20%+ above, 🔴 for 50%+ above', () => {
    const cheap = round('c1', { airline: 'CHEAP', cartTotal: 800 });
    const mid = round('c1', { airline: 'MID', cartTotal: 1000 });
    const outlier = round('c1', { airline: 'OUTLIER', cartTotal: 1300 });
    const s = run(fresh(), ...[cheap, mid, outlier].map((f) => ({ type: 'addFlight', flight: f }) as const));
    expect(rateFlight(s, cheap).goodPrice).toBe(true);
    expect(rateFlight(s, mid).level).toBe('compromise');
    expect(rateFlight(s, outlier).level).toBe('bad');
  });

  it('one-way flights are rated by their own leg only', () => {
    const out = flight('c1', 'A', 'out', { date: '2027-09-03', stops: 0, cartTotal: 500 });
    const back = flight('c1', 'A', 'back', { date: '2027-09-13', stops: 0, cartTotal: 400 });
    const s = fresh();
    expect(rateFlight(s, out).level).toBe('recommended');
    expect(rateFlight(s, back).level).toBe('recommended');
    expect(rateFlight(s, { ...back, date: '2027-09-12' }).level).toBe('bad');
  });
});

describe('hotel', () => {
  const eur = () => hotel('c1', 'A', { currency: 'EUR', manualNights: 2, pricePerNight: 150, taxes: 10, cityTax: 8, breakfast: 20, resortFee: 12 });

  it('nights come from the dates: 03/09 → 05/09 = 2', () => {
    const h = hotel('c1', 'A', { checkIn: '2027-09-03', checkOut: '2027-09-05' });
    expect(hotelNights(h)).toEqual({ nights: 2, fromDates: true });
  });

  it('2 nights × $150 + taxes + city tax + breakfast + resort fee + other', () => {
    const h = hotel('c1', 'A', { manualNights: 2, pricePerNight: 150, taxes: 10, cityTax: 8, breakfast: 20, resortFee: 12, other: 5 });
    expect(hotelCost(h)).toBe(300 + 10 + 8 + 20 + 12 + 5);
  });

  it('euro price: shows the euro total, invents no rate, and waits for a USD amount', () => {
    const h = eur();
    expect(hotelNativeCost(h)).toBe(300 + 10 + 8 + 20 + 12);
    expect(hotelNeedsConversion(h)).toBe(true);
    expect(hotelCost(h)).toBe(0);
    const s = run(fresh(), { type: 'addHotel', hotel: h }, selectRoom('c1', 'A', 'c1-A1'), plan('c1', 'A', { hotelId: h.id }));
    const a = computePlan(s, 'c1', 'A');
    expect(a.lines.hotel.entered).toBe(false);
    expect(hasNotice(a, 'hotelCurrency')).toBe(true);
    expect(a.total).toBe(4805);
  });

  it('after the user types the USD amount, it is added to the total', () => {
    const h = { ...eur(), usdTotal: 420 };
    expect(hotelNeedsConversion(h)).toBe(false);
    const s = run(fresh(), { type: 'addHotel', hotel: h }, selectRoom('c1', 'A', 'c1-A1'), plan('c1', 'A', { hotelId: h.id }));
    expect(computePlan(s, 'c1', 'A').lines.hotel).toEqual({ amount: 420, entered: true });
    expect(computePlan(s, 'c1', 'A').total).toBe(4805 + 420);
  });

  it('selecting a different hotel changes the total; the hotel goes to the right group only', () => {
    const cheap = hotel('c1', 'A', { name: 'Cheap', manualNights: 2, pricePerNight: 100 });
    const dear = hotel('c1', 'A', { name: 'Dear', manualNights: 2, pricePerNight: 250 });
    const forB = hotel('c1', 'B', { name: 'B only', manualNights: 2, pricePerNight: 999 });
    let s = run(fresh(), ...[cheap, dear, forB].map((h) => ({ type: 'addHotel', hotel: h }) as const), selectRoom('c1', 'A', 'c1-A1'));
    s = run(s, plan('c1', 'A', { hotelId: cheap.id }));
    expect(computePlan(s, 'c1', 'A').total).toBe(4805 + 200);
    s = run(s, plan('c1', 'A', { hotelId: dear.id }));
    expect(computePlan(s, 'c1', 'A').total).toBe(4805 + 500);
    expect(computePlan(s, 'c1', 'B').lines.hotel.entered).toBe(false);
  });

  it('a shared hotel is split 50/50 or by hand', () => {
    const half = hotel('c1', 'both', { manualNights: 2, pricePerNight: 210 });
    expect([hotelShare(half, 'A').amount, hotelShare(half, 'B').amount]).toEqual([210, 210]);
    const custom = { ...half, split: 'custom' as const, shareA: 300 };
    expect([hotelShare(custom, 'A').amount, hotelShare(custom, 'B').amount]).toEqual([300, 120]);
  });

  it('a hotel after the cruise is its own line and does not touch the hotel before', () => {
    const before = hotel('c1', 'A', { phase: 'before', manualNights: 2, pricePerNight: 100 });
    const after = hotel('c1', 'A', { phase: 'after', manualNights: 2, pricePerNight: 130 });
    const s = run(
      fresh(),
      { type: 'addHotel', hotel: before },
      { type: 'addHotel', hotel: after },
      selectRoom('c1', 'A', 'c1-A1'),
      plan('c1', 'A', { hotelId: before.id, hotelAfterId: after.id }),
    );
    const a = computePlan(s, 'c1', 'A');
    expect([a.lines.hotel.amount, a.lines.hotelAfter.amount]).toEqual([200, 260]);
    expect(a.total).toBe(4805 + 200 + 260);
  });

  it('a hotel can only be selected for its own phase, and changing the phase clears the wrong selection', () => {
    const h = hotel('c1', 'A', { phase: 'before', manualNights: 1, pricePerNight: 100 });
    let s = run(fresh(), { type: 'addHotel', hotel: h }, plan('c1', 'A', { hotelId: h.id, hotelAfterId: h.id }));
    expect(computePlan(s, 'c1', 'A').hotelAfter).toBeNull();
    s = run(s, { type: 'updateHotel', id: h.id, patch: { phase: 'after' } });
    expect(s.plans.c1!.A.hotelId).toBeNull();
    expect(s.plans.c1!.A.hotelAfterId).toBe(h.id);
  });

  it('"no hotel after" is a decision; undecided after is only an info notice', () => {
    const undecided = computePlan(fresh(), 'c1', 'A');
    expect(undecided.notices.find((n) => n.code === 'hotelAfterUndecided')!.severity).toBe('blue');
    const decided = computePlan(run(fresh(), plan('c1', 'A', { noHotelAfter: true })), 'c1', 'A');
    expect(decided.lines.hotelAfter).toEqual({ amount: 0, entered: true, label: 'לא צריך' });
  });

  it('new hotels get the planned dates: 2 nights before / after the cruise, and no price', () => {
    const cruise = fresh().cruises[0]!;
    const before = newHotelFor(cruise, 'A', 'before');
    expect([before.checkIn, before.checkOut]).toEqual(['2027-09-03', '2027-09-05']);
    expect(hotelNights(before).nights).toBe(2);
    const after = newHotelFor(cruise, 'A', 'after');
    expect([after.checkIn, after.checkOut]).toEqual(['2027-09-12', '2027-09-14']);
    expect([before.pricePerNight, after.pricePerNight]).toEqual([null, null]);
  });
});

describe('trip timeline', () => {
  it('flight → hotel → cruise → hotel → flight home', () => {
    const before = hotel('c1', 'A', { name: 'H1', checkIn: '2027-09-03', checkOut: '2027-09-05' });
    const after = hotel('c1', 'A', { phase: 'after', name: 'H2', checkIn: '2027-09-12', checkOut: '2027-09-14' });
    const s = run(freshState(), { type: 'addHotel', hotel: before }, { type: 'addHotel', hotel: after }, plan('c1', 'A', { hotelId: before.id, hotelAfterId: after.id }));
    const t = tripTimeline(s, 'c1', 'A');
    expect(t.map((e) => [e.kind, e.from, e.to])).toEqual([
      ['flight', '2027-09-03', ''],
      ['hotel', '2027-09-03', '2027-09-05'],
      ['cruise', '2027-09-05', '2027-09-12'],
      ['hotel', '2027-09-12', '2027-09-14'],
      ['flight', '2027-09-14', ''],
    ]);
  });

  it('shows only the cruise when nothing else is chosen', () => {
    expect(tripTimeline(fresh(), 'c2', 'B').map((e) => e.kind)).toEqual(['cruise']);
  });
});

describe('cruise price vs. total trip, per adult', () => {
  /** Both dates complete for group A. */
  function complete(c1Flight: number, c2Flight: number): AppState {
    return run(
      fresh(),
      { type: 'addFlight', flight: round('c1', { id: 'f1', cartTotal: c1Flight }) },
      { type: 'addFlight', flight: round('c2', { id: 'f2', cartTotal: c2Flight }) },
      plan('c1', 'A', { roomId: 'c1-A1', outFlightId: 'f1', noHotel: true, tips: 0, agentFee: 0 }),
      plan('c2', 'A', { roomId: 'c2-A2', outFlightId: 'f2', noHotel: true, tips: 0, agentFee: 0 }),
    );
  }

  it('the cheaper cruise is not always the cheaper holiday', () => {
    // cruise: 05/09 $4,805 vs 19/09 $5,085 (05/09 cheaper by $280); trip: 4,805+1,200 = 6,005 vs 5,085+400 = 5,485
    const cmp = compareDates(complete(1200, 400), 'A');
    const t = cruiseVsTrip(cmp);
    expect([t.cruiseCheapest, t.cruiseGap, t.tripCheapest, t.tripGap, t.differs]).toEqual([0, 280, 1, 520, true]);
  });

  it('when both agree there is no warning', () => {
    const t = cruiseVsTrip(compareDates(complete(900, 900), 'A'));
    expect(t.differs).toBe(false);
  });

  it('per adult is secondary: total ÷ adults (the baby cost stays inside)', () => {
    expect(perAdult(6005, { adults: 2, infants: 1 })).toBe(3002.5);
    expect(perAdult(100, { adults: 0, infants: 1 })).toBeNull();
  });

  it('recommendation: cheaper trip wins, with reasons', () => {
    const s = complete(900, 900); // 5,705 vs 5,985
    const r = recommendation(s, 'A');
    expect(r.status).toBe('recommend');
    expect(r.cruiseId).toBe('c1');
    expect(r.reasons).toContain('ישירה בשני הכיוונים');
    expect(r.reasons.some((x) => x.includes('כל הטיול זול ב-$280'))).toBe(true);
    expect(r.reasons.some((x) => x.includes('הקרוז זול ב-$280'))).toBe(true);
  });

  it('recommendation: the cheapest date is passed over when its flights are rated 🔴', () => {
    const s = run(complete(900, 900), { type: 'updateFlight', id: 'f1', patch: { date: '2027-09-05' } });
    const r = recommendation(s, 'A');
    expect(r.cruiseId).toBe('c2');
    expect(r.cautions.join(' ')).toContain('"לא מומלץ"');
  });

  it('recommendation: no recommendation when every date has bad flights, or equal totals', () => {
    const allBad = run(complete(900, 900), { type: 'updateFlight', id: 'f1', patch: { stops: 3 } }, { type: 'updateFlight', id: 'f2', patch: { stops: 3 } });
    expect(recommendation(allBad, 'A').status).toBe('none');
    const equal = run(complete(900, 900), { type: 'updateFlight', id: 'f2', patch: { cartTotal: 620 } }); // 5,705 vs 5,705
    expect(recommendation(equal, 'A').status).toBe('none');
  });

  it('recommendation: "too early to choose" lists what is missing', () => {
    const r = recommendation(fresh(), 'A');
    expect(r.status).toBe('early');
    expect(r.missing).toEqual(['חדר', 'טיסות', 'מלון', 'טיפים', 'עמלה']);
  });

  it('recommendation: stays "too early" when only one date has flights (partial)', () => {
    const s = run(fresh(), { type: 'addFlight', flight: round('c1', { id: 'f1' }) }, plan('c1', 'A', { roomId: 'c1-A1', outFlightId: 'f1', noHotel: true, tips: 0, agentFee: 0 }), selectRoom('c2', 'A', 'c2-A2'));
    expect(recommendation(s, 'A').status).toBe('early');
  });

  it('recommendation is per group: group B is not influenced by group A', () => {
    const s = complete(900, 900);
    expect(recommendation(s, 'B').status).toBe('early');
    expect(recommendation(run(s, { type: 'setGroupBEnabled', enabled: false }), 'A')).toEqual(recommendation(s, 'A'));
  });

  it('partial comparison: one date with a flight, the other without → never "date X is cheaper"', () => {
    const s = run(freshState(), selectRoom('c1', 'A', 'c1-A1'), selectRoom('c2', 'A', 'c2-A1'));
    const cmp = compareDates(s, 'A');
    expect(cmp.partial).toBe(true);
    expect(cmp.reasons.map(strip)).toContain('ב-19/09 חסרות טיסות');
  });
});
