import { createContext, useContext } from 'react';
import type { Dispatch } from 'react';
import type { Action } from '../domain/reducer';
import type { AppState } from '../domain/types';

export type Screen = 'summary' | 'entry' | 'details';

/** Where "✏️ edit" should land on the entry screen. */
export interface EntryTarget {
  cruiseId?: string;
  /** Flight or hotel card to open. */
  focusId?: string;
}

interface Ctx {
  state: AppState;
  dispatch: Dispatch<Action>;
  go: (screen: Screen, target?: EntryTarget) => void;
  target: EntryTarget | null;
}

export const AppContext = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppContext missing');
  return ctx;
}
