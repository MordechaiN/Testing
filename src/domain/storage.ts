import { initialState, plansFor } from './seed';
import type { AppState } from './types';

const KEY = 'cruise-compare-v1';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Accepts anything (localStorage content or an imported file) and returns a usable state,
 * or null if it is not a cruise-compare backup. Missing plans are filled in.
 */
export function normalizeState(raw: unknown): AppState | null {
  if (!isObject(raw) || raw.version !== 1) return null;
  const base = initialState();
  const arrays = ['cruises', 'flights', 'hotels', 'terms'] as const;
  for (const k of arrays) if (!Array.isArray(raw[k])) return null;
  if (!isObject(raw.plans) || !isObject(raw.passengers) || !isObject(raw.favorite) || !isObject(raw.deposit)) {
    return null;
  }

  const state = { ...base, ...(raw as unknown as AppState) };
  for (const c of state.cruises) {
    if (!isObject(c) || !isObject(c.rooms) || !Array.isArray(c.rooms.A) || !Array.isArray(c.rooms.B)) return null;
  }
  const plans: AppState['plans'] = {};
  for (const c of state.cruises) {
    const existing = state.plans[c.id];
    plans[c.id] = { ...plansFor(), ...(existing ?? {}) };
  }
  return {
    ...state,
    plans,
    passengers: { ...base.passengers, ...state.passengers },
    favorite: { ...base.favorite, ...state.favorite },
    deposit: { ...base.deposit, ...state.deposit },
    groupBEnabled: state.groupBEnabled !== false,
  };
}

export function loadState(): AppState {
  try {
    const text = localStorage.getItem(KEY);
    if (text) {
      const parsed = normalizeState(JSON.parse(text));
      if (parsed) return parsed;
    }
  } catch {
    // Storage blocked or corrupt – fall back to the initial data.
  }
  return initialState();
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage blocked (private window etc.) – the app keeps working, just without autosave.
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
