import { describe, expect, it } from 'vitest';
import {
  activeGroups,
  adultBreakdownCents,
  computePlan,
  fareLadder,
  flightCost,
  goodNews,
  hasNotice,
  plannedStay,
  priceCheck,
  todoList,
  tripOption,
} from '../src/domain/calc';
import { FARE_RULES } from '../src/domain/fares';
import { hotelNights } from '../src/domain/calc';
import { applySeeds, elAlFareId, elAlFares, freshState } from '../src/domain/seed';
import { exportJson, importJson, loadState, normalizeState, saveState } from '../src/domain/storage';
import type { AppState, Flight } from '../src/domain/types';
import { fresh, hotel, plan, run, selectRoom } from './helpers';

const withFares = (): AppState => ({ ...fresh(), flights: elAlFares(), seeds: { elAlBenchmark: true, elAlFares: true } });
const fare = (s: AppState, cruise: 'c1' | 'c2', cls: 'lite' | 'classic' | 'flex'): Flight =>
  s.flights.find((f) => f.id === elAlFareId(cruise, cls))!;
const mode = (id: string, m: 'unverified' | 'total' | 'breakdown') => ({ type: 'updateFlight' as const, id, patch: { priceMode: m } });

describe('EL AL fares – the data exactly as supplied', () => {
  it('six records: Lite / Classic / Flex for both cruises, shared by both groups', () => {
    const s = withFares();
    expect(s.flights).toHaveLength(6);
    for (const f of s.flights) {
      expect(f.group).toBe('both');
      expect(f.direction).toBe('round');
      expect(f.airline).toBe('EL AL');
      expect([f.fromAirport, f.toAirport, f.stops, f.returnStops]).toEqual(['TLV', 'BCN', 0, 0]);
      expect(f.searchedFor).toContain('4 מבוגרים + תינוק');
    }
    expect(s.flights.map((f) => [f.cruiseId, f.fareClass])).toEqual([
      ['c1', 'lite'], ['c2', 'lite'], ['c1', 'classic'], ['c2', 'classic'], ['c1', 'flex'], ['c2', 'flex'],
    ]);
  });

  it('dates and times are the supplied ones (03/09–13/09 and 17/09–27/09); nothing else is invented', () => {
    const c1 = fare(withFares(), 'c1', 'lite');
    const c2 = fare(withFares(), 'c2', 'lite');
    expect([c1.date, c1.depTime, c1.returnDate, c1.returnDepTime]).toEqual(['2027-09-03', '14:25', '2027-09-13', '22:35']);
    expect([c2.date, c2.depTime, c2.returnDate, c2.returnDepTime]).toEqual(['2027-09-17', '14:10', '2027-09-27', '22:35']);
    expect([c1.flightNo, c1.returnFlightNo, c1.returnArrTime, c1.checkedAt, c2.arrTime]).toEqual(['', '', '', '', '']);
  });

  it('displayed prices and the per-passenger breakdown are stored separately, as supplied', () => {
    const table: [string, 'lite' | 'classic' | 'flex', number, number, number, number][] = [
      ['c1', 'lite', 262, 178, 249, 50],
      ['c2', 'lite', 192, 178, 369, 74],
      ['c1', 'classic', 322, 238, 369, 74],
      ['c2', 'classic', 252, 238, 299, 60],
      ['c1', 'flex', 372, 288, 469, 94],
      ['c2', 'flex', 302, 288, 399, 80],
    ];
    const s = withFares();
    for (const [c, cls, out, back, adult, baby] of table) {
      const f = fare(s, c as 'c1' | 'c2', cls);
      expect([f.displayedOut, f.displayedBack, f.adultFare, f.carrierSurcharge, f.adultTaxes, f.babyFare, f.babyTaxes]).toEqual([
        out, back, adult, 120, 69.88, baby, 32.2,
      ]);
    }
  });

  it('fare rules: Lite has no change/refund and an unknown bag + seat; Classic and Flex include both', () => {
    expect(FARE_RULES.lite).toMatchObject({ includesBaggage: false, includesSeat: false, change: '✗' });
    expect(FARE_RULES.lite.baggage).toContain('?');
    expect(FARE_RULES.lite.trolley).toContain('כפי שמוגדר בתעריף');
    expect(FARE_RULES.classic).toMatchObject({ includesBaggage: true, includesSeat: true, seat: 'מושב רגיל כלול', change: 'בתשלום' });
    expect(FARE_RULES.flex).toMatchObject({ includesBaggage: true, includesSeat: true, seat: 'כל סוג מושב כלול', change: 'חינם' });
    expect(FARE_RULES.flex.cancellation).toContain('מופחתים');
    expect(FARE_RULES.classic.voucher).toContain('שובר');
  });
});

describe('passengers – 4 adults + 1 baby, groups never mixed', () => {
  it('4 adults + 1 baby in total, A = 2 adults + baby, B = 2 adults', () => {
    const s = fresh();
    expect(s.passengers.A).toEqual({ adults: 2, infants: 1 });
    expect(s.passengers.B).toEqual({ adults: 2, infants: 0 });
    expect(s.passengers.A.adults + s.passengers.B.adults).toBe(4);
    expect(s.passengers.A.infants + s.passengers.B.infants).toBe(1);
  });

  it('breakdown mode: A = 2 × adult + baby, B = 2 × adult (not 5 × adult)', () => {
    const s = run(withFares(), mode('elal-c1-lite', 'breakdown'));
    const f = fare(s, 'c1', 'lite');
    expect(adultBreakdownCents(f)).toBe(43888);
    const a = flightCost(f, s.passengers.A, 'A');
    const b = flightCost(f, s.passengers.B, 'B');
    expect(a.fare).toBe(2 * 438.88 + 82.2);
    expect(b.fare).toBe(2 * 438.88);
    expect(a.fare + b.fare).toBeCloseTo(4 * 438.88 + 82.2, 2);
    expect(a.fare).not.toBeCloseTo(5 * 438.88, 0);
  });
});

describe('mismatch: displayed price vs breakdown', () => {
  it('is caught automatically for every one of the six records – and nothing is "fixed"', () => {
    const s = withFares();
    for (const f of s.flights) {
      const c = priceCheck(f);
      expect(c.comparable).toBe(true);
      expect(c.mismatch).toBe(true);
    }
    // Lite 03/09: shown $262 / $178, breakdown 249 + 120 + 69.88 = 438.88
    const lite = priceCheck(fare(s, 'c1', 'lite'));
    expect(lite.adultCents).toBe(43888);
    expect(lite.displayedSumCents).toBe(44000);
    expect(lite.diffCents).toBe(112);
    expect(priceCheck(fare(s, 'c1', 'classic')).adultCents).toBe(55888);
  });

  it('a displayed price that equals the breakdown to the cent is not a mismatch', () => {
    const f = { ...fare(withFares(), 'c1', 'lite'), displayedOut: 438.88, displayedBack: null };
    expect(priceCheck(f).mismatch).toBe(false);
    expect(priceCheck({ ...f, displayedOut: null, displayedBack: null }).comparable).toBe(false);
  });

  it('the starting state is "unverified": no price counted, ⚠️ "נדרש אימות מחיר"', () => {
    const s = run(withFares(), selectRoom('c1', 'A', 'c1-A1'), { type: 'selectFare', cruiseId: 'c1', flightId: 'elal-c1-lite' });
    const a = computePlan(s, 'c1', 'A');
    expect(fare(s, 'c1', 'lite').priceMode).toBe('unverified');
    expect(a.lines.flights.entered).toBe(false);
    expect(a.lines.flights.label).toBe('נדרש אימות מחיר');
    expect(a.total).toBe(4805); // the cruise only – the flight is NOT counted from either number
    expect(hasNotice(a, 'unverifiedFlight')).toBe(true);
    expect(a.notices.find((n) => n.code === 'unverifiedFlight')!.text).toContain('נדרש אימות מחיר');
    expect(a.status).toBe('yellow');
  });

  it('the displayed price and the breakdown are never added together', () => {
    const s = run(withFares(), mode('elal-c1-lite', 'breakdown'));
    const a = flightCost(fare(s, 'c1', 'lite'), s.passengers.A, 'A');
    expect(a.fare).toBe(959.96);
    expect(a.fare).not.toBe(959.96 + 440);
    expect(a.fare).not.toBe(959.96 + 262);
  });
});

describe('price verification states', () => {
  it('"use the entered total": the typed total is the price for the group', () => {
    const s = run(
      withFares(),
      mode('elal-c1-lite', 'total'),
      { type: 'setVerifiedTotal', id: 'elal-c1-lite', key: 'A', value: 1000 },
      { type: 'setVerifiedTotal', id: 'elal-c1-lite', key: 'B', value: 800 },
    );
    const f = fare(s, 'c1', 'lite');
    expect(flightCost(f, s.passengers.A, 'A')).toMatchObject({ fare: 1000, needsVerification: false });
    expect(flightCost(f, s.passengers.B, 'B')).toMatchObject({ fare: 800, needsVerification: false });
  });

  it('a party total without a known split is NOT divided by guess', () => {
    const s = run(withFares(), mode('elal-c1-lite', 'total'), { type: 'setVerifiedTotal', id: 'elal-c1-lite', key: 'all', value: 1800 });
    const f = fare(s, 'c1', 'lite');
    const a = flightCost(f, s.passengers.A, 'A');
    expect(a.splitUnknown).toBe(true);
    expect(a.needsVerification).toBe(true);
    expect(a.fare).toBe(0);
    // the split becomes known once one group's part is typed: the other pays the rest
    const s2 = run(s, { type: 'setVerifiedTotal', id: 'elal-c1-lite', key: 'A', value: 1000 });
    expect(flightCost(fare(s2, 'c1', 'lite'), s2.passengers.B, 'B').fare).toBe(800);
  });

  it('breakdown mode with a contradiction stays a 🟡 warning; unverified is the default', () => {
    const s = run(withFares(), selectRoom('c1', 'A', 'c1-A1'), { type: 'selectFare', cruiseId: 'c1', flightId: 'elal-c1-lite' }, mode('elal-c1-lite', 'breakdown'));
    const a = computePlan(s, 'c1', 'A');
    expect(a.lines.flights.amount).toBe(959.96);
    expect(hasNotice(a, 'priceMismatch')).toBe(true);
    expect(a.status).toBe('yellow');
    expect(withFares().flights.every((f) => f.priceMode === 'unverified')).toBe(true);
  });
});

describe('baggage and seats – no double counting', () => {
  const extras = (id: string) => [
    { type: 'setFareExtra' as const, id, row: 'baggage' as const, group: 'A' as const, value: 70 },
    { type: 'setFareExtra' as const, id, row: 'seat' as const, group: 'A' as const, value: 40 },
  ];

  it('Classic: the bag and the seat are included – a typed cost is ignored', () => {
    const s = run(withFares(), mode('elal-c1-classic', 'breakdown'), ...extras('elal-c1-classic'));
    const c = flightCost(fare(s, 'c1', 'classic'), s.passengers.A, 'A');
    expect([c.baggage, c.seats, c.baggageIncluded, c.seatIncluded]).toEqual([0, 0, true, true]);
    expect(c.ignoredExtras).toEqual(['מושב', 'מזוודה']);
    expect(c.total).toBe(c.fare);
  });

  it('Flex: the bag and the seat are included too – shown as "כלול", total unchanged', () => {
    const base = run(withFares(), selectRoom('c1', 'A', 'c1-A1'), { type: 'selectFare', cruiseId: 'c1', flightId: 'elal-c1-flex' }, mode('elal-c1-flex', 'breakdown'));
    const withTyped = run(base, ...extras('elal-c1-flex'));
    const a = computePlan(withTyped, 'c1', 'A');
    expect(a.total).toBe(computePlan(base, 'c1', 'A').total);
    expect(a.lines.baggage.label).toBe('כלולה בתעריף');
    expect(a.lines.seats.label).toBe('כלול בתעריף');
    expect(hasNotice(a, 'includedExtras')).toBe(true);
  });

  it('Lite: a bag bought separately is its own cost', () => {
    const s = run(withFares(), mode('elal-c1-lite', 'breakdown'), { type: 'setFareExtra', id: 'elal-c1-lite', row: 'baggage', group: 'A', value: 70 });
    const c = flightCost(fare(s, 'c1', 'lite'), s.passengers.A, 'A');
    expect([c.baggage, c.fare, c.total]).toEqual([70, 959.96, 1029.96]);
  });

  it('Lite: a seat bought separately is its own cost; nothing is added automatically', () => {
    const none = flightCost(fare(run(withFares(), mode('elal-c1-lite', 'breakdown')), 'c1', 'lite'), { adults: 2, infants: 1 }, 'A');
    expect([none.seats, none.baggage, none.seatsEntered]).toEqual([0, 0, false]);
    const s = run(withFares(), mode('elal-c1-lite', 'breakdown'), { type: 'setFareExtra', id: 'elal-c1-lite', row: 'seat', group: 'B', value: 55 });
    const b = flightCost(fare(s, 'c1', 'lite'), s.passengers.B, 'B');
    expect([b.seats, b.total]).toEqual([55, 877.76 + 55]);
    // group A did not get B's seat
    expect(flightCost(fare(s, 'c1', 'lite'), s.passengers.A, 'A').seats).toBe(0);
  });
});

describe('group isolation and independence', () => {
  it('turning group B off does not change group A', () => {
    const base = run(withFares(), selectRoom('c1', 'A', 'c1-A1'), { type: 'selectFare', cruiseId: 'c1', flightId: 'elal-c1-classic' }, mode('elal-c1-classic', 'breakdown'));
    const before = computePlan(base, 'c1', 'A');
    const off = run(base, { type: 'setGroupBEnabled', enabled: false });
    expect(activeGroups(off)).toEqual(['A']);
    expect(computePlan(off, 'c1', 'A')).toEqual(before);
    expect(before.lines.flights.amount).toBe(2 * 558.88 + 106.2);
  });

  it("group A's and group B's flight costs are computed on their own passengers", () => {
    const s = run(withFares(), selectRoom('c1', 'A', 'c1-A1'), selectRoom('c1', 'B', 'c1-B1'), { type: 'selectFare', cruiseId: 'c1', flightId: 'elal-c1-lite' }, mode('elal-c1-lite', 'breakdown'));
    expect(computePlan(s, 'c1', 'A').lines.flights.amount).toBe(959.96);
    expect(computePlan(s, 'c1', 'B').lines.flights.amount).toBe(877.76);
    expect(computePlan(s, 'c1', 'A').total).toBe(4805 + 959.96);
    expect(computePlan(s, 'c1', 'B').total).toBe(3775 + 877.76);
  });

  it('flight dates never change the cruise dates or the cruise prices', () => {
    const s = run(withFares(), { type: 'selectFare', cruiseId: 'c1', flightId: 'elal-c1-lite' });
    expect(s.cruises.map((c) => [c.id, c.start, c.end])).toEqual([
      ['c1', '2027-09-05', '2027-09-12'],
      ['c2', '2027-09-19', '2027-09-26'],
    ]);
    expect(s.cruises.flatMap((c) => [...c.rooms.A, ...c.rooms.B].map((r) => r.price))).toEqual([
      4805, 5280, 5880, 3775, 5140, 4780, 5825, 5085, 5505, 3935, 4920, 6020,
    ]);
  });

  it("selecting a fare on one cruise date does not touch the other date's plan", () => {
    const s = run(withFares(), { type: 'selectFare', cruiseId: 'c1', flightId: 'elal-c1-lite' });
    expect(s.plans.c1!.A.outFlightId).toBe('elal-c1-lite');
    expect(s.plans.c1!.B.outFlightId).toBe('elal-c1-lite');
    expect(s.plans.c2!.A.outFlightId).toBeNull();
  });
});

describe('hotel is part of the trip', () => {
  it('nights are derived from the flight dates: 03/09→05/09 and 12/09→13/09; 17/09→19/09 and 26/09→27/09', () => {
    const s = withFares();
    expect(plannedStay(s, 'c1', 'both', 'before')).toEqual({ checkIn: '2027-09-03', checkOut: '2027-09-05' });
    expect(plannedStay(s, 'c1', 'both', 'after')).toEqual({ checkIn: '2027-09-12', checkOut: '2027-09-13' });
    expect(plannedStay(s, 'c2', 'A', 'before')).toEqual({ checkIn: '2027-09-17', checkOut: '2027-09-19' });
    expect(plannedStay(s, 'c2', 'B', 'after')).toEqual({ checkIn: '2027-09-26', checkOut: '2027-09-27' });
    const o = tripOption(s, 'c1');
    expect([o.before!.nights, o.after!.nights, o.before!.source]).toEqual([2, 1, 'flight']);
  });

  it('a hotel is a separate line from the flight, editable, and added to the total', () => {
    const base = run(withFares(), selectRoom('c1', 'A', 'c1-A1'), { type: 'selectFare', cruiseId: 'c1', flightId: 'elal-c1-lite' }, mode('elal-c1-lite', 'breakdown'));
    const stay = plannedStay(base, 'c1', 'A', 'before')!;
    const h = hotel('c1', 'A', { name: 'Test hotel', ...stay, pricePerNight: 200 });
    const s = run(base, { type: 'addHotel', hotel: h }, plan('c1', 'A', { hotelId: h.id }));
    expect(hotelNights(h).nights).toBe(2);
    const a = computePlan(s, 'c1', 'A');
    expect(a.lines.hotel.amount).toBe(400);
    expect(a.lines.flights.amount).toBe(959.96);
    expect(a.total).toBe(4805 + 959.96 + 400);
    // the user can change the dates: 3 nights
    const edited = run(s, { type: 'updateHotel', id: h.id, patch: { checkIn: '2027-09-02' } });
    expect(computePlan(edited, 'c1', 'A').lines.hotel.amount).toBe(600);
    // and the suggestion now differs from the hotel dates
    expect(plannedStay(edited, 'c1', 'A', 'before')!.checkIn).toBe('2027-09-03');
  });
});

describe('fare comparison and what-now', () => {
  it('delta vs Lite is computed only from verified prices', () => {
    const s0 = withFares();
    expect(fareLadder(s0, 'c1').columns[1]!.deltaVsLite.A).toBeNull();
    const s = run(withFares(), ...['lite', 'classic'].map((c) => mode(`elal-c1-${c}`, 'breakdown')));
    const ladder = fareLadder(s, 'c1');
    expect(ladder.columns[0]!.deltaVsLite.A).toBeNull();
    // Classic breakdown − Lite breakdown: A = 2×120 + (106.20 − 82.20) = 264, B = 240
    expect(ladder.columns[1]!.deltaVsLite.A).toBe(264);
    expect(ladder.columns[1]!.deltaVsLite.B).toBe(240);
  });

  it('flags the Lite 17/09 breakdown that is higher than Classic – without changing it', () => {
    const ladder = fareLadder(withFares(), 'c2');
    expect(ladder.issues.join(' ')).toContain('Lite');
    expect(ladder.issues.join(' ')).toContain('$558.88');
    expect(fareLadder(withFares(), 'c1').issues).toEqual([]);
    expect(fare(withFares(), 'c2', 'lite').adultFare).toBe(369);
  });

  it('"what now" lists the EL AL verification, hotel, Crew tips and agent fee; the buffer is good news', () => {
    const s = withFares();
    const todos = todoList(s).map((t) => t.text);
    expect(todos.some((t) => t.includes('אימות המחירים של טיסות EL AL') && t.includes('אי-התאמה'))).toBe(true);
    expect(todos.some((t) => t.includes('מלון'))).toBe(true);
    expect(todos.some((t) => t.includes('Crew tips'))).toBe(true);
    expect(todos.some((t) => t.includes('עמלת הסוכן'))).toBe(true);
    expect(goodNews(s)).toEqual(['תאריכי הטיסות נותנים buffer של יומיים לפני הקרוז ויום אחרי הקרוז']);
  });
});

describe('persistence', () => {
  const edited = (): AppState =>
    run(
      withFares(),
      { type: 'selectFare', cruiseId: 'c1', flightId: 'elal-c1-classic' },
      mode('elal-c1-classic', 'total'),
      { type: 'setVerifiedTotal', id: 'elal-c1-classic', key: 'A', value: 1234.5 },
      { type: 'setFareExtra', id: 'elal-c1-lite', row: 'baggage', group: 'B', value: 65 },
      { type: 'archiveFareCheck', id: 'elal-c2-flex', checkId: 'chk-1' },
    );

  it('refresh keeps the fares, the mode, totals, extras and history (localStorage)', () => {
    const s = edited();
    saveState(s);
    const loaded = loadState();
    expect(loaded).toEqual(s);
    expect(fare(loaded, 'c1', 'classic').verifiedTotal.A).toBe(1234.5);
    expect(fare(loaded, 'c2', 'flex').history).toHaveLength(1);
    expect(loaded.plans.c1!.A.outFlightId).toBe('elal-c1-classic');
  });

  it('export → import keeps all the fare information', () => {
    const s = edited();
    const back = importJson(exportJson(s))!;
    expect(back).toEqual(s);
    const f = fare(back, 'c1', 'lite');
    expect([f.displayedOut, f.displayedBack, f.adultFare, f.carrierSurcharge, f.adultTaxes, f.babyFare, f.babyTaxes]).toEqual([262, 178, 249, 120, 69.88, 50, 32.2]);
    expect(f.extraBaggage.B).toBe(65);
  });

  it('the new check keeps the old one as "בדיקה קודמת" – history is never deleted', () => {
    const s = edited();
    const flex = fare(s, 'c2', 'flex');
    expect(flex.history[0]).toMatchObject({ id: 'chk-1', displayedOut: 302, displayedBack: 288, adultFare: 399, babyFare: 80 });
    expect(flex.priceMode).toBe('unverified');
    expect(flex.checkedAt).toBe('');
    const again = run(s, { type: 'setFarePrice', id: 'elal-c2-flex', field: 'displayedOut', value: 310 }, { type: 'archiveFareCheck', id: 'elal-c2-flex', checkId: 'chk-2' });
    const h = fare(again, 'c2', 'flex').history;
    expect(h.map((x) => x.displayedOut)).toEqual([302, 310]);
  });

  it('an older save (v3, with the cart) gets the six fares once; deleting them is respected', () => {
    const v3 = { ...freshState(), version: 3, flights: [], seeds: { elAlBenchmark: true } } as unknown as Record<string, unknown>;
    const n = normalizeState(v3)!;
    expect(n.version).toBe(4);
    expect(n.flights.filter((f) => f.fareClass)).toHaveLength(6);
    const removed = run(n, ...n.flights.map((f) => ({ type: 'removeFlight' as const, id: f.id })));
    expect(applySeeds(removed).flights).toEqual([]);
    expect(importJson(exportJson(removed))!.flights).toEqual([]);
  });

  it('a regular flight option can still only belong to A or B (a shared record needs a fare type)', () => {
    const bad = { ...fresh(), flights: [{ ...elAlFares()[0]!, fareClass: '' }] };
    expect(importJson(JSON.stringify(bad))!.flights).toEqual([]);
  });
});
