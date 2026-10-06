import type { ReactNode } from 'react';
import type { Line, Notice, PlanStatus } from '../domain/calc';
import { usd } from '../domain/format';
import type { Money } from '../domain/types';

export type Tone = 'green' | 'yellow' | 'red' | 'blue' | 'gray';

export function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

/** Dollar amount, always left-to-right so the $ sign never jumps around in RTL text. */
export function Usd({ value, className }: { value: number; className?: string }) {
  return (
    <span className={`usd ${className ?? ''}`} dir="ltr">
      {usd(value)}
    </span>
  );
}

export function NotEntered({ text = 'טרם הוזן' }: { text?: string }) {
  return <span className="not-entered">{text}</span>;
}

/** A cost line: amount, explicit label ("לא צריך"), or "טרם הוזן" – never a fake $0. */
export function LineValue({ line }: { line: Line }) {
  if (line.label) return <span className="line-label">{line.label}</span>;
  if (!line.entered) return <NotEntered />;
  return <Usd value={line.amount} />;
}

const STATUS_TEXT: Record<PlanStatus, { icon: string; text: string; tone: Tone }> = {
  green: { icon: '🟢', text: 'כל הנתונים העיקריים הוזנו', tone: 'green' },
  yellow: { icon: '🟡', text: 'חסר מידע', tone: 'yellow' },
  red: { icon: '🔴', text: 'בעיה', tone: 'red' },
};

export function StatusBadge({ status, notices }: { status: PlanStatus; notices: Notice[] }) {
  const s = STATUS_TEXT[status];
  const first = notices.find((n) => n.severity === status);
  return (
    <span className={`status status-${s.tone}`}>
      <span aria-hidden="true">{s.icon}</span> {first && status !== 'green' ? first.text : s.text}
    </span>
  );
}

const SEVERITY_ICON = { red: '🔴', yellow: '🟡', blue: '🔵' } as const;
const SEVERITY_TONE = { red: 'red', yellow: 'yellow', blue: 'blue' } as const;

export function NoticeList({ notices, max }: { notices: Notice[]; max?: number }) {
  if (notices.length === 0) return null;
  const shown = max ? notices.slice(0, max) : notices;
  return (
    <ul className="notice-list">
      {shown.map((n, i) => (
        <li key={i} className={`notice notice-${SEVERITY_TONE[n.severity]}`}>
          <span aria-hidden="true">{SEVERITY_ICON[n.severity]}</span> {n.text}
        </li>
      ))}
      {max && notices.length > max && <li className="muted small">ועוד {notices.length - max}…</li>}
    </ul>
  );
}

export function parseNumber(text: string): number | null {
  if (text.trim() === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

interface NumFieldProps {
  label: string;
  value: Money;
  onChange: (v: number | null) => void;
  unit?: string;
  hint?: ReactNode;
  step?: string;
  min?: number;
  placeholder?: string;
  className?: string;
}

/** Number input. Empty = null = "טרם הוזן" (counted as 0 in sums, but shown as missing). */
export function NumField({
  label,
  value,
  onChange,
  unit = '$',
  hint,
  step = 'any',
  min = 0,
  placeholder = 'טרם הוזן',
  className,
}: NumFieldProps) {
  return (
    <label className={`field ${className ?? ''}`}>
      <span className="field-label">{label}</span>
      <MoneyInput value={value} onChange={onChange} unit={unit} step={step} min={min} placeholder={placeholder} ariaLabel={label} />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

interface MoneyInputProps {
  value: Money;
  onChange: (v: number | null) => void;
  ariaLabel: string;
  unit?: string;
  step?: string;
  min?: number;
  placeholder?: string;
}

export function MoneyInput({ value, onChange, ariaLabel, unit = '$', step = 'any', min = 0, placeholder = 'טרם הוזן' }: MoneyInputProps) {
  return (
    <span className={`num-wrap ${unit ? 'has-unit' : ''}`}>
      {unit && (
        <span className="unit" aria-hidden="true">
          {unit}
        </span>
      )}
      <input
        type="number"
        inputMode="decimal"
        min={min}
        step={step}
        value={value ?? ''}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => onChange(parseNumber(e.target.value))}
      />
    </span>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'date' | 'time';
  placeholder?: string;
  wide?: boolean;
}

export function TextField({ label, value, onChange, type = 'text', placeholder, wide }: TextFieldProps) {
  return (
    <label className={`field ${wide ? 'field-wide' : ''}`}>
      <span className="field-label">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        dir={type === 'text' ? 'auto' : 'ltr'}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function Section({
  title,
  hint,
  children,
  actions,
  className,
  label,
}: {
  title: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <section className={`section ${className ?? ''}`} aria-label={label}>
      <div className="section-head">
        <h2>{title}</h2>
        {actions && <div className="btn-row">{actions}</div>}
      </div>
      {hint && <p className="muted section-hint">{hint}</p>}
      {children}
    </section>
  );
}
