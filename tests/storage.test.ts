import { describe, expect, it } from 'vitest';
import { exportJson, importJson, loadState, normalizeState, saveState } from '../src/domain/storage';
import { reducer } from '../src/domain/reducer';
import { initialState } from '../src/domain/seed';
import { daysBetween, addDays, rangeLabel, shortDate, parseDate } from '../src/domain/dates';

describe('storage', () => {
  it('round-trips through localStorage', () => {
    const s = reducer(initialState(), { type: 'updatePlan', cruiseId: 'c1', group: 'A', patch: { tips: 42 } });
    saveState(s);
    expect(loadState().plans.c1!.A.tips).toBe(42);
  });

  it('falls back to the initial data when storage is corrupt', () => {
    localStorage.setItem('cruise-compare-v1', '{not json');
    expect(loadState()).toEqual(initialState());
  });

  it('export then import returns the same state', () => {
    const s = reducer(initialState(), { type: 'setGroupBEnabled', enabled: false });
    expect(importJson(exportJson(s))).toEqual(s);
  });

  it('rejects files that are not a backup', () => {
    expect(importJson('{"hello":1}')).toBeNull();
    expect(importJson('nonsense')).toBeNull();
    expect(normalizeState(null)).toBeNull();
    expect(normalizeState({ version: 1, cruises: [{ id: 'x' }], flights: [], hotels: [], terms: [], plans: {}, passengers: {}, favorite: {}, deposit: {} })).toBeNull();
  });

  it('fills in missing plans for cruises of an older backup', () => {
    const s = initialState();
    const raw = { ...s, plans: {} };
    const n = normalizeState(raw)!;
    expect(n.plans.c1!.A.roomId).toBeNull();
    expect(n.plans.c2!.B.tips).toBeNull();
  });
});

describe('dates', () => {
  it('parses and formats', () => {
    expect(shortDate('2027-09-05')).toBe('05/09');
    // Strip the invisible direction marks before comparing.
    expect(rangeLabel('2027-09-05', '2027-09-12').replace(/[\u2066\u2069]/g, '')).toBe('05/09–12/09');
    expect(rangeLabel('', '')).toBe('תאריכים לא הוזנו');
  });
  it('counts nights across a month end', () => {
    expect(daysBetween('2027-09-05', '2027-09-12')).toBe(7);
    expect(daysBetween('2027-08-30', '2027-09-02')).toBe(3);
  });
  it('rejects impossible dates', () => {
    expect(parseDate('2027-02-30')).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(daysBetween('', '2027-09-02')).toBeNull();
  });
  it('computes the date 90 days before departure', () => {
    expect(addDays('2027-09-05', -90)).toBe('2027-06-07');
    expect(addDays('2027-09-19', -90)).toBe('2027-06-21');
  });
});
