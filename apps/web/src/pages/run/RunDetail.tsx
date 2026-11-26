// Run detail: the header strip, then (while the gate waits) the gate, then the pipeline over the
// Gantt next to the step panel, the diff with the tests, and the retro. On phones: section tabs
// (Summary · Trace · Diff · Retro) and the step panel in a Sheet.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import {
  Button,
  cn,
  Progress,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Skeleton,
} from '@leonfpontes/atlas-ui'

import { LoadError, MetaStrip, PageHeader, SectionHead, Small } from '../../components/bits'
import { Icon } from '../../components/icons'
import { Status, runLabel, runVisual } from '../../components/Status'
import { getJson, useApi } from '../../lib/api'
import { ago, clock, tokensShort, usd } from '../../lib/format'
import { useIsPhone, useReducedMotion, useTitle } from '../../lib/hooks'
import { mmss, useReplay } from '../../lib/replay'
import { Link, setQuery, useLocation } from '../../lib/router'
import {
  defaultStep,
  MAX_FIX_LOOPS,
  PART_LABEL,
  planFrom,
  runTotal,
  spans,
  statusAt,
  stepName,
  tokensIn,
} from '../../lib/run'
import type { EventRow, Meta, RunDetail, StepRow, Timeline } from '../../lib/types'
import { VariantCell } from '../Runs'
import { GateCard } from './Gate'
import { DiffAndTests, FailureAlert, loopReason, RejectedCard, Retro, SummaryCards } from './Sections'
import { StepPanel } from './StepPanel'
import { Gantt, PipelineStrip, type TraceView } from './Trace'

type Section = 'summary' | 'trace' | 'diff' | 'retro'
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'trace', label: 'Trace' },
  { id: 'diff', label: 'Diff' },
  { id: 'retro', label: 'Retro' },
]

function CostBar({ parts, budget }: { parts: [string, number][]; budget: number }) {
  const label = `${parts.map(([p, c]) => `${p} ${usd(c)}`).join(', ')}, of a ${usd(budget, 2)} budget`
  const shades = [
    'bg-foreground',
    'bg-foreground/78',
    'bg-foreground/58',
    'bg-foreground/40',
    'bg-foreground/24',
    'bg-foreground/60',
  ]
  return (
    <>
      <div
        role="img"
        aria-label={label}
        className="mt-1.5 flex h-1.5 gap-px overflow-hidden rounded-[2px] bg-track"
      >
        {parts.map(([p, c], i) => (
          <i
            key={p}
            className={cn('block h-full', shades[i])}
            style={{ width: `${Math.min(100, (c / budget) * 100)}%` }}
          />
        ))}
      </div>
      <p
        aria-hidden="true"
        className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 font-mono text-xs/4 text-muted-foreground"
      >
        {parts.map(([p, c], i) => (
          <span key={p} className="inline-flex items-center gap-1">
            <i className={cn('inline-block size-2 rounded-[1px]', shades[i])} />
            {p} {(c / 1e6).toFixed(3)}
          </span>
        ))}
      </p>
    </>
  )
}

function SpeedControl({
  speeds,
  value,
  onChange,
}: {
  speeds: number[]
  value: number
  onChange: (s: number) => void
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const d =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0
    if (!d) return
    e.preventDefault()
    const i = (speeds.indexOf(value) + d + speeds.length) % speeds.length
    onChange(speeds[i]!)
    refs.current[i]?.focus()
  }
  return (
    <div
      role="radiogroup"
      aria-label="Speed"
      onKeyDown={onKey}
      className="inline-flex items-center gap-0.5 rounded-lg border bg-muted p-[3px]"
    >
      {speeds.map((s, i) => (
        <button
          key={s}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="radio"
          aria-checked={value === s}
          tabIndex={value === s ? 0 : -1}
          onClick={() => onChange(s)}
          className={cn(
            'inline-flex h-10 min-w-11 cursor-pointer items-center justify-center rounded-md border border-transparent px-3 font-mono text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:h-11',
            value === s && 'border-border bg-background text-foreground shadow-xs',
          )}
        >
          {s}×
        </button>
      ))}
    </div>
  )
}

function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading the run" className="grid gap-4">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-20" />
      <Skeleton className="h-48" />
    </div>
  )
}

export function RunDetailPage({ id, meta }: { id: number; meta: Meta }) {
  const live = meta.mode === 'live'
  const { query } = useLocation()
  const [pollMs, setPollMs] = useState<number | undefined>(undefined)
  const load = useApi<RunDetail>(`/api/runs/${id}`, pollMs)
  const detail = load.data
  const timelineLoad = useApi<Timeline>(`/api/runs/${id}/timeline`, pollMs)
  const timeline = timelineLoad.data
  const planStep = detail?.steps.find((s) => s.kind === 'plan')
  const planEvents = useApi<{ events: EventRow[] }>(
    planStep ? `/api/runs/${id}/steps/${planStep.id}/events` : null,
  )
  const isPhone = useIsPhone()
  const reduced = useReducedMotion()
  const [now, setNow] = useState(() => Date.now())
  const [notice, setNotice] = useState('')
  const [sheet, setSheet] = useState(false)
  const section = (SECTIONS.find((s) => s.id === query.get('section'))?.id ??
    (query.get('step') ? 'trace' : 'summary')) as Section

  useTitle(detail ? `Run #${detail.run.id} · Agent Dev Crew` : 'Run · Agent Dev Crew')

  const open = detail ? detail.run.status === 'running' || detail.run.status === 'waiting' : false
  useEffect(() => {
    setPollMs(live && open ? 2000 : undefined)
    if (!open) return
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [live, open])

  const total = detail ? runTotal(detail, now) : 0
  const replay = useReplay(timeline?.durationMs ?? total, {
    onPlay: () => (timeline ? Promise.resolve() : getJson<Timeline>(`/api/runs/${id}/timeline`)),
  })
  const t = replay.t
  const stepSpans = useMemo(
    () => (detail ? spans(detail.steps, total, timeline) : new Map()),
    [detail, total, timeline],
  )

  // One aria-live line per finished step while the replay plays.
  const finishedCount = useRef(0)
  useEffect(() => {
    if (!detail || t === undefined) {
      finishedCount.current = 0
      return
    }
    const done = detail.steps
      .filter((s) => s.kind !== 'fix-loop')
      .filter((s) => {
        const sp = stepSpans.get(s.id)
        return sp && sp.end <= t && s.status !== 'queued'
      })
      .sort((a, b) => (stepSpans.get(a.id)?.end ?? 0) - (stepSpans.get(b.id)?.end ?? 0))
    if (done.length > finishedCount.current) {
      const last = done.at(-1)!
      setNotice(
        `${stepName(last)} ${last.status.replace('-', ' ')} at ${clock(stepSpans.get(last.id)?.end ?? 0)}.`,
      )
    }
    finishedCount.current = done.length
  }, [t, detail, stepSpans])

  if (load.state === 'loading') return <Loading />
  if (load.state === 'error')
    return (
      <>
        <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted-foreground">
          <Link href="/" className="text-muted-foreground no-underline hover:text-foreground">
            Runs
          </Link>
        </nav>
        <LoadError what={`run #${id}`} error={load.error} onRetry={load.reload} />
      </>
    )

  const d = load.data
  const { run, steps } = d
  const selectedId = Number(query.get('step')) || defaultStep(d, timeline)
  const selected = steps.find((s) => s.id === selectedId) ?? steps[0]
  const parentOf = (s: StepRow) => steps.find((p) => p.id === s.parent_id)
  const gateStep = [...steps].reverse().find((s) => s.kind === 'gate')
  const waiting = run.status === 'waiting' && gateStep?.status === 'waiting'
  const plan = planFrom(d, planEvents.data?.events)
  const spent = steps.reduce((a, s) => a + s.cost_micros, 0)

  // Header numbers; during a replay they count up with the playhead.
  const seen = (s: StepRow) => t === undefined || (stepSpans.get(s.id)?.end ?? Infinity) <= t
  const costShown = steps.filter(seen).reduce((a, s) => a + s.cost_micros, 0)
  const parts = PART_LABEL.map(([key, label]) => {
    const value =
      t === undefined
        ? (d.costByPart[key] ?? 0)
        : steps.filter((s) => seen(s) && (s.role ?? s.kind) === key).reduce((a, s) => a + s.cost_micros, 0)
    return [label, value] as [string, number]
  }).filter(([, v]) => v > 0)
  const gateWait = steps
    .filter((s) => s.kind === 'gate')
    .reduce((a, s) => {
      const sp = stepSpans.get(s.id)
      if (!sp) return a
      const end = t === undefined ? sp.end : Math.min(sp.end, t)
      return a + Math.max(0, end - sp.start)
    }, 0)
  const inTokens = steps.filter(seen).reduce((a, s) => a + tokensIn(s), 0)
  const cached = steps.filter(seen).reduce((a, s) => a + s.cache_read_tokens, 0)
  const outTokens = steps.filter(seen).reduce((a, s) => a + s.output_tokens, 0)
  const pipelineSteps = steps.filter(
    (s) => s.parent_id === null && s.kind !== 'retro' && s.kind !== 'fix-loop',
  )
  const doneSteps = pipelineSteps.filter((s) =>
    ['passed', 'approved', 'failed', 'rejected', 'changes-requested'].includes(
      statusAt(s, stepSpans.get(s.id), t),
    ),
  )
  const overBudget = run.failure_reason === 'over-budget'

  const metaItems = [
    {
      k: 'Status',
      v: (
        <span className="font-sans">
          {t !== undefined ? (
            <Status visual="running" text="Replaying" />
          ) : (
            <Status visual={runVisual(run.status)} text={runLabel(run.status, run.failure_reason)} />
          )}
        </span>
      ),
    },
    {
      k: waiting ? 'Cost so far' : 'Cost',
      v: (
        <>
          {usd(costShown)}
          <Small>
            of {usd(run.budget_micros, 2)} budget{waiting ? ` · ${usd(run.budget_micros - spent)} left` : ''}
          </Small>
        </>
      ),
      extra: overBudget ? (
        <Progress
          value={100}
          variant="destructive"
          className="mt-1.5 h-1"
          aria-label="100% of the budget used"
        />
      ) : parts.length ? (
        <CostBar parts={parts} budget={run.budget_micros} />
      ) : null,
    },
    {
      k: 'Duration',
      v: (
        <>
          {clock(t ?? total)}
          {gateWait > 0 && <Small>{clock(gateWait)} waiting for you</Small>}
        </>
      ),
    },
    {
      k: 'Tokens',
      v: (
        <>
          {tokensShort(inTokens + outTokens)}
          <Small>
            in {tokensShort(inTokens)} ({tokensShort(cached)} cached) · out {tokensShort(outTokens)}
          </Small>
        </>
      ),
    },
    run.tests_total !== null && t === undefined
      ? {
          k: 'Tests',
          v: (
            <>
              {run.tests_passed} / {run.tests_total}
              {run.hidden_total !== null && (
                <Small>
                  + {run.hidden_passed} / {run.hidden_total} hidden
                </Small>
              )}
            </>
          ),
        }
      : {
          k: 'Steps',
          v: (
            <>
              {doneSteps.length} of {pipelineSteps.length}
              {steps.some((s) => s.kind === 'retro') && <Small>Retro runs after</Small>}
            </>
          ),
        },
  ]

  const loops = steps.filter((s) => s.kind === 'fix-loop').length
  const dagNote = waiting
    ? 'Nothing runs after the gate until you decide.'
    : run.variant === 'single-agent'
      ? 'One agent plans, writes code and runs the tests in a single step, with no gate.'
      : loops
        ? `QA failed ${loops === 1 ? 'once' : `${loops} times`}; the fix loop ran ${loops} of ${MAX_FIX_LOOPS} allowed times.${steps.some((s) => s.kind === 'retro') ? ' The Retro runs after the pipeline and blocks nothing.' : ''}`
        : steps.some((s) => s.kind === 'retro')
          ? 'The Retro runs after the pipeline and blocks nothing.'
          : ''

  const select = (stepId: number, how: 'click' | 'focus') => {
    if (stepId !== selected?.id) setQuery('step', String(stepId))
    if (isPhone && how === 'click') setSheet(true)
  }

  const view: TraceView = {
    steps,
    spans: stepSpans,
    total: timeline?.durationMs && t !== undefined ? timeline.durationMs : total,
    t,
    growBars: !reduced,
    selected: selected?.id,
    onSelect: select,
    hideQueued: waiting && t === undefined,
  }

  const replayLength = timeline?.durationMs ?? total
  const replayControl = (
    <div
      role="group"
      aria-label="Replay this run"
      className="inline-flex items-center gap-2 max-[760px]:w-full max-[760px]:[&>button]:flex-1"
      onKeyDown={(e) => {
        if (e.key === ' ' && (e.target as HTMLElement).getAttribute('role') !== 'radio') {
          e.preventDefault()
          replay.toggle()
        }
      }}
    >
      <Button variant="outline" onClick={replay.toggle} aria-keyshortcuts="Space">
        <Icon name={replay.state === 'playing' ? 'pause' : 'play'} />
        {replay.state === 'playing' ? 'Pause' : replay.state === 'paused' ? 'Resume' : 'Replay'}
      </Button>
      {replay.state !== 'idle' && (
        <Button variant="outline" onClick={replay.stop}>
          <Icon name="stop" />
          Stop
        </Button>
      )}
      <SpeedControl
        speeds={meta.replaySpeeds.length ? meta.replaySpeeds : [1, 4]}
        value={replay.speed}
        onChange={replay.setSpeed}
      />
    </div>
  )

  const showSection = (s: Section) => !isPhone || section === s
  const stepPanel = selected ? (
    <StepPanel key={selected.id} runId={run.id} step={selected} parent={parentOf(selected)} />
  ) : null

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link
          href="/"
          className="inline-flex min-h-6 items-center text-muted-foreground no-underline hover:text-foreground max-[760px]:min-h-11"
        >
          Runs
        </Link>
        <span aria-hidden="true">/</span>
        <span className="font-mono text-[13px]">#{run.id}</span>
      </nav>
      <PageHeader
        title={run.title}
        lead={
          <>
            <VariantCell run={run} />
            {run.repo_ref && (
              <>
                {' · '}
                <code className="text-[13px]">{run.repo_ref}</code>
              </>
            )}
            {' · started '}
            {ago(run.started_at, new Date(now))}
          </>
        }
        actions={replayControl}
      />

      {isPhone && (
        <nav aria-label="Run sections" className="sticky top-0 z-[9] -mx-4 mb-3 border-b bg-background px-4">
          <div className="flex gap-4">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-current={section === s.id ? 'true' : undefined}
                onClick={() => setQuery('section', s.id)}
                className={cn(
                  '-mb-px inline-flex h-11 flex-1 cursor-pointer items-center justify-center border-b-2 border-transparent text-sm font-medium text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  section === s.id && 'border-foreground text-foreground',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </nav>
      )}

      <p aria-live="polite" className="sr-only">
        {notice}
      </p>

      {showSection('summary') && (
        <>
          <MetaStrip items={metaItems} />
          {waiting && gateStep && (
            <GateCard
              runId={run.id}
              plan={plan}
              waiting={clock(gateWait)}
              budgetLeft={run.budget_micros - spent}
              revision={steps
                .filter((s) => s.kind === 'gate' && s.status === 'changes-requested')
                .map((s) => ({ comment: s.comment }))}
              onDecided={(decision) => {
                setNotice(`Decision sent: ${decision.replace('-', ' ')}.`)
                load.reload()
              }}
            />
          )}
          {!waiting && (
            <>
              <FailureAlert detail={d} />
              <RejectedCard detail={d} />
              <SummaryCards detail={d} plan={plan} timeline={timeline} />
            </>
          )}
        </>
      )}

      {showSection('trace') && (
        <section aria-labelledby="tr-h" className="mt-6 max-[760px]:mt-0">
          <SectionHead
            id="tr-h"
            title="Pipeline and trace"
            note={
              t !== undefined ? (
                <span className="font-mono tabular-nums">
                  {mmss(t / replay.speed)} of {mmss(replayLength / replay.speed)}{' '}
                  <span className="font-sans text-muted-foreground">
                    · real time {clock(t)} of {clock(replayLength)}
                    {reduced ? ' · reduced motion: the whole run shows at once' : ''}
                  </span>
                </span>
              ) : (
                dagNote || (loopReason(timeline) ?? '')
              )
            }
          />
          <PipelineStrip view={view} />
          <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start gap-4 max-[1100px]:grid-cols-1">
            <Gantt view={view} />
            {!isPhone && stepPanel}
          </div>
        </section>
      )}

      {showSection('diff') && <DiffAndTests detail={d} />}
      {showSection('retro') && (
        <>
          <Retro detail={d} />
          {isPhone && !steps.some((s) => s.kind === 'retro') && (
            <p className="mt-6 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
              {run.variant === 'single-agent'
                ? 'The single agent has no retro.'
                : 'The retro runs after the pipeline.'}
            </p>
          )}
        </>
      )}

      {isPhone && selected && (
        <Sheet open={sheet} onOpenChange={setSheet}>
          <SheetContent
            side="bottom"
            showCloseButton={false}
            className="max-h-[82vh] overflow-auto rounded-t-xl p-0"
          >
            <SheetTitle className="sr-only">{stepName(selected)}</SheetTitle>
            <SheetDescription className="sr-only">The selected step of run #{run.id}</SheetDescription>
            <StepPanel
              key={selected.id}
              runId={run.id}
              step={selected}
              parent={parentOf(selected)}
              onClose={() => setSheet(false)}
              headingId="sheet-step-h"
              className="rounded-none border-0"
            />
          </SheetContent>
        </Sheet>
      )}
      {isPhone && section === 'trace' && selected && !sheet && (
        <p className="mt-3 text-[13px] text-muted-foreground">
          Tap a step to see its prompt, tools, tokens and cost.
        </p>
      )}
    </>
  )
}
