import {
  activeGroups,
  bothGroupsTotal,
  cheapestRoom,
  compareDates,
  comparisonSentence,
  computePlan,
  cruiseNights,
  cruiseVsTrip,
  flightCost,
  flightFullyPriced,
  flightGroup,
  flightsFor,
  goodNews,
  hotelNights,
  perAdult,
  rateFlight,
  recommendation,
  tripTimeline,
  LINE_KEYS,
  LINE_LABEL,
  todoList,
} from '../domain/calc';
import type { DateComparison } from '../domain/calc';
import { dateName, longDate, ltr, rangeLabel, rangeLabelLong, shortDate } from '../domain/dates';
import {
  DIRECTION_LABEL,
  directLabel,
  flightDetails,
  flightLabel,
  flightPriceText,
  GROUP_LABEL,
  GROUP_SHORT,
  passengersLabel,
  usd,
  usdText,
} from '../domain/format';
import type { CSSProperties } from 'react';
import type { Cruise, Flight, GroupId } from '../domain/types';
import { Chip, LineValue, NoticeList, StatusBadge, Usd } from './common';
import { useApp } from './context';
import { TripOptions } from './TripOptions';

// ---------- the recommendation ----------

const RATING_TONE = { recommended: 'green', compromise: 'yellow', bad: 'red', unknown: 'gray' } as const;

function RecommendationFor({ group }: { group: GroupId }) {
  const { state, go } = useApp();
  const rec = recommendation(state, group);
  const cruise = state.cruises.find((c) => c.id === rec.cruiseId);
  const plan = cruise ? computePlan(state, cruise.id, group) : null;
  return (
    <div className={`rec rec-${rec.status} answer-${group}`}>
      <h3>{GROUP_LABEL[group]}</h3>
      {rec.status === 'recommend' && cruise && plan && (
        <>
          <div className="rec-title">
            🏆 <strong>{rangeLabelLong(cruise.start, cruise.end)}</strong> · <Usd value={plan.total} className="big" />
          </div>
          <div className="muted small">{plan.room?.name}</div>
          <p className="rec-why">למה?</p>
          <ul className="plain-list">
            {rec.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
          <p className="muted small">זו המלצה בלבד, לפי מה שהוזן עד עכשיו. ההחלטה שלכם.</p>
        </>
      )}
      {rec.status === 'early' && (
        <>
          <div className="rec-title">
            <Chip tone="yellow">🟡 עדיין מוקדם לבחור</Chip>
          </div>
          {rec.missing.length > 0 && (
            <p>
              חסרים: <strong>{rec.missing.join(', ')}</strong>
            </p>
          )}
          <button className="btn btn-small" onClick={() => go('entry')}>
            להשלמת הנתונים
          </button>
        </>
      )}
      {rec.status === 'none' && (
        <>
          <div className="rec-title">
            <Chip tone="gray">אין המלצה</Chip>
          </div>
          <ul className="plain-list">
            {rec.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </>
      )}
      {rec.cautions.map((c, i) => (
        <p key={i} className="notice notice-yellow">
          🟡 {c}
        </p>
      ))}
    </div>
  );
}

function Recommendation() {
  const { state } = useApp();
  return (
    <section className="section rec-box" aria-label="האפשרות המומלצת">
      <h2>🏆 האפשרות המומלצת</h2>
      <p className="muted small">כל קבוצה בנפרד. ההמלצה לוקחת בחשבון מחיר כולל, טיסה ישירה, מרווח ביטחון לפני ואחרי הקרוז, שעות ותינוק – לא רק מחיר.</p>
      <div className="answer-grid">
        {activeGroups(state).map((g) => (
          <RecommendationFor key={g} group={g} />
        ))}
      </div>
    </section>
  );
}

// ---------- what now? ----------

const SCREEN_BUTTON = {
  summary: null,
  entry: 'להזנת נתונים',
  details: 'לפרטים ותנאים',
} as const;

function WhatNow() {
  const { state, go } = useApp();
  const todos = todoList(state);
  const news = goodNews(state);
  if (todos.length === 0) {
    return (
      <section className="banner banner-green" aria-label="מה עכשיו?">
        <strong>🟢 כל הנתונים העיקריים הוזנו.</strong> אפשר להחליט לפי הטבלאות למטה.
        {news.map((text) => (
          <div key={text}>🟢 {text}</div>
        ))}
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
      {news.map((text) => (
        <p key={text} className="good-news">
          🟢 {text}
        </p>
      ))}
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

function QuickAnswer() {
  const { state } = useApp();
  const groups = activeGroups(state);
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
  const { state, dispatch, go } = useApp();
  const cmp = compareDates(state, group);
  const results = state.cruises.map((c) => computePlan(state, c.id, group));
  const sentence = comparisonSentence(cmp, usdText);
  const trip = cruiseVsTrip(cmp);
  const pax = state.passengers[group];

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
            <tr className="row-route">
              <th scope="row">מסלול</th>
              {state.cruises.map((c) => (
                <td key={c.id}>
                  <Timeline cruiseId={c.id} group={group} />
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
                  {[results[i]!.out, results[i]!.back].filter((f): f is Flight => f !== null).map((f) => {
                    const rating = rateFlight(state, f);
                    return (
                      <div key={f.id} className="flight-chosen">
                        <div className="small">
                          ✈️ {DIRECTION_LABEL[f.direction]}: {flightLabel(f)}
                          {flightDetails(f) && <span className="muted"> · {flightDetails(f)}</span>}
                        </div>
                        <Chip tone={RATING_TONE[rating.level]}>
                          {rating.icon} {rating.label}
                        </Chip>
                        <span className="muted small"> {rating.reasons.join(' · ')}</span>
                      </div>
                    );
                  })}
                  <button className="btn-link" onClick={() => go('entry', { cruiseId: c.id, focusId: results[i]!.out?.id })}>
                    ✏️ עריכה
                  </button>
                </td>
              ))}
            </tr>

            {LINE_KEYS.filter((key) => key !== 'hotelAfter' || results.some((r) => r.hotelAfter || r.lines.hotelAfter.label)).map((key) => (
              <tr key={key} className={key === 'cruise' ? 'row-cruise' : 'row-line'}>
                <th scope="row">{key === 'cruise' ? 'קרוז (החדר שנבחר)' : LINE_LABEL[key]}</th>
                {results.map((r) => {
                  const hotel = key === 'hotel' ? r.hotel : key === 'hotelAfter' ? r.hotelAfter : null;
                  return (
                    <td key={r.cruiseId}>
                      {key === 'cruise' && !r.room ? <Chip tone="red">🔴 חסר חדר</Chip> : <LineValue line={r.lines[key]} />}
                      {hotel && (
                        <div className="muted small">
                          🏨 {hotel.name || 'מלון'} · {hotelNights(hotel).nights} לילות
                          {(key === 'hotel' || key === 'hotelAfter') && (
                            <button className="btn-link" onClick={() => go('entry', { cruiseId: r.cruiseId, focusId: hotel.id })}>
                              ✏️ עריכה
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
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
                        <div className="muted small">
                          קרוז בלבד <Usd value={r.cruiseOnly} /> · כל הטיול <Usd value={r.total} />
                        </div>
                        {perAdult(r.total, pax) !== null && (
                          <div className="muted small">
                            ≈ <Usd value={perAdult(r.total, pax)!} /> למבוגר (מידע משני – התינוק כלול בעלות)
                          </div>
                        )}
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
      {trip.cruiseGap !== null && trip.cruiseGap > 0 && (
        <p className={`cvt ${trip.differs ? 'cvt-warn' : ''}`}>
          <strong>קרוז בלבד:</strong> {dateName(state.cruises[trip.cruiseCheapest ?? 0]!.start)} זול ב-{usdText(trip.cruiseGap)}
          {trip.tripGap !== null && trip.tripCheapest !== null && (
            <>
              {' '}
              · <strong>כל הטיול:</strong> {dateName(state.cruises[trip.tripCheapest]!.start)} זול ב-{usdText(trip.tripGap)}
              {cmp.partial && ' (לפי מה שהוזן – השוואה חלקית)'}
            </>
          )}
          {trip.differs && <> · 🟡 הקרוז הזול יותר הוא לא החופשה הזולה יותר.</>}
        </p>
      )}
    </section>
  );
}

// ---------- trip timeline ----------

const TIMELINE_ICON = { flight: '✈️', hotel: '🏨', cruise: '🚢' } as const;

function Timeline({ cruiseId, group }: { cruiseId: string; group: GroupId }) {
  const { state } = useApp();
  const events = tripTimeline(state, cruiseId, group);
  const span = (from: string, to: string) =>
    to ? `${shortDate(from) || '??'}–${shortDate(to)}` : shortDate(from) || 'תאריך לא הוזן';
  return (
    <ol className="timeline">
      {events.map((e, i) => (
        <li key={i}>
          <span className="tl-date">{ltr(span(e.from, e.to))}</span> {TIMELINE_ICON[e.kind]} {e.text}
        </li>
      ))}
    </ol>
  );
}

// ---------- flight comparison ----------

function FlightRow({ flight, selected, onSelect }: { flight: Flight; selected: boolean; onSelect: () => void }) {
  const { state, go } = useApp();
  const pax = state.passengers[flightGroup(flight)];
  const cost = flightCost(flight, pax);
  const rating = rateFlight(state, flight);
  const dates =
    flight.direction === 'round'
      ? `${shortDate(flight.date) || '??'} → ${shortDate(flight.returnDate) || '??'}`
      : shortDate(flight.date) || 'תאריך לא הוזן';
  return (
    <tr className={selected ? 'is-selected' : ''}>
      <th scope="row">
        <div>
          ✈️ {flightLabel(flight)} {flight.benchmark && <Chip tone="blue">📌 Benchmark</Chip>}
        </div>
        <div className="muted small">{DIRECTION_LABEL[flight.direction]}</div>
      </th>
      <td data-label="תאריכים">{ltr(dates)}</td>
      <td data-label="ישירה">{directLabel(flight)}</td>
      <td data-label="נוסעים">{passengersLabel(pax)}</td>
      <td data-label="מחיר">
        {cost.fareEntered ? <Usd value={cost.total} className="total" /> : <span className="not-entered">חסר מחיר</span>}
        {cost.usesCartTotal && <div className="muted small">סה״כ העגלה (Round Trip)</div>}
        {(cost.seats > 0 || cost.baggage > 0) && (
          <div className="muted small">
            טיסה {usd(cost.fare)} + מושבים {usd(cost.seats)} + מזוודות {usd(cost.baggage)}
          </div>
        )}
        {flight.fareType && <div className="muted small">{flight.fareType}</div>}
        {!flight.verified && <Chip tone="yellow">🟡 לא מאומת</Chip>}
        {flight.verified && flight.checkedAt && (
          <div className="muted small">
            מחיר שנבדק ב-{ltr(longDate(flight.checkedAt))} – לא מחיר מובטח
          </div>
        )}
      </td>
      <td data-label="דירוג ולמה">
        <Chip tone={RATING_TONE[rating.level]}>
          {rating.icon} {rating.label}
        </Chip>
        {rating.goodPrice && <Chip tone="green">🟢 מחיר טוב</Chip>}
        <div className="small">{rating.reasons.join(' · ')}</div>
      </td>
      <td className="small" data-label="מקור">
        {flight.source || <span className="not-entered">מקור לא הוזן</span>}
        {flight.sourceUrl && (
          <div>
            <a href={flight.sourceUrl} target="_blank" rel="noreferrer noopener">
              קישור
            </a>
          </div>
        )}
      </td>
      <td>
        <button className={`btn btn-small ${selected ? 'btn-primary' : ''}`} onClick={onSelect} aria-pressed={selected}>
          {selected ? '✓ נבחרה' : 'בחר'}
        </button>
        <button className="btn-link" onClick={() => go('entry', { cruiseId: flight.cruiseId, focusId: flight.id })}>
          ✏️ עריכה
        </button>
      </td>
    </tr>
  );
}

function FlightComparison() {
  const { state, dispatch, go } = useApp();
  const groups = activeGroups(state);
  return (
    <section className="section" aria-label="השוואת טיסות">
      <h2>✈️ השוואת טיסות</h2>
      <p className="muted small">
        הדירוג הוא המלצה בלבד, עם הסיבה. טיסה ישירה עדיפה בגלל התינוק. מחירי טיסות משתנים – כל מחיר מוצג כמחיר שנבדק, לא כמחיר מובטח.
      </p>
      {state.flights.length === 0 && (
        <div className="banner banner-yellow">
          <div>עדיין לא הוזנו טיסות.</div>
          <button className="btn" onClick={() => go('entry')}>
            הוספת טיסה
          </button>
        </div>
      )}
      {state.cruises.map((c) =>
        groups.map((g) => {
          const list = state.flights.filter((f) => f.cruiseId === c.id && f.group === g);
          if (list.length === 0) return null;
          const plan = state.plans[c.id]?.[g];
          const pax = state.passengers[g];
          const order = { recommended: 0, compromise: 1, unknown: 2, bad: 3 } as const;
          const sorted = [...list].sort(
            (a, b) =>
              order[rateFlight(state, a).level] - order[rateFlight(state, b).level] ||
              (flightFullyPriced(a, pax) ? flightCost(a, pax).total : Infinity) - (flightFullyPriced(b, pax) ? flightCost(b, pax).total : Infinity),
          );
          return (
            <div key={c.id + g} className="flight-cruise">
              <h3>
                {rangeLabelLong(c.start, c.end)} · {GROUP_LABEL[g]}
              </h3>
              <div className="table-scroll">
                <table className="cmp flights">
                  <thead>
                    <tr>
                      <th scope="col">טיסה</th>
                      <th scope="col">תאריכים</th>
                      <th scope="col">ישירה</th>
                      <th scope="col">נוסעים</th>
                      <th scope="col">מחיר</th>
                      <th scope="col">דירוג ולמה</th>
                      <th scope="col">מקור</th>
                      <th scope="col">
                        <span className="sr-only">פעולות</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((f) => {
                      const selected = plan?.outFlightId === f.id || plan?.backFlightId === f.id;
                      return (
                        <FlightRow
                          key={f.id}
                          flight={f}
                          selected={selected}
                          onSelect={() =>
                            dispatch({
                              type: 'updatePlan',
                              cruiseId: c.id,
                              group: g,
                              patch: f.direction === 'back' ? { backFlightId: selected ? null : f.id } : { outFlightId: selected ? null : f.id },
                            })
                          }
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }),
      )}
    </section>
  );
}

// ---------- screen ----------

export function SummaryScreen() {
  const { state } = useApp();
  const groups = activeGroups(state);
  return (
    <div className="screen">
      <Recommendation />
      <WhatNow />
      <TripOptions />
      <QuickAnswer />
      {groups.map((g) => (
        <GroupTable key={g} group={g} />
      ))}
      <FlightComparison />
      {!state.groupBEnabled && (
        <p className="banner banner-blue">
          🔵 קבוצה B מוסתרת (לא מצטרפת). הנתונים שלה שמורים, והם לא משפיעים על שום סכום כאן.
        </p>
      )}
    </div>
  );
}
