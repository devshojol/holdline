import { useEffect, useState, type ReactNode } from 'react';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

/**
 * A screen's header: a Back button to the main menu (Esc does the same), the screen's name, and room on the
 * right for the screen's own controls. Kept short so the screen below fits the window without scrolling.
 */
export function PageHeader({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-3 flex shrink-0 items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" onClick={() => goHome()} className="tal-slab flex items-center gap-1.5 px-3 py-2 font-display text-sm uppercase" aria-label="Back to the main menu">
          <span aria-hidden="true">◀</span> Back
        </button>
        <div className="min-w-0 leading-none">
          <div className="font-label text-xs font-semibold uppercase tracking-[0.3em] text-accent">{kicker}</div>
          <h1 className="truncate font-display text-3xl uppercase text-ink">{title}</h1>
        </div>
      </div>
      {children}
    </div>
  );
}

let goHome: () => void = () => undefined;
/** Set once by the app: what the Back button does. */
export function setBackAction(fn: () => void) {
  goHome = fn;
}

export function Card({ children, className, title, right }: { children: ReactNode; className?: string; title?: string; right?: ReactNode }) {
  return (
    <section className={cx('tal-card tal-panel border p-5', className)}>
      {(title || right) && (
        <div className="tal-panel-head flex items-center justify-between gap-3">
          {title && <h2 className="tal-card-title font-display text-lg font-semibold uppercase tracking-[0.12em] text-ink">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled,
  className,
  title,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'outline' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  className?: string;
  title?: string;
  type?: 'button' | 'submit';
}) {
  const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-5 py-2.5 text-base', lg: 'px-8 py-4 text-xl' };
  const variants = {
    primary: 'tal-primary bg-accent text-white hover:bg-[#ff5d6a] active:translate-y-px',
    ghost: 'bg-transparent text-mute hover:text-ink hover:bg-white/5',
    outline: 'border border-line bg-panel2 text-ink hover:border-mute',
    danger: 'border border-accent/50 bg-accent/10 text-accent hover:bg-accent/20',
  };
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'tal-btn clip-angle-sm inline-flex items-center justify-center gap-2 font-display font-bold uppercase tracking-[0.12em] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        sizes[size],
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  hint?: string;
}) {
  return (
    <label className="block py-1.5">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-sm text-mute">{label}</span>
        <input
          type="number"
          className="tal-num tabular w-20 border border-line bg-bg px-2 py-0.5 text-right text-sm text-ink outline-none focus:border-accent"
          value={Number.isFinite(value) ? Number(value.toFixed(4)) : 0}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
          }}
        />
      </div>
      <input
        type="range"
        className="tal-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      {(hint || format) && <div className="mt-1 text-xs text-dim">{hint ?? format?.(value)}</div>}
    </label>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="tal-row flex cursor-pointer items-center justify-between gap-4 py-2">
      <span>
        <span className="block text-sm text-ink">{label}</span>
        {hint && <span className="block text-xs text-dim">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="tal-switch"
      >
        <span className="tal-switch-knob" />
        <span className="tal-switch-text">{checked ? 'On' : 'Off'}</span>
      </button>
    </label>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cx('flex flex-wrap gap-1.5', className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          title={o.title}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
          className="tal-chip"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean }) {
  return (
    <div className="tal-stat" data-accent={accent}>
      <div className="text-xs uppercase tracking-widest text-dim">{label}</div>
      <div className={cx('font-display tabular text-3xl font-bold leading-tight', accent ? 'text-accent' : 'text-ink')}>{value}</div>
      {sub && <div className="text-xs text-mute">{sub}</div>}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-2">
      <div className="tal-field-label mb-2 text-xs uppercase tracking-widest text-dim">{label}</div>
      {children}
    </div>
  );
}

export function Badge({ children, tone = 'mute' }: { children: ReactNode; tone?: 'mute' | 'accent' | 'ok' | 'warn' }) {
  const tones = {
    mute: 'border-line text-mute',
    accent: 'border-accent/50 text-accent',
    ok: 'border-ok/40 text-ok',
    warn: 'border-warn/40 text-warn',
  };
  return <span className={cx('inline-flex items-center border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider', tones[tone])}>{children}</span>;
}

/** Two-step destructive action (no browser confirm() — it is unavailable in embedded viewers). */
export function ConfirmButton({ children, confirmLabel = 'Click again to confirm', onConfirm, size = 'sm' }: { children: ReactNode; confirmLabel?: string; onConfirm: () => void; size?: 'sm' | 'md' }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button
      variant="danger"
      size={size}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : children}
    </Button>
  );
}

/**
 * A game-style option picker on one line: the setting's name, then ◀ value ▶. Clicking an arrow steps through
 * the options (wrapping round); much more compact than a row of chips.
 */
export function Cycler<T extends string | number>({
  label,
  options,
  value,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  hint?: string;
  /** Read-only: shows the value without arrows (a setting someone else controls). */
  disabled?: boolean;
}) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  const step = (d: number) => onChange(options[(i + d + options.length) % options.length].value);
  const current = options[i];
  return (
    <div className="flex items-center justify-between gap-3 py-1" title={hint ?? current?.title}>
      <span className="min-w-0 truncate text-sm text-mute">{label}</span>
      <div className="flex shrink-0 items-center" role="group" aria-label={label}>
        <button type="button" disabled={disabled} onClick={() => step(-1)} className={cx('tal-slab grid h-8 w-8 place-items-center text-sm', disabled && 'invisible')} aria-label={`Previous ${label}`}>
          ◀
        </button>
        <span className="w-28 truncate px-1 text-center font-display text-sm uppercase text-ink" aria-live="polite">
          {current?.label}
        </span>
        <button type="button" disabled={disabled} onClick={() => step(1)} className={cx('tal-slab grid h-8 w-8 place-items-center text-sm', disabled && 'invisible')} aria-label={`Next ${label}`}>
          ▶
        </button>
      </div>
    </div>
  );
}
