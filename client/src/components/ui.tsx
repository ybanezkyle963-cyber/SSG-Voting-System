import { useEffect, useId, useRef } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

/* ------------------------------------------------------------------- button */

type Variant = 'plain' | 'primary' | 'seal'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'md' | 'sm'
}

const VARIANTS: Record<Variant, string> = {
  plain: '',
  primary: 'btn-primary',
  seal: 'btn-seal'
}

export function Button({ variant = 'plain', size = 'md', className = '', ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`btn ${VARIANTS[variant]} ${size === 'sm' ? 'btn-sm' : ''} ${className}`}
      {...rest}
    />
  )
}

/* -------------------------------------------------------------------- field */

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: ReactNode
}

export function Field({ label, hint, className = '', id, ...rest }: FieldProps) {
  const generated = useId()
  const fieldId = id ?? generated
  return (
    <div className="flex flex-col gap-1">
      <label className="label" htmlFor={fieldId}>
        {label}
      </label>
      <input id={fieldId} className={`field ${className}`} {...rest} />
      {hint ? <p className="font-sans text-xs text-ink-60">{hint}</p> : null}
    </div>
  )
}

/* --------------------------------------------------------------------- card */

interface CardProps {
  title?: ReactNode
  eyebrow?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}

export function Card({ title, eyebrow, actions, children, className = '' }: CardProps) {
  return (
    <section className={`card ${className}`}>
      {title || eyebrow || actions ? (
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-rule px-4 py-3 sm:px-5">
          <div>
            {eyebrow ? (
              <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-60">
                {eyebrow}
              </p>
            ) : null}
            {title ? <h2 className="text-xl leading-tight">{title}</h2> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  )
}

/* -------------------------------------------------------------------- alert */

type AlertTone = 'info' | 'success' | 'warn' | 'error'

const ALERT_TONES: Record<AlertTone, string> = {
  info: 'border-ink/25 bg-white',
  success: 'border-pine bg-pine/10',
  warn: 'border-gold bg-gold/15',
  error: 'border-seal bg-seal/10'
}

export function Alert({
  tone = 'info',
  title,
  children
}: {
  tone?: AlertTone
  title?: ReactNode
  children?: ReactNode
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`border-l-4 px-3 py-2 font-sans text-sm ${ALERT_TONES[tone]}`}
    >
      {title ? <p className="font-semibold text-ink">{title}</p> : null}
      {children ? <div className={title ? 'mt-1 text-ink/80' : 'text-ink/80'}>{children}</div> : null}
    </div>
  )
}

/* ---------------------------------------------------------------------- tag */

export function Tag({
  children,
  tone = 'plain'
}: {
  children: ReactNode
  tone?: 'plain' | 'pine' | 'gold' | 'seal'
}) {
  const tones = {
    plain: 'border-ink/25 text-ink-60',
    pine: 'border-pine text-pine',
    gold: 'border-gold text-ink bg-gold/20',
    seal: 'border-seal text-seal'
  } as const
  return <span className={`tag ${tones[tone]}`}>{children}</span>
}

/* --------------------------------------------------------------------- stat */

export function Stat({
  label,
  value,
  note,
  tone = 'plain'
}: {
  label: string
  value: ReactNode
  note?: ReactNode
  tone?: 'plain' | 'pine' | 'seal'
}) {
  const valueTone = {
    plain: 'text-ink',
    pine: 'text-pine',
    seal: 'text-seal'
  }[tone]
  return (
    <div className="border border-rule bg-white/70 px-3 py-2">
      <p className="label">{label}</p>
      <p className={`numeric text-2xl font-semibold ${valueTone}`}>{value}</p>
      {note ? <p className="mt-0.5 font-sans text-xs text-ink-60">{note}</p> : null}
    </div>
  )
}

/* -------------------------------------------------------------------- barrow */

/** A counted bar with an optional threshold marker. Used for every tally view. */
export function BarRow({
  label,
  sublabel,
  votes,
  share,
  max,
  threshold,
  winner,
  struck,
  tone = 'pine'
}: {
  label: ReactNode
  sublabel?: ReactNode
  votes?: number
  share?: number
  max: number
  threshold?: number | null
  winner?: boolean
  struck?: boolean
  tone?: 'pine' | 'gold'
}) {
  // The bar is scaled in votes; `share` is only the printed percentage.
  const pct = max > 0 ? Math.min(100, ((votes ?? 0) / max) * 100) : 0
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
      <div className={`text-sm ${struck ? 'text-ink-60 line-through' : 'text-ink'}`}>
        <span className="font-semibold">{label}</span>
        {sublabel ? <span className="ml-2 font-sans text-xs text-ink-60">{sublabel}</span> : null}
        {winner ? <span className="ml-2 align-middle"><Tag tone="pine">elected</Tag></span> : null}
      </div>
      <div className="numeric text-right text-sm font-semibold text-ink">
        {votes ?? 0}
        <span className="ml-1 font-normal text-ink-60">({(share ?? 0).toFixed(1)}%)</span>
      </div>
      <div className="col-span-2 relative h-3 w-full border border-rule bg-white">
        <div
          className={`h-full ${tone === 'pine' ? 'bg-pine' : 'bg-gold'}`}
          style={{ width: `${pct}%` }}
        />
        {threshold ? (
          <span
            className="absolute -top-1 h-5 w-0.5 bg-seal"
            style={{ left: `${Math.min(100, (threshold / max) * 100)}%` }}
            aria-hidden="true"
          />
        ) : null}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------- modal */

export function Modal({
  open,
  title,
  onClose,
  children,
  footer
}: {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    // Land on the footer's first control — the safe choice — rather than the
    // dismiss button, so a stray Enter does not commit an irreversible action.
    const focusable =
      box.current?.querySelector<HTMLElement>('footer button') ??
      box.current?.querySelector<HTMLElement>('button, input, [tabindex]')
    focusable?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="no-print fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4">
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Confirmation'}
        className="w-full max-w-lg border border-ink bg-paper shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h2 className="text-lg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="font-sans text-xs uppercase tracking-[0.14em] text-ink-60 hover:text-ink"
          >
            Close
          </button>
        </header>
        <div className="px-4 py-4">{children}</div>
        {footer ? (
          <footer className="flex flex-wrap justify-end gap-2 border-t border-rule px-4 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ spinner */

export function Spinner({ label = 'Working' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 font-sans text-sm text-ink-60">
      <span
        className="h-3 w-3 animate-spin rounded-full border-2 border-ink/20 border-t-pine"
        aria-hidden="true"
      />
      {label}…
    </span>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="border border-dashed border-rule px-4 py-6 text-center font-sans text-sm text-ink-60">
      {children}
    </p>
  )
}
