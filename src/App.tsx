import { useEffect, useMemo, useReducer, useState } from 'react';
import { reducer } from './domain/reducer';
import { loadState, saveState } from './domain/storage';
import { DetailsScreen } from './ui/DetailsScreen';
import { EntryScreen } from './ui/EntryScreen';
import { SummaryScreen } from './ui/SummaryScreen';
import { AppContext } from './ui/context';
import type { Screen } from './ui/context';

const TABS: { id: Screen; label: string }[] = [
  { id: 'summary', label: 'סיכום והשוואה' },
  { id: 'entry', label: 'הזנת נתונים' },
  { id: 'details', label: 'פרטים ותנאים' },
];

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const [screen, setScreen] = useState<Screen>('summary');

  useEffect(() => saveState(state), [state]);
  useEffect(() => window.scrollTo?.({ top: 0 }), [screen]);

  const ctx = useMemo(() => ({ state, dispatch, go: setScreen }), [state]);

  return (
    <AppContext.Provider value={ctx}>
      <header className="app-header">
        <div className="wrap">
          <h1>השוואת קרוז · ברצלונה, ספטמבר 2027</h1>
          <nav className="nav" aria-label="מסכים">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`nav-btn ${screen === t.id ? 'nav-on' : ''}`}
                aria-current={screen === t.id ? 'page' : undefined}
                onClick={() => setScreen(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="scenario" role="group" aria-label="מי נוסע">
            <span className="scenario-label">מי נוסע?</span>
            <button
              className={`seg ${!state.groupBEnabled ? 'seg-on' : ''}`}
              aria-pressed={!state.groupBEnabled}
              onClick={() => dispatch({ type: 'setGroupBEnabled', enabled: false })}
            >
              רק קבוצה A (זוג + תינוק)
            </button>
            <button
              className={`seg ${state.groupBEnabled ? 'seg-on' : ''}`}
              aria-pressed={state.groupBEnabled}
              onClick={() => dispatch({ type: 'setGroupBEnabled', enabled: true })}
            >
              A + קבוצה B (זוג)
            </button>
          </div>
        </div>
      </header>
      <main className="wrap">
        {screen === 'summary' && <SummaryScreen />}
        {screen === 'entry' && <EntryScreen />}
        {screen === 'details' && <DetailsScreen />}
      </main>
      <footer className="wrap foot muted small">
        כלי אישי להשוואה – לא מבצע הזמנות. כל הסכומים בדולרים. הנתונים נשמרים בדפדפן הזה.
      </footer>
    </AppContext.Provider>
  );
}
