import { useEffect, useState } from 'react';
import {
  activeGroups,
  computePlan,
  cruiseDatesValid,
  flightCost,
  flightGroup,
  flightsFor,
  hotelCost,
  hotelIssues,
  hotelNights,
  hotelHasPrice,
  hotelNeedsConversion,
  rateFlight,
  hotelServesGroup,
  hotelShare,
  isFilled,
  plannedStay,
  LINE_KEYS,
  LINE_LABEL,
  passengerSlots,
  tipsPeople,
} from '../domain/calc';
import { daysBetween, ltr, rangeLabel, shortDate } from '../domain/dates';
import { CURRENCY_SYMBOL, DIRECTION_LABEL, flightDetails, hotelNativeText, flightLabel, flightPriceText, GROUP_LABEL, GROUP_SHORT, OWNER_LABEL, usd } from '../domain/format';
import type { PriceRow } from '../domain/reducer';
import { emptyFlight, emptyItem, newHotelFor, uid } from '../domain/seed';
import type { Cruise, Currency, ExtraItem, Flight, FlightDirection, GroupId, Hotel, ItemCategory, Owner, Plan } from '../domain/types';
import { GROUPS } from '../domain/types';
import { Chip, LineValue, MoneyInput, NotEntered, NoticeList, NumField, Section, TextField, Usd } from './common';
import { useApp } from './context';
import { FareSection } from './FaresSection';

// ---------- open/close state of the option cards ----------

export interface Cards {
  open: Set<string>;
  toggle: (id: string) => void;
  show: (id: string) => void;
}

// ---------- one group on one date: the main form ----------

function GroupForm({ cruise, group, cards }: { cruise: Cruise; group: GroupId; cards: Cards }) {
  const { state, dispatch } = useApp();
  const plan = state.plans[cruise.id]?.[group];
  if (!plan) return null;
  const result = computePlan(state, cruise.id, group);
  const pax = state.passengers[group];
  const patch = (p: Partial<Plan>) => dispatch({ type: 'updatePlan', cruiseId: cruise.id, group, patch: p });
  const hotelsOf = (phase: 'before' | 'after') =>
    state.hotels.filter((h) => h.cruiseId === cruise.id && hotelServesGroup(h, group) && (h.phase ?? 'before') === phase);

  const newHotel = (phase: 'before' | 'after') => {
    const h = newHotelFor(cruise, group, phase, plannedStay(state, cruise.id, group, phase));
    dispatch({ type: 'addHotel', hotel: h });
    patch(phase === 'before' ? { hotelId: h.id, noHotel: false } : { hotelAfterId: h.id, noHotelAfter: false });
    cards.show(h.id);
  };

  const hotelSelect = (phase: 'before' | 'after') => {
    const after = phase === 'after';
    const value = after ? (plan.noHotelAfter ? '__none__' : (plan.hotelAfterId ?? '')) : plan.noHotel ? '__none__' : (plan.hotelId ?? '');
    return (
      <div className="field field-wide">
        <span className="field-label">{after ? 'מלון בברצלונה אחרי הקרוז (אופציונלי)' : 'מלון בברצלונה לפני הקרוז'}</span>
        <div className="select-row">
          <select
            aria-label={`${after ? 'מלון אחרי הקרוז' : 'מלון'} – ${GROUP_SHORT[group]}`}
            value={value}
            onChange={(e) => {
              const v = e.target.value;
              if (after) patch(v === '__none__' ? { hotelAfterId: null, noHotelAfter: true } : { hotelAfterId: v || null, noHotelAfter: false });
              else patch(v === '__none__' ? { hotelId: null, noHotel: true } : { hotelId: v || null, noHotel: false });
            }}
          >
            <option value="">טרם הוחלט</option>
            <option value="__none__">לא צריך מלון</option>
            {hotelsOf(phase).map((h) => (
              <option key={h.id} value={h.id}>
                {h.name || 'מלון (ללא שם)'} · {h.owner === 'both' ? 'משותף, ' : ''}
                {hotelHasPrice(h) ? (hotelNeedsConversion(h) ? `${hotelNativeText(h)} (טרם הומר)` : usd(hotelShare(h, group).amount)) : 'חסר מחיר'}
              </option>
            ))}
          </select>
          <button className="btn" type="button" onClick={() => newHotel(phase)}>
            + מלון חדש
          </button>
        </div>
      </div>
    );
  };

  const flightSelect = (slot: 'out' | 'back') => {
    const options = flightsFor(state, cruise.id, group, slot);
    const label = slot === 'out' ? 'טיסת הלוך (או כרטיס הלוך-חזור)' : 'טיסת חזור';
    return (
      <label className="field field-wide">
        <span className="field-label">{label}</span>
        <select
          aria-label={`${slot === 'out' ? 'טיסת הלוך' : 'טיסת חזור'} – ${GROUP_SHORT[group]}`}
          value={(slot === 'out' ? plan.outFlightId : plan.backFlightId) ?? ''}
          onChange={(e) => patch(slot === 'out' ? { outFlightId: e.target.value || null } : { backFlightId: e.target.value || null })}
        >
          <option value="">{options.length === 0 ? 'אין עדיין אפשרויות – הוסיפו למטה' : 'טרם נבחרה'}</option>
          {options.map((f) => (
            <option key={f.id} value={f.id}>
              {f.direction === 'round' ? 'הלוך-חזור: ' : ''}
              {flightLabel(f)} · {flightPriceText(f, pax)}
            </option>
          ))}
        </select>
      </label>
    );
  };

  const fav = state.favorite[group] === cruise.id;
  const tipsCount = tipsPeople(plan, pax);

  return (
    <div className={`card group-card group-${group}`}>
      <div className="card-head">
        <h3>{GROUP_LABEL[group]}</h3>
        <label className="check">
          <input
            type="checkbox"
            checked={fav}
            onChange={() => dispatch({ type: 'setFavorite', group, cruiseId: fav ? null : cruise.id })}
          />
          ⭐ תאריך מועדף
        </label>
      </div>

      <div className="form-grid">
        <label className="field field-wide">
          <span className="field-label">חדר</span>
          <select
            aria-label={`חדר – ${GROUP_SHORT[group]}`}
            value={plan.roomId ?? ''}
            onChange={(e) => patch({ roomId: e.target.value || null })}
          >
            <option value="">בחרו חדר…</option>
            {cruise.rooms[group].map((r) => (
              <option key={r.id} value={r.id}>
                {r.name || 'חדר ללא שם'} – {r.price === null ? 'חסר מחיר' : usd(r.price)}
              </option>
            ))}
          </select>
        </label>

        {flightSelect('out')}
        {result.roundTrip ? (
          <p className="field field-wide muted small">כרטיס הלוך-חזור – אין צורך בטיסת חזור נפרדת.</p>
        ) : (
          flightSelect('back')
        )}

        {hotelSelect('before')}
        {hotelSelect('after')}

        <div className="field field-wide tips-field">
          <span className="field-label">טיפים לצוות (Crew tips)</span>
          <div className="tips-row">
            <MoneyInput ariaLabel={`טיפים – ${GROUP_SHORT[group]}`} value={plan.tips} onChange={(v) => patch({ tips: v })} />
            <select
              aria-label="איך הוזנו הטיפים"
              value={plan.tipsMode}
              onChange={(e) => patch({ tipsMode: e.target.value === 'person' ? 'person' : 'group' })}
            >
              <option value="group">לכל הקבוצה</option>
              <option value="person">לאדם</option>
            </select>
            {plan.tipsMode === 'person' && (
              <label className="inline-num">
                ×
                <input
                  type="number"
                  min={0}
                  step={1}
                  aria-label="מספר אנשים לטיפים"
                  value={plan.tipsPeople ?? ''}
                  placeholder={String(tipsCount)}
                  onChange={(e) => patch({ tipsPeople: e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value))) })}
                />
                אנשים
              </label>
            )}
          </div>
          <span className="field-hint">
            לא כלול במחיר הקרוז. השאירו ריק עד שיש מספר.
            {plan.tipsMode === 'person' && pax.infants > 0 && ' אם משלמים גם על התינוק – הגדילו את מספר האנשים.'}
          </span>
        </div>

        <NumField
          label="עמלת סוכן"
          value={plan.agentFee}
          onChange={(v) => patch({ agentFee: v })}
          hint="לא ידוע עדיין? השאירו ריק. אין עמלה? הזינו 0."
        />
        <NumField label="חבילת משקאות" value={plan.drinks} onChange={(v) => patch({ drinks: v })} hint="רק אם קונים" />
        <NumField label="אינטרנט" value={plan.internet} onChange={(v) => patch({ internet: v })} hint="רק אם קונים" />
      </div>

      <div className="total-box" aria-live="polite">
        <div className="total-lines">
          {LINE_KEYS.map((k) => (
            <span key={k} className="total-line">
              {LINE_LABEL[k]}: <LineValue line={result.lines[k]} />
            </span>
          ))}
        </div>
        <div className="total-main">
          סה״כ {GROUP_SHORT[group]}:{' '}
          {result.room ? (
            <Usd value={result.total} className="total" />
          ) : (
            <>
              <NotEntered text="בחרו חדר כדי לראות סה״כ" />
              {result.extras > 0 && (
                <span className="muted small">
                  {' '}
                  (בלי הקרוז: <Usd value={result.extras} />)
                </span>
              )}
            </>
          )}
        </div>
        <NoticeList notices={result.notices} />
        <p className="muted small">
          תחבורה ועלויות אחרות – בטבלה בתחתית העמוד. שדה ריק = "טרם הוזן" (נספר כ-0 בסכום).
        </p>
      </div>
    </div>
  );
}

// ---------- flight options of a group ----------

const PRICE_ROWS: { key: PriceRow; label: string }[] = [
  { key: 'fare', label: 'מחיר טיסה' },
  { key: 'seat', label: 'מושב' },
  { key: 'baggage', label: 'מזוודה' },
];

function FlightCard({ flight, cards }: { flight: Flight; cards: Cards }) {
  const { state, dispatch } = useApp();
  const isOpen = cards.open.has(flight.id);
  const group = flightGroup(flight);
  const pax = state.passengers[group];
  const slots = passengerSlots(pax);
  const cost = flightCost(flight, pax);
  const other: GroupId = group === 'A' ? 'B' : 'A';
  const set = (patch: Partial<Flight>) => dispatch({ type: 'updateFlight', id: flight.id, patch });
  const round = flight.direction === 'round';
  const details = flightDetails(flight);
  const rating = rateFlight(state, flight);
  const ratingTone = { recommended: 'green', compromise: 'yellow', bad: 'red', unknown: 'gray' } as const;

  return (
    <div className="card flight-card" id={`card-${flight.id}`}>
      <div className="card-head">
        <div>
          <Chip tone="blue">{DIRECTION_LABEL[flight.direction]}</Chip> <strong>{flightLabel(flight)}</strong>
          {flight.benchmark && <Chip tone="blue">📌 Benchmark</Chip>}
          {!flight.verified && <Chip tone="yellow">🟡 לא מאומת</Chip>}
          {details && <div className="muted small">{details}</div>}
          <div className="rating-line">
            <Chip tone={ratingTone[rating.level]}>
              {rating.icon} {rating.label}
            </Chip>
            {rating.goodPrice && <Chip tone="green">🟢 מחיר טוב</Chip>}
            <span className="muted small"> {rating.reasons.join(' · ')}</span>
          </div>
        </div>
        <div className="card-actions">
          <span className="mini-cost">
            {cost.fareEntered ? (
              <>
                סה״כ <Usd value={cost.total} />
              </>
            ) : (
              <NotEntered text="חסר מחיר" />
            )}
          </span>
          <button className="btn" onClick={() => cards.toggle(flight.id)} aria-expanded={isOpen}>
            {isOpen ? 'סגור' : 'ערוך'}
          </button>
          {state.groupBEnabled && (
            <button
              className="btn"
              onClick={() => {
                const newId = uid('f');
                dispatch({ type: 'copyFlight', id: flight.id, newId, group: other });
              }}
            >
              העתק ל{GROUP_LABEL[other]}
            </button>
          )}
          <button
            className="btn btn-danger"
            onClick={() => {
              if (window.confirm('למחוק את אפשרות הטיסה?')) dispatch({ type: 'removeFlight', id: flight.id });
            }}
          >
            מחק
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="card-body">
          <div className="form-grid">
            <label className="field">
              <span className="field-label">סוג</span>
              <select value={flight.direction} onChange={(e) => set({ direction: e.target.value as FlightDirection })}>
                <option value="out">הלוך</option>
                <option value="back">חזור</option>
                <option value="round">הלוך-חזור (מחיר אחד לשני הכיוונים)</option>
              </select>
            </label>
            <TextField label="חברת תעופה" value={flight.airline} onChange={(v) => set({ airline: v })} />
            <TextField label="מספר טיסה" value={flight.flightNo} onChange={(v) => set({ flightNo: v })} />
            <TextField label="תאריך" type="date" value={flight.date} onChange={(v) => set({ date: v })} />
            <TextField label="שעת יציאה" type="time" value={flight.depTime} onChange={(v) => set({ depTime: v })} />
            <TextField label="שעת נחיתה" type="time" value={flight.arrTime} onChange={(v) => set({ arrTime: v })} />
            <TextField label="שדה יציאה" value={flight.fromAirport} onChange={(v) => set({ fromAirport: v })} placeholder="TLV" />
            <TextField label="שדה נחיתה" value={flight.toAirport} onChange={(v) => set({ toAirport: v })} placeholder="BCN" />
            <NumField label="מספר עצירות" unit="" step="1" placeholder="לא ידוע" value={flight.stops} onChange={(v) => set({ stops: v })} hint="0 = ישירה" />
            <TextField label="משך טיסה" value={flight.duration} onChange={(v) => set({ duration: v })} placeholder="4:35" />
          </div>

          {round && (
            <>
              <h4>פרטי החזור</h4>
              <div className="form-grid">
                <TextField label="מספר טיסה (חזור)" value={flight.returnFlightNo} onChange={(v) => set({ returnFlightNo: v })} />
                <TextField label="תאריך (חזור)" type="date" value={flight.returnDate} onChange={(v) => set({ returnDate: v })} />
                <TextField label="שעת יציאה (חזור)" type="time" value={flight.returnDepTime} onChange={(v) => set({ returnDepTime: v })} />
                <TextField label="שעת נחיתה (חזור)" type="time" value={flight.returnArrTime} onChange={(v) => set({ returnArrTime: v })} />
                <NumField label="עצירות (חזור)" unit="" step="1" placeholder="לא ידוע" value={flight.returnStops} onChange={(v) => set({ returnStops: v })} />
                <TextField label="משך (חזור)" value={flight.returnDuration} onChange={(v) => set({ returnDuration: v })} />
              </div>
            </>
          )}

          <h4>מחיר העגלה</h4>
          <div className="form-grid">
            <TextField label="סוג תעריף" value={flight.fareType} onChange={(v) => set({ fareType: v })} placeholder="Lite / Classic / Flex" />
            <NumField
              label={round ? 'סה״כ הכרטיס כפי שמופיע בעגלה ($)' : 'סה״כ הטיסה כפי שמופיע בעגלה ($)'}
              value={flight.cartTotal}
              onChange={(v) => set({ cartTotal: v })}
              hint="אם הוזן – זה מקור האמת. המערכת לא מחשבת מחדש לפי פירוט הנוסעים."
            />
            {round && <NumField label="מזה הלוך ($) – מידע בלבד" value={flight.fareOut} onChange={(v) => set({ fareOut: v })} />}
            {round && <NumField label="מזה חזור ($) – מידע בלבד" value={flight.fareBack} onChange={(v) => set({ fareBack: v })} />}
          </div>
          {cost.cartMismatch && (
            <p>
              <Chip tone="blue">🔵 סכום הנוסעים שונה מסה״כ העגלה – נספר סה״כ העגלה.</Chip>
            </p>
          )}

          <h4>
            מחירים לכל נוסע ($){round ? ' – לשני הכיוונים' : ''}
            {cost.usesCartTotal ? ' – מידע בלבד, לא מתווסף' : ''}
          </h4>
          <div className="table-scroll">
            <table className="price-grid">
              <thead>
                <tr>
                  <th scope="col" />
                  {slots.map((s) => (
                    <th scope="col" key={s.id}>
                      {s.label}
                    </th>
                  ))}
                  <th scope="col" className="row-sum">
                    סה״כ
                  </th>
                </tr>
              </thead>
              <tbody>
                {PRICE_ROWS.map(({ key, label }) => (
                  <tr key={key}>
                    <th scope="row">{label}</th>
                    {slots.map((s) => (
                      <td key={s.id}>
                        <MoneyInput
                          unit=""
                          ariaLabel={`${label} – ${s.label}`}
                          placeholder={s.kind === 'infant' ? 'לא חויב' : 'טרם הוזן'}
                          value={flight[key][s.id] ?? null}
                          onChange={(v) => dispatch({ type: 'setFlightPrice', id: flight.id, row: key, slotId: s.id, value: v })}
                        />
                      </td>
                    ))}
                    <td className="row-sum">
                      {slots.some((s) => isFilled(flight[key][s.id])) ? (
                        <Usd value={key === 'fare' ? cost.fare : key === 'seat' ? cost.seats : cost.baggage} />
                      ) : (
                        <NotEntered text="—" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            תינוק לא מחויב עד שמזינים לו מחיר (גם $0 הוא מחיר שהוזן). מושבים ומזוודות נספרים בנפרד מהטיסה.
          </p>
          {cost.missingAdultFare.length > 0 && <Chip tone="yellow">🟡 חסר מחיר טיסה: {cost.missingAdultFare.join(', ')}</Chip>}

          <div className="form-grid">
            <TextField label="כבודה כלולה" value={flight.baggageInfo} onChange={(v) => set({ baggageInfo: v })} placeholder="תיק יד בלבד / 23 ק״ג" />
            <TextField label="תנאי שינוי" value={flight.changeTerms} onChange={(v) => set({ changeTerms: v })} />
            <TextField label="תנאי ביטול" value={flight.cancelTerms} onChange={(v) => set({ cancelTerms: v })} />
            <TextField label="מקור המחיר" value={flight.source} onChange={(v) => set({ source: v })} placeholder="אתר EL AL / עגלה" />
            <TextField label="קישור למקור" value={flight.sourceUrl} onChange={(v) => set({ sourceUrl: v })} placeholder="https://…" />
            <TextField label="תאריך בדיקה" type="date" value={flight.checkedAt} onChange={(v) => set({ checkedAt: v })} />
            <div className="field">
              <span className="field-label">&nbsp;</span>
              <label className="check">
                <input type="checkbox" checked={flight.verified} onChange={(e) => set({ verified: e.target.checked })} />
                המחיר מאומת (ראיתי אותו באתר / בעגלה)
              </label>
              <label className="check">
                <input type="checkbox" checked={flight.benchmark} onChange={(e) => set({ benchmark: e.target.checked })} />
                📌 Benchmark – הצעה להשוואה
              </label>
            </div>
            <TextField label="הערות" value={flight.notes} onChange={(v) => set({ notes: v })} wide />
          </div>
          <p className="muted small">מחיר שנבדק הוא לא מחיר מובטח – מחירי טיסות משתנים.</p>
        </div>
      )}
    </div>
  );
}

function GroupFlights({ cruise, group, cards }: { cruise: Cruise; group: GroupId; cards: Cards }) {
  const { state, dispatch } = useApp();
  const list = state.flights.filter((f) => f.cruiseId === cruise.id && f.group === group);
  const add = (direction: FlightDirection) => {
    const f = emptyFlight(cruise.id, group, direction);
    dispatch({ type: 'addFlight', flight: f });
    const plan = state.plans[cruise.id]?.[group];
    // Select the new option automatically if nothing is selected yet for that slot.
    if (plan && direction !== 'back' && !plan.outFlightId) {
      dispatch({ type: 'updatePlan', cruiseId: cruise.id, group, patch: { outFlightId: f.id } });
    }
    if (plan && direction === 'back' && !plan.backFlightId) {
      dispatch({ type: 'updatePlan', cruiseId: cruise.id, group, patch: { backFlightId: f.id } });
    }
    cards.show(f.id);
  };
  return (
    <div className="flight-group">
      <div className="section-head">
        <h3>אפשרויות טיסה – {GROUP_SHORT[group]}</h3>
        <div className="btn-row">
          <button className="btn" onClick={() => add('out')}>
            + טיסת הלוך
          </button>
          <button className="btn" onClick={() => add('back')}>
            + טיסת חזור
          </button>
          <button className="btn" onClick={() => add('round')}>
            + כרטיס הלוך-חזור
          </button>
        </div>
      </div>
      {list.length === 0 && <p className="muted small">אין עדיין אפשרויות טיסה לקבוצה הזו בתאריך הזה.</p>}
      {list.map((f) => (
        <FlightCard key={f.id} flight={f} cards={cards} />
      ))}
    </div>
  );
}

// ---------- hotels ----------

function HotelCard({ hotel, cruise, cards }: { hotel: Hotel; cruise: Cruise; cards: Cards }) {
  const { state, dispatch } = useApp();
  const isOpen = cards.open.has(hotel.id);
  const set = (patch: Partial<Hotel>) => dispatch({ type: 'updateHotel', id: hotel.id, patch });
  const { nights, fromDates } = hotelNights(hotel);
  const issues = hotelIssues(hotel, cruise);
  const shareA = hotelShare(hotel, 'A');
  const shareB = hotelShare(hotel, 'B');
  const usedBy = GROUPS.filter((g) => state.plans[cruise.id]?.[g].hotelId === hotel.id || state.plans[cruise.id]?.[g].hotelAfterId === hotel.id);
  // Dates the flights imply (arrival → cruise start, or cruise end → flight home). Only a suggestion – dates stay editable.
  const stay = plannedStay(state, cruise.id, hotel.owner, hotel.phase);
  const stayNights = stay ? daysBetween(stay.checkIn, stay.checkOut) : null;
  const stayDiffers = !!stay && (stay.checkIn !== hotel.checkIn || stay.checkOut !== hotel.checkOut);

  return (
    <div className="card hotel-card" id={`card-${hotel.id}`}>
      <div className="card-head">
        <div>
          <strong>{hotel.name || 'מלון (ללא שם)'}</strong>
          <div className="muted small">
            {hotel.phase === 'after' ? 'אחרי הקרוז' : 'לפני הקרוז'} · {OWNER_LABEL[hotel.owner]} · {nights} לילות
            {usedBy.length > 0 && ` · נבחר ע״י: ${usedBy.map((g) => GROUP_SHORT[g]).join(', ')}`}
          </div>
        </div>
        <div className="card-actions">
          <span className="mini-cost">
            {hotelHasPrice(hotel) ? (
              <>
                סה״כ {hotel.currency !== 'USD' && <span dir="ltr">{hotelNativeText(hotel)}</span>}
                {hotel.currency !== 'USD' && ' · '}
                {hotelNeedsConversion(hotel) ? <NotEntered text="טרם הומר ל-USD" /> : <Usd value={hotelCost(hotel)} />}
              </>
            ) : (
              <NotEntered text="חסר מחיר" />
            )}
          </span>
          <button className="btn" onClick={() => cards.toggle(hotel.id)} aria-expanded={isOpen}>
            {isOpen ? 'סגור' : 'ערוך'}
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              if (window.confirm('למחוק את המלון?')) dispatch({ type: 'removeHotel', id: hotel.id });
            }}
          >
            מחק
          </button>
        </div>
      </div>
      {issues.map((i) => (
        <Chip key={i} tone="red">
          🔴 {i}
        </Chip>
      ))}
      {(shareA.problem || shareB.problem) && <Chip tone="red">🔴 {shareA.problem ?? shareB.problem}</Chip>}
      {isOpen && (
        <div className="card-body">
          <div className="form-grid">
            <label className="field">
              <span className="field-label">שייך ל</span>
              <select value={hotel.owner} onChange={(e) => set({ owner: e.target.value as Owner })}>
                <option value="A">{GROUP_LABEL.A}</option>
                <option value="B">{GROUP_LABEL.B}</option>
                <option value="both">שתי הקבוצות (משותף)</option>
              </select>
            </label>
            {hotel.owner === 'both' && (
              <label className="field">
                <span className="field-label">חלוקה</span>
                <select value={hotel.split} onChange={(e) => set({ split: e.target.value === 'custom' ? 'custom' : 'half' })}>
                  <option value="half">50/50</option>
                  <option value="custom">סכום ידני לקבוצה A (השאר לקבוצה B)</option>
                </select>
              </label>
            )}
            {hotel.owner === 'both' && hotel.split === 'custom' && (
              <NumField label="כמה משלמת קבוצה A" value={hotel.shareA} onChange={(v) => set({ shareA: v })} />
            )}
            <label className="field">
              <span className="field-label">מתי</span>
              <select value={hotel.phase} onChange={(e) => set({ phase: e.target.value === 'after' ? 'after' : 'before' })}>
                <option value="before">לפני הקרוז</option>
                <option value="after">אחרי הקרוז</option>
              </select>
            </label>
            <TextField label="שם המלון" value={hotel.name} onChange={(v) => set({ name: v })} />
            <TextField label="כתובת" value={hotel.address} onChange={(v) => set({ address: v })} />
            <label className="field">
              <span className="field-label">מטבע</span>
              <select value={hotel.currency} onChange={(e) => set({ currency: e.target.value as Currency })}>
                <option value="USD">USD – דולר ($)</option>
                <option value="EUR">EUR – אירו (€)</option>
                <option value="ILS">ILS – שקל (₪)</option>
              </select>
            </label>
            <TextField label="Check-in" type="date" value={hotel.checkIn} onChange={(v) => set({ checkIn: v })} />
            <TextField label="Check-out" type="date" value={hotel.checkOut} onChange={(v) => set({ checkOut: v })} />
            {stay && (
              <div className="field field-wide stay-hint">
                <span className="field-label">לפי תאריכי הטיסה</span>
                <span className="readonly">
                  {ltr(`${shortDate(stay.checkIn)} → ${shortDate(stay.checkOut)}`)} ({stayNights} לילות)
                </span>
                {stayDiffers && (
                  <button className="btn btn-small" onClick={() => set({ checkIn: stay.checkIn, checkOut: stay.checkOut })}>
                    החל תאריכים מהטיסה
                  </button>
                )}
              </div>
            )}
            {fromDates ? (
              <div className="field">
                <span className="field-label">מספר לילות</span>
                <span className="readonly">{nights} (לפי התאריכים)</span>
              </div>
            ) : (
              <NumField label="מספר לילות" unit="" step="1" value={hotel.manualNights} onChange={(v) => set({ manualNights: v })} hint="או הזינו תאריכים" />
            )}
            <NumField unit={CURRENCY_SYMBOL[hotel.currency]} label={`מחיר ללילה (${hotel.currency})`} value={hotel.pricePerNight} onChange={(v) => set({ pricePerNight: v })} />
            <NumField unit={CURRENCY_SYMBOL[hotel.currency]} label="מסים (סה״כ)" value={hotel.taxes} onChange={(v) => set({ taxes: v })} />
            <NumField unit={CURRENCY_SYMBOL[hotel.currency]} label="City tax / מס מקומי (סה״כ)" value={hotel.cityTax} onChange={(v) => set({ cityTax: v })} />
            <NumField unit={CURRENCY_SYMBOL[hotel.currency]} label="ארוחת בוקר (סה״כ)" value={hotel.breakfast} onChange={(v) => set({ breakfast: v })} />
            <NumField unit={CURRENCY_SYMBOL[hotel.currency]} label="דמי אתר / Resort fee (סה״כ)" value={hotel.resortFee} onChange={(v) => set({ resortFee: v })} />
            <NumField unit={CURRENCY_SYMBOL[hotel.currency]} label="עלויות נוספות (סה״כ)" value={hotel.other} onChange={(v) => set({ other: v })} />
            {hotel.currency !== 'USD' && (
              <NumField
                label="מחיר כולל לאחר המרה ל-USD ($)"
                value={hotel.usdTotal}
                onChange={(v) => set({ usdTotal: v })}
                hint={
                  <>
                    סה״כ במלון: <span dir="ltr">{hotelNativeText(hotel)}</span>. המערכת לא ממציאה שער – המירו בעצמכם והזינו כאן.
                  </>
                }
              />
            )}
            <TextField label="קישור להזמנה" value={hotel.url} onChange={(v) => set({ url: v })} placeholder="https://…" />
            <TextField label="מקור" value={hotel.source} onChange={(v) => set({ source: v })} placeholder="אתר המלון / Booking…" />
            <TextField label="תאריך בדיקה" type="date" value={hotel.checkedAt} onChange={(v) => set({ checkedAt: v })} />
            <TextField label="הערות" value={hotel.notes} onChange={(v) => set({ notes: v })} wide />
          </div>
          <div className="card-foot">
            {hotel.currency !== 'USD' && (
              <>
                במטבע המלון: <span dir="ltr">{hotelNativeText(hotel)}</span> ·{' '}
              </>
            )}
            סה״כ מלון ב-USD: {hotelNeedsConversion(hotel) ? <NotEntered text="טרם הומר" /> : <Usd value={hotelCost(hotel)} />}
            {hotel.owner === 'both' && !shareA.problem && (
              <>
                {' '}
                · קבוצה A: <Usd value={shareA.amount} />
                {state.groupBEnabled && (
                  <>
                    {' '}
                    · קבוצה B: <Usd value={shareB.amount} />
                  </>
                )}
              </>
            )}
            <div className="muted small">כל הסכומים בדולרים. מחיר ביורו – המירו לפני ההזנה.</div>
          </div>
        </div>
      )}
    </div>
  );
}

function HotelSection({ cruise, cards }: { cruise: Cruise; cards: Cards }) {
  const { state, dispatch } = useApp();
  const list = state.hotels.filter((h) => h.cruiseId === cruise.id);
  return (
    <Section
      title="מלונות בברצלונה"
      hint="אפשר לשמור כמה מלונות, לפני הקרוז ואחריו. מלון שייך לקבוצה A, לקבוצה B או לשתיהן (אז מחלקים 50/50 או לפי סכום). המלון הנבחר נקבע בטופס של כל קבוצה (למעלה) וקובע את הסכום."
      actions={
        <>
        <button
          className="btn"
          onClick={() => {
            const h = newHotelFor(cruise, 'A', 'before', plannedStay(state, cruise.id, 'A', 'before'));
            dispatch({ type: 'addHotel', hotel: h });
            cards.show(h.id);
          }}
        >
          + מלון לפני הקרוז
        </button>
        <button
          className="btn"
          onClick={() => {
            const h = newHotelFor(cruise, 'A', 'after', plannedStay(state, cruise.id, 'A', 'after'));
            dispatch({ type: 'addHotel', hotel: h });
            cards.show(h.id);
          }}
        >
          + מלון אחרי הקרוז
        </button>
        </>
      }
    >
      {list.length === 0 && <p className="muted small">אין עדיין מלונות לתאריך הזה.</p>}
      {list.map((h) => (
        <HotelCard key={h.id} hotel={h} cruise={cruise} cards={cards} />
      ))}
    </Section>
  );
}

// ---------- transport / other rows ----------

function ItemRow({ item }: { item: ExtraItem }) {
  const { dispatch } = useApp();
  const set = (patch: Partial<ExtraItem>) => dispatch({ type: 'updateItem', id: item.id, patch });
  return (
    <div className="item-row">
      <label className="field">
        <span className="field-label">סוג</span>
        <select value={item.category} onChange={(e) => set({ category: e.target.value as ItemCategory })}>
          <option value="transport">תחבורה</option>
          <option value="other">אחר</option>
        </select>
      </label>
      <TextField label="מה" value={item.name} onChange={(v) => set({ name: v })} placeholder={item.category === 'transport' ? 'שדה תעופה → מלון' : 'אטרקציה / ארוחה'} />
      <NumField label="סכום" value={item.amount} onChange={(v) => set({ amount: v })} />
      <label className="field">
        <span className="field-label">קבוצה</span>
        <select value={item.owner} onChange={(e) => set({ owner: e.target.value as Owner })}>
          <option value="A">{GROUP_LABEL.A}</option>
          <option value="B">{GROUP_LABEL.B}</option>
          <option value="both">שתיהן – חצי-חצי</option>
        </select>
      </label>
      <TextField label="הערה" value={item.note} onChange={(v) => set({ note: v })} />
      <div className="field">
        <span className="field-label">&nbsp;</span>
        <button className="btn btn-danger" aria-label={`מחק ${item.name || 'שורה'}`} onClick={() => dispatch({ type: 'removeItem', id: item.id })}>
          מחק
        </button>
      </div>
    </div>
  );
}

function ItemsSection({ cruise }: { cruise: Cruise }) {
  const { state, dispatch } = useApp();
  const list = state.items.filter((i) => i.cruiseId === cruise.id);
  const add = (category: ItemCategory) => dispatch({ type: 'addItem', item: emptyItem(cruise.id, category, 'A') });
  return (
    <Section
      title="תחבורה ועלויות אחרות"
      hint="כל שורה: מה, כמה, לאיזו קבוצה. לדוגמה: מונית שדה תעופה → מלון, רכבת, מלון → נמל, אטרקציה, ארוחה, חניה."
      actions={
        <>
          <button className="btn" onClick={() => add('transport')}>
            + תחבורה
          </button>
          <button className="btn" onClick={() => add('other')}>
            + עלות אחרת
          </button>
        </>
      }
    >
      {list.length === 0 && <p className="muted small">אין עדיין שורות לתאריך הזה.</p>}
      {list.map((i) => (
        <ItemRow key={i.id} item={i} />
      ))}
    </Section>
  );
}

// ---------- agent prices (rooms) ----------

function RoomsSection({ cruise }: { cruise: Cruise }) {
  const { state, dispatch } = useApp();
  return (
    <details className="section details-box">
      <summary>
        <h2 className="inline">מחירי הסוכן – חדרים (עריכה)</h2>
      </summary>
      <p className="muted">מחירי קרוז בלבד, כולל מיסים, כפי שנמסרו. סוג החדר והמחיר נפרדים – אין הנחה שחדר יקר יותר הוא טוב יותר.</p>
      {activeGroups(state).map((g) => (
        <div key={g} className="rooms-group">
          <h3>{GROUP_LABEL[g]}</h3>
          {cruise.rooms[g].map((r) => (
            <div className="room-row" key={r.id}>
              <input
                type="text"
                aria-label="שם חדר"
                value={r.name}
                placeholder="שם החדר"
                onChange={(e) => dispatch({ type: 'updateRoom', cruiseId: cruise.id, group: g, roomId: r.id, patch: { name: e.target.value } })}
              />
              <MoneyInput
                ariaLabel={`מחיר – ${r.name || 'חדר'}`}
                placeholder="חסר מחיר"
                value={r.price}
                onChange={(v) => dispatch({ type: 'updateRoom', cruiseId: cruise.id, group: g, roomId: r.id, patch: { price: v } })}
              />
              <button
                className="btn btn-danger"
                aria-label={`מחק ${r.name || 'חדר'}`}
                onClick={() => {
                  if (window.confirm('למחוק את החדר?')) dispatch({ type: 'removeRoom', cruiseId: cruise.id, group: g, roomId: r.id });
                }}
              >
                מחק
              </button>
            </div>
          ))}
          <button className="btn" onClick={() => dispatch({ type: 'addRoom', cruiseId: cruise.id, group: g, id: uid('r') })}>
            + הוסף חדר
          </button>
        </div>
      ))}
    </details>
  );
}

// ---------- cruise header ----------

function CruiseHeader({ cruise, onRemoved }: { cruise: Cruise; onRemoved: () => void }) {
  const { dispatch } = useApp();
  const valid = cruiseDatesValid(cruise);
  return (
    <div className="card cruise-head">
      <div className="form-grid">
        <TextField label="תאריך יציאה" type="date" value={cruise.start} onChange={(v) => dispatch({ type: 'updateCruise', id: cruise.id, patch: { start: v } })} />
        <TextField label="תאריך חזרה" type="date" value={cruise.end} onChange={(v) => dispatch({ type: 'updateCruise', id: cruise.id, patch: { end: v } })} />
        <div className="field">
          <span className="field-label">&nbsp;</span>
          <button
            className="btn btn-danger"
            onClick={() => {
              if (window.confirm('למחוק את הצעת הקרוז הזו, כולל הטיסות, המלונות והעלויות שלה?')) {
                dispatch({ type: 'removeCruise', id: cruise.id });
                onRemoved();
              }
            }}
          >
            מחק הצעת קרוז
          </button>
        </div>
      </div>
      {!valid && (cruise.start || cruise.end) && <Chip tone="red">🔴 תאריך החזרה חייב להיות אחרי תאריך היציאה</Chip>}
      {!cruise.start && !cruise.end && <Chip tone="yellow">🟡 הזינו תאריכים</Chip>}
    </div>
  );
}

// ---------- screen ----------

export function EntryScreen() {
  const { state, dispatch, target } = useApp();
  // "✏️ edit" in the summary lands on the right date and opens the right flight/hotel card.
  const [selected, setSelected] = useState(target?.cruiseId ?? state.cruises[0]?.id ?? '');
  const [open, setOpen] = useState<Set<string>>(new Set(target?.focusId ? [target.focusId] : []));
  const [scrollTo, setScrollTo] = useState<string | null>(target?.focusId ?? null);

  const cruise = state.cruises.find((c) => c.id === selected) ?? state.cruises[0];
  const groups = activeGroups(state);

  const cards: Cards = {
    open,
    toggle: (id) =>
      setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    show: (id) => {
      setOpen((prev) => new Set(prev).add(id));
      setScrollTo(id);
    },
  };

  useEffect(() => {
    if (!scrollTo) return;
    document.getElementById(`card-${scrollTo}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    setScrollTo(null);
  }, [scrollTo]);

  return (
    <div className="screen">
      <div className="tabs" role="tablist" aria-label="תאריכי קרוז">
        {state.cruises.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={cruise?.id === c.id}
            className={`tab ${cruise?.id === c.id ? 'tab-on' : ''}`}
            onClick={() => setSelected(c.id)}
          >
            {rangeLabel(c.start, c.end)}
          </button>
        ))}
        <button
          className="tab tab-add"
          onClick={() => {
            const id = uid('c');
            dispatch({ type: 'addCruise', id });
            setSelected(id);
          }}
        >
          + הצעת קרוז חדשה
        </button>
      </div>

      {!cruise && <p className="muted">אין הצעות קרוז. הוסיפו אחת.</p>}

      {cruise && (
        <>
          <CruiseHeader cruise={cruise} onRemoved={() => setSelected('')} />

          {groups.map((g, i) => (
            <Section key={g} title={`${i + 1}. ${GROUP_LABEL[g]}`} className={`group-entry group-${g}`} label={`הזנה – ${GROUP_LABEL[g]}`}>
              <GroupForm cruise={cruise} group={g} cards={cards} />
              <GroupFlights cruise={cruise} group={g} cards={cards} />
            </Section>
          ))}
          {!state.groupBEnabled && (
            <div className="banner banner-blue">
              <div>🔵 {GROUP_LABEL.B} מוסתרת (לא מצטרפת). הנתונים שלה שמורים.</div>
              <button className="btn" onClick={() => dispatch({ type: 'setGroupBEnabled', enabled: true })}>
                להציג שוב
              </button>
            </div>
          )}

          <FareSection cruise={cruise} cards={cards} />

          <HotelSection cruise={cruise} cards={cards} />
          <ItemsSection cruise={cruise} />
          <RoomsSection cruise={cruise} />
        </>
      )}
    </div>
  );
}

