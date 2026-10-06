import {
  activeGroups,
  bothGroupsTotal,
  cheapestRoom,
  compareDates,
  comparisonSentence,
  computePlan,
  cruiseNights,
  cheapestItinerary,
  flightsFor,
  LINE_KEYS,
  LINE_LABEL,
  todoList,
} from '../domain/calc';
import type { DateComparison } from '../domain/calc';
import { dateName, rangeLabel, rangeLabelLong } from '../domain/dates';
import { DIRECTION_LABEL, flightDetails, flightLabel, flightPriceText, GROUP_LABEL, GROUP_SHORT, usd, usdText } from '../domain/format';
import type { CSSProperties } from 'react';
import type { AppState, Cruise, GroupId } from '../domain/types';
import { Chip, LineValue, NoticeList, StatusBadge, Usd } from './common';
import { useApp } from './context';

// ---------- what now? ----------

const SCREEN_BUTTON = {
  summary: null,
  entry: 'להזנת נתונים',
  details: 'לפרטים ותנאים',
} as const;

function WhatNow() {
  const { state, go } = useApp();
  const todos = todoList(state);
  if (todos.length === 0) {
    return (
      <section className="banner banner-green" aria-label="מה עכשיו?">
        <strong>🟢 כל הנתונים העיקריים הוזנו.</strong> אפשר להחליט לפי הטבלאות למטה.
      </section>
    );
  }
  return (
    <section className="section todo" aria-label="מה עכשיו?">
      <h2>מה עכשיו?</h2>
      <ol className="todo-list">
        {todos.map((t) => (
          <li key={t.id}>
            <span>{t.text}</span>
            {SCREEN_BUTTON[t.screen] && (
              <button className="btn btn-small" onClick={() => go(t.screen)}>
                {SCREEN_BUTTON[t.screen]}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------- the 5-second answer ----------

function Verdict({ cmp }: { cmp: DateComparison }) {
  const sentence = comparisonSentence(cmp, usdText);
  if (!sentence) return <div className="muted">אין עדיין שני תאריכים עם מחיר להשוואה.</div>;
  if (!cmp.partial) {
    return (
      <div className="verdict">
        <strong className="verdict-sure">🟢 {sentence}</strong>
      </div>
    );
  }
  // Missing data: never state it as a fact – show "partial" first, the number only as "so far".
  return (
    <div className="verdict">
      <details className="partial">
        <summary>
          <Chip tone="yellow">🟡 השוואה חלקית</Chip> <span className="muted">לפי מה שהוזן עד עכשיו: {sentence} (לא סופי)</span>
        </summary>
        <ul className="plain-list small">
          {cmp.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** Green "cheapest" marks only when the comparison is complete and the dates really differ. */
function isFinalCheapest(cmp: DateComparison, i: number): boolean {
  return !cmp.partial && cmp.cheapestIndex === i && (cmp.gap ?? 0) > 0;
}

function GroupAnswer({ group }: { group: GroupId }) {
  const { state } = useApp();
  const cmp = compareDates(state, group);
  return (
    <div className={`answer-group answer-${group}`}>
      <h3>{GROUP_LABEL[group]}</h3>
      <div className="answer-totals">
        {cmp.columns.map((c, i) => (
          <div key={c.cruise.id} className={`answer-total ${isFinalCheapest(cmp, i) ? 'is-cheapest' : ''}`}>
            <div className="answer-date">{rangeLabel(c.cruise.start, c.cruise.end)}</div>
            {c.result ? (
              <>
                <Usd value={c.result.total} className="big" />
                <div className="muted small">
                  {c.basis === 'selected' ? c.result.room?.name : `טרם נבחר חדר – לפי הזול (${c.result.room?.name})`}
                </div>
              </>
            ) : (
              <span className="not-entered">אין מחיר</span>
            )}
          </div>
        ))}
      </div>
      <Verdict cmp={cmp} />
    </div>
  );
}

function cheapestFlightText(state: AppState, cruiseId: string, group: GroupId): string | null {
  const it = cheapestItinerary(state, cruiseId, group);
  if (!it) return null;
  const names = it.legs.map((f) => `${f.direction === 'round' ? 'הלוך-חזור ' : ''}${flightLabel(f)}`).join(' + ');
  const extras = it.seats + it.baggage > 0 ? ` + מושבים ${usd(it.seats)} + מזוודות ${usd(it.baggage)}` : '';
  const only = it.oneWayOnly ? ` (רק ${it.legs[0]!.direction === 'back' ? 'חזור' : 'הלוך'} – הכיוון השני חסר)` : '';
  return `${names}: ${usd(it.total)} (טיסות ${usd(it.fare)}${extras})${only}`;
}

function QuickAnswer() {
  const { state } = useApp();
  const groups = activeGroups(state);
  const flightLines = state.cruises.flatMap((c) =>
    groups
      .map((g) => ({ c, g, text: cheapestFlightText(state, c.id, g) }))
      .filter((x): x is { c: Cruise; g: GroupId; text: string } => x.text !== null),
  );
  const favorites = groups
    .map((g) => ({ g, cruise: state.cruises.find((c) => c.id === state.favorite[g]) }))
    .filter((x): x is { g: GroupId; cruise: Cruise } => x.cruise !== undefined);
  const both = state.groupBEnabled
    ? state.cruises.map((c) => ({ c, total: bothGroupsTotal(state, c.id) })).filter((x) => x.total !== null)
    : [];

  return (
    <section className="section answer" aria-label="בקצרה">
      <h2>בקצרה – כמה עולה הכול?</h2>
      <div className="answer-grid">
        {groups.map((g) => (
          <GroupAnswer key={g} group={g} />
        ))}
      </div>

      <div className="answer-lines">
        <div>
          <strong>✈️ הטיסות הזולות ביותר: </strong>
          {flightLines.length === 0 ? (
            <span className="not-entered">עדיין לא הוזנו טיסות</span>
          ) : (
            <ul className="plain-list">
              {flightLines.map(({ c, g, text }) => (
                <li key={c.id + g}>
                  {dateName(c.start)} · {GROUP_SHORT[g]} – {text}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <strong>⭐ מועדף (סימנתי): </strong>
          {favorites.length === 0 ? (
            <span className="muted">לא סומן. אפשר לסמן ☆ בראש כל עמודה בטבלה.</span>
          ) : (
            favorites.map(({ g, cruise }, i) => (
              <span key={g}>
                {i > 0 && ' · '}
                {GROUP_SHORT[g]}: {rangeLabel(cruise.start, cruise.end)}
              </span>
            ))
          )}
        </div>
        {both.length > 0 && (
          <div className="muted small">
            לידיעה בלבד – A + B יחד (זה לא המחיר של אף קבוצה):{' '}
            {both.map((x, i) => (
              <span key={x.c.id}>
                {i > 0 && ' · '}
                {rangeLabel(x.c.start, x.c.end)} <Usd value={x.total!} />
              </span>
            ))}
          </div>
        )}
      </div>
      <p className="muted small">זול ≠ טוב יותר. המחיר וסוג החדר מוצגים בנפרד – ההחלטה שלכם.</p>
    </section>
  );
}

// ---------- one group, all dates ----------

function RoomPicker({ cruise, group }: { cruise: Cruise; group: GroupId }) {
  const { state, dispatch } = useApp();
  const selected = state.plans[cruise.id]?.[group].roomId ?? null;
  const cheapest = cheapestRoom(state, cruise.id, group)?.room?.id;
  const name = `room-${group}-${cruise.id}`;
  return (
    <fieldset className="room-picker">
      <legend className="sr-only">
        חדר – {GROUP_SHORT[group]} – {rangeLabel(cruise.start, cruise.end)}
      </legend>
      {cruise.rooms[group].map((r) => (
        <label key={r.id} className={`room-option ${selected === r.id ? 'is-selected' : ''}`}>
          <input
            type="radio"
            name={name}
            value={r.id}
            checked={selected === r.id}
            onChange={() => dispatch({ type: 'updatePlan', cruiseId: cruise.id, group, patch: { roomId: r.id } })}
          />
          <span className="room-name">{r.name || 'חדר ללא שם'}</span>
          <span className="room-price">{r.price === null ? <span className="not-entered">חסר מחיר</span> : <Usd value={r.price} />}</span>
          {cheapest === r.id && <span className="tag-cheap">הזול בתאריך</span>}
        </label>
      ))}
    </fieldset>
  );
}

function FlightPicker({ cruise, group, slot }: { cruise: Cruise; group: GroupId; slot: 'out' | 'back' }) {
  const { state, dispatch, go } = useApp();
  const plan = state.plans[cruise.id]?.[group];
  const options = flightsFor(state, cruise.id, group, slot);
  if (!plan) return null;
  const value = slot === 'out' ? plan.outFlightId : plan.backFlightId;
  if (options.length === 0) {
    return (
      <button className="btn-link" onClick={() => go('entry')}>
        + הוספת טיסה
      </button>
    );
  }
  return (
    <select
      aria-label={`${slot === 'out' ? 'טיסת הלוך' : 'טיסת חזור'} – ${GROUP_SHORT[group]} – ${dateName(cruise.start)}`}
      value={value ?? ''}
      onChange={(e) =>
        dispatch({
          type: 'updatePlan',
          cruiseId: cruise.id,
          group,
          patch: slot === 'out' ? { outFlightId: e.target.value || null } : { backFlightId: e.target.value || null },
        })
      }
    >
      <option value="">טרם נבחרה</option>
      {options.map((f) => (
        <option key={f.id} value={f.id}>
          {f.direction === 'round' ? `${DIRECTION_LABEL.round}: ` : ''}
          {flightLabel(f)} · {flightPriceText(f, state.passengers[group])}
        </option>
      ))}
    </select>
  );
}

function GroupTable({ group }: { group: GroupId }) {
  const { state, dispatch } = useApp();
  const cmp = compareDates(state, group);
  const results = state.cruises.map((c) => computePlan(state, c.id, group));
  const sentence = comparisonSentence(cmp, usdText);

  if (state.cruises.length === 0) return null;

  return (
    <section className={`section group-section group-${group}`} aria-label={GROUP_LABEL[group]}>
      <h2>
        {GROUP_LABEL[group]}
        <span className="h2-note"> · מחושב בנפרד</span>
      </h2>
      <div className="table-scroll">
        <table className="cmp group-table" style={{ '--cols': state.cruises.length } as CSSProperties}>
          <thead>
            <tr>
              <th scope="col" className="label-col">
                <span className="sr-only">סעיף</span>
              </th>
              {state.cruises.map((c, i) => {
                const fav = state.favorite[group] === c.id;
                const nights = cruiseNights(c);
                return (
                  <th scope="col" key={c.id}>
                    <div className="col-title">{rangeLabelLong(c.start, c.end)}</div>
                    <div className="col-sub">{nights ? `${nights} לילות` : <Chip tone="red">תאריכים לא תקינים</Chip>}</div>
                    <StatusBadge status={results[i]!.status} notices={results[i]!.notices} />
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
            <tr className="row-pick">
              <th scope="row">חדר</th>
              {state.cruises.map((c) => (
                <td key={c.id}>
                  <RoomPicker cruise={c} group={group} />
                </td>
              ))}
            </tr>
            <tr className="row-pick">
              <th scope="row">טיסה</th>
              {state.cruises.map((c, i) => (
                <td key={c.id}>
                  <div className="flight-pick">
                    <span className="mini-label">{results[i]!.roundTrip ? 'הלוך-חזור' : 'הלוך'}</span>
                    <FlightPicker cruise={c} group={group} slot="out" />
                  </div>
                  {!results[i]!.roundTrip && (
                    <div className="flight-pick">
                      <span className="mini-label">חזור</span>
                      <FlightPicker cruise={c} group={group} slot="back" />
                    </div>
                  )}
                  {[results[i]!.out, results[i]!.back].filter(Boolean).map((f) => (
                    <div key={f!.id} className="muted small flight-chosen">
                      {DIRECTION_LABEL[f!.direction]}: {flightLabel(f!)}
                      {flightDetails(f!) && <> · {flightDetails(f!)}</>}
                    </div>
                  ))}
                </td>
              ))}
            </tr>

            {LINE_KEYS.map((key) => (
              <tr key={key} className={key === 'cruise' ? 'row-cruise' : 'row-line'}>
                <th scope="row">{key === 'cruise' ? 'קרוז (החדר שנבחר)' : LINE_LABEL[key]}</th>
                {results.map((r) => (
                  <td key={r.cruiseId}>
                    {key === 'cruise' && !r.room ? <Chip tone="red">🔴 חסר חדר</Chip> : <LineValue line={r.lines[key]} />}
                  </td>
                ))}
              </tr>
            ))}

            <tr className="row-total">
              <th scope="row">סה״כ</th>
              {results.map((r, i) => {
                const isMin = isFinalCheapest(cmp, i) && cmp.columns[i]!.basis === 'selected';
                const cheap = cmp.columns[i]!.basis === 'cheapest' ? cmp.columns[i]!.result : null;
                return (
                  <td key={r.cruiseId} className={isMin ? 'is-min' : ''}>
                    {r.room ? (
                      <>
                        <Usd value={r.total} className="total" />
                        {isMin && <div className="min-tag">הזול מבין התאריכים</div>}
                      </>
                    ) : (
                      <>
                        <span className="not-entered">בחרו חדר</span>
                        {cheap && (
                          <div className="muted small">
                            עם החדר הזול: <Usd value={cheap.total} />
                          </div>
                        )}
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
            <tr className="row-notes">
              <th scope="row">מה חסר</th>
              {results.map((r) => (
                <td key={r.cruiseId}>
                  {r.notices.length === 0 ? <span className="muted small">הכול הוזן</span> : <NoticeList notices={r.notices} />}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="group-verdict">
        <strong>השוואת תאריכים: </strong>
        {sentence ? <Verdict cmp={cmp} /> : <span className="muted">צריך לפחות שני תאריכים עם מחיר.</span>}
      </div>
    </section>
  );
}

// ---------- screen ----------

export function SummaryScreen() {
  const { state } = useApp();
  const groups = activeGroups(state);
  return (
    <div className="screen">
      <WhatNow />
      <QuickAnswer />
      {groups.map((g) => (
        <GroupTable key={g} group={g} />
      ))}
      {!state.groupBEnabled && (
        <p className="banner banner-blue">
          🔵 קבוצה B מוסתרת (לא מצטרפת). הנתונים שלה שמורים, והם לא משפיעים על שום סכום כאן.
        </p>
      )}
    </div>
  );
}
