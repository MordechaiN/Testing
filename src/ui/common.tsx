import type { ReactNode } from 'react';
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
  hint?: string;
  step?: string;
  min?: number;
}

/** Number input. Empty = null (counts as 0 everywhere). */
export function NumField({ label, value, onChange, unit = '$', hint, step = 'any', min = 0 }: NumFieldProps) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="num-wrap">
        {unit && <span className="unit" aria-hidden="true">{unit}</span>}
        <input
          type="number"
          inputMode="decimal"
          min={min}
          step={step}
          value={value ?? ''}
          placeholder="0"
          dir="ltr"
          onChange={(e) => onChange(parseNumber(e.target.value))}
        />
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
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

export function Section({ title, hint, children, actions }: { title: string; hint?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
        {actions}
      </div>
      {hint && <p className="muted">{hint}</p>}
      {children}
    </section>
  );
}
