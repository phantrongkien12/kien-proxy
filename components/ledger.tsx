import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('panel', className)}>{children}</section>
}

export function PanelHead({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div className="flex items-baseline gap-2.5">
        <h2 className="text-[13px] font-medium tracking-tight">{title}</h2>
        {hint ? <span className="eyebrow">{hint}</span> : null}
      </div>
      {action}
    </header>
  )
}

export function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string
  value: string
  hint?: string
  accent?: boolean
}) {
  return (
    <div className="panel px-4 py-3.5">
      <p className="eyebrow">{label}</p>
      <p className={cn('num mt-2 text-[26px] leading-none tracking-tight', accent && 'text-destructive')}>{value}</p>
      {hint ? <p className="mt-2 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function Badge({
  children,
  tone = 'plain',
  className,
}: {
  children: ReactNode
  tone?: 'plain' | 'solid' | 'danger'
  className?: string
}) {
  return (
    <span
      className={cn(
        'badge',
        tone === 'solid' && 'badge-solid',
        tone === 'danger' && 'badge-danger',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('block', className)}>
      <span className="eyebrow mb-1.5 block">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="text-[13px] font-medium">{title}</p>
      <p className="max-w-sm text-[12px] leading-relaxed text-muted-foreground">{body}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-3 animate-spin rounded-full border border-current border-t-transparent',
        className,
      )}
    />
  )
}

export function PageHead({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-2 text-[22px] font-medium tracking-tight text-balance">{title}</h1>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted-foreground text-pretty">
          {description}
        </p>
      </div>
      {action}
    </div>
  )
}
