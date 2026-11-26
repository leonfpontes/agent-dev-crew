// Small building blocks shared by the four screens.
import { useState, type HTMLAttributes, type ReactNode } from 'react'

import { Alert, AlertDescription, AlertTitle, Button, cn } from '@leonfpontes/atlas-ui'

import type { ApiError } from '../lib/api'
import type { DiffLine } from '../lib/diff'
import { Icon } from './icons'

/** Copies text and says so for 1.6 s. */
export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (text: string, key = 'default') => {
    void navigator.clipboard?.writeText(text).catch(() => {})
    setCopied(key)
    window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600)
  }
  return { copied, copy }
}

export function Kbd({ children, onPrimary = false }: { children: ReactNode; onPrimary?: boolean }) {
  return (
    <kbd
      className={cn(
        'ml-1 rounded-sm border px-[5px] py-[3px] font-mono text-xs leading-none font-medium',
        onPrimary
          ? 'border-primary-foreground/40 bg-primary-foreground/18 text-inherit'
          : 'border-border bg-background text-muted-foreground',
      )}
    >
      {children}
    </kbd>
  )
}

/** A dark terminal block with a copy button; `$ ` prompts are dropped from the copied text. */
export function CodeBlock({
  title,
  children,
  copyText,
  copyLabel = 'Copy command',
  className,
  wrap = false,
}: {
  title: string
  children: ReactNode
  copyText?: string
  copyLabel?: string
  className?: string
  wrap?: boolean
}) {
  const { copied, copy } = useCopy()
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg bg-code-bg font-mono text-[13px]/[1.7] text-code-fg',
        className,
      )}
    >
      <div className="flex h-11 items-center gap-3 border-b border-[#2E3542] px-3.5 text-xs text-code-dim">
        <span className="font-sans">{title}</span>
        <span className="flex-1" />
        {copyText !== undefined && (
          <button
            type="button"
            aria-label={copied ? 'Copied' : copyLabel}
            onClick={() => copy(copyText.replace(/^\$ /gm, ''))}
            className={cn(
              '-mr-2.5 inline-flex min-h-(--control) min-w-(--control) cursor-pointer items-center justify-center gap-1.5 rounded-md px-2.5 font-sans text-xs font-medium outline-none hover:text-code-fg focus-visible:ring-[3px] focus-visible:ring-ring/50',
              copied && 'text-code-add',
            )}
          >
            <Icon name={copied ? 'check' : 'copy'} />
            {copied && <span>Copied</span>}
          </button>
        )}
      </div>
      <pre
        tabIndex={0}
        className={cn(
          'm-0 overflow-x-auto px-4 py-3.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          wrap ? 'break-words whitespace-pre-wrap' : 'whitespace-pre',
        )}
      >
        {children}
      </pre>
    </div>
  )
}

/** The page header: title, one line under it, and the page's actions on the right. */
export function PageHeader({
  title,
  lead,
  actions,
  eyebrow,
  titleClass,
}: {
  title: ReactNode
  lead?: ReactNode
  actions?: ReactNode
  eyebrow?: ReactNode
  titleClass?: string
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4 max-[760px]:mb-3">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-2 text-[13px] leading-none font-medium text-muted-foreground">{eyebrow}</p>
        )}
        <h1 className={cn('text-2xl leading-tight font-semibold tracking-[-0.015em]', titleClass)}>
          {title}
        </h1>
        {lead && <div className="mt-1 text-sm text-muted-foreground">{lead}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 max-[760px]:w-full">{actions}</div>}
    </div>
  )
}

/** The strip of key numbers under a page header. */
export function MetaStrip({
  items,
  className,
  ...props
}: { items: { k: ReactNode; v: ReactNode; extra?: ReactNode }[] } & HTMLAttributes<HTMLDListElement>) {
  return (
    <dl
      className={cn(
        'crew-meta flex flex-wrap rounded-lg border bg-card max-[760px]:grid max-[760px]:grid-cols-2',
        className,
      )}
      {...props}
    >
      {items.map((item, i) => (
        <div
          key={i}
          className="grid min-w-0 flex-auto content-start gap-1 border-r px-4 py-3 last:border-r-0 max-[760px]:px-3 max-[760px]:py-2"
        >
          <dt className="text-xs leading-none font-medium text-muted-foreground">{item.k}</dt>
          <dd className="m-0 font-mono text-[15px]/[1.3] font-medium whitespace-nowrap tabular-nums max-[760px]:text-sm max-[760px]:whitespace-normal">
            {item.v}
            {item.extra && <div className="whitespace-normal">{item.extra}</div>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** The small grey text after a number in a meta cell. */
export function Small({ children }: { children: ReactNode }) {
  return (
    <small className="font-sans text-xs/[1.4] font-normal whitespace-normal text-muted-foreground max-[760px]:mt-0.5 max-[760px]:block">
      {' '}
      {children}
    </small>
  )
}

export function SectionHead({ id, title, note }: { id: string; title: ReactNode; note?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      {note && <p className="text-[13px] text-muted-foreground">{note}</p>}
    </div>
  )
}

/** The empty state: what happened, and what to do next. */
export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <div className="grid max-w-[640px] justify-items-start gap-3 rounded-xl border border-dashed px-6 py-12 max-[760px]:px-4 max-[760px]:py-8">
      <span className="text-muted-foreground">{icon}</span>
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="grid w-full max-w-[560px] justify-items-start gap-3 text-sm text-muted-foreground">
        {children}
      </div>
    </div>
  )
}

/** A failed read: the API's sentence and a way to try again. */
export function LoadError({ what, error, onRetry }: { what: string; error: ApiError; onRetry: () => void }) {
  return (
    <Alert variant="destructive" className="max-[760px]:grid-cols-[16px_minmax(0,1fr)]">
      <Icon name="failed" />
      <AlertTitle>{`Couldn't load ${what}`}</AlertTitle>
      <AlertDescription>
        <p>{error.message}</p>
        {error.how && <p>{error.how}</p>}
        <Button variant="outline" className="mt-2" onClick={onRetry}>
          <Icon name="refresh" />
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  )
}

/** Diff lines: one number column, a sign column (meaning without color), then the code. */
export function DiffLines({
  lines,
  label,
  className,
}: {
  lines: DiffLine[]
  label: string
  className?: string
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn(
        'crew-dl relative m-0 overflow-x-auto font-mono text-[13px]/5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset',
        className,
      )}
    >
      {lines.map((l, i) => (
        <span key={i} className={cn('crew-l', `crew-l-${l.type}`)}>
          <span className="crew-ln">{l.n ?? ''}</span>
          <span className="crew-s">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}</span>
          <code>{l.text}</code>
        </span>
      ))}
    </div>
  )
}

/** Inline code with backticks turned into <code>. */
export function Ticks({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('`') && p.endsWith('`') ? (
          <code key={i}>{p.slice(1, -1)}</code>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}
