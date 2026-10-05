import { useState, type ReactNode } from 'react';
import { FIELD_LABELS, OPTIONS } from '../../domain/defaults';
import { STATUS_LABEL } from '../../domain/format';
import type { ContextField, DayStatus, EventContext, Settings } from '../../domain/types';
import { rememberCustomOption } from '../../persistence/repo';
import { Icon, type IconName } from './Icon';

// --- Schaltflächen -------------------------------------------------------------

type ButtonVariant = 'solid' | 'glass' | 'tinted' | 'plain' | 'danger';

const BUTTON_STYLE: Record<ButtonVariant, string> = {
  solid: 'bg-solid text-on-solid shadow-[0_8px_24px_rgba(0,0,0,0.16)]',
  glass: 'glass-strong text-ink',
  tinted: 'bg-fill text-ink',
  plain: 'text-accent',
  danger: 'bg-fill text-alert',
};

export function Button({
  children,
  onClick,
  variant = 'tinted',
  disabled,
  className = '',
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`pressable flex min-h-[50px] w-full items-center justify-center gap-2 rounded-full px-5 text-[17px] font-semibold disabled:opacity-40 ${BUTTON_STYLE[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function IconButton({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="pressable glass flex size-11 items-center justify-center rounded-full text-ink2"
    >
      <Icon name={icon} size={21} />
    </button>
  );
}

// --- Status ---------------------------------------------------------------------

export const STATUS_COLOR: Record<DayStatus, string> = {
  green: 'var(--ok)',
  orange: 'var(--warn)',
  red: 'var(--alert)',
};

const STATUS_ICON: Record<DayStatus, IconName> = { green: 'checkCircle', orange: 'minusCircle', red: 'upCircle' };

/** Status immer als Farbe + Symbol + Text. */
export function StatusBadge({ status, label }: { status: DayStatus; label?: string }) {
  const color = STATUS_COLOR[status];
  return (
    <span
      className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full py-1 pl-2 pr-3 text-[15px] font-medium transition-colors duration-500"
      style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
    >
      <Icon name={STATUS_ICON[status]} size={18} strokeWidth={2} />
      <span>{label ?? STATUS_LABEL[status]}</span>
    </span>
  );
}

export function StatusDot({ status, size = 10 }: { status: DayStatus | null; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: status ? STATUS_COLOR[status] : 'var(--fill2)' }}
    />
  );
}

// --- Auswahl ---------------------------------------------------------------------

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div role="tablist" aria-label={label} className="relative flex rounded-full bg-fill p-[3px]">
      <div
        aria-hidden="true"
        className="glass-strong absolute bottom-[3px] top-[3px] rounded-full transition-transform duration-500"
        style={{
          width: `calc((100% - 6px) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
          transitionTimingFunction: 'var(--spring)',
        }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={`relative z-10 min-h-[38px] flex-1 rounded-full px-2 text-[14px] font-medium transition-colors ${o.value === value ? 'text-ink' : 'text-ink2'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ selected, onClick, children }: { selected?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`pressable min-h-[44px] rounded-full px-4 text-[15px] font-medium transition-colors ${selected ? 'bg-solid text-on-solid' : 'bg-fill text-ink'}`}
    >
      {children}
    </button>
  );
}

/** Einfachauswahl aus Chips mit optionaler eigener Eingabe. */
export function ChipSelect({
  options,
  value,
  onChange,
  onAddCustom,
  customLabel = 'Eigene Eingabe',
}: {
  options: string[];
  value?: string;
  onChange: (v: string | undefined) => void;
  onAddCustom?: (v: string) => void;
  customLabel?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const all = value && !options.includes(value) ? [...options, value] : options;

  const commit = () => {
    const v = draft.trim();
    if (v) {
      onChange(v);
      onAddCustom?.(v);
    }
    setDraft('');
    setAdding(false);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {all.map((o) => (
        <Chip key={o} selected={o === value} onClick={() => onChange(o === value ? undefined : o)}>
          {o}
        </Chip>
      ))}
      {onAddCustom &&
        (adding ? (
          <form
            className="flex min-h-[44px] items-center rounded-full bg-fill pl-4 pr-1"
            onSubmit={(e) => {
              e.preventDefault();
              commit();
            }}
          >
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              maxLength={40}
              placeholder={customLabel}
              aria-label={customLabel}
              className="w-36 bg-transparent text-ink outline-none placeholder:text-ink3"
            />
            <button type="submit" aria-label="Übernehmen" className="flex size-9 items-center justify-center text-accent">
              <Icon name="check" size={18} />
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="pressable flex min-h-[44px] items-center gap-1 rounded-full border border-dashed border-[var(--ink3)] px-4 text-[15px] text-ink2"
          >
            <Icon name="plus" size={15} />
            {customLabel}
          </button>
        ))}
    </div>
  );
}

const FIELD_ORDER: ContextField[] = ['trigger', 'mood', 'location', 'companions', 'activity'];

/**
 * Optionale Kontextangaben als aufklappbare Gruppen. Nichts davon ist Pflicht;
 * zugeklappt zeigt jede Zeile nur die aktuelle Auswahl.
 */
export function ContextFields({
  value,
  onChange,
  settings,
  initiallyOpen,
  withNote,
}: {
  value: EventContext;
  onChange: (v: EventContext) => void;
  settings: Settings;
  initiallyOpen?: ContextField;
  withNote?: boolean;
}) {
  const [open, setOpen] = useState<ContextField | 'note' | null>(initiallyOpen ?? null);

  return (
    <div className="overflow-hidden rounded-[22px] bg-fill">
      {FIELD_ORDER.map((field, i) => {
        const isOpen = open === field;
        return (
          <div key={field} className={i ? 'border-t-[0.5px] border-sep' : ''}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : field)}
              className="flex min-h-[50px] w-full items-center gap-3 px-4 text-left text-[16px]"
            >
              <span className="flex-1">{FIELD_LABELS[field]}</span>
              <span className="max-w-[55%] truncate text-ink2">{value[field] ?? ''}</span>
              <span className={`text-ink3 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}>
                <Icon name="chevronDown" size={16} />
              </span>
            </button>
            {isOpen && (
              <div className="fade-in px-3 pb-4 pt-1">
                <ChipSelect
                  options={[...OPTIONS[field], ...(settings.customOptions[field] ?? [])]}
                  value={value[field]}
                  onChange={(v) => onChange({ ...value, [field]: v })}
                  onAddCustom={(v) => void rememberCustomOption(field, v)}
                  customLabel={field === 'trigger' ? 'Eigener Trigger' : field === 'location' ? 'Eigener Ort' : 'Eigene Eingabe'}
                />
              </div>
            )}
          </div>
        );
      })}
      {withNote && (
        <div className="border-t-[0.5px] border-sep px-4 py-2">
          <input
            value={value.note ?? ''}
            onChange={(e) => onChange({ ...value, note: e.target.value })}
            maxLength={200}
            placeholder="Notiz"
            aria-label="Notiz"
            className="min-h-[40px] w-full bg-transparent text-ink outline-none placeholder:text-ink3"
          />
        </div>
      )}
    </div>
  );
}

/** Skala 1–10 als 5×2-Raster (ausreichend große Tippflächen). */
export function IntensityScale({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Stärke von 1 bis 10" className="grid grid-cols-5 gap-2">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
        const selected = value === n;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(n)}
            className={`pressable num flex h-[52px] items-center justify-center rounded-[18px] text-[20px] font-semibold transition-colors ${selected ? 'bg-solid text-on-solid' : 'bg-fill text-ink'}`}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

// --- Layout ----------------------------------------------------------------------

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`glass card ${className}`}>{children}</section>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="px-1 pb-2 pt-1 text-[13px] font-medium uppercase tracking-wide text-ink2">{children}</h3>;
}

export function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <Card className="py-8 text-center">
      <p className="text-[17px] font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-[30ch] text-[15px] leading-snug text-ink2">{text}</p>
    </Card>
  );
}
