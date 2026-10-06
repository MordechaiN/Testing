import { createContext, useContext } from 'react';
import type { Dispatch } from 'react';
import type { Action } from '../domain/reducer';
import type { AppState } from '../domain/types';

export type Screen = 'summary' | 'entry' | 'details';

interface Ctx {
  state: AppState;
  dispatch: Dispatch<Action>;
  go: (screen: Screen) => void;
}

export const AppContext = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppContext missing');
  return ctx;
}
