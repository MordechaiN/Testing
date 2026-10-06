import { useRef, useState } from 'react';
import { addDays, longDate, rangeLabel } from '../domain/dates';
import { GROUP_LABEL } from '../domain/format';
import { exportJson, importJson } from '../domain/storage';
import type { TermStatus } from '../domain/types';
import { GROUPS } from '../domain/types';
import { Chip, NumField, Section } from './common';
import type { Tone } from './common';
import { useApp } from './context';

const STATUS: Record<TermStatus, { label: string; tone: Tone }> = {
  clarify: { label: 'דורש בירור', tone: 'yellow' },
  missing: { label: 'חסר מידע', tone: 'yellow' },
  ok: { label: 'ברור / כלול', tone: 'green' },
  info: { label: 'מידע / אופציונלי', tone: 'blue' },
};

function Passengers() {
  const { state, dispatch } = useApp();
  return (
    <Section title="נוסעים בכל קבוצה" hint="המערכת מכפילה מחירי טיסה, מושב ומזוודה לפי המספרים האלה. תינוק משלם רק אם הזנתם לו מחיר.">
      <div className="form-grid">
        {GROUPS.map((g) => (
          <div key={g} className="card">
            <h3>{GROUP_LABEL[g]}</h3>
            <div className="form-grid">
              <NumField
                label="מבוגרים"
                unit=""
                step="1"
                value={state.passengers[g].adults}
                onChange={(v) => dispatch({ type: 'setPassengers', group: g, patch: { adults: Math.max(0, Math.floor(v ?? 0)) } })}
              />
              <NumField
                label="תינוקות"
                unit=""
                step="1"
                value={state.passengers[g].infants}
                onChange={(v) => dispatch({ type: 'setPassengers', group: g, patch: { infants: Math.max(0, Math.floor(v ?? 0)) } })}
              />
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Terms() {
  const { state, dispatch } = useApp();
  return (
    <Section
      title="תנאים שהתקבלו מהסוכנת"
      hint={'הטקסט בעמודה "מה נאמר" הוא ציטוט – לא פירוש שלי. נושא שדורש בירור נשאר צהוב עד שתשנו אותו.'}
    >
      <div className="table-scroll">
        <table className="cmp terms">
          <thead>
            <tr>
              <th scope="col">נושא</th>
              <th scope="col">מה נאמר</th>
              <th scope="col">סטטוס</th>
              <th scope="col">הערה שלי</th>
            </tr>
          </thead>
          <tbody>
            {state.terms.map((t) => (
              <tr key={t.id}>
                <th scope="row">{t.topic}</th>
                <td>{t.said}</td>
                <td>
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
                  <div>
                    <Chip tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Chip>
                  </div>
                </td>
                <td>
                  <input
                    type="text"
                    aria-label={`הערה – ${t.topic}`}
                    dir="auto"
                    value={t.note}
                    onChange={(e) => dispatch({ type: 'updateTerm', id: t.id, patch: { note: e.target.value } })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Deposit() {
  const { state, dispatch } = useApp();
  return (
    <Section title="מקדמה וביטול">
      <div className="banner banner-yellow">
        <div>
          <strong>דורש בירור – הסוכנת מסרה נתונים סותרים:</strong> 170$ לאדם, 200$ לחדר, 540$ לזוג רגיל. 170$ לאדם לזוג הם 340$, לא
          540$. המערכת לא בוחרת מספר. כשתקבלו תשובה, הזינו כאן את הסכום בפועל לכל קבוצה (הוא לא נכנס לחישוב המחיר הכולל).
        </div>
      </div>
      <div className="form-grid">
        {GROUPS.map((g) => (
          <NumField
            key={g}
            label={`מקדמה בפועל – ${GROUP_LABEL[g]}`}
            value={state.deposit[g]}
            onChange={(v) => dispatch({ type: 'setDeposit', group: g, value: v })}
            hint={state.deposit[g] === null ? 'טרם נקבע' : undefined}
          />
        ))}
      </div>

      <h3>ביטול</h3>
      <p>
        ככה נאמר: "אפשר לבטל עד 90 יום לפני המועד ואז הלכה המקדמה". <Chip tone="yellow">נדרש אישור בכתב</Chip>
      </p>
      <p className="muted small">
        לא ברור מהניסוח מה קורה בביטול אחרי המועד הזה, ומה בדיוק נחשב "המועד". התאריכים למטה הם רק חישוב של 90 יום אחורה מיום ההפלגה:
      </p>
      <ul className="plain-list">
        {state.cruises.map((c) => {
          const d = addDays(c.start, -90);
          return (
            <li key={c.id}>
              {rangeLabel(c.start, c.end)}: {d ? longDate(d) : 'הזינו תאריך הפלגה'}
            </li>
          );
        })}
      </ul>
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
    a.click();
    URL.revokeObjectURL(url);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const parsed = importJson(await file.text());
    if (!parsed) {
      setMessage({ tone: 'red', text: 'הקובץ לא נראה כמו גיבוי של המערכת. לא שונה כלום.' });
    } else {
      dispatch({ type: 'replaceAll', state: parsed });
      setMessage({ tone: 'green', text: 'הגיבוי נטען.' });
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Section
      title="גיבוי ואיפוס"
      hint="הנתונים נשמרים אוטומטית בדפדפן הזה בלבד. כדי לעבור למחשב אחר או לשתף – ייצאו גיבוי וייבאו אותו שם."
    >
      <div className="btn-row">
        <button className="btn" onClick={download}>
          ייצוא גיבוי (קובץ)
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          ייבוא גיבוי
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-label="קובץ גיבוי" onChange={(e) => void upload(e.target.files?.[0])} />
        <button
          className="btn btn-danger"
          onClick={() => {
            if (window.confirm('לאפס הכול ולחזור לנתונים ההתחלתיים? כל מה שהזנתם יימחק.')) {
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
      <Deposit />
      <Terms />
      <Passengers />
      <Backup />
    </div>
  );
}
