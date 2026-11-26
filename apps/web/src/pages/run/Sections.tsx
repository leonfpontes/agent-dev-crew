// The parts of a finished run: the two answers a reader wants first (gate and result), the failure
// alert, the diff with the test results, and the retro lessons.
import { useState, type ReactNode } from 'react'

import { Alert, AlertDescription, AlertTitle, Badge, cn } from '@leonfpontes/atlas-ui'

import { DiffLines, SectionHead } from '../../components/bits'
import { Icon } from '../../components/icons'
import { Status, runLabel, runVisual } from '../../components/Status'
import { parseDiff, splitPath } from '../../lib/diff'
import { duration, usd } from '../../lib/format'
import { Link } from '../../lib/router'
import { MAX_FIX_LOOPS, stepName } from '../../lib/run'
import type { Lesson, Plan, RunDetail, StepRow, Timeline } from '../../lib/types'

const card = 'rounded-xl border bg-card'

function Kv({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="m-0 grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm max-[760px]:grid-cols-[88px_minmax(0,1fr)]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-[13px] text-muted-foreground">{k}</dt>
          <dd className="m-0">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

const Num = ({ children }: { children: ReactNode }) => (
  <span className="font-mono text-[13px] tabular-nums">{children}</span>
)

export function loopReason(timeline: Timeline | undefined): string | null {
  const p = timeline?.events.find((e) => e.kind === 'loop.started')?.payload as
    { reason?: string } | undefined
  return p?.reason ?? null
}

export function SummaryCards({
  detail,
  plan,
  timeline,
}: {
  detail: RunDetail
  plan: Plan | null
  timeline: Timeline | undefined
}) {
  const { run, steps } = detail
  const gate = [...steps]
    .reverse()
    .find((s) => s.kind === 'gate' && s.status !== 'waiting' && s.status !== 'rejected')
  const files = parseDiff(run.diff)
  const adds = files.reduce((a, f) => a + f.additions, 0)
  const dels = files.reduce((a, f) => a + f.deletions, 0)
  const loops = steps.filter((s) => s.kind === 'fix-loop').length
  const reason = loopReason(timeline)
  const stopped = steps.find((s) => s.status === 'failed' && s.parent_id === null && s.kind !== 'test')
  const byPolicy = gate?.decided_by === 'policy'
  const gateTitle = gate
    ? `Human gate · ${gate.status === 'rejected' ? 'rejected' : gate.status === 'changes-requested' ? 'changes requested' : 'approved'} by ${byPolicy ? 'the policy' : 'you'}`
    : null

  const result: [string, ReactNode][] = []
  if (run.hidden_total !== null)
    result.push([
      'Hidden tests',
      <>
        <Num>
          {run.hidden_passed} / {run.hidden_total}
        </Num>{' '}
        acceptance tests passed <span className="text-muted-foreground">· never shown to the agents</span>
      </>,
    ])
  if (run.tests_total !== null)
    result.push([
      'Repository',
      <>
        <Num>
          {run.tests_passed} / {run.tests_total}
        </Num>{' '}
        tests passed
      </>,
    ])
  if (files.length)
    result.push([
      'Diff',
      <Num>
        {files.length} {files.length === 1 ? 'file' : 'files'} · <span className="text-success">+{adds}</span>{' '}
        <span className="text-destructive">−{dels}</span>
      </Num>,
    ])
  if (run.variant !== 'single-agent' && run.status !== 'rejected' && !stopped)
    result.push([
      'Fix loop',
      loops
        ? `Used ${loops} of ${MAX_FIX_LOOPS}${reason ? ` · ${reason}` : ''}`
        : `None needed · ${MAX_FIX_LOOPS} allowed`,
    ])
  if (stopped) result.push(['Stopped at', `${stepName(stopped)} · ${stopped.summary ?? 'failed'}`])
  if (run.status === 'rejected')
    result.push(['Code', 'None: the run ended at the gate, before the Engineer.'])

  return (
    <div className={cn('mt-4 grid gap-4', gate ? 'grid-cols-2 max-[1100px]:grid-cols-1' : 'grid-cols-1')}>
      {gate && gateTitle && (
        <section
          aria-labelledby="sg-h"
          className={cn(card, 'grid content-start gap-3 px-5 py-4 max-[760px]:p-4')}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="sg-h" className="flex items-center gap-2 text-[15px] font-semibold">
              <Status visual={gate.status === 'changes-requested' ? 'changes' : 'approved'} decorative />
              {gateTitle}
            </h2>
            {gate.duration_ms !== null && (
              <span className="font-mono text-[13px] text-muted-foreground tabular-nums">
                {duration(gate.duration_ms)} after the plan
              </span>
            )}
          </div>
          <Kv
            rows={[
              [
                'Method',
                byPolicy
                  ? 'Logged policy (gate: always-approve)'
                  : run.origin === 'example'
                    ? 'Person, in the demo'
                    : 'Person',
              ],
              ['Reason', gate.comment ? `“${gate.comment}”` : '—'],
            ]}
          />
          {plan && (
            <details>
              <summary className="inline-flex min-h-8 items-center gap-1.5 text-sm font-medium max-[760px]:min-h-11">
                <Icon name="chevron" className="crew-chev" />
                PO plan · {plan.steps.length} steps
              </summary>
              <ol className="mt-1.5 grid list-decimal gap-1 pl-5 text-sm">
                {plan.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </details>
          )}
          {!byPolicy && (
            <p className="text-[13px] text-muted-foreground">
              In evaluation runs, a logged policy (<code>gate: always-approve</code>) approves the gate, never
              a person.
            </p>
          )}
        </section>
      )}
      <section
        aria-labelledby="sr-h"
        className={cn(card, 'grid content-start gap-3 px-5 py-4 max-[760px]:p-4')}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="sr-h" className="flex items-center gap-2 text-[15px] font-semibold">
            <Status visual={runVisual(run.status)} decorative />
            Result · {runLabel(run.status, run.failure_reason).toLowerCase()}
          </h2>
          {files.length > 0 && (
            <a
              href="#diff"
              className="inline-flex min-h-6 items-center gap-1 text-sm text-primary underline underline-offset-[3px] max-[760px]:min-h-11"
            >
              Jump to the diff <Icon name="arrow" size={14} />
            </a>
          )}
        </div>
        <Kv rows={result} />
      </section>
    </div>
  )
}

/** The alert of a failed run: what happened, in numbers, and where to look. */
export function FailureAlert({ detail }: { detail: RunDetail }) {
  const { run, steps } = detail
  if (run.status !== 'failed') return null
  const spent = steps.reduce((a, s) => a + s.cost_micros, 0)
  const loops = steps.filter((s) => s.kind === 'fix-loop').length
  const lastTest = [...steps].reverse().find((s) => s.kind === 'test' && s.status === 'failed')
  const stopped = steps.find((s) => s.status === 'failed' && s.kind !== 'test' && s.kind !== 'fix-loop')
  let title: string
  let text: string
  if (run.failure_reason === 'over-budget') {
    title = `Run #${run.id} stopped: the next call would pass the ${usd(run.budget_micros, 2)} budget`
    text = `${stopped ? stepName(stopped) : 'The run'} reached ${usd(spent)} of ${usd(run.budget_micros, 2)}. The engine stops before the call that would pass the limit, never after. Raise the budget for this run or split the request.`
  } else if (run.failure_reason === 'fix-loops-exhausted') {
    title = `Run #${run.id} failed at QA · fix loop ${loops} of ${MAX_FIX_LOOPS} used`
    text = `${lastTest?.summary ? `The last QA run passed ${lastTest.summary} tests. ` : ''}The run keeps the diff and the trace; open the failed step to see the failing tests.`
  } else {
    title = `Run #${run.id} failed${stopped ? ` at ${stepName(stopped)}` : ''}`
    text = 'The model call failed on the primary and on the fallback model. Open the step to see the error.'
  }
  return (
    <Alert variant="destructive" className="mt-4">
      <Icon name={run.failure_reason === 'over-budget' ? 'dollar' : 'failed'} />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{text}</p>
      </AlertDescription>
    </Alert>
  )
}

export function DiffAndTests({ detail }: { detail: RunDetail }) {
  const { run } = detail
  const files = parseDiff(run.diff)
  const [open, setOpen] = useState<Record<string, boolean>>(() => (files[0] ? { [files[0].path]: true } : {}))
  const [current, setCurrent] = useState(files[0]?.path)
  const adds = files.reduce((a, f) => a + f.additions, 0)
  const dels = files.reduce((a, f) => a + f.deletions, 0)

  const show = (path: string) => {
    setOpen((o) => ({ ...o, [path]: true }))
    setCurrent(path)
    document.getElementById(`file-${path}`)?.scrollIntoView({ block: 'start' })
  }

  return (
    <section id="diff" aria-labelledby="diff-h" className="mt-6 scroll-mt-28">
      <SectionHead
        id="diff-h"
        title="Diff and tests"
        note={
          files.length ? (
            <>
              {files.length} {files.length === 1 ? 'file' : 'files'} ·{' '}
              <span className="font-mono text-success">+{adds}</span>{' '}
              <span className="font-mono text-destructive">−{dels}</span> · open a file to see its changes
            </>
          ) : undefined
        }
      />
      {files.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
          {run.status === 'rejected'
            ? 'No diff: the run ended at the gate, so the Engineer wrote no code.'
            : run.status === 'waiting' || run.status === 'running'
              ? 'No diff yet: the Engineer writes code after you approve the plan.'
              : 'The trace keeps no diff for this run.'}
        </p>
      ) : (
        <div className="grid grid-cols-[300px_minmax(0,1fr)] items-start gap-4 max-[1100px]:grid-cols-1">
          <div className={card}>
            <ul aria-label="Changed files" className="p-2 font-mono text-[13px]">
              {files.map((f) => {
                const { dir, name } = splitPath(f.path)
                return (
                  <li key={f.path}>
                    <a
                      href={`#file-${f.path}`}
                      aria-current={current === f.path ? 'true' : undefined}
                      onClick={(e) => {
                        e.preventDefault()
                        show(f.path)
                      }}
                      className={cn(
                        'flex min-h-11 items-center gap-2 rounded-md px-2 text-foreground no-underline outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        current === f.path && 'bg-sidebar-accent hover:bg-sidebar-accent',
                      )}
                    >
                      <Icon name="file" className="text-muted-foreground" />
                      <span className="grid min-w-0 leading-[1.3]">
                        <span className="truncate text-xs text-muted-foreground">{dir}</span>
                        <b className="truncate font-medium">{name}</b>
                      </span>
                      <span className="flex-1" />
                      {f.additions > 0 && <span className="text-success">+{f.additions}</span>}
                      {f.deletions > 0 && <span className="text-destructive">−{f.deletions}</span>}
                    </a>
                  </li>
                )
              })}
            </ul>
          </div>
          <div className="grid min-w-0 gap-3">
            {files.map((f) => (
              <details
                key={f.path}
                id={`file-${f.path}`}
                open={!!open[f.path]}
                onToggle={(e) => {
                  const isOpen = (e.currentTarget as HTMLDetailsElement).open
                  setOpen((o) => (o[f.path] === isOpen ? o : { ...o, [f.path]: isOpen }))
                }}
                className="scroll-mt-28 overflow-hidden rounded-lg border bg-card"
              >
                <summary className="flex min-h-11 flex-wrap items-center gap-2.5 border-b bg-muted px-3 font-mono text-[13px] font-medium [details:not([open])>&]:border-b-0">
                  <Icon name="chevron" className="crew-chev" />
                  <span className="min-w-0 break-all">{f.path}</span>
                  {f.isNew && <span className="font-sans font-normal text-muted-foreground">· new file</span>}
                  <span className="flex-1" />
                  <span className="text-success">+{f.additions}</span>
                  <span className="text-destructive">−{f.deletions}</span>
                </summary>
                <DiffLines lines={f.lines} label={`Diff of ${f.path}`} />
              </details>
            ))}
            {(run.hidden_total !== null || run.tests_total !== null) && (
              <div className="grid grid-cols-2 gap-3 max-[1300px]:grid-cols-1">
                {run.hidden_total !== null && (
                  <TestsCard
                    icon={<Icon name="gate-ok" className="text-crew" />}
                    title="Hidden acceptance tests"
                    passed={run.hidden_passed ?? 0}
                    total={run.hidden_total}
                    note="Written with the request, run after the diff, never shown to the agents. This is what the Evaluation counts."
                  />
                )}
                {run.tests_total !== null && (
                  <TestsCard
                    icon={<Icon name="term" />}
                    title="Repository tests · vitest run"
                    passed={run.tests_passed ?? 0}
                    total={run.tests_total}
                    note="The suite the crew can see and run, with the tests QA added. The engine's own run decides, not what a model says."
                  />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function TestsCard({
  icon,
  title,
  passed,
  total,
  note,
}: {
  icon: ReactNode
  title: string
  passed: number
  total: number
  note: string
}) {
  const ok = passed === total
  return (
    <div className={card}>
      <div className="flex min-h-11 flex-wrap items-center gap-2.5 rounded-t-xl border-b bg-muted px-3 text-[13px] font-medium">
        {icon}
        <span>{title}</span>
        <span className="flex-1" />
        <Status visual={ok ? 'passed' : 'failed'} text={`${passed} / ${total}`} className="font-mono" />
      </div>
      <p className="px-3 py-2.5 text-[13px] text-muted-foreground">{note}</p>
    </div>
  )
}

function LessonCard({ lesson, steps, runId }: { lesson: Lesson; steps: StepRow[]; runId: number }) {
  const step = steps.find((s) => s.id === lesson.step_id)
  const from = step ? `run #${runId} · ${stepName(step)}, attempt ${step.attempt}` : `run #${runId}`
  return (
    <div className={cn(card, 'grid content-start gap-3 px-5 py-4 max-[760px]:p-4')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {lesson.status === 'proposed' && lesson.playbook_version !== null ? (
          <>
            <Badge className="bg-crew-subtle text-crew">
              <Icon name="gate" size={12} />
              Proposed as playbook v{lesson.playbook_version}
            </Badge>
            <Link
              href="/playbook"
              className="inline-flex min-h-6 items-center gap-1 text-sm text-primary underline underline-offset-[3px] max-[760px]:min-h-11"
            >
              Review the change <Icon name="arrow" size={14} />
            </Link>
          </>
        ) : lesson.status === 'duplicate' ? (
          <Status visual="skipped" text={`Dropped · duplicate of v${lesson.duplicate_of ?? '?'}`} />
        ) : lesson.status === 'accepted' ? (
          <Status visual="approved" text={`In playbook v${lesson.playbook_version ?? '?'}`} />
        ) : (
          <Status visual="rejected" text="Rejected" />
        )}
      </div>
      <p className="text-[13px] text-muted-foreground">
        From{' '}
        {step ? (
          <a
            href={`?step=${step.id}`}
            className="inline-flex min-h-6 items-center text-primary underline underline-offset-[3px] max-[760px]:min-h-11"
          >
            {from}
          </a>
        ) : (
          from
        )}
      </p>
      <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <dt className="text-xs/[22px] font-medium text-muted-foreground">Error</dt>
        <dd className="m-0">{lesson.error}</dd>
        <dt className="text-xs/[22px] font-medium text-muted-foreground">Cause</dt>
        <dd className="m-0">{lesson.cause}</dd>
        <dt className="text-xs/[22px] font-medium text-muted-foreground">Rule</dt>
        <dd className="m-0">
          {lesson.status === 'duplicate' ? (
            <>
              {lesson.rule} <span className="text-muted-foreground">Already in v{lesson.duplicate_of}.</span>
            </>
          ) : (
            <strong className="font-semibold">{lesson.rule}</strong>
          )}
        </dd>
      </dl>
    </div>
  )
}

export function Retro({ detail }: { detail: RunDetail }) {
  const { lessons, steps, run } = detail
  const retro = steps.find((s) => s.kind === 'retro')
  if (!retro) return null
  return (
    <section aria-labelledby="re-h" className="mt-6">
      <SectionHead
        id="re-h"
        title={`Retro · ${lessons.length} ${lessons.length === 1 ? 'lesson' : 'lessons'}`}
        note="Lessons enter the playbook only if you approve them"
      />
      {lessons.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
          {retro.status === 'passed'
            ? `The retro found nothing new to learn from run #${run.id}${retro.summary ? ` (${retro.summary})` : ''}.`
            : retro.status === 'skipped'
              ? 'The retro did not run: the run stopped before the pipeline finished.'
              : 'The retro runs after the pipeline and blocks nothing.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 max-[1100px]:grid-cols-1">
          {lessons.map((l) => (
            <LessonCard key={l.id} lesson={l} steps={steps} runId={run.id} />
          ))}
        </div>
      )}
    </section>
  )
}

export function RejectedCard({ detail }: { detail: RunDetail }) {
  const gate = detail.steps.find((s) => s.kind === 'gate' && s.status === 'rejected')
  if (!gate) return null
  return (
    <section aria-labelledby="rj-h" className="mt-4 rounded-xl border border-crew-line bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 max-[760px]:px-4">
        <h2 id="rj-h" className="flex items-center gap-2 text-base font-semibold">
          <Icon name="gate-no" className="text-crew" />
          You rejected the PO plan · run #{detail.run.id}
        </h2>
        {gate.duration_ms !== null && (
          <span className="font-mono text-[13px] text-muted-foreground tabular-nums">
            {duration(gate.duration_ms)} after the plan
          </span>
        )}
      </div>
      <div className="grid gap-3 px-5 pt-4 pb-5 max-[760px]:px-4">
        <p className="text-sm">{gate.comment ? `“${gate.comment}”` : 'No reason recorded.'}</p>
        <p className="text-[13px] text-muted-foreground">
          The run ends at the gate. The Engineer wrote no code; the run keeps your reason.
        </p>
      </div>
    </section>
  )
}
