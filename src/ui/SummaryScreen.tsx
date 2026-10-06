import {
  activeGroups,
  bothGroupsTotal,
  cheapestOverall,
  cheapestRoom,
  computePlan,
  cruiseNights,
  gap,
  infantPriceMissing,
  nextStep,
  rankFlights,
} from '../domain/calc';
import type { Breakdown, PlanResult } from '../domain/calc';
import { rangeLabel, rangeLabelLong, shortDate } from '../domain/dates';
import { flightLabel, GROUP_LABEL, GROUP_SHORT, stopsLabel, usd } from '../domain/format';
import type { AppState, Cruise, FlightDirection, GroupId } from '../domain/types';
import { Chip, Usd } from './common';
import { useApp } from './context';

const NOT_INCLUDED_LABEL = {
  flights: 'טיסות',
  hotel: 'מלון',
  tips: 'טיפים',
  agentFee: 'עמלה',
} as const;

function flightsMissing(r: PlanResult): boolean {
  return r.missing.includes('outFlight') || r.missing.includes('backFlight');
}

function cruiseTitle(c: Cruise): string {
  return rangeLabelLong(c.start, c.end);
}

// ---------- next step ----------

function NextStepBanner() {
  const { state, go } = useApp();
  const step = nextStep(state);
  if (!step) {
    return (
      <div className="banner banner-green">
        <strong>הנתונים הושלמו.</strong> אפשר להחליט לפי הטבלאות למטה.
      </div>
    );
  }
  return (
    <div className="banner banner-blue">
      <div>
        <strong>מה עכשיו?</strong> {step.text}
      </div>
      {step.screen !== 'summary' && (
        <button className="btn btn-primary" onClick={() => go(step.screen)}>
          {step.screen === 'entry' ? 'למסך הזנת נתונים' : 'לפרטים ותנאים'}
        </button>
      )}
    </div>
  );
}

// ---------- the 5-second answer ----------

function CheapestLine({ state, group }: { state: AppState; group: GroupId }) {
  const best = cheapestOverall(state, group);
  const icon = group === 'A' ? '🟢' : '🔵';
  const label = `הזול ביותר – ${GROUP_LABEL[group]}`;
  if (!best) {
    return (
      <div className="answer-row">
        <span className="answer-icon">{icon}</span>
        <div>
          <div className="answer-label">{label}</div>
          <div className="muted">אין עדיין חדר עם מחיר.</div>
        </div>
      </div>
    );
  }
  const cruise = state.cruises.find((c) => c.id === best.cruiseId)!;
  const partial = state.cruises.some((c) => flightsMissing(computePlan(state, c.id, group)));
  return (
    <div className="answer-row">
      <span className="answer-icon">{icon}</span>
      <div>
        <div className="answer-label">{label}</div>
        <div className="answer-main">
          <strong>{rangeLabel(cruise.start, cruise.end)}</strong> · {best.room?.name} ·{' '}
          <Usd value={best.total} className="big" />
        </div>
        {partial && <Chip tone="yellow">חלקי – חסרות טיסות, ההשוואה עדיין לא מלאה</Chip>}
      </div>
    </div>
  );
}

function cheapestFlightText(state: AppState, cruiseId: string, direction: FlightDirection, group: GroupId): string {
  const ranked = rankFlights(state, cruiseId, direction).filter((r) => r.cheapest[group]);
  const first = ranked[0];
  if (!first) return '—';
  return `${flightLabel(first.flight)} (${usd(first.cost[group].total)})`;
}

function FlightsLine({ state }: { state: AppState }) {
  const groups = activeGroups(state);
  const any = state.flights.length > 0;
  return (
    <div className="answer-row">
      <span className="answer-icon">🟡</span>
      <div>
        <div className="answer-label">הטיסות המשתלמות ביותר</div>
        {!any && <div className="muted">עדיין לא הוזנו טיסות.</div>}
        {any &&
          state.cruises.map((c) =>
            groups
              .filter((g) => rankFlights(state, c.id, 'out').some((r) => r.cheapest[g]) || rankFlights(state, c.id, 'back').some((r) => r.cheapest[g]))
              .map((g) => (
              <div key={c.id + g} className="answer-sub">
                <strong>{rangeLabel(c.start, c.end)}</strong> · {GROUP_SHORT[g]} – הלוך:{' '}
                {cheapestFlightText(state, c.id, 'out', g)} · חזור: {cheapestFlightText(state, c.id, 'back', g)}
              </div>
            )),
          )}
      </div>
    </div>
  );
}

function FavoriteLine({ state }: { state: AppState }) {
  const groups = activeGroups(state);
  const items = groups
    .map((g) => ({ g, cruise: state.cruises.find((c) => c.id === state.favorite[g]) }))
    .filter((x) => x.cruise);
  return (
    <div className="answer-row">
      <span className="answer-icon">⭐</span>
      <div>
        <div className="answer-label">המועדף שלי</div>
        {items.length === 0 ? (
          <div className="muted">לא סומן. לחצו על ☆ בראש העמודה בטבלה.</div>
        ) : (
          items.map(({ g, cruise }) => (
            <div key={g} className="answer-sub">
              {GROUP_SHORT[g]}: <strong>{rangeLabel(cruise!.start, cruise!.end)}</strong>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---------- one group, all dates ----------

const BREAKDOWN_ROWS: { key: keyof Breakdown; label: string; always: boolean }[] = [
  { key: 'flights', label: 'טיסות (הלוך + חזור)', always: true },
  { key: 'seats', label: 'מושבים', always: true },
  { key: 'baggage', label: 'מזוודות', always: true },
  { key: 'flightExtras', label: 'תוספות טיסה', always: false },
  { key: 'hotel', label: 'מלון בברצלונה', always: true },
  { key: 'tips', label: 'טיפים', always: true },
  { key: 'agentFee', label: 'עמלת סוכנת', always: true },
  { key: 'drinks', label: 'שתייה', always: false },
  { key: 'internet', label: 'אינטרנט', always: false },
  { key: 'transport', label: 'תחבורה', always: false },
  { key: 'other', label: 'אחר', always: false },
];

function Amount({ value }: { value: number }) {
  return value === 0 ? <span className="dash" title="לא הוזן – לא נכלל בסכום">—</span> : <Usd value={value} />;
}

function GroupTable({ group }: { group: GroupId }) {
  const { state, dispatch } = useApp();
  const results = state.cruises.map((c) => computePlan(state, c.id, group));
  const cheapest = state.cruises.map((c) => cheapestRoom(state, c.id, group));

  const selectedTotals = results.filter((r) => r.room !== null && !r.missing.includes('cruisePrice'));
  const comparable = selectedTotals.length === results.length && results.length > 1;
  const minSelected = comparable ? Math.min(...selectedTotals.map((r) => Math.round(r.total * 100))) : null;

  const cheapTotals = cheapest.map((r) => r?.total ?? null);
  const cheapComparable = cheapTotals.every((t) => t !== null) && cheapTotals.length > 1;
  const minCheap = cheapComparable ? Math.min(...(cheapTotals as number[]).map((t) => Math.round(t * 100))) : null;

  const tone = group === 'A' ? 'green' : 'blue';
  const icon = group === 'A' ? '🟢' : '🔵';

  if (state.cruises.length === 0) {
    return <p className="muted">אין הצעות קרוז. הוסיפו במסך הזנת נתונים.</p>;
  }

  const visibleRows = BREAKDOWN_ROWS.filter(
    (row) => row.always || results.some((r) => r.breakdown[row.key] !== 0),
  );

  return (
    <section className={`section group-section group-${group}`} aria-label={GROUP_LABEL[group]}>
      <h2>
        {GROUP_LABEL[group]}
        <span className="h2-note"> – מחושב בנפרד, בלי הקבוצה השנייה</span>
      </h2>
      <div className="table-scroll">
        <table className="cmp">
          <thead>
            <tr>
              <th scope="col" />
              {state.cruises.map((c) => {
                const fav = state.favorite[group] === c.id;
                const nights = cruiseNights(c);
                return (
                  <th scope="col" key={c.id}>
                    <div className="col-title">{rangeLabel(c.start, c.end)}</div>
                    <div className="col-sub">{nights ? `${nights} לילות` : 'בדקו תאריכים'}</div>
                    <button
                      className={`star ${fav ? 'star-on' : ''}`}
                      aria-pressed={fav}
                      onClick={() => dispatch({ type: 'setFavorite', group, cruiseId: fav ? null : c.id })}
                    >
                      {fav ? '⭐ מועדף' : '☆ סמן כמועדף'}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">החדר שבחרתי</th>
              {state.cruises.map((c) => {
                const plan = state.plans[c.id]?.[group];
                return (
                  <td key={c.id}>
                    <select
                      aria-label={`חדר – ${GROUP_SHORT[group]} – ${rangeLabel(c.start, c.end)}`}
                      value={plan?.roomId ?? ''}
                      onChange={(e) =>
                        dispatch({ type: 'updatePlan', cruiseId: c.id, group, patch: { roomId: e.target.value || null } })
                      }
                    >
                      <option value="">בחרו חדר…</option>
                      {c.rooms[group].map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name || 'חדר ללא שם'} – {r.price === null ? 'חסר מחיר' : usd(r.price)}
                        </option>
                      ))}
                    </select>
                  </td>
                );
              })}
            </tr>

            <tr className="row-cruise">
              <th scope="row">קרוז בלבד</th>
              {results.map((r) => (
                <td key={r.cruiseId}>
                  {r.room ? <Usd value={r.cruiseOnly} /> : <span className="dash">—</span>}
                </td>
              ))}
            </tr>

            {visibleRows.map((row) => (
              <tr key={row.key} className="row-extra">
                <th scope="row">{row.label}</th>
                {results.map((r) => (
                  <td key={r.cruiseId}>
                    <Amount value={r.breakdown[row.key]} />
                  </td>
                ))}
              </tr>
            ))}

            <tr className="row-total">
              <th scope="row">סה״כ כל הטיול</th>
              {results.map((r) => {
                const isMin = minSelected !== null && Math.round(r.total * 100) === minSelected && r.room !== null;
                return (
                  <td key={r.cruiseId} className={isMin ? `is-min is-min-${tone}` : ''}>
                    {r.room ? (
                      <>
                        <Usd value={r.total} className="total" />
                        {isMin && <div className="min-tag">{icon} הזול מבין הבחירות שלי</div>}
                        {r.missing.includes('cruisePrice') && <Chip tone="red">חסר מחיר קרוז</Chip>}
                      </>
                    ) : (
                      <Chip tone="yellow">בחרו חדר</Chip>
                    )}
                  </td>
                );
              })}
            </tr>

            <tr className="row-notes">
              <th scope="row">לא כלול בסכום</th>
              {results.map((r) => (
                <td key={r.cruiseId}>
                  <div className="muted small">
                    {r.notIncluded.length === 0 ? 'הכול הוזן' : r.notIncluded.map((k) => NOT_INCLUDED_LABEL[k]).join(', ')}
                  </div>
                  {r.missing.includes('outFlight') && <Chip tone="yellow">חסרה טיסת הלוך</Chip>}
                  {r.missing.includes('backFlight') && <Chip tone="yellow">חסרה טיסת חזור</Chip>}
                </td>
              ))}
            </tr>

            {comparable && (
              <tr className="row-gap">
                <th scope="row">פער בין התאריכים (הבחירות שלי)</th>
                {results.map((r) => (
                  <td key={r.cruiseId}>
                    {Math.round(r.total * 100) === minSelected ? (
                      <Chip tone="green">הזול ביותר</Chip>
                    ) : (
                      <Usd value={gap(r.total, minSelected! / 100)} className="gap" />
                    )}
                  </td>
                ))}
              </tr>
            )}

            <tr className="row-cheap">
              <th scope="row">החדר הזול ביותר בתאריך</th>
              {state.cruises.map((c, i) => {
                const cr = cheapest[i];
                const selected = state.plans[c.id]?.[group].roomId;
                return (
                  <td key={c.id}>
                    {cr ? (
                      <>
                        <div className="small">{cr.room?.name}</div>
                        <Usd value={cr.total} />
                        {selected !== cr.room?.id && (
                          <button
                            className="btn-link"
                            onClick={() =>
                              dispatch({ type: 'updatePlan', cruiseId: c.id, group, patch: { roomId: cr.room!.id } })
                            }
                          >
                            בחר
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="dash">—</span>
                    )}
                  </td>
                );
              })}
            </tr>

            {cheapComparable && (
              <tr className="row-gap">
                <th scope="row">פער בין התאריכים (הזול בכל תאריך)</th>
                {cheapTotals.map((t, i) => (
                  <td key={state.cruises[i]!.id}>
                    {Math.round(t! * 100) === minCheap ? (
                      <Chip tone="green">הזול ביותר</Chip>
                    ) : (
                      <Usd value={gap(t!, minCheap! / 100)} className="gap" />
                    )}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!comparable && results.length > 1 && (
        <p className="muted small">פער בין התאריכים יופיע אחרי שתבחרו חדר בכל תאריך.</p>
      )}
    </section>
  );
}

// ---------- optional: both groups together ----------

function BothNote() {
  const { state } = useApp();
  const items = state.cruises
    .map((c) => ({ c, total: bothGroupsTotal(state, c.id) }))
    .filter((x): x is { c: Cruise; total: number } => x.total !== null);
  if (items.length === 0) return null;
  return (
    <p className="muted small both-note">
      לידיעה בלבד – שתי הקבוצות יחד (זה לא המחיר שלכם):{' '}
      {items.map((x, i) => (
        <span key={x.c.id}>
          {i > 0 && ' · '}
          {rangeLabel(x.c.start, x.c.end)} <Usd value={x.total} />
        </span>
      ))}
    </p>
  );
}

// ---------- flights overview ----------

function FlightList({ cruiseId, direction }: { cruiseId: string; direction: FlightDirection }) {
  const { state } = useApp();
  const groups = activeGroups(state);
  const ranked = rankFlights(state, cruiseId, direction);
  const title = direction === 'out' ? 'הלוך' : 'חזור';
  if (ranked.length === 0) {
    return (
      <div className="flight-block">
        <h4>{title}</h4>
        <p className="muted small">לא הוזנו אפשרויות.</p>
      </div>
    );
  }
  return (
    <div className="flight-block">
      <h4>{title}</h4>
      <div className="table-scroll">
        <table className="cmp flights">
          <thead>
            <tr>
              <th scope="col">אפשרות</th>
              {groups.map((g) => (
                <th scope="col" key={g}>
                  {GROUP_SHORT[g]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranked.map(({ flight: f, cost, cheapest }) => {
              const details = [
                shortDate(f.date),
                f.depTime && f.arrTime ? `${f.depTime}→${f.arrTime}` : f.depTime || f.arrTime,
                f.airport,
                stopsLabel(f.stops),
                f.duration,
                f.baggageInfo,
              ].filter(Boolean);
              return (
                <tr key={f.id}>
                  <th scope="row">
                    <div>{flightLabel(f)}</div>
                    {details.length > 0 && <div className="muted small">{details.join(' · ')}</div>}
                  </th>
                  {groups.map((g) => (
                    <td key={g} className={cheapest[g] ? 'is-min is-min-yellow' : ''}>
                      <Usd value={cost[g].total} />
                      {cheapest[g] && <div className="min-tag">🟡 הזולה ביותר</div>}
                      {state.passengers[g].infants > 0 && infantPriceMissing(f) && (
                        <Chip tone="yellow">מחיר תינוק לא הוזן</Chip>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FlightsOverview() {
  const { state, go } = useApp();
  return (
    <section className="section">
      <h2>טיסות לפי תאריך</h2>
      <p className="muted">
        הטיסה הזולה לא תמיד הטובה ביותר – בדקו עצירות, זמן כולל, שעות וכבודה.
      </p>
      {state.flights.length === 0 && (
        <div className="banner banner-yellow">
          <div>עדיין לא הוזנו טיסות, ולכן הסכומים למעלה הם לפני טיסות.</div>
          <button className="btn" onClick={() => go('entry')}>
            הוספת טיסות
          </button>
        </div>
      )}
      {state.flights.length > 0 &&
        state.cruises.map((c) => (
          <div key={c.id} className="flight-cruise">
            <h3>{cruiseTitle(c)}</h3>
            <div className="flight-cols">
              <FlightList cruiseId={c.id} direction="out" />
              <FlightList cruiseId={c.id} direction="back" />
            </div>
          </div>
        ))}
    </section>
  );
}

// ---------- screen ----------

export function SummaryScreen() {
  const { state, go } = useApp();
  const groups = activeGroups(state);
  const clarify = state.terms.filter((t) => t.status === 'clarify').length;
  return (
    <div className="screen">
      <NextStepBanner />

      <section className="section answer">
        <h2>בקצרה</h2>
        {groups.map((g) => (
          <CheapestLine key={g} state={state} group={g} />
        ))}
        <FlightsLine state={state} />
        <FavoriteLine state={state} />
        <p className="muted small">
          "הזול ביותר" = קרוז + כל מה שהוזן עד עכשיו. זול ≠ הכי טוב: בדקו את סוג החדר ואת הטיסות.
        </p>
      </section>

      {groups.map((g) => (
        <GroupTable key={g} group={g} />
      ))}
      {state.groupBEnabled && <BothNote />}
      {!state.groupBEnabled && (
        <p className="muted small">קבוצה B מוסתרת (לא מגיעים) – אין לה השפעה על שום סכום בעמוד.</p>
      )}

      <FlightsOverview />

      {clarify > 0 && (
        <div className="banner banner-yellow">
          <div>
            <strong>{clarify} תנאים דורשים בירור</strong> מול הסוכנת (מקדמה, ביטול, עמלה).
          </div>
          <button className="btn" onClick={() => go('details')}>
            לפרטים ותנאים
          </button>
        </div>
      )}
    </div>
  );
}
