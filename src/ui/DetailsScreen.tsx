import { useRef, useState } from 'react';
import { inclusionList } from '../domain/calc';
import { addDays, longDate, ltr, rangeLabelLong } from '../domain/dates';
import { GROUP_LABEL } from '../domain/format';
import { exportJson, importJson } from '../domain/storage';
import type { TermStatus } from '../domain/types';
import { GROUPS } from '../domain/types';
import { Chip, NumField, Section } from './common';
import type { Tone } from './common';
import { useApp } from './context';

const STATUS: Record<TermStatus, { label: string; tone: Tone; icon: string }> = {
  clarify: { label: 'דורש בירור', tone: 'yellow', icon: '⚠️' },
  missing: { label: 'חסר מידע', tone: 'yellow', icon: '🟡' },
  ok: { label: 'ברור / כלול', tone: 'green', icon: '🟢' },
  info: { label: 'מידע / אופציונלי', tone: 'blue', icon: '🔵' },
};

const SEVERITY_ICON = { green: '🟢', blue: '🔵', yellow: '🟡', red: '🔴' } as const;

function Inclusion() {
  const { state } = useApp();
  const { included, notIncluded } = inclusionList(state);
  return (
    <Section title="מה כלול במחיר הקרוז ומה לא" label="מה כלול ומה לא">
      <div className="two-cols">
        <div>
          <h3>כלול (לפי הסוכן)</h3>
          <ul className="plain-list">
            {included.map((i) => (
              <li key={i.text}>
                {SEVERITY_ICON[i.severity]} {i.text}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>לא כלול</h3>
          <ul className="plain-list">
            {notIncluded.map((i) => (
              <li key={i.text}>
                {SEVERITY_ICON[i.severity]} {i.text}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}

function DepositAndCancel() {
  const { state, dispatch } = useApp();
  return (
    <Section title="מקדמה וביטול">
      <div className="banner banner-yellow">
        <div>
          <strong>⚠️ מקדמה – דורש בירור.</strong> נמסר מהסוכן: "$170 לאדם / $200 לחדר / $540 לזוג רגיל". המספרים לא מסתדרים
          ({ltr('$170 × 2 = $340')}, לא {ltr('$540')}). המערכת לא בוחרת מספר. כשתקבלו תשובה – הזינו את המקדמה בפועל לכל קבוצה.
        </div>
      </div>
      <div className="form-grid">
        {GROUPS.map((g) => (
          <NumField
            key={g}
            label={`מקדמה בפועל – ${GROUP_LABEL[g]}`}
            value={state.deposit[g]}
            onChange={(v) => dispatch({ type: 'setDeposit', group: g, value: v })}
            hint="תשלום על חשבון המחיר – לא מתווסף לסה״כ"
          />
        ))}
      </div>

      <h3 className="mt">
        ביטול – <Chip tone="yellow">⚠️ דורש אישור בכתב</Chip>
      </h3>
      <p>נמסר מהסוכן: "אפשר לבטל עד 90 יום לפני המועד ואז הלכה המקדמה".</p>
      <p className="muted small">אין כאן פרשנות משפטית. התאריכים הם רק חישוב של 90 יום לפני יום ההפלגה:</p>
      <ul className="plain-list">
        {state.cruises.map((c) => {
          const d = addDays(c.start, -90);
          return (
            <li key={c.id}>
              הפלגה {rangeLabelLong(c.start, c.end)}: 90 יום לפני = <strong>{d ? ltr(longDate(d)) : 'הזינו תאריך הפלגה'}</strong>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function Terms() {
  const { state, dispatch } = useApp();
  return (
    <Section title="תנאי ההצעה מהסוכן" hint='העמודה "מה נאמר" היא ציטוט ולא פרשנות. אחרי בירור – שנו את הסטטוס והוסיפו הערה.'>
      <div className="terms">
        {state.terms.map((t) => (
          <div key={t.id} className={`term term-${STATUS[t.status].tone}`}>
            <div className="term-head">
              <strong>{t.topic}</strong>
              <Chip tone={STATUS[t.status].tone}>
                {STATUS[t.status].icon} {STATUS[t.status].label}
              </Chip>
            </div>
            <div className="term-said">"{t.said}"</div>
            <div className="term-edit">
              <label className="field">
                <span className="field-label">סטטוס</span>
                <select
                  aria-label={`סטטוס – ${t.topic}`}
                  value={t.status}
                  onChange={(e) => dispatch({ type: 'updateTerm', id: t.id, patch: { status: e.target.value as TermStatus } })}
                >
                  {(Object.keys(STATUS) as TermStatus[]).map((k) => (
                    <option key={k} value={k}>
                      {STATUS[k].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field field-grow">
                <span className="field-label">הערה שלי</span>
                <input
                  type="text"
                  aria-label={`הערה – ${t.topic}`}
                  dir="auto"
                  value={t.note}
                  onChange={(e) => dispatch({ type: 'updateTerm', id: t.id, patch: { note: e.target.value } })}
                />
              </label>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Notes() {
  const { state, dispatch } = useApp();
  return (
    <Section title="הערות">
      <textarea
        className="notes"
        aria-label="הערות"
        dir="auto"
        rows={4}
        placeholder="כל מה שחשוב לזכור (שיחות עם הסוכן, שאלות פתוחות…)"
        value={state.notes}
        onChange={(e) => dispatch({ type: 'setNotes', notes: e.target.value })}
      />
    </Section>
  );
}

function Passengers() {
  const { state, dispatch } = useApp();
  return (
    <Section title="נוסעים בכל קבוצה" hint="לכל נוסע עמודת מחיר משלו בטיסות. תינוק משלם רק אם מזינים לו מחיר.">
      <div className="form-grid">
        {GROUPS.map((g) => (
          <div key={g} className="card">
            <h3>{GROUP_LABEL[g]}</h3>
            <div className="form-grid">
              <NumField
                label="מבוגרים"
                unit=""
                step="1"
                placeholder="0"
                value={state.passengers[g].adults}
                onChange={(v) => dispatch({ type: 'setPassengers', group: g, patch: { adults: v ?? 0 } })}
              />
              <NumField
                label="תינוקות"
                unit=""
                step="1"
                placeholder="0"
                value={state.passengers[g].infants}
                onChange={(v) => dispatch({ type: 'setPassengers', group: g, patch: { infants: v ?? 0 } })}
              />
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Backup() {
  const { state, dispatch } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null);

  const download = () => {
    const blob = new Blob([exportJson(state)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cruise-compare-backup.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage({ tone: 'green', text: 'קובץ הגיבוי ירד למחשב.' });
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const parsed = importJson(await file.text());
    if (!parsed) {
      setMessage({ tone: 'red', text: 'הקובץ לא נראה כמו גיבוי של המערכת. לא שונה כלום.' });
    } else if (window.confirm('הייבוא יחליף את כל הנתונים הנוכחיים בנתונים מהקובץ. להמשיך?')) {
      dispatch({ type: 'replaceAll', state: parsed });
      setMessage({ tone: 'green', text: 'הגיבוי נטען.' });
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Section
      title="גיבוי – ייצוא וייבוא"
      hint="הנתונים נשמרים אוטומטית בדפדפן הזה בלבד (בכל שינוי, אין כפתור שמירה). כדי לעבור למחשב או לטלפון אחר – ייצאו קובץ וייבאו אותו שם."
    >
      <div className="btn-row">
        <button className="btn btn-primary" onClick={download}>
          ייצוא נתונים (JSON)
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          ייבוא נתונים
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          aria-label="קובץ גיבוי"
          onChange={(e) => void upload(e.target.files?.[0])}
        />
        <button
          className="btn btn-danger"
          onClick={() => {
            if (window.confirm('לאפס הכול ולחזור לנתונים ההתחלתיים? כל מה שהזנתם יימחק. מומלץ לייצא גיבוי קודם.')) {
              dispatch({ type: 'reset' });
              setMessage({ tone: 'blue', text: 'הנתונים אופסו.' });
            }
          }}
        >
          איפוס לנתונים ההתחלתיים
        </button>
      </div>
      {message && (
        <p role="status">
          <Chip tone={message.tone}>{message.text}</Chip>
        </p>
      )}
    </Section>
  );
}

export function DetailsScreen() {
  return (
    <div className="screen">
      <Inclusion />
      <DepositAndCancel />
      <Terms />
      <Notes />
      <Passengers />
      <Backup />
    </div>
  );
}
