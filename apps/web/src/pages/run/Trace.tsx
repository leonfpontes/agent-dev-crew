// The pipeline strip (ref. GitHub Actions run graph) over the Gantt of the steps (ref. Langfuse,
// Inngest). A row or a node selects the step shown in the panel next to it.
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { cn } from '@leonfpontes/atlas-ui'

import { Icon } from '../../components/icons'
import { Status, stepVisual, visualLabel } from '../../components/Status'
import { duration, usd } from '../../lib/format'
import {
  barKind,
  MAX_FIX_LOOPS,
  pipeline,
  statusAt,
  stepName,
  stepTree,
  type PipeNode,
  type Span,
} from '../../lib/run'
import type { StepRow } from '../../lib/types'

export interface TraceView {
  steps: StepRow[]
  spans: Map<number, Span>
  total: number
  /** Replay time, or undefined for the full trace. */
  t: number | undefined
  /** Under reduced motion the bars stay whole; only the counters and statuses move. */
  growBars: boolean
  selected: number | undefined
  onSelect: (id: number, how: 'click' | 'focus') => void
  hideQueued: boolean
}

const lengthAt = (view: TraceView, s: StepRow) => {
  const span = view.spans.get(s.id)
  if (!span) return s.duration_ms
  const end = view.t === undefined ? span.end : Math.min(span.end, view.t)
  return Math.max(0, end - span.start)
}

function NodeCard({
  node,
  current,
  onSelect,
  refFn,
}: {
  node: PipeNode
  current: boolean
  onSelect: () => void
  refFn?: (el: HTMLButtonElement | null) => void
}) {
  const gate = node.key === 'gate'
  const queued = node.visual === 'queued' || node.visual === 'skipped'
  const time = node.durationMs === null ? '—' : duration(node.durationMs)
  const cost = node.costMicros ? usd(node.costMicros) : '—'
  return (
    <button
      ref={refFn}
      type="button"
      onClick={onSelect}
      aria-current={current ? 'true' : undefined}
      aria-label={`${node.label}, ${visualLabel(node.visual)}, ${time}, ${cost === '—' ? 'no cost' : cost}`}
      className={cn(
        'grid min-w-[112px] flex-[1_1_112px] cursor-pointer gap-1 rounded-lg border bg-background px-2.5 py-2 text-left outline-none hover:border-muted-foreground focus-visible:relative focus-visible:z-[1] focus-visible:ring-[3px] focus-visible:ring-ring/50',
        gate && 'border-crew-line',
        queued && 'border-dashed text-muted-foreground',
        node.key === 'retro' && 'border-dashed bg-transparent',
        current &&
          (gate ? 'shadow-[0_0_0_1px_var(--crew)]' : 'border-primary shadow-[0_0_0_1px_var(--primary)]'),
      )}
    >
      <span className="flex items-center gap-1.5 text-[13px] leading-tight font-medium">
        <Status visual={node.visual} label={false} />
        {node.label}
      </span>
      <span
        className="flex justify-between gap-2 font-mono text-xs text-muted-foreground tabular-nums"
        aria-hidden="true"
      >
        <span>{time}</span>
        <span>{cost}</span>
      </span>
    </button>
  )
}

export function PipelineStrip({ view }: { view: TraceView }) {
  const statusOf = (s: StepRow) => statusAt(s, view.spans.get(s.id), view.t)
  const { nodes, retro, loops } = pipeline(view.steps, statusOf, (s) => lengthAt(view, s))
  const row = useRef<HTMLDivElement>(null)
  const refs = useRef<Partial<Record<PipeNode['key'], HTMLButtonElement | null>>>({})
  const [loop, setLoop] = useState<{ left: number; width: number } | null>(null)
  const pick = (n: PipeNode) => {
    const last = [...n.steps].reverse().find((s) => statusOf(s) !== 'queued') ?? n.steps[0]
    if (last) view.onSelect(last.id, 'click')
  }

  useLayoutEffect(() => {
    const place = () => {
      const a = refs.current.engineer
      const b = refs.current.qa
      const box = row.current
      if (!loops || !a || !b || !box) return setLoop(null)
      const o = box.getBoundingClientRect()
      const ra = a.getBoundingClientRect()
      const rb = b.getBoundingClientRect()
      const left = ra.left + ra.width / 2 - o.left + box.scrollLeft
      setLoop({ left, width: rb.left + rb.width / 2 - ra.left - ra.width / 2 })
    }
    place()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    if (row.current) ro?.observe(row.current)
    return () => ro?.disconnect()
  }, [loops, nodes.length])

  const isCurrent = (n: PipeNode) => n.steps.some((s) => s.id === view.selected)

  return (
    <div className="mb-3 rounded-xl border bg-card max-[760px]:hidden">
      <div className="overflow-x-auto px-4 pt-3 pb-8">
        <div ref={row} className="relative flex min-w-max items-center">
          {nodes.map((n, i) => (
            <span key={n.key} className="contents">
              {i > 0 && <span className="crew-edge" aria-hidden="true" />}
              <NodeCard
                node={n}
                current={isCurrent(n)}
                onSelect={() => pick(n)}
                refFn={(el) => {
                  refs.current[n.key] = el
                }}
              />
            </span>
          ))}
          {retro && (
            <>
              <span className="crew-edge crew-edge-after relative" aria-hidden="true">
                <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs text-muted-foreground">
                  after
                </span>
              </span>
              <NodeCard node={retro} current={isCurrent(retro)} onSelect={() => pick(retro)} />
            </>
          )}
          {loop && (
            <span
              className="crew-loop"
              aria-hidden="true"
              style={{ top: 'calc(100% + 6px)', left: loop.left, width: loop.width }}
            />
          )}
        </div>
        <p className="sr-only">
          {loops > 0 &&
            `QA failed and sent the work back to the Engineer: ${loops} fix ${loops === 1 ? 'loop' : 'loops'} of ${MAX_FIX_LOOPS}. `}
          {retro && 'The Retro runs after the pipeline.'}
        </p>
      </div>
    </div>
  )
}

const GRID =
  'grid grid-cols-[20px_minmax(0,1fr)_minmax(120px,1.3fr)_58px] items-center gap-2.5 px-4 max-[760px]:grid-cols-[20px_minmax(0,1fr)_64px_52px] max-[760px]:px-3'

export function Gantt({ view }: { view: TraceView }) {
  const tree = stepTree(view.steps)
  const pct = (ms: number) => (view.total ? (ms / view.total) * 100 : 0)
  const ticks: number[] = []
  for (let m = 0; m * 60_000 < view.total; m++) ticks.push(m * 60_000)
  const list = useRef<HTMLDivElement>(null)

  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 }
    const d = keys[e.key]
    if (!d) return
    const rows = [...(list.current?.querySelectorAll<HTMLButtonElement>('button[data-step]') ?? [])]
    const i = rows.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    e.preventDefault()
    rows[Math.max(0, Math.min(rows.length - 1, i + d))]?.focus()
  }

  const bar = (s: StepRow, status: StepRow['status']): ReactNode => {
    const span = view.spans.get(s.id)
    const kind = barKind(s, status)
    if (!span || !kind) return null
    const end = view.t !== undefined && view.growBars ? Math.min(span.end, view.t) : span.end
    return (
      <i
        className={`crew-bar crew-bar-${kind}`}
        style={{
          left: `${pct(span.start)}%`,
          width: `${Math.max(0.6, pct(Math.max(0, end - span.start)))}%`,
        }}
      />
    )
  }

  const rowFor = (s: StepRow, inner: boolean, sub: string | null) => {
    const status = statusAt(s, view.spans.get(s.id), view.t)
    const len = lengthAt(view, s)
    const cost = status === 'queued' || !s.cost_micros ? '—' : usd(s.cost_micros)
    const notYet = status === 'queued' && view.t !== undefined
    return (
      <button
        type="button"
        data-step={s.id}
        aria-current={view.selected === s.id ? 'true' : undefined}
        aria-label={`${stepName(s)}, ${visualLabel(stepVisual(status))}, ${len === null ? 'not started' : duration(len)}, cost ${cost === '—' ? 'none' : cost}`}
        onClick={() => view.onSelect(s.id, 'click')}
        onFocus={() => view.onSelect(s.id, 'focus')}
        className={cn(
          GRID,
          'min-h-11 w-full cursor-pointer text-left text-sm outline-none hover:bg-muted/60 focus-visible:relative focus-visible:z-[1] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset',
          view.selected === s.id && 'bg-sidebar-accent hover:bg-sidebar-accent',
          inner && 'pl-9 max-[760px]:pl-6',
          notYet && 'opacity-50',
        )}
      >
        <Status visual={stepVisual(status)} label={false} />
        <span
          className={cn(
            'min-w-0 truncate max-[760px]:whitespace-normal',
            inner && 'text-[13px]',
            status === 'queued' && 'text-muted-foreground',
          )}
        >
          {stepName(s)}
          {sub && <small className="ml-1.5 text-xs text-muted-foreground">{sub}</small>}
        </span>
        <span
          className="crew-track max-[760px]:hidden"
          style={{ ['--tick' as string]: `${pct(60_000)}%` }}
          aria-hidden="true"
        >
          {bar(s, status)}
          {view.t !== undefined && <span className="crew-playhead" style={{ left: `${pct(view.t)}%` }} />}
        </span>
        <span
          className="hidden text-right font-mono text-[13px] text-muted-foreground tabular-nums max-[760px]:block"
          aria-hidden="true"
        >
          {len === null ? '—' : duration(len)}
        </span>
        <span className="text-right font-mono text-[13px] tabular-nums" aria-hidden="true">
          {cost}
        </span>
      </button>
    )
  }

  const subOf = (s: StepRow) =>
    s.kind === 'gate'
      ? s.status === 'waiting'
        ? 'waiting'
        : (s.summary?.split(' ')[0] ?? null)
      : s.kind === 'retro'
        ? 'after the run'
        : s.summary
  const visible = tree.filter(({ step }) => !(view.hideQueued && step.status === 'queued'))
  const hasLoop = tree.some(({ step }) => step.kind === 'fix-loop')
  const hasRetro = tree.some(({ step }) => step.kind === 'retro' && step.status === 'passed')
  const hasFail = view.steps.some((s) => s.status === 'failed')

  return (
    <div className="rounded-xl border bg-card min-[1101px]:sticky min-[1101px]:top-[72px]">
      <div className={cn(GRID, 'items-end border-b py-2.5 text-xs font-medium text-muted-foreground')}>
        <span />
        <span>Step</span>
        <span className="relative h-4 max-[760px]:hidden" aria-hidden="true">
          {ticks.map((t, i) => (
            <span
              key={t}
              className={cn('absolute top-0 font-mono text-xs', i > 0 && '-translate-x-1/2')}
              style={{ left: `${pct(t)}%` }}
            >
              {t ? `${t / 60_000}m` : '0'}
            </span>
          ))}
        </span>
        <span className="hidden text-right max-[760px]:block">Time</span>
        <span className="text-right">Cost</span>
      </div>
      <div ref={list} onKeyDown={move} className="py-1">
        {visible.map(({ step, children }) =>
          children.length ? (
            <details key={step.id} open>
              <summary className="list-none">
                <span className={cn(GRID, 'min-h-11 text-sm font-medium')}>
                  <Status
                    visual={stepVisual(statusAt(step, view.spans.get(step.id), view.t))}
                    label={false}
                  />
                  <span className="min-w-0 truncate">
                    <Icon name="chevron" size={14} className="crew-chev mr-1 inline align-[-2px]" />
                    {stepName(step)}
                    <small className="ml-1.5 text-xs font-normal text-muted-foreground">
                      of {MAX_FIX_LOOPS}
                    </small>
                  </span>
                  <span
                    className="crew-track max-[760px]:hidden"
                    style={{ ['--tick' as string]: `${pct(60_000)}%` }}
                    aria-hidden="true"
                  >
                    {bar(step, statusAt(step, view.spans.get(step.id), view.t))}
                  </span>
                  <span className="hidden text-right font-mono text-[13px] text-muted-foreground tabular-nums max-[760px]:block">
                    {lengthAt(view, step) === null ? '—' : duration(lengthAt(view, step) ?? 0)}
                  </span>
                  <span className="text-right font-mono text-[13px] tabular-nums">
                    {usd(children.reduce((a, c) => a + c.cost_micros, 0))}
                  </span>
                </span>
              </summary>
              {children.map((c) => (
                <div key={c.id}>{rowFor(c, true, c.summary)}</div>
              ))}
            </details>
          ) : (
            <div key={step.id}>{rowFor(step, false, subOf(step))}</div>
          ),
        )}
      </div>
      <p className="flex flex-wrap gap-x-3.5 gap-y-1 border-t px-4 pt-2.5 pb-3.5 text-xs text-muted-foreground max-[760px]:hidden">
        <span className="inline-flex items-center gap-1.5">
          <i className="crew-sw crew-bar-p" />
          model step · solid
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="crew-sw crew-bar-g" />
          waiting at the human gate · hatched
        </span>
        {hasFail && (
          <span className="inline-flex items-center gap-1.5">
            <i className="crew-sw crew-bar-f" />
            failed · solid
          </span>
        )}
        {hasLoop && (
          <span className="inline-flex items-center gap-1.5">
            <i className="crew-sw crew-bar-l" />
            fix loop · dashed
          </span>
        )}
        {hasRetro && (
          <span className="inline-flex items-center gap-1.5">
            <i className="crew-sw crew-bar-r" />
            after the run · dashed
          </span>
        )}
        <span>Lines every minute · total {duration(view.total)}</span>
      </p>
    </div>
  )
}
