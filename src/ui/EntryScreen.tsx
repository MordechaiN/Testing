import { useEffect, useState } from 'react';
import {
  activeGroups,
  computePlan,
  cruiseDatesValid,
  flightCost,
  hotelCost,
  hotelIssues,
  hotelNights,
  hotelServesGroup,
  infantPriceMissing,
} from '../domain/calc';
import type { Breakdown } from '../domain/calc';
import { rangeLabel, shortDate } from '../domain/dates';
import { flightLabel, GROUP_LABEL, GROUP_SHORT, stopsLabel, usd } from '../domain/format';
import { emptyFlight, emptyHotel, uid } from '../domain/seed';
import { GROUPS } from '../domain/types';
import type {
  Cruise,
  Flight,
  FlightDirection,
  GroupId,
  Hotel,
  HotelGroup,
  PerPassenger,
} from '../domain/types';
import { Chip, NumField, Section, TextField, Usd } from './common';
import { useApp } from './context';

// ---------- shared helpers ----------

interface Cards {
  open: Set<string>;
  toggle: (id: string) => void;
  show: (id: string) => void;
}

const TOTAL_LABELS: [keyof Breakdown, string][] = [
  ['cruise', 'קרוז'],
  ['flights', 'טיסות'],
  ['seats', 'מושבים'],
  ['baggage', 'מזוודות'],
  ['flightExtras', 'תוספות טיסה'],
  ['hotel', 'מלון'],
  ['tips', 'טיפים'],
  ['agentFee', 'עמלה'],
  ['drinks', 'שתייה'],
  ['internet', 'אינטרנט'],
  ['transport', 'תחבורה'],
  ['other', 'אחר'],
];

// ---------- one group on one date: the main form ----------

function GroupForm({ cruise, group, cards }: { cruise: Cruise; group: GroupId; cards: Cards }) {
  const { state, dispatch } = useApp();
  const plan = state.plans[cruise.id]?.[group];
  if (!plan) return null;
  const result = computePlan(state, cruise.id, group);
  const room = result.room;
  const pax = state.passengers[group];

  const patch = (p: Partial<typeof plan>) => dispatch({ type: 'updatePlan', cruiseId: cruise.id, group, patch: p });

  const flightsFor = (direction: FlightDirection) =>
    state.flights.filter((f) => f.cruiseId === cruise.id && f.direction === direction);
  const hotelsHere = state.hotels.filter((h) => h.cruiseId === cruise.id && hotelServesGroup(h, group));

  const newFlight = (direction: FlightDirection) => {
    const f = emptyFlight(cruise.id, direction);
    dispatch({ type: 'addFlight', flight: f });
    patch(direction === 'out' ? { outFlightId: f.id } : { backFlightId: f.id });
    cards.show(f.id);
  };
  const newHotel = () => {
    const h = emptyHotel(cruise.id, group);
    dispatch({ type: 'addHotel', hotel: h });
    patch({ hotelId: h.id });
    cards.show(h.id);
  };

  const flightSelect = (direction: FlightDirection, value: string | null, key: 'outFlightId' | 'backFlightId') => (
    <div className="field field-wide">
      <span className="field-label">{direction === 'out' ? 'טיסת הלוך' : 'טיסת חזור'}</span>
      <div className="select-row">
        <select
          aria-label={`${direction === 'out' ? 'טיסת הלוך' : 'טיסת חזור'} – ${GROUP_SHORT[group]}`}
          value={value ?? ''}
          onChange={(e) => patch({ [key]: e.target.value || null })}
        >
          <option value="">{flightsFor(direction).length === 0 ? 'אין עדיין אפשרויות' : 'לא נבחרה'}</option>
          {flightsFor(direction).map((f) => (
            <option key={f.id} value={f.id}>
              {flightLabel(f)}
              {f.date ? ` · ${shortDate(f.date)}` : ''} · {usd(flightCost(f, pax).total)}
            </option>
          ))}
        </select>
        <button className="btn" type="button" onClick={() => newFlight(direction)}>
          + טיסה חדשה
        </button>
      </div>
    </div>
  );

  const fav = state.favorite[group] === cruise.id;

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
        <div className="field field-wide">
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
          <span className="field-hint">
            מחיר קרוז:{' '}
            {room && room.price !== null ? <Usd value={room.price} /> : <Chip tone="yellow">לא נבחר / חסר מחיר</Chip>}{' '}
            (נערך בחלק "מחירי הסוכנת" למטה)
          </span>
        </div>

        {flightSelect('out', plan.outFlightId, 'outFlightId')}
        {flightSelect('back', plan.backFlightId, 'backFlightId')}

        <div className="field field-wide">
          <span className="field-label">מלון בברצלונה</span>
          <div className="select-row">
            <select
              aria-label={`מלון – ${GROUP_SHORT[group]}`}
              value={plan.hotelId ?? ''}
              onChange={(e) => patch({ hotelId: e.target.value || null })}
            >
              <option value="">בלי מלון / לא נבחר</option>
              {hotelsHere.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name || 'מלון (ללא שם)'} · {usd(hotelCost(h))}
                </option>
              ))}
            </select>
            <button className="btn" type="button" onClick={newHotel}>
              + מלון חדש
            </button>
          </div>
        </div>

        <NumField label="טיפים" value={plan.tips} onChange={(v) => patch({ tips: v })} hint="סכום כולל לקבוצה" />
        <NumField label="עמלת סוכנת" value={plan.agentFee} onChange={(v) => patch({ agentFee: v })} hint="עדיין לא ידוע? השאירו ריק" />
        <NumField label="שתייה (רק אם קונים)" value={plan.drinks} onChange={(v) => patch({ drinks: v })} />
        <NumField label="אינטרנט (רק אם קונים)" value={plan.internet} onChange={(v) => patch({ internet: v })} />
        <NumField label="תחבורה" value={plan.transport} onChange={(v) => patch({ transport: v })} />
        <NumField label="אחר" value={plan.other} onChange={(v) => patch({ other: v })} />
      </div>

      <div className="total-box" aria-live="polite">
        <div className="total-lines">
          {TOTAL_LABELS.filter(([k]) => result.breakdown[k] !== 0 || k === 'cruise').map(([k, label]) => (
            <span key={k} className="total-line">
              {label}: <Usd value={result.breakdown[k]} />
            </span>
          ))}
        </div>
        <div className="total-main">
          סה״כ (אוטומטי): <Usd value={result.total} className="total" />
        </div>
        {result.missing.includes('room') && <Chip tone="yellow">לא נבחר חדר</Chip>}
        {result.missing.includes('cruisePrice') && <Chip tone="red">לחדר שנבחר אין מחיר</Chip>}
        <p className="muted small">
          {pax.adults} מבוגרים{pax.infants > 0 ? ` + ${pax.infants} תינוק` : ''} · שדה ריק נחשב 0
        </p>
      </div>
    </div>
  );
}

// ---------- flight options ----------

const PRICE_ROWS: { key: 'base' | 'seat' | 'baggage' | 'other'; label: string }[] = [
  { key: 'base', label: 'מחיר טיסה' },
  { key: 'seat', label: 'מושב' },
  { key: 'baggage', label: 'מזוודה' },
  { key: 'other', label: 'תוספות אחרות' },
];

function FlightCard({ flight, cards }: { flight: Flight; cards: Cards }) {
  const { state, dispatch } = useApp();
  const isOpen = cards.open.has(flight.id);
  const groups = activeGroups(state);
  const set = (patch: Partial<Flight>) => dispatch({ type: 'updateFlight', id: flight.id, patch });
  const setPrice = (key: 'base' | 'seat' | 'baggage' | 'other', who: keyof PerPassenger, v: number | null) =>
    set({ [key]: { ...flight[key], [who]: v } });
  const hasInfants = groups.some((g) => state.passengers[g].infants > 0);

  const meta = [shortDate(flight.date), flight.depTime && flight.arrTime ? `${flight.depTime}→${flight.arrTime}` : '', stopsLabel(flight.stops)]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="card flight-card" id={`card-${flight.id}`}>
      <div className="card-head">
        <div>
          <strong>{flightLabel(flight)}</strong>
          {meta && <span className="muted"> · {meta}</span>}
        </div>
        <div className="card-actions">
          {groups.map((g) => (
            <span key={g} className="mini-cost">
              {GROUP_SHORT[g]}: <Usd value={flightCost(flight, state.passengers[g]).total} />
            </span>
          ))}
          <button className="btn" onClick={() => cards.toggle(flight.id)} aria-expanded={isOpen}>
            {isOpen ? 'סגור' : 'ערוך'}
          </button>
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
            <TextField label="חברת תעופה" value={flight.airline} onChange={(v) => set({ airline: v })} />
            <TextField label="מספר טיסה" value={flight.flightNo} onChange={(v) => set({ flightNo: v })} />
            <TextField label="תאריך" type="date" value={flight.date} onChange={(v) => set({ date: v })} />
            <TextField label="שעת יציאה" type="time" value={flight.depTime} onChange={(v) => set({ depTime: v })} />
            <TextField label="שעת נחיתה" type="time" value={flight.arrTime} onChange={(v) => set({ arrTime: v })} />
            <TextField label="שדה תעופה / מסלול" value={flight.airport} onChange={(v) => set({ airport: v })} placeholder="TLV → BCN" />
            <NumField label="מספר עצירות" unit="" step="1" value={flight.stops} onChange={(v) => set({ stops: v })} hint="0 = ישירה, ריק = לא ידוע" />
            <TextField label="זמן כולל" value={flight.duration} onChange={(v) => set({ duration: v })} placeholder="4:35" />
            <TextField label="כבודה כלולה" value={flight.baggageInfo} onChange={(v) => set({ baggageInfo: v })} placeholder="תיק יד בלבד / 23 ק״ג" wide />
          </div>

          <h4>מחירים לנוסע ($)</h4>
          <table className="price-grid">
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col">מבוגר</th>
                <th scope="col">תינוק</th>
              </tr>
            </thead>
            <tbody>
              {PRICE_ROWS.map(({ key, label }) => (
                <tr key={key}>
                  <th scope="row">{label}</th>
                  {(['adult', 'infant'] as const).map((who) => (
                    <td key={who}>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        dir="ltr"
                        placeholder="0"
                        aria-label={`${label} – ${who === 'adult' ? 'מבוגר' : 'תינוק'}`}
                        value={flight[key][who] ?? ''}
                        onChange={(e) => setPrice(key, who, e.target.value === '' ? null : Number(e.target.value))}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {hasInfants && infantPriceMissing(flight) && (
            <p>
              <Chip tone="yellow">מחיר תינוק לא הוזן – נחשב 0$. אם התינוק משלם, הזינו.</Chip>
            </p>
          )}

          <div className="form-grid">
            <TextField label="הערות" value={flight.notes} onChange={(v) => set({ notes: v })} wide />
          </div>

          <div className="card-foot muted small">
            {groups.map((g) => {
              const c = flightCost(flight, state.passengers[g]);
              return (
                <div key={g}>
                  {GROUP_SHORT[g]} ({state.passengers[g].adults} מבוגרים
                  {state.passengers[g].infants > 0 ? ` + ${state.passengers[g].infants} תינוק` : ''}): טיסה <Usd value={c.base} /> · מושבים{' '}
                  <Usd value={c.seats} /> · מזוודות <Usd value={c.baggage} /> · אחר <Usd value={c.other} /> · סה״כ{' '}
                  <Usd value={c.total} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function FlightSection({ cruise, cards }: { cruise: Cruise; cards: Cards }) {
  const { state, dispatch } = useApp();
  const add = (direction: FlightDirection) => {
    const f = emptyFlight(cruise.id, direction);
    dispatch({ type: 'addFlight', flight: f });
    cards.show(f.id);
  };
  return (
    <Section
      title="אפשרויות טיסה"
      hint="אפשר להוסיף כמה אפשרויות לאותו תאריך. בחרו מהן בטופס של כל קבוצה (למעלה). המחיר מוזן לנוסע, והמערכת מכפילה לפי מספר הנוסעים של כל קבוצה."
    >
      {(['out', 'back'] as const).map((direction) => {
        const list = state.flights.filter((f) => f.cruiseId === cruise.id && f.direction === direction);
        return (
          <div key={direction} className="flight-group">
            <div className="section-head">
              <h3>{direction === 'out' ? 'טיסות הלוך (לברצלונה)' : 'טיסות חזור (מברצלונה)'}</h3>
              <button className="btn" onClick={() => add(direction)}>
                + הוסף טיסה
              </button>
            </div>
            {list.length === 0 && <p className="muted small">אין עדיין אפשרויות.</p>}
            {list.map((f) => (
              <FlightCard key={f.id} flight={f} cards={cards} />
            ))}
          </div>
        );
      })}
    </Section>
  );
}

// ---------- hotels ----------

function HotelCard({ hotel, cruise, cards }: { hotel: Hotel; cruise: Cruise; cards: Cards }) {
  const { state, dispatch } = useApp();
  const isOpen = cards.open.has(hotel.id);
  const set = (patch: Partial<Hotel>) => dispatch({ type: 'updateHotel', id: hotel.id, patch });
  const { nights, fromDates } = hotelNights(hotel);
  const issues = hotelIssues(hotel, cruise);
  const cost = hotelCost(hotel);
  const groupText: Record<HotelGroup, string> = {
    A: GROUP_SHORT.A,
    B: GROUP_SHORT.B,
    both: 'שתי הקבוצות',
  };
  const used = (['A', 'B'] as const).filter((g) => state.plans[cruise.id]?.[g].hotelId === hotel.id);

  return (
    <div className="card hotel-card" id={`card-${hotel.id}`}>
      <div className="card-head">
        <div>
          <strong>{hotel.name || 'מלון (ללא שם)'}</strong>
          <span className="muted">
            {' '}
            · {groupText[hotel.group]} · {nights} לילות
          </span>
        </div>
        <div className="card-actions">
          <span className="mini-cost">
            <Usd value={cost} />
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
        <p key={i}>
          <Chip tone="red">{i}</Chip>
        </p>
      ))}
      {isOpen && (
        <div className="card-body">
          <div className="form-grid">
            <label className="field">
              <span className="field-label">שייך ל</span>
              <select value={hotel.group} onChange={(e) => set({ group: e.target.value as HotelGroup })}>
                <option value="A">{GROUP_LABEL.A}</option>
                <option value="B">{GROUP_LABEL.B}</option>
                <option value="both">שתי הקבוצות (כל קבוצה משלמת את הסכום)</option>
              </select>
            </label>
            <TextField label="שם המלון" value={hotel.name} onChange={(v) => set({ name: v })} />
            <TextField label="כניסה" type="date" value={hotel.checkIn} onChange={(v) => set({ checkIn: v })} />
            <TextField label="יציאה" type="date" value={hotel.checkOut} onChange={(v) => set({ checkOut: v })} />
            {fromDates ? (
              <div className="field">
                <span className="field-label">לילות</span>
                <span className="readonly">{nights} (לפי התאריכים)</span>
              </div>
            ) : (
              <NumField label="לילות" unit="" step="1" value={hotel.manualNights} onChange={(v) => set({ manualNights: v })} hint="או הזינו תאריכים" />
            )}
            <NumField label="מחיר ללילה (לחדר)" value={hotel.pricePerNight} onChange={(v) => set({ pricePerNight: v })} />
            <NumField label="מסים (סה״כ)" value={hotel.taxes} onChange={(v) => set({ taxes: v })} />
            <NumField label="מס עירייה (סה״כ)" value={hotel.cityTax} onChange={(v) => set({ cityTax: v })} />
            <NumField label="ארוחת בוקר (סה״כ, אם לא כלולה)" value={hotel.breakfast} onChange={(v) => set({ breakfast: v })} />
            <NumField label="עלויות נוספות (סה״כ)" value={hotel.other} onChange={(v) => set({ other: v })} />
            <TextField label="הערות" value={hotel.notes} onChange={(v) => set({ notes: v })} wide />
          </div>
          <div className="card-foot muted small">
            סה״כ מלון: <Usd value={cost} />
            {used.length > 0 && <> · נבחר ע״י: {used.map((g) => GROUP_SHORT[g]).join(', ')}</>}
            <br />
            כל הסכומים בדולרים. אם קיבלתם מחיר ביורו – המירו לפני ההזנה.
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
      title="אפשרויות מלון בברצלונה"
      hint="מלון שייך לקבוצה אחת, או לשתיהן. אם לשתי הקבוצות מחיר שונה – הוסיפו שני מלונות."
      actions={
        <button
          className="btn"
          onClick={() => {
            const h = emptyHotel(cruise.id, 'A');
            dispatch({ type: 'addHotel', hotel: h });
            cards.show(h.id);
          }}
        >
          + הוסף מלון
        </button>
      }
    >
      {list.length === 0 && <p className="muted small">אין עדיין מלונות. אם מגיעים ישר לנמל – אפשר להשאיר ריק.</p>}
      {list.map((h) => (
        <HotelCard key={h.id} hotel={h} cruise={cruise} cards={cards} />
      ))}
    </Section>
  );
}

// ---------- agent prices (rooms) ----------

function RoomsSection({ cruise }: { cruise: Cruise }) {
  const { dispatch } = useApp();
  return (
    <details className="section details-box">
      <summary>
        <h2 className="inline">מחירי הסוכנת – חדרים (עריכה)</h2>
      </summary>
      <p className="muted">מחירי קרוז בלבד, כולל מיסים, לפי הסוכנת. אין התאמה אוטומטית של חדר לפי השם.</p>
      {GROUPS.map((g) => (
        <div key={g} className="rooms-group">
          <h3>{GROUP_LABEL[g]}</h3>
          {cruise.rooms[g].map((r) => (
            <div className="room-row" key={r.id}>
              <input
                type="text"
                aria-label="שם חדר"
                value={r.name}
                placeholder="שם החדר"
                onChange={(e) =>
                  dispatch({ type: 'updateRoom', cruiseId: cruise.id, group: g, roomId: r.id, patch: { name: e.target.value } })
                }
              />
              <span className="num-wrap">
                <span className="unit" aria-hidden="true">$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  dir="ltr"
                  aria-label={`מחיר – ${r.name || 'חדר'}`}
                  value={r.price ?? ''}
                  placeholder="חסר"
                  onChange={(e) =>
                    dispatch({
                      type: 'updateRoom',
                      cruiseId: cruise.id,
                      group: g,
                      roomId: r.id,
                      patch: { price: e.target.value === '' ? null : Number(e.target.value) },
                    })
                  }
                />
              </span>
              <button
                className="btn btn-danger"
                aria-label={`מחק ${r.name || 'חדר'}`}
                onClick={() => dispatch({ type: 'removeRoom', cruiseId: cruise.id, group: g, roomId: r.id })}
              >
                מחק
              </button>
            </div>
          ))}
          <button
            className="btn"
            onClick={() => dispatch({ type: 'addRoom', cruiseId: cruise.id, group: g, id: uid('r') })}
          >
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
    <div className="card">
      <div className="form-grid">
        <TextField label="תאריך יציאה" type="date" value={cruise.start} onChange={(v) => dispatch({ type: 'updateCruise', id: cruise.id, patch: { start: v } })} />
        <TextField label="תאריך חזרה" type="date" value={cruise.end} onChange={(v) => dispatch({ type: 'updateCruise', id: cruise.id, patch: { end: v } })} />
        <div className="field">
          <span className="field-label">&nbsp;</span>
          <button
            className="btn btn-danger"
            onClick={() => {
              if (window.confirm('למחוק את הצעת הקרוז הזו עם כל הטיסות והמלונות שלה?')) {
                dispatch({ type: 'removeCruise', id: cruise.id });
                onRemoved();
              }
            }}
          >
            מחק הצעת קרוז
          </button>
        </div>
      </div>
      {!valid && (cruise.start || cruise.end) && <Chip tone="red">תאריך החזרה חייב להיות אחרי תאריך היציאה</Chip>}
      {!cruise.start && !cruise.end && <Chip tone="yellow">הזינו תאריכים</Chip>}
    </div>
  );
}

// ---------- screen ----------

export function EntryScreen() {
  const { state, dispatch } = useApp();
  const [selected, setSelected] = useState(state.cruises[0]?.id ?? '');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [scrollTo, setScrollTo] = useState<string | null>(null);

  const cruise = state.cruises.find((c) => c.id === selected) ?? state.cruises[0];

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
    document.getElementById(`card-${scrollTo}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
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

          <Section title="1. בחירה והזנה – כל קבוצה בנפרד">
            <GroupForm cruise={cruise} group="A" cards={cards} />
            {state.groupBEnabled ? (
              <GroupForm cruise={cruise} group="B" cards={cards} />
            ) : (
              <div className="card muted">
                <strong>{GROUP_LABEL.B}</strong> מוסתרת (לא מגיעים). הנתונים שהוזנו נשמרים.{' '}
                <button className="btn" onClick={() => dispatch({ type: 'setGroupBEnabled', enabled: true })}>
                  הצג שוב
                </button>
              </div>
            )}
          </Section>

          <FlightSection cruise={cruise} cards={cards} />
          <HotelSection cruise={cruise} cards={cards} />
          <RoomsSection cruise={cruise} />
        </>
      )}
    </div>
  );
}
