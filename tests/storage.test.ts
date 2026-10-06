import { describe, expect, it } from 'vitest';
import { computePlan } from '../src/domain/calc';
import { addDays, daysBetween, longDate, parseDate, rangeLabel, rangeLabelLong, shortDate } from '../src/domain/dates';
import { exportJson, importJson, loadState, normalizeState, saveState, STORAGE_KEY } from '../src/domain/storage';
import { initialState } from '../src/domain/seed';
import { fresh, fullScenario, plan, run } from './helpers';

const strip = (s: string) => s.replace(/[⁦⁩]/g, '');

describe('localStorage', () => {
  it('a reload brings back exactly what was saved', () => {
    const { state } = fullScenario();
    saveState(state);
    const loaded = loadState();
    expect(loaded).toEqual(state);
    expect(computePlan(loaded, 'c1', 'A').total).toBe(7392);
  });

  it('falls back to the initial data when storage is corrupt, and keeps the corrupt text aside', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadState()).toEqual(initialState());
    const kept = Object.keys(localStorage).filter((k) => k.startsWith(`${STORAGE_KEY}-unreadable-`));
    expect(kept).toHaveLength(1);
    expect(localStorage.getItem(kept[0]!)).toBe('{not json');
  });

  it('starts with the initial data when nothing was saved', () => {
    expect(loadState()).toEqual(initialState());
  });
});

describe('export / import', () => {
  it('export then import returns exactly the same data', () => {
    const { state } = fullScenario();
    const withExtras = run(
      state,
      { type: 'setGroupBEnabled', enabled: false },
      { type: 'setDeposit', group: 'A', value: 340 },
      { type: 'setNotes', notes: 'הערה' },
      { type: 'setFavorite', group: 'A', cruiseId: 'c2' },
      plan('c2', 'B', { noHotel: true }),
    );
    expect(importJson(exportJson(withExtras))).toEqual(withExtras);
  });

  it('rejects files that are not a backup, without touching anything', () => {
    expect(importJson('{"hello":1}')).toBeNull();
    expect(importJson('nonsense')).toBeNull();
    expect(importJson('[]')).toBeNull();
    expect(normalizeState(null)).toBeNull();
    expect(normalizeState({ version: 2, cruises: [{ id: 'x' }], flights: [], hotels: [] })).toBeNull();
    expect(normalizeState({ version: 99, cruises: [], flights: [], hotels: [] })).toBeNull();
  });

  it('repairs missing pieces instead of failing (missing plans, items, terms)', () => {
    const s = initialState() as unknown as Record<string, unknown>;
    const n = normalizeState({ ...s, plans: {}, items: undefined, terms: undefined })!;
    expect(n.plans.c1!.A.roomId).toBeNull();
    expect(n.items).toEqual([]);
    expect(n.terms.length).toBeGreaterThan(0);
  });

  it('drops a favorite that points to a cruise that no longer exists', () => {
    const s = { ...initialState(), favorite: { A: 'gone', B: 'c2' } };
    expect(normalizeState(s)!.favorite).toEqual({ A: null, B: 'c2' });
  });
});

describe('migration from version 1 (data is never lost)', () => {
  // A realistic version-1 save, as written by the first release.
  const v1 = {
    version: 1,
    groupBEnabled: true,
    passengers: { A: { adults: 2, infants: 1 }, B: { adults: 2, infants: 0 } },
    cruises: initialState().cruises,
    flights: [
      {
        id: 'f1', cruiseId: 'c1', direction: 'out', airline: 'El Al', flightNo: 'LY1', date: '2027-09-05',
        depTime: '06:00', arrTime: '10:00', airport: 'TLV → BCN', stops: 0, duration: '4:00', baggageInfo: '23kg',
        base: { adult: 300, infant: 50 }, seat: { adult: 25, infant: null }, baggage: { adult: 60, infant: null },
        other: { adult: 5, infant: null }, notes: 'n',
      },
      {
        id: 'f2', cruiseId: 'c1', direction: 'back', airline: 'El Al', flightNo: 'LY2', date: '', depTime: '', arrTime: '',
        airport: '', stops: null, duration: '', baggageInfo: '',
        base: { adult: 280, infant: null }, seat: { adult: null, infant: null }, baggage: { adult: null, infant: null },
        other: { adult: null, infant: null }, notes: '',
      },
    ],
    hotels: [
      {
        id: 'h1', cruiseId: 'c1', group: 'both', name: 'X', checkIn: '', checkOut: '', manualNights: 2,
        pricePerNight: 200, taxes: null, cityTax: null, breakfast: null, other: null, notes: '',
      },
    ],
    plans: {
      c1: {
        A: { roomId: 'c1-A1', outFlightId: 'f1', backFlightId: 'f2', hotelId: 'h1', tips: 250, agentFee: 100, drinks: null, internet: null, transport: 40, other: 10 },
        B: { roomId: 'c1-B3', outFlightId: 'f1', backFlightId: null, hotelId: 'h1', tips: null, agentFee: null, drinks: 30, internet: null, transport: null, other: null },
      },
      c2: {
        A: { roomId: null, outFlightId: null, backFlightId: null, hotelId: null, tips: null, agentFee: null, drinks: null, internet: null, transport: null, other: null },
        B: { roomId: null, outFlightId: null, backFlightId: null, hotelId: null, tips: null, agentFee: null, drinks: null, internet: null, transport: null, other: null },
      },
    },
    favorite: { A: 'c1', B: null },
    deposit: { A: 340, B: null },
    terms: initialState().terms,
  };

  // Version-1 totals, calculated by hand with the version-1 rules:
  // A: 4805 + out (2×300 + 50 + 2×25 + 2×60 + 2×5 = 830) + back (2×280 = 560) + hotel 400 (full) + 250 + 100 + 40 + 10 = 6,995
  // B: 4780 + out (2×300 + 2×25 + 2×60 + 2×5 = 780) + hotel 400 (full) + drinks 30 = 5,990
  it('keeps every total exactly as it was', () => {
    const s = normalizeState(v1)!;
    expect(s.version).toBe(2);
    expect(computePlan(s, 'c1', 'A').total).toBe(6995);
    expect(computePlan(s, 'c1', 'B').total).toBe(5990);
  });

  it('keeps choices, notes, favorites and deposits', () => {
    const s = normalizeState(v1)!;
    expect(s.plans.c1!.A.roomId).toBe('c1-A1');
    expect(s.favorite.A).toBe('c1');
    expect(s.deposit.A).toBe(340);
    const a = computePlan(s, 'c1', 'A');
    expect(a.out!.flightNo).toBe('LY1');
    expect(a.out!.fromAirport).toBe('TLV → BCN');
    expect(a.out!.fare).toEqual({ 'adult-1': 305, 'adult-2': 305, 'infant-1': 50 });
    expect(a.lines.transport.amount).toBe(40);
    expect(a.lines.other.amount).toBe(10);
  });

  it('gives each group its own copy of a shared v1 flight and hotel', () => {
    const s = normalizeState(v1)!;
    expect(s.flights.filter((f) => f.flightNo === 'LY1').map((f) => f.group).sort()).toEqual(['A', 'B']);
    expect(s.hotels.map((h) => h.owner).sort()).toEqual(['A', 'B']);
  });

  it('a v1 save in localStorage is migrated on load and saved back as v2', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v1));
    const loaded = loadState();
    expect(loaded.version).toBe(2);
    expect(computePlan(loaded, 'c1', 'A').total).toBe(6995);
  });
});

describe('dates', () => {
  it('formats in reading order with an arrow, never reversed', () => {
    expect(shortDate('2027-09-05')).toBe('05/09');
    expect(longDate('2027-09-19')).toBe('19/09/2027');
    expect(strip(rangeLabel('2027-09-05', '2027-09-12'))).toBe('05/09 → 12/09');
    expect(strip(rangeLabelLong('2027-09-05', '2027-09-12'))).toBe('05/09/2027 → 12/09/2027');
    expect(strip(rangeLabelLong('2027-09-19', '2027-09-26'))).toBe('19/09/2027 → 26/09/2027');
    expect(rangeLabel('2027-09-05', '2027-09-12').startsWith('⁦')).toBe(true);
    expect(rangeLabel('', '')).toBe('תאריכים לא הוזנו');
  });

  it('counts nights across a month end', () => {
    expect(daysBetween('2027-09-05', '2027-09-12')).toBe(7);
    expect(daysBetween('2027-08-30', '2027-09-02')).toBe(3);
  });

  it('rejects impossible dates', () => {
    expect(parseDate('2027-02-30')).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(shortDate('2027-02-30')).toBe('');
    expect(daysBetween('', '2027-09-02')).toBeNull();
  });

  it('computes 90 days before each sailing', () => {
    expect(longDate(addDays('2027-09-05', -90)!)).toBe('07/06/2027');
    expect(longDate(addDays('2027-09-19', -90)!)).toBe('21/06/2027');
  });

  it('keeps the fresh() helper equal to the initial state', () => {
    expect(fresh()).toEqual(initialState());
  });
});
