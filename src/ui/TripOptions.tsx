import { activeGroups, compareDates, fareLadder, flightCost, missingItems, toCents, tripOption } from '../domain/calc';
import type { DateColumn, PlanResult } from '../domain/calc';
import { ltr, rangeLabel, shortDate } from '../domain/dates';
import { FARE_RULES } from '../domain/fares';
import { directLabel, GROUP_SHORT, passengersLabel, usd } from '../domain/format';
import type { GroupId } from '../domain/types';
import { Chip, LineValue, NotEntered, Usd } from './common';
import { useApp } from './context';

const span = (from: string, to: string) => ltr(`${shortDate(from) || '??'}–${shortDate(to) || '??'}`);

function nightsWord(n: number): string {
  return n === 1 ? 'לילה אחד' : `${n} לילות`;
}

function GroupTotalCell({ column, group }: { column: DateColumn | undefined; group: GroupId }) {
  const r = column?.result;
  if (!r) return <NotEntered text="בחרו חדר" />;
  const missing = missingItems(r);
  return (
    <div>
      <Usd value={r.total} className="total" />
      {column.basis === 'cheapest' && <div className="muted small">לפי החדר הזול</div>}
      {missing.length > 0 ? (
        <div className="small">
          <Chip tone="yellow">🟡 חלקי – חסר: {missing.join(', ')}</Chip>
        </div>
      ) : (
        <div className="small">
          <Chip tone="green">🟢 {GROUP_SHORT[group]}</Chip>
        </div>
      )}
    </div>
  );
}

function extrasLine(r: PlanResult) {
  const keys = ['seats', 'baggage', 'tips', 'agentFee', 'drinks', 'internet', 'transport', 'other'] as const;
  const entered = keys.some((k) => r.lines[k].entered && !r.lines[k].label);
  const sum = keys.reduce((t, k) => t + toCents(r.lines[k].amount), 0) / 100;
  return entered ? <Usd value={sum} /> : <NotEntered />;
}

/** Option 1 / Option 2: the whole trip (flight, hotel, cruise, totals) side by side. */
export function TripOptions() {
  const { state, dispatch, go } = useApp();
  const groups = activeGroups(state);
  const cmp = Object.fromEntries(groups.map((g) => [g, compareDates(state, g)])) as Record<GroupId, ReturnType<typeof compareDates>>;
  const party = groups.reduce((t, g) => ({ adults: t.adults + state.passengers[g].adults, infants: t.infants + state.passengers[g].infants }), {
    adults: 0,
    infants: 0,
  });

  return (
    <section className="section trip-options" aria-label="אפשרויות הטיול">
      <h2>🧭 איזה Trip שלם עדיף?</h2>
      <p className="muted small">
        לא רק איזה קרוז זול יותר – כל הטיול: טיסה, מלון וקרוז. כל קבוצה מחושבת בנפרד.
        {' '}
        <strong>כל הנוסעים: {passengersLabel(party)}</strong>
        {groups.map((g) => ` · ${g}: ${passengersLabel(state.passengers[g])}`).join('')}
      </p>
      <div className="option-grid">
        {state.cruises.map((cruise, i) => {
          const o = tripOption(state, cruise.id);
          const f = o.flight;
          const ladder = fareLadder(state, cruise.id);
          const hasFares = ladder.columns.some((c) => c.flight);
          const selectedId = state.plans[cruise.id]?.[groups[0] ?? 'A']?.outFlightId;
          const stayText = (s: typeof o.before) =>
            s ? `${span(s.checkIn, s.checkOut)} (${nightsWord(s.nights)})${s.source === 'flight' ? ' · לפי הטיסה' : ''}` : 'לא ידוע';
          return (
            <article key={cruise.id} className="option-card" aria-label={`אפשרות ${i + 1}`}>
              <h3>
                אפשרות {i + 1} · <span dir="ltr">{rangeLabel(cruise.start, cruise.end)}</span>
              </h3>
              <ul className="option-timeline">
                <li>
                  ✈️ {f ? (
                    <>
                      <span dir="ltr">
                        {shortDate(f.date)} → {shortDate(f.direction === 'round' ? f.returnDate : f.date)}
                      </span>{' '}
                      · {f.airline || 'טיסה'}
                      {f.depTime && (
                        <>
                          {' '}
                          · <span dir="ltr">{f.depTime} → {f.arrTime || '?'}</span>
                        </>
                      )}
                      {directLabel(f) === 'כן' && ' · ישירה'}
                      {!o.flightSelected && <span className="muted small"> (תאריכי התעריפים – טרם נבחר תעריף)</span>}
                    </>
                  ) : (
                    <NotEntered text="טרם נבחרה טיסה" />
                  )}
                </li>
                <li>
                  🏨 לפני: {stayText(o.before)} · אחרי: {stayText(o.after)}
                </li>
                <li>
                  🚢 <span dir="ltr">{span(cruise.start, cruise.end)}</span> · קרוז
                </li>
              </ul>

              {hasFares && (
                <div className="fare-pick" role="group" aria-label={`בחירת תעריף – אפשרות ${i + 1}`}>
                  <span className="field-label">תעריף EL AL:</span>
                  {ladder.columns.map((c) =>
                    c.flight ? (
                      <button
                        key={c.fareClass}
                        className={`btn btn-small ${selectedId === c.flight.id ? 'btn-primary' : ''}`}
                        aria-pressed={selectedId === c.flight.id}
                        onClick={() => dispatch({ type: 'selectFare', cruiseId: cruise.id, flightId: c.flight!.id })}
                      >
                        {FARE_RULES[c.fareClass].label}
                        {groups.map((g) => {
                          const cost = flightCost(c.flight!, state.passengers[g], g);
                          return (
                            <span key={g} className="fare-btn-price">
                              {g} · {cost.needsVerification ? '⚠️' : usd(cost.total)}
                            </span>
                          );
                        })}
                      </button>
                    ) : null,
                  )}
                  <button className="btn-link" onClick={() => go('entry', { cruiseId: cruise.id })}>
                    ✏️ פירוט והשוואה
                  </button>
                </div>
              )}

              <div className="table-scroll">
                <table className="cmp option-table">
                  <thead>
                    <tr>
                      <th scope="col">
                        <span className="sr-only">סעיף</span>
                      </th>
                      {groups.map((g) => (
                        <th key={g} scope="col">
                          {g} · {GROUP_SHORT[g]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">✈️ טיסות</th>
                      {groups.map((g) => {
                        const r = cmp[g].columns[i]?.result;
                        return (
                          <td key={g} data-label={`✈️ טיסות · ${g}`}>
                            {r ? <LineValue line={r.lines.flights} /> : '—'}
                          </td>
                        );
                      })}
                    </tr>
                    <tr>
                      <th scope="row">🏨 מלון</th>
                      {groups.map((g) => {
                        const r = cmp[g].columns[i]?.result;
                        return (
                          <td key={g} data-label={`🏨 מלון · ${g}`}>
                            {r ? (
                              <>
                                <LineValue line={r.lines.hotel} />
                                {(r.lines.hotelAfter.entered || r.lines.hotelAfter.label) && (
                                  <>
                                    {' + '}
                                    <LineValue line={r.lines.hotelAfter} />
                                  </>
                                )}
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    <tr>
                      <th scope="row">🚢 קרוז</th>
                      {groups.map((g) => {
                        const r = cmp[g].columns[i]?.result;
                        return (
                          <td key={g} data-label={`🚢 קרוז · ${g}`}>
                            {r ? <LineValue line={r.lines.cruise} /> : <NotEntered text="בחרו חדר" />}
                          </td>
                        );
                      })}
                    </tr>
                    <tr>
                      <th scope="row">🧾 שאר (טיפים, עמלה…)</th>
                      {groups.map((g) => {
                        const r = cmp[g].columns[i]?.result;
                        return (
                          <td key={g} data-label={`🧾 שאר · ${g}`}>
                            {r ? extrasLine(r) : '—'}
                          </td>
                        );
                      })}
                    </tr>
                    <tr className="row-total">
                      <th scope="row">💰 Total</th>
                      {groups.map((g) => (
                        <td key={g} data-label={`💰 Total ${g}`}>
                          <GroupTotalCell column={cmp[g].columns[i]} group={g} />
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
