import {
  activeGroups,
  fareLadder,
  flightCost,
  isFilled,
  priceCheck,
  rateFlight,
  toCents,
} from '../domain/calc';
import type { FareColumn } from '../domain/calc';
import { longDate, ltr, shortDate } from '../domain/dates';
import { FARE_CLASS_LABEL, FARE_RULES } from '../domain/fares';
import { fmt, GROUP_SHORT, usd } from '../domain/format';
import type { FarePriceField } from '../domain/reducer';
import { uid } from '../domain/seed';
import type { Cruise, Flight, GroupId, PriceMode } from '../domain/types';
import { Chip, NumField, Section, TextField, Usd } from './common';
import type { Cards } from './EntryScreen';
import { useApp } from './context';

const cents = (c: number): string => usd(c / 100);

/** "249 + 120 + 69.88" – the numbers exactly as typed, so the user can compare them with the airline. */
function sumText(parts: (number | null)[]): string {
  return parts.map((p) => (p === null ? '?' : fmt(p))).join(' + ');
}

function fareDates(f: Flight): string {
  return ltr(`${shortDate(f.date) || '??'} → ${shortDate(f.returnDate) || '??'}`);
}

// ---------- comparison table: Lite / Classic / Flex ----------

function Cell({ col, children }: { col: FareColumn; children: React.ReactNode }) {
  return <td data-fare={col.fareClass}>{children}</td>;
}

export function FareTable({ cruise }: { cruise: Cruise }) {
  const { state } = useApp();
  const ladder = fareLadder(state, cruise.id);
  const groups = activeGroups(state);
  if (ladder.columns.every((c) => c.flight === null)) return null;
  const rule = (c: FareColumn) => FARE_RULES[c.fareClass];

  return (
    <div className="fare-compare" aria-label="השוואת תעריפים">
      <div className="table-scroll">
        <table className="cmp fare-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">שורה</span>
              </th>
              {ladder.columns.map((c) => (
                <th key={c.fareClass} scope="col">
                  {rule(c).label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">מחיר שהוצג (הלוך / חזור)</th>
              {ladder.columns.map((c) => (
                <Cell key={c.fareClass} col={c}>
                  {c.flight ? (
                    <span dir="ltr">
                      {c.flight.displayedOut === null ? '?' : usd(c.flight.displayedOut)} /{' '}
                      {c.flight.displayedBack === null ? '?' : usd(c.flight.displayedBack)}
                    </span>
                  ) : (
                    '—'
                  )}
                </Cell>
              ))}
            </tr>
            <tr>
              <th scope="row">פירוט למבוגר</th>
              {ladder.columns.map((c) => (
                <Cell key={c.fareClass} col={c}>
                  {c.flight ? (
                    <span dir="ltr">
                      {sumText([c.flight.adultFare, c.flight.carrierSurcharge, c.flight.adultTaxes])}
                      {c.check?.adultCents != null && <> = {cents(c.check.adultCents)}</>}
                    </span>
                  ) : (
                    '—'
                  )}
                </Cell>
              ))}
            </tr>
            <tr>
              <th scope="row">פירוט לתינוק</th>
              {ladder.columns.map((c) => (
                <Cell key={c.fareClass} col={c}>
                  {c.flight ? (
                    <span dir="ltr">
                      {sumText([c.flight.babyFare, c.flight.babyTaxes])}
                      {c.check?.babyCents != null && <> = {cents(c.check.babyCents)}</>}
                    </span>
                  ) : (
                    '—'
                  )}
                </Cell>
              ))}
            </tr>
            <tr>
              <th scope="row">סטטוס מחיר</th>
              {ladder.columns.map((c) => (
                <Cell key={c.fareClass} col={c}>
                  {c.flight ? <FareStatus flight={c.flight} /> : '—'}
                </Cell>
              ))}
            </tr>
            {groups.map((g) => (
              <tr key={`cost-${g}`}>
                <th scope="row">מחיר לחישוב – {GROUP_SHORT[g]}</th>
                {ladder.columns.map((c) => {
                  const cost = c.cost[g];
                  return (
                    <Cell key={c.fareClass} col={c}>
                      {cost ? <Usd value={cost.total} className="total" /> : <span className="not-entered">נדרש אימות</span>}
                    </Cell>
                  );
                })}
              </tr>
            ))}
            {groups.map((g) => (
              <tr key={`delta-${g}`}>
                <th scope="row">תוספת לעומת Lite – {GROUP_SHORT[g]}</th>
                {ladder.columns.map((c) => {
                  const d = c.deltaVsLite[g];
                  return (
                    <Cell key={c.fareClass} col={c}>
                      {c.fareClass === 'lite' ? '—' : d === null ? <span className="not-entered">לא ניתן לחשב</span> : <span dir="ltr">{d >= 0 ? '+' : ''}{usd(d)}</span>}
                    </Cell>
                  );
                })}
              </tr>
            ))}
            <tr className="row-info">
              <th scope="row">
                לפי פירוט – לבדיקה בלבד (לא נספר)
                <div className="muted small">מבוגרים × מבוגר + תינוקות × תינוק</div>
              </th>
              {ladder.columns.map((c) => (
                <Cell key={c.fareClass} col={c}>
                  {c.flight ? (
                    <span dir="ltr" className="small">
                      {groups.map((g) => (
                        <span key={g} className="block">
                          {g}: {c.breakdownCents[g] === null ? '?' : cents(c.breakdownCents[g]!)}
                        </span>
                      ))}
                      {state.groupBEnabled && (
                        <span className="block">
                          {state.passengers.A.adults + state.passengers.B.adults}+{state.passengers.A.infants + state.passengers.B.infants}:{' '}
                          {c.breakdownAllCents === null ? '?' : cents(c.breakdownAllCents)}
                        </span>
                      )}
                    </span>
                  ) : (
                    '—'
                  )}
                </Cell>
              ))}
            </tr>
            <RuleRow label="תיק אישי" pick={(r) => r.personalBag} cols={ladder.columns} />
            <RuleRow label="טרולי" pick={(r) => r.trolley} cols={ladder.columns} />
            <RuleRow label="מזוודה" pick={(r) => r.baggage} cols={ladder.columns} />
            <RuleRow label="מושב" pick={(r) => r.seat} cols={ladder.columns} />
            <RuleRow label="שינוי" pick={(r) => r.change} cols={ladder.columns} />
            <RuleRow label="ביטול" pick={(r) => r.cancellation} cols={ladder.columns} />
            <RuleRow label="שובר" pick={(r) => r.voucher} cols={ladder.columns} />
          </tbody>
        </table>
      </div>
      {ladder.issues.map((text) => (
        <p key={text} className="banner banner-yellow small">
          ⚠️ {text}
        </p>
      ))}
      <p className="muted small">
        התכולה לפי המידע שסופק בלבד. "?" = לא ידוע / לא כלול. מזוודה ומושב שכלולים בתעריף לא נספרים שוב כעלות נוספת.
        {' '}
        {FARE_CLASS_LABEL.lite}: אפשר להוסיף עלות מושב/מזוודה בנפרד בכרטיס התעריף.
      </p>
    </div>
  );
}

function RuleRow({
  label,
  pick,
  cols,
}: {
  label: string;
  pick: (r: (typeof FARE_RULES)['lite']) => string;
  cols: FareColumn[];
}) {
  return (
    <tr>
      <th scope="row">{label}</th>
      {cols.map((c) => (
        <td key={c.fareClass} data-fare={c.fareClass}>
          {pick(FARE_RULES[c.fareClass])}
        </td>
      ))}
    </tr>
  );
}

function FareStatus({ flight }: { flight: Flight }) {
  const { state } = useApp();
  const check = priceCheck(flight);
  const groups = activeGroups(state);
  const unusable = groups.some((g) => flightCost(flight, state.passengers[g], g).needsVerification);
  if (unusable) {
    return <Chip tone="yellow">{check.mismatch ? '⚠️ נדרש אימות מחיר – נתונים לא תואמים' : '⚠️ נדרש אימות מחיר'}</Chip>;
  }
  return flight.priceMode === 'breakdown' && check.mismatch ? (
    <Chip tone="yellow">🟡 לפי פירוט – המחיר שהוצג שונה</Chip>
  ) : (
    <Chip tone="green">🟢 {flight.priceMode === 'total' ? 'מחיר כולל מאומת' : 'לפי פירוט'}</Chip>
  );
}

// ---------- one fare record ----------

const MODE_LABEL: Record<PriceMode, string> = {
  unverified: 'לא מאומת',
  total: 'השתמש במחיר הכולל שהוזן',
  breakdown: 'השתמש בחישוב לפי נוסעים',
};

function MismatchBox({ flight }: { flight: Flight }) {
  const check = priceCheck(flight);
  if (!check.mismatch) return null;
  const out = flight.displayedOut;
  const back = flight.displayedBack;
  return (
    <div className="banner banner-yellow mismatch-box" role="alert">
      <div>
        <strong>⚠️ נדרש אימות מחיר – הנתונים אינם תואמים. בדוק את המחיר מול EL AL.</strong>
      </div>
      <ul className="plain-list small">
        <li>
          מחיר שהוצג: הלוך {out === null ? '?' : <span dir="ltr">{usd(out)}</span>}, חזור {back === null ? '?' : <span dir="ltr">{usd(back)}</span>}
          {check.displayedSumCents !== null && (
            <>
              {' '}
              (יחד <span dir="ltr">{cents(check.displayedSumCents)}</span>)
            </>
          )}
        </li>
        <li>
          פירוט מבוגר: <span dir="ltr">{sumText([flight.adultFare, flight.carrierSurcharge, flight.adultTaxes])} = {cents(check.adultCents ?? 0)}</span>
        </li>
        {check.diffCents !== null && (
          <li>
            הפרש: <span dir="ltr">{cents(check.diffCents)}</span>
          </li>
        )}
        <li>שני המספרים הם ייצוגים של אותו מחיר – הם לא נספרים יחד, ואף אחד מהם לא נבחר בניחוש.</li>
      </ul>
    </div>
  );
}

export function FareCard({ flight, cards }: { flight: Flight; cards: Cards }) {
  const { state, dispatch } = useApp();
  const rule = FARE_RULES[flight.fareClass as Exclude<typeof flight.fareClass, ''>];
  const isOpen = cards.open.has(flight.id);
  const groups = activeGroups(state);
  const set = (patch: Partial<Flight>) => dispatch({ type: 'updateFlight', id: flight.id, patch });
  const setField = (field: FarePriceField) => (value: number | null) => dispatch({ type: 'setFarePrice', id: flight.id, field, value });
  const check = priceCheck(flight);
  const rating = rateFlight(state, flight, groups[0] ?? 'A');
  const ratingTone = { recommended: 'green', compromise: 'yellow', bad: 'red', unknown: 'gray' } as const;
  const history = flight.history;

  return (
    <div className="card flight-card fare-card" id={`card-${flight.id}`}>
      <div className="card-head">
        <div>
          <Chip tone="blue">EL AL {rule.label}</Chip> <strong>{fareDates(flight)}</strong>
          <div className="muted small">
            {flight.searchedFor && <>נבדק עבור: {flight.searchedFor}</>}
            {flight.checkedAt ? <> · נבדק ב-{ltr(longDate(flight.checkedAt))}</> : <> · תאריך הבדיקה לא הוזן</>}
          </div>
          <div className="rating-line">
            <FareStatus flight={flight} />
            <Chip tone={ratingTone[rating.level]}>
              {rating.icon} {rating.label}
            </Chip>
            <span className="muted small"> {rating.reasons.join(' · ')}</span>
          </div>
        </div>
        <div className="card-actions">
          <span className="mini-cost">
            {groups.map((g) => {
              const c = flightCost(flight, state.passengers[g], g);
              return (
                <span key={g} className="block">
                  {g} · {c.needsVerification ? <span className="not-entered">נדרש אימות</span> : <Usd value={c.total} />}
                </span>
              );
            })}
          </span>
          <button className="btn" onClick={() => cards.toggle(flight.id)} aria-expanded={isOpen}>
            {isOpen ? 'סגור' : 'ערוך'}
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              if (window.confirm('למחוק את רשומת התעריף?')) dispatch({ type: 'removeFlight', id: flight.id });
            }}
          >
            מחק
          </button>
        </div>
      </div>

      <MismatchBox flight={flight} />

      {isOpen && (
        <div className="card-body">
          <h4>מחיר שהוצג ליד הטיסה (כפי שהוזן)</h4>
          <div className="form-grid">
            <NumField label="מחיר הלוך" value={flight.displayedOut} onChange={setField('displayedOut')} />
            <NumField label="מחיר חזור" value={flight.displayedBack} onChange={setField('displayedBack')} />
          </div>

          <h4>פירוט המחיר לנוסע</h4>
          <div className="form-grid">
            <NumField label="מבוגר – Fare" value={flight.adultFare} onChange={setField('adultFare')} />
            <NumField label="מבוגר – Carrier surcharge" value={flight.carrierSurcharge} onChange={setField('carrierSurcharge')} />
            <NumField label="מבוגר – Taxes" value={flight.adultTaxes} onChange={setField('adultTaxes')} />
            <NumField label="תינוק – Fare" value={flight.babyFare} onChange={setField('babyFare')} />
            <NumField label="תינוק – Taxes" value={flight.babyTaxes} onChange={setField('babyTaxes')} />
          </div>
          <p className="muted small">
            מבוגר = Fare + Carrier surcharge + Taxes. תינוק = Fare + Taxes. אל תוסיפו את המחיר שהוצג על הפירוט – זה אותו מחיר באופן אחר.
          </p>

          <h4>מחיר כולל לחישוב</h4>
          <fieldset className="price-mode">
            <legend className="sr-only">מחיר כולל לחישוב</legend>
            {(['total', 'breakdown', 'unverified'] as const).map((m) => (
              <label key={m} className="check">
                <input type="radio" name={`mode-${flight.id}`} checked={flight.priceMode === m} onChange={() => set({ priceMode: m })} />
                {MODE_LABEL[m]}
              </label>
            ))}
          </fieldset>
          {flight.priceMode === 'breakdown' && (
            <p className="muted small">
              A = 2 × מבוגר + תינוק, B = 2 × מבוגר. לבחור רק אם ברור שהפירוט הוא מחיר לנוסע לכל הכרטיס (הלוך וחזור)
              {check.mismatch && ' – כרגע המחיר שהוצג שונה מהפירוט'}.
            </p>
          )}
          {flight.priceMode === 'total' && (
            <>
              <div className="form-grid">
                <NumField
                  label="מחיר כולל מאומת – כל הנוסעים"
                  value={flight.verifiedTotal.all}
                  onChange={(v) => dispatch({ type: 'setVerifiedTotal', id: flight.id, key: 'all', value: v })}
                />
                <NumField
                  label="מחיר כולל מאומת – קבוצה A"
                  value={flight.verifiedTotal.A}
                  onChange={(v) => dispatch({ type: 'setVerifiedTotal', id: flight.id, key: 'A', value: v })}
                />
                {state.groupBEnabled && (
                  <NumField
                    label="מחיר כולל מאומת – קבוצה B"
                    value={flight.verifiedTotal.B}
                    onChange={(v) => dispatch({ type: 'setVerifiedTotal', id: flight.id, key: 'B', value: v })}
                  />
                )}
              </div>
              <p className="muted small">
                המחיר שהוזן הוא המחיר הקובע. מחיר כולל לכל הנוסעים לא מתחלק לפי ניחוש – הזינו את החלק של A או של B.
                {isFilled(flight.verifiedTotal.all) &&
                  isFilled(flight.verifiedTotal.A) &&
                  isFilled(flight.verifiedTotal.B) &&
                  toCents(flight.verifiedTotal.A) + toCents(flight.verifiedTotal.B) !== toCents(flight.verifiedTotal.all) &&
                  ' ⚠️ A + B לא שווה לסכום הכולל.'}
              </p>
            </>
          )}

          <h4>מושב ומזוודה</h4>
          {rule.includesBaggage || rule.includesSeat ? (
            <p className="small">
              {rule.includesBaggage && <>מזוודה כלולה בתעריף. </>}
              {rule.includesSeat && <>{rule.seat}. </>}
              לכן לא מוסיפים עלות נוספת (בלי כפל).
            </p>
          ) : (
            <p className="muted small">בתעריף Lite מזוודה ומושב לא כלולים / לא ידועים – מוסיפים עלות נפרדת רק אם נרכשו.</p>
          )}
          <div className="form-grid">
            {groups.map((g: GroupId) => (
              <NumField
                key={`seat-${g}`}
                label={`מושב נוסף – ${GROUP_SHORT[g]}`}
                value={flight.extraSeat[g]}
                onChange={(v) => dispatch({ type: 'setFareExtra', id: flight.id, row: 'seat', group: g, value: v })}
                hint={rule.includesSeat ? 'כלול בתעריף – לא נספר' : undefined}
              />
            ))}
            {groups.map((g: GroupId) => (
              <NumField
                key={`bag-${g}`}
                label={`מזוודה נוספת – ${GROUP_SHORT[g]}`}
                value={flight.extraBaggage[g]}
                onChange={(v) => dispatch({ type: 'setFareExtra', id: flight.id, row: 'baggage', group: g, value: v })}
                hint={rule.includesBaggage ? 'כלולה בתעריף – לא נספרת' : undefined}
              />
            ))}
          </div>

          <h4>מקור ופרטים</h4>
          <div className="form-grid">
            <TextField label="מקור המחיר" value={flight.source} onChange={(v) => set({ source: v })} />
            <TextField label="קישור למקור" value={flight.sourceUrl} onChange={(v) => set({ sourceUrl: v })} placeholder="https://…" />
            <TextField label="תאריך בדיקה" type="date" value={flight.checkedAt} onChange={(v) => set({ checkedAt: v })} />
            <TextField label="נבדק עבור" value={flight.searchedFor} onChange={(v) => set({ searchedFor: v })} />
            <TextField label="מספר טיסה – הלוך" value={flight.flightNo} onChange={(v) => set({ flightNo: v })} />
            <TextField label="מספר טיסה – חזור" value={flight.returnFlightNo} onChange={(v) => set({ returnFlightNo: v })} />
            <TextField label="יציאה הלוך" type="time" value={flight.depTime} onChange={(v) => set({ depTime: v })} />
            <TextField label="נחיתה הלוך" type="time" value={flight.arrTime} onChange={(v) => set({ arrTime: v })} />
            <TextField label="יציאה חזור" type="time" value={flight.returnDepTime} onChange={(v) => set({ returnDepTime: v })} />
            <TextField label="נחיתה חזור" type="time" value={flight.returnArrTime} onChange={(v) => set({ returnArrTime: v })} />
            <TextField label="הערות" value={flight.notes} onChange={(v) => set({ notes: v })} wide />
          </div>

          <h4>היסטוריית בדיקות</h4>
          {history.length === 0 ? (
            <p className="muted small">אין בדיקות קודמות. הנתונים למעלה הם הבדיקה שהוזנה.</p>
          ) : (
            <ol className="history-list">
              {history.map((h) => (
                <li key={h.id}>
                  <Chip tone="gray">בדיקה קודמת</Chip> {h.checkedAt ? ltr(longDate(h.checkedAt)) : 'תאריך לא הוזן'}
                  {h.source && <> · {h.source}</>}
                  <div className="small" dir="ltr">
                    {h.displayedOut === null ? '?' : usd(h.displayedOut)} / {h.displayedBack === null ? '?' : usd(h.displayedBack)} · adult {sumText([h.adultFare, h.carrierSurcharge, h.adultTaxes])} · baby {sumText([h.babyFare, h.babyTaxes])}
                  </div>
                </li>
              ))}
              <li>
                <Chip tone="blue">בדיקה חדשה</Chip> הנתונים למעלה
              </li>
            </ol>
          )}
          <button className="btn" onClick={() => dispatch({ type: 'archiveFareCheck', id: flight.id, checkId: uid('chk') })}>
            ➕ בדיקה חדשה (שומר את הנוכחית כבדיקה קודמת)
          </button>
          <p className="muted small">מחיר שנבדק הוא לא מחיר מובטח – מחירי טיסות משתנים.</p>
        </div>
      )}
    </div>
  );
}

// ---------- section on the entry screen ----------

export function FareSection({ cruise, cards }: { cruise: Cruise; cards: Cards }) {
  const { state } = useApp();
  const fares = state.flights.filter((f) => f.cruiseId === cruise.id && f.fareClass !== '');
  if (fares.length === 0) return null;
  const order = ['lite', 'classic', 'flex'];
  const sorted = [...fares].sort((a, b) => order.indexOf(a.fareClass) - order.indexOf(b.fareClass));
  return (
    <Section
      title="✈️ טיסות EL AL – תעריפים (Lite / Classic / Flex)"
      hint="טיסות שנבדקו עבור 4 מבוגרים + תינוק. כל קבוצה מחושבת בנפרד: A = 2 מבוגרים + תינוק, B = 2 מבוגרים. הבחירה מתבצעת במסך הסיכום."
      className="fare-section"
      label="תעריפי EL AL"
    >
      <FareTable cruise={cruise} />
      {sorted.map((f) => (
        <FareCard key={f.id} flight={f} cards={cards} />
      ))}
    </Section>
  );
}
