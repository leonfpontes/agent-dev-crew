// How it works: the public page. The claim, then a real run summary instead of an illustration,
// the pipeline with its roles, the trace, the playbook, the evaluation and the quickstart.
// Every number comes from the API (the replay data and the scoreboard).
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import {
  Badge,
  Button,
  cn,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@leonfpontes/atlas-ui'

import { CodeBlock, DiffLines } from '../components/bits'
import { Icon, Mark } from '../components/icons'
import { RunCard } from '../components/RunCard'
import { Status } from '../components/Status'
import { useApi } from '../lib/api'
import { parseHunks } from '../lib/diff'
import { durationFixed, percent, sdPoints, tokensLong, usd } from '../lib/format'
import type { Theme } from '../lib/hooks'
import { useTitle } from '../lib/hooks'
import {
  ATLAS_REPOSITORY,
  BUDGET_MICROS,
  CLONE,
  GITHUB_PROFILE,
  LINKEDIN,
  MAX_FIX_LOOPS,
  MODELS,
  REPOSITORY,
  ROLES,
} from '../lib/landing'
import { Link } from '../lib/router'
import { toolArg, toolCalls } from '../lib/run'
import { PHRASE, SHOWCASE_RUN, shareRun, SUB } from '../lib/share'
import {
  leadSet,
  scoreSets,
  SET_LABEL,
  setHeadline,
  type ScoreSet,
  type SetVariant,
} from '../lib/scoreboards'
import type { EventRow, PlaybookVersion, RunDetail, Variant } from '../lib/types'
import { VARIANTS } from '../lib/types'
import { VARIANT_LABEL } from './Runs'

const WRAP = 'mx-auto max-w-[1200px] px-6 max-[760px]:px-4'

export function SiteHeader({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const nav = [
    ['How it works', '#top'],
    ['Trace', '#trace'],
    ['Evaluation', '#eval'],
    ['Quickstart', '#quickstart'],
  ]
  return (
    <header className="border-b bg-background">
      <div className={cn(WRAP, 'flex h-16 items-center gap-7 max-[760px]:gap-2')}>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-2.5 text-[15px] font-semibold whitespace-nowrap text-foreground no-underline"
        >
          <Mark size={24} />
          Agent Dev Crew
        </Link>
        <nav aria-label="Main" className="flex gap-1 max-[900px]:hidden">
          {nav.map(([label, href], i) => (
            <a
              key={href}
              href={href}
              aria-current={i === 0 ? 'page' : undefined}
              className={cn(
                'inline-flex h-16 items-center border-b-2 border-transparent px-2.5 text-[15px] text-muted-foreground no-underline outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
                i === 0 && 'border-foreground font-medium text-foreground',
              )}
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex gap-2">
          <Button asChild variant="outline" className="max-[900px]:hidden">
            <a href={REPOSITORY}>
              <Icon name="github" />
              GitHub
            </a>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            onClick={onToggleTheme}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </Button>
          <Button asChild>
            <Link href="/runs">Open the demo</Link>
          </Button>
        </div>
      </div>
    </header>
  )
}

function SecHead({
  eyebrow,
  title,
  id,
  children,
}: {
  eyebrow: string
  title: string
  id: string
  children: ReactNode
}) {
  return (
    <div className="mb-7 max-w-[720px]">
      <p className="text-[13px] leading-none font-medium text-muted-foreground">{eyebrow}</p>
      <h2
        id={id}
        className="my-2.5 text-[28px] leading-[1.2] font-semibold tracking-[-0.02em] max-[600px]:text-2xl"
      >
        {title}
      </h2>
      <div className="text-muted-foreground">{children}</div>
    </div>
  )
}

function Hero({ run, sets }: { run?: RunDetail; sets: ScoreSet[] }) {
  const lead = leadSet(sets)
  const sentence = lead ? setHeadline(lead) : null
  return (
    <div className="border-b py-16 max-[600px]:py-9">
      <div
        className={cn(
          WRAP,
          'grid grid-cols-[minmax(0,6fr)_minmax(0,5fr)] items-center gap-12 max-[1100px]:grid-cols-1 max-[1100px]:gap-9',
        )}
      >
        <div>
          <p className="text-[13px] leading-none font-medium text-muted-foreground">
            Agent Dev Crew · open source · MIT
          </p>
          <h1 className="mt-3.5 mb-4 text-[44px] leading-[1.1] font-semibold tracking-[-0.03em] max-[600px]:text-[32px]">
            {PHRASE}
          </h1>
          <p className="max-w-[540px] text-lg text-muted-foreground max-[600px]:text-base">{SUB}</p>
          <CodeBlock
            className="mt-7 max-w-[520px]"
            title="Replay demo · no API key"
            copyText={`${CLONE}\n$ pnpm demo`}
            copyLabel="Copy commands"
            wrap
          >
            {`${CLONE}\n$ pnpm demo`}
          </CodeBlock>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/runs">Open the demo</Link>
            </Button>
            <Button asChild variant="outline">
              <a href="#quickstart">Quickstart</a>
            </Button>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2.5 text-sm text-muted-foreground">
            {sentence ? <span>{sentence}</span> : <Skeleton className="h-4 w-80" />}
            {sets.length > 1 && (
              <a
                href="#eval"
                className="inline-flex min-h-6 items-center text-primary underline underline-offset-[3px] max-[760px]:min-h-11"
              >
                Both sets
              </a>
            )}
          </div>
        </div>
        {run ? (
          <Link
            href={`/runs/${run.run.id}`}
            className="block rounded-xl text-foreground no-underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <RunCard run={shareRun(run)} tag="example run" />
          </Link>
        ) : (
          <Skeleton className="h-[420px] rounded-xl" />
        )}
      </div>
    </div>
  )
}

const NODES: { name: string; does: string; gate?: boolean }[] = [
  { name: 'PO', does: 'plan + acceptance criteria' },
  { name: 'Human gate', does: 'you approve the plan', gate: true },
  { name: 'Engineer', does: 'writes the code' },
  { name: 'Reviewer', does: 'reviews the diff' },
  { name: 'QA', does: 'runs the tests' },
  { name: 'Retro', does: 'lessons → playbook' },
]

function PipelineDiagram() {
  const row = useRef<HTMLDivElement>(null)
  const [loop, setLoop] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const place = () => {
      const box = row.current
      const nodes = box?.querySelectorAll<HTMLElement>('[data-node]')
      const a = nodes?.[2]
      const b = nodes?.[4]
      if (!box || !a || !b) return
      const o = box.getBoundingClientRect()
      const ra = a.getBoundingClientRect()
      const rb = b.getBoundingClientRect()
      setLoop({
        left: ra.left + ra.width / 2 - o.left,
        width: rb.left + rb.width / 2 - ra.left - ra.width / 2,
      })
    }
    place()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    if (row.current) ro?.observe(row.current)
    return () => ro?.disconnect()
  }, [])
  return (
    <div className="mb-5 rounded-xl border bg-card">
      <div className="overflow-x-auto px-5 pt-6 pb-16 max-[760px]:hidden">
        <div ref={row} className="relative flex min-w-max items-center">
          {NODES.map((n, i) => (
            <span key={n.name} className="contents">
              {i > 0 && <span className="crew-edge" aria-hidden="true" />}
              <span
                data-node
                className={cn(
                  'grid min-w-[124px] flex-[1_1_124px] gap-1 rounded-lg border bg-background px-3 py-2.5',
                  n.gate && 'border-crew-line',
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {n.gate && <Status visual="waiting" label={false} />}
                  {n.name}
                </span>
                <span className="text-xs text-muted-foreground">{n.does}</span>
              </span>
            </span>
          ))}
          {loop && (
            <span
              className="crew-loop"
              aria-hidden="true"
              style={{ top: 'calc(100% + 6px)', left: loop.left, width: loop.width }}
            >
              <span className="absolute -bottom-2.5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 bg-card px-2 text-xs leading-[18px] font-medium whitespace-nowrap text-warning">
                <Icon name="loop" size={14} />
                Fix loop · at most {MAX_FIX_LOOPS}
              </span>
            </span>
          )}
        </div>
      </div>
      <ol className="hidden py-2 max-[760px]:block">
        {[
          ['PO', 'plan + acceptance criteria'],
          ['Human gate', 'you approve, ask for changes or reject the plan'],
          ['Engineer', 'writes the code'],
          ['Reviewer', 'reviews the diff'],
          ['QA', `runs the tests · back to the Engineer at most ${MAX_FIX_LOOPS} times`],
          ['Retro', 'lessons → playbook proposal'],
        ].map(([name, does]) => (
          <li key={name} className="grid min-h-12 grid-cols-[24px_minmax(0,1fr)] items-center gap-2.5 px-4">
            {name === 'Human gate' ? (
              <Status visual="waiting" label={false} />
            ) : (
              <span aria-hidden="true" className="ml-2 h-full border-l" />
            )}
            <span className="text-sm font-medium">
              {name}
              <small className="block text-xs font-normal text-muted-foreground">{does}</small>
            </span>
          </li>
        ))}
      </ol>
      <p className="sr-only">
        The pipeline runs PO, then the human gate, Engineer, Reviewer and QA; QA can send the work back to the
        Engineer at most {MAX_FIX_LOOPS} times. The Retro runs after the pipeline.
      </p>
    </div>
  )
}

function Pipeline() {
  return (
    <section aria-labelledby="pipeline-h" id="pipeline" className="scroll-mt-4 border-b py-14">
      <div className={WRAP}>
        <SecHead eyebrow="Pipeline" title="Four roles, one gate, a bounded fix loop" id="pipeline-h">
          Each role has its prompt in a file, the smallest set of tools and its own model with a fallback. The
          Engineer writes code only after you approve the plan; QA can send the work back to the Engineer at
          most {MAX_FIX_LOOPS === 2 ? 'twice' : `${MAX_FIX_LOOPS} times`}.
        </SecHead>
        <PipelineDiagram />
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table className="max-[760px]:block">
            <TableHeader className="max-[760px]:hidden">
              <TableRow className="hover:bg-transparent">
                <TableHead>Role</TableHead>
                <TableHead>Does</TableHead>
                <TableHead>Tools</TableHead>
                <TableHead>Model · fallback</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="max-[760px]:block">
              {ROLES.map((r) => (
                <TableRow key={r.role} className="max-[760px]:grid max-[760px]:gap-0.5 max-[760px]:p-3">
                  <TableCell className="font-medium max-[760px]:h-auto max-[760px]:p-0">{r.role}</TableCell>
                  <TableCell className="whitespace-normal max-[760px]:h-auto max-[760px]:p-0">
                    {r.does}
                  </TableCell>
                  <TableCell className="whitespace-normal max-[760px]:h-auto max-[760px]:p-0">
                    {r.tools.map((t, i) => (
                      <span key={t}>
                        {i > 0 && ' '}
                        <code className="text-[13px]">{t}</code>
                      </span>
                    ))}
                  </TableCell>
                  <TableCell className="font-mono text-[13px] whitespace-normal tabular-nums max-[760px]:h-auto max-[760px]:p-0">
                    {MODELS.primary} · {MODELS.fallback}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  )
}

/** " · started after QA failed 1 of 24 tests", from the failed QA step's "23 / 24". */
function failedNote(summary: string | null | undefined): string | null {
  const m = /(\d+) \/ (\d+)/.exec(summary ?? '')
  if (!m) return null
  const [passed, total] = [Number(m[1]), Number(m[2])]
  return ` · started after QA failed ${total - passed} of ${total} tests`
}

function TraceSection({ run }: { run?: RunDetail }) {
  const fix = run?.steps.find((s) => s.kind === 'fix')
  const loop = run?.steps.find((s) => s.id === fix?.parent_id)
  const events = useApi<{ events: EventRow[] }>(
    run && fix ? `/api/runs/${run.run.id}/steps/${fix.id}/events` : null,
  )
  const calls = toolCalls(events.data?.events ?? [])
  const reason = events.data?.events.find((e) => e.kind === 'loop.started')?.payload as
    { reason?: string } | undefined
  const failedTest = run?.steps.find((s) => s.kind === 'test' && s.status === 'failed')
  return (
    <section aria-labelledby="trace-h" id="trace" className="scroll-mt-4 border-b py-14">
      <div
        className={cn(
          WRAP,
          'grid grid-cols-[minmax(0,4fr)_minmax(0,7fr)] items-start gap-12 max-[1100px]:grid-cols-1 max-[1100px]:gap-6',
        )}
      >
        <div>
          <SecHead eyebrow="Trace" title="Explain any run in under a minute" id="trace-h">
            Every step stores its prompt, response, tool calls, tokens, cost, time, model and attempts in
            SQLite. The run page reads it back: the pipeline, a timeline, the step you pick and the diff with
            its tests.
          </SecHead>
          <Link
            href={`/runs/${SHOWCASE_RUN}${fix ? `?step=${fix.id}` : ''}`}
            className="inline-flex min-h-6 items-center gap-1 text-primary underline underline-offset-[3px] max-[760px]:min-h-11"
          >
            Open run #{SHOWCASE_RUN} <Icon name="arrow" size={14} />
          </Link>
        </div>
        {fix ? (
          <div className="rounded-xl border bg-card">
            <div className="px-5 pt-4 max-[760px]:px-4">
              <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
                <Status visual="passed" decorative />
                Engineer · fix
                {loop?.loop_index && (
                  <Badge variant="warning">
                    Fix loop {loop.loop_index} of {MAX_FIX_LOOPS}
                  </Badge>
                )}
              </h3>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Attempt {fix.attempt}
                {failedNote(failedTest?.summary) ?? (reason?.reason ? ` · ${reason.reason}` : '')}
              </p>
            </div>
            <dl className="mx-5 mt-4 grid grid-cols-4 rounded-lg border max-[760px]:mx-4 max-[760px]:grid-cols-2 [&>div]:grid [&>div]:gap-1 [&>div]:border-r [&>div]:px-3 [&>div]:py-2.5 [&>div:last-child]:border-r-0 max-[760px]:[&>div:nth-child(2)]:border-r-0 max-[760px]:[&>div:nth-child(-n+2)]:border-b">
              {[
                ['Model', fix.model ?? '—'],
                [
                  'Tokens',
                  `${tokensLong(fix.input_tokens + fix.cache_read_tokens + fix.cache_write_tokens)} → ${tokensLong(fix.output_tokens)}`,
                ],
                ['Cost', usd(fix.cost_micros)],
                ['Duration', fix.duration_ms === null ? '—' : durationFixed(fix.duration_ms)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs leading-none font-medium text-muted-foreground">{k}</dt>
                  <dd className="m-0 font-mono text-[13px] font-medium tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <ul aria-label="Tool calls" className="m-5 rounded-lg border max-[760px]:m-4">
              {calls.map((c, i) => {
                const tests =
                  c.tool === 'run_tests' ? (c.output as { passed?: number } | undefined) : undefined
                const lines =
                  c.tool === 'write_file' && typeof c.output === 'string'
                    ? /\+(\d+) −(\d+)/.exec(c.output)
                    : null
                return (
                  <li
                    key={i}
                    className="grid min-h-11 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2.5 border-b px-3 py-2.5 text-sm last:border-b-0"
                  >
                    <Icon
                      name={c.tool === 'write_file' ? 'edit' : c.tool === 'run_tests' ? 'term' : 'file'}
                      className="text-muted-foreground"
                    />
                    <span className="min-w-0 break-words">
                      <code className="text-[13px]">{c.tool}</code>{' '}
                      <span className="text-muted-foreground">{toolArg(c)}</span>
                    </span>
                    {tests?.passed !== undefined ? (
                      <Status visual="passed" text={`${tests.passed} passed`} />
                    ) : lines ? (
                      <span className="font-mono text-[13px]">
                        <span className="text-success">+{lines[1]}</span>{' '}
                        <span className="text-destructive">−{lines[2]}</span>
                      </span>
                    ) : (
                      <span className="font-mono text-[13px] text-muted-foreground">
                        {c.durationMs === undefined ? '' : `${(c.durationMs / 1000).toFixed(1)} s`}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ) : (
          <Skeleton className="h-72 rounded-xl" />
        )}
      </div>
    </section>
  )
}

function PlaybookSection({ run, versions }: { run?: RunDetail; versions?: PlaybookVersion[] }) {
  const lesson = run?.lessons.find((l) => l.status === 'proposed')
  const version =
    versions?.find((v) => v.version === lesson?.playbook_version) ??
    versions?.find((v) => v.status === 'proposed')
  const before = versions?.find((v) => version && v.version < version.version && v.status === 'approved')
  const lines = parseHunks(version?.diff ?? '')
  return (
    <section aria-labelledby="playbook-h" id="playbook" className="scroll-mt-4 border-b py-14">
      <div
        className={cn(
          WRAP,
          'grid grid-cols-[minmax(0,4fr)_minmax(0,7fr)] items-start gap-12 max-[1100px]:grid-cols-1 max-[1100px]:gap-6',
        )}
      >
        <SecHead eyebrow="Playbook" title="Each run can teach the next one" id="playbook-h">
          After a run, the retro writes lessons as error, cause and rule, and proposes a diff to{' '}
          <code>playbook.md</code>. Nothing changes until you approve it, and the evaluation measures whether
          the playbook helps.
        </SecHead>
        {lesson && version ? (
          <div className="grid gap-4 rounded-xl border bg-card p-5 max-[760px]:p-4">
            <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              <dt className="text-xs/[22px] font-medium text-muted-foreground">Error</dt>
              <dd className="m-0">{lesson.error}</dd>
              <dt className="text-xs/[22px] font-medium text-muted-foreground">Cause</dt>
              <dd className="m-0">{lesson.cause}</dd>
              <dt className="text-xs/[22px] font-medium text-muted-foreground">Rule</dt>
              <dd className="m-0">
                <strong className="font-semibold">{lesson.rule}</strong>
              </dd>
            </dl>
            <div className="overflow-hidden rounded-lg border">
              <div className="flex min-h-11 items-center gap-2.5 border-b bg-muted px-3 font-mono text-[13px] font-medium">
                <span>
                  playbook.md · v{before?.version ?? version.version - 1} → v{version.version}
                </span>
                <span className="flex-1" />
                <span className="text-success">+{lines.filter((l) => l.type === 'add').length}</span>
              </div>
              <DiffLines lines={lines} label="Diff of playbook.md" wrap />
            </div>
          </div>
        ) : (
          <Skeleton className="h-64 rounded-xl" />
        )}
      </div>
    </section>
  )
}

function SetTable({ set }: { set: ScoreSet }) {
  const stats = VARIANTS.map((v) => set.main.find((m) => m.variant === v)).filter((m): m is SetVariant => !!m)
  const digits = stats.some((m) => m.costUsdPerRequest.mean < 0.01) ? 4 : 3
  const best = (pick: (m: SetVariant) => number | null, higher = false): Variant[] => {
    const values = stats
      .map((m) => ({ v: m.variant, x: pick(m) }))
      .filter((e): e is { v: Variant; x: number } => e.x !== null)
    if (values.length < 2) return []
    const top = values.reduce((a, b) => ((higher ? b.x > a.x : b.x < a.x) ? b : a)).x
    const winners = values.filter((e) => Math.abs(e.x - top) < 1e-9).map((e) => e.v)
    return winners.length === values.length ? [] : winners
  }
  const rows: { name: string; best: Variant[]; cell: (m: SetVariant) => ReactNode }[] = [
    {
      name: 'Requests passing all hidden tests',
      best: best((m) => m.passRate.mean, true),
      cell: (m) => `${percent(m.passRate.mean)} ${sdPoints(m.passRate.sd)}`,
    },
    {
      name: 'Cost per request',
      best: best((m) => m.costUsdPerRequest.mean),
      cell: (m) => `$${m.costUsdPerRequest.mean.toFixed(digits)}`,
    },
    {
      name: 'Fix loops per request',
      best: best((m) => (m.variant === 'single-agent' ? null : m.fixLoopsPerRequest.mean)),
      cell: (m) =>
        m.variant === 'single-agent' ? (
          <span className="text-muted-foreground">does not apply</span>
        ) : (
          m.fixLoopsPerRequest.mean.toFixed(2)
        ),
    },
  ]
  return (
    <div
      role="region"
      aria-label={`Evaluation, ${SET_LABEL[set.set]}, by variant`}
      tabIndex={0}
      className="overflow-x-auto rounded-lg border bg-card outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="w-max min-w-full">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Metric</TableHead>
              {stats.map((m) => (
                <TableHead key={m.variant} className="text-right">
                  {m.variant === 'crew-playbook'
                    ? `Crew + playbook v${m.playbookVersion}`
                    : VARIANT_LABEL[m.variant]}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.name}>
                <TableHead scope="row" className="font-medium text-foreground">
                  {r.name}
                </TableHead>
                {stats.map((m) => (
                  <TableCell key={m.variant} className="text-right font-mono text-[13px] tabular-nums">
                    {r.best.includes(m.variant) && (
                      <span className="mr-1.5 inline-flex align-[-2px]">
                        <Status visual="passed" label={false} text="best" size={14} />
                      </span>
                    )}
                    {r.cell(m)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function EvalSection({ sets }: { sets: ScoreSet[] }) {
  return (
    <section aria-labelledby="eval-h" id="eval" className="scroll-mt-4 border-b py-14">
      <div className={WRAP}>
        <SecHead eyebrow="Evaluation" title="Measured against one agent" id="eval-h">
          Feature requests with hidden acceptance tests the agents never see. Three variants run every
          request: one agent doing everything, the crew, and the crew with the playbook it learned. A request
          passes when all its hidden tests pass; mean ± standard deviation across rounds. Two sets: the hard
          one, with requests in two parts that interact, and the easy one, the baseline.
        </SecHead>
        <div className="grid gap-10">
          {sets.map((set) => (
            <div key={set.set} className="grid gap-3">
              <h3 className="text-base font-semibold">
                {set.set === 'hard' ? 'Hard set' : 'Easy set · the baseline'}{' '}
                <span className="font-normal text-muted-foreground">
                  · {set.requests} requests × {set.rounds} rounds · {set.model} · run {set.runAt.slice(0, 10)}
                </span>
              </h3>
              <p className="max-w-[820px] text-[15px]">{setHeadline(set)}</p>
              <SetTable set={set} />
              {set.notes.map((n) => (
                <p key={n} className="max-w-[820px] text-[13px] text-muted-foreground">
                  Note: {n}
                </p>
              ))}
            </div>
          ))}
        </div>
        <p className="mt-6 flex flex-wrap items-center gap-2.5 text-sm text-muted-foreground">
          <span>
            Reproduce: <code>pnpm eval</code> and <code>pnpm eval --set hard</code>
          </span>
          <Link
            href="/evaluation"
            className="inline-flex min-h-6 items-center gap-1 text-primary underline underline-offset-[3px] max-[760px]:min-h-11"
          >
            Full scoreboard <Icon name="arrow" size={14} />
          </Link>
        </p>
      </div>
    </section>
  )
}

function Quickstart({ budgetMicros }: { budgetMicros: number }) {
  const steps: { title: string; text: ReactNode; code: string; copy: string }[] = [
    { title: 'Get the code', text: 'Node 22 and pnpm.', code: CLONE, copy: CLONE },
    {
      title: 'Open the demo',
      text: (
        <>
          Opens the example runs at <code>http://127.0.0.1:8787</code>.
        </>
      ),
      code: '$ pnpm demo',
      copy: '$ pnpm demo',
    },
    {
      title: 'Run it live (optional)',
      text: (
        <>
          A real run on a throwaway copy of <code>fernhill-orders</code>, stopped at {usd(budgetMicros, 2)}.
          Put your <code>ANTHROPIC_API_KEY</code> in <code>.env.local</code> first.
        </>
      ),
      code: '$ pnpm crew run "Add an order cancellation endpoint"',
      copy: '$ pnpm crew run "Add an order cancellation endpoint"',
    },
  ]
  return (
    <section aria-labelledby="quickstart-h" id="quickstart" className="scroll-mt-4 border-b py-14">
      <div className={WRAP}>
        <SecHead eyebrow="Quickstart" title="The demo in three commands, without a key" id="quickstart-h">
          Replay mode plays example runs: no API key, no cost. Live mode runs on your machine with your own
          Anthropic key.
        </SecHead>
        <ol className="grid gap-6">
          {steps.map((s, i) => (
            <li
              key={s.title}
              className="grid grid-cols-[minmax(0,4fr)_minmax(0,7fr)] items-start gap-6 max-[900px]:grid-cols-1 max-[900px]:gap-3"
            >
              <div>
                <h3 className="mb-1.5 flex items-baseline gap-2.5 text-base font-semibold">
                  <span className="font-mono text-[13px] font-medium text-muted-foreground">{i + 1}</span>
                  {s.title}
                </h3>
                <p className="text-[15px] text-muted-foreground">{s.text}</p>
              </div>
              <CodeBlock title="Terminal" copyText={s.copy} wrap>
                {s.code}
              </CodeBlock>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

export function SiteFooter() {
  const link =
    'inline-flex min-h-8 items-center text-sm text-muted-foreground no-underline hover:text-foreground max-[760px]:min-h-11'
  return (
    <footer className="pt-10 pb-14">
      <div className={cn(WRAP, 'grid grid-cols-[2fr_1fr_1fr] gap-8 max-[760px]:grid-cols-2')}>
        <div className="max-[760px]:col-span-full">
          <p className="font-semibold">Built by Leonardo Pontes</p>
          <p className="text-sm text-muted-foreground">
            Orchestration, trace, evaluation and interface, end to end. The interface uses{' '}
            <a href={ATLAS_REPOSITORY} className="text-primary underline underline-offset-[3px]">
              Atlas UI
            </a>
            .
          </p>
          <div className="mt-3.5 flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <a href={LINKEDIN}>
                LinkedIn <Icon name="link" />
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={GITHUB_PROFILE}>
                <Icon name="github" />
                GitHub
              </a>
            </Button>
          </div>
        </div>
        <nav aria-labelledby="f-project">
          <h2 id="f-project" className="mb-2.5 text-[13px] font-semibold">
            Project
          </h2>
          <ul className="grid gap-1">
            <li>
              <a href={REPOSITORY} className={link}>
                Repository
              </a>
            </li>
            <li>
              <Link href="/runs" className={link}>
                Demo
              </Link>
            </li>
            <li>
              <Link href="/evaluation" className={link}>
                Evaluation
              </Link>
            </li>
          </ul>
        </nav>
        <nav aria-labelledby="f-docs">
          <h2 id="f-docs" className="mb-2.5 text-[13px] font-semibold">
            Docs
          </h2>
          <ul className="grid gap-1">
            <li>
              <a href="#quickstart" className={link}>
                Quickstart
              </a>
            </li>
            <li>
              <a href="#pipeline" className={link}>
                Pipeline
              </a>
            </li>
            <li>
              <Link href="/playbook" className={link}>
                Playbook
              </Link>
            </li>
          </ul>
        </nav>
        <p className="col-span-full text-[13px] text-muted-foreground">
          Agent Dev Crew · MIT license · Fernhill Market and <code>fernhill-orders</code> are fictional.
        </p>
      </div>
    </footer>
  )
}

export function HowItWorksPage({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  useTitle('Agent Dev Crew · How it works')
  const run = useApi<RunDetail>(`/api/runs/${SHOWCASE_RUN}`)
  const sets = scoreSets()
  const playbook = useApi<{ versions: PlaybookVersion[] }>('/api/playbook')
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-4 focus:z-50 focus:inline-flex focus:h-11 focus:items-center focus:rounded-md focus:border focus:bg-background focus:px-4 focus:text-foreground"
      >
        Skip to content
      </a>
      <SiteHeader theme={theme} onToggleTheme={onToggleTheme} />
      <main id="main" tabIndex={-1} className="outline-none">
        <span id="top" />
        <Hero run={run.data} sets={sets} />
        <Pipeline />
        <TraceSection run={run.data} />
        <PlaybookSection run={run.data} versions={playbook.data?.versions} />
        <EvalSection sets={sets} />
        <Quickstart budgetMicros={run.data?.run.budget_micros ?? BUDGET_MICROS} />
      </main>
      <SiteFooter />
    </>
  )
}
