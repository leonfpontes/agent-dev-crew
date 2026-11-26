// The stage the README GIF and the video are recorded from, frame by frame: every scene is a pure
// function of the clock (window.__setTime(ms)), so two recordings give the same frames.
// /demo plays the video's 60 s; /demo?mode=gif the GIF's 20 s. Not linked from the app.
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { cn } from '@leonfpontes/atlas-ui'

import { DiffLines } from '../components/bits'
import { Icon, Mark } from '../components/icons'
import { Status, runLabel, runVisual } from '../components/Status'
import { useApi } from '../lib/api'
import {
  GIF_MS,
  GIF_SCENES,
  gifCaptions,
  progress,
  sceneAt,
  VIDEO_MS,
  VIDEO_SCENES,
  videoCaptions,
  type Caption,
  type Scene,
} from '../lib/demo-script'
import { parseDiff, parseHunks } from '../lib/diff'
import { leadSet, scoreSets, SET_LABEL, setHeadline } from '../lib/scoreboards'
import { estimate, percent, sdPoints, usd } from '../lib/format'
import { useNoIndex, useTitle } from '../lib/hooks'
import { planFrom, runTotal, spans, toolCalls, toolArg } from '../lib/run'
import { SHOWCASE_RUN } from '../lib/share'
import type {
  EvaluationResponse,
  EventRow,
  PlaybookVersion,
  RunDetail,
  RunsResponse,
  Timeline,
} from '../lib/types'
import { VARIANTS } from '../lib/types'
import { Gantt } from './run/Trace'
import { VARIANT_LABEL } from './Runs'

declare global {
  interface Window {
    __setTime?: (ms: number) => void
    __demoReady?: boolean
    __demoCaptions?: { video: Caption[]; gif: Caption[] }
  }
}

interface Data {
  run: RunDetail
  timeline: Timeline
  plan: EventRow[]
  fix: EventRow[]
  evaluation: EvaluationResponse
  runs: RunsResponse
  versions: PlaybookVersion[]
}

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid h-full grid-rows-[auto_1fr] overflow-hidden rounded-xl border bg-background">
      <div className="flex h-12 items-center gap-3 border-b px-5 text-[15px] font-semibold">
        <Mark size={20} />
        Agent Dev Crew
        <span className="text-text-subtle">/</span>
        <span className="font-normal text-muted-foreground">{title}</span>
        <span className="ml-auto rounded-sm border border-dashed border-warning bg-warning-subtle px-2 text-[13px] leading-5 font-medium text-warning">
          example run
        </span>
      </div>
      <div className="overflow-hidden p-5">{children}</div>
    </div>
  )
}

function Problem({ p, fix }: { p: number; fix: EventRow[] }) {
  // A long agent log, scrolling: the same tool calls, over and over, with nothing to read it by.
  const calls = toolCalls(fix)
  const lines = Array.from({ length: 80 }, (_, i) => {
    const c = calls[i % Math.max(1, calls.length)]
    return c ? `[agent] ${c.tool} ${toolArg(c)} … ${i % 7 === 0 ? 'retrying' : 'ok'}` : '[agent] …'
  })
  return (
    <div className="h-full overflow-hidden rounded-xl bg-code-bg px-6 py-5 font-mono text-[15px]/[1.7] text-code-dim">
      <div style={{ transform: `translateY(-${Math.round(p * 1500)}px)` }}>
        {lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  )
}

function RunsList({ runs }: { runs: RunsResponse }) {
  return (
    <Frame title="Runs">
      <div className="overflow-hidden rounded-lg border">
        {runs.runs.slice(0, 7).map((r) => (
          <div
            key={r.id}
            className="grid h-[62px] grid-cols-[170px_minmax(0,1fr)_80px_90px] items-center gap-4 border-b px-4 text-[16px] last:border-b-0"
          >
            <Status
              visual={runVisual(r.status)}
              text={runLabel(r.status, r.failure_reason)}
              className="text-[15px]"
            />
            <span className="truncate font-medium">{r.title}</span>
            <span className="text-right font-mono text-[15px] text-muted-foreground">#{r.id}</span>
            <span className="text-right font-mono text-[15px]">{usd(r.cost_micros)}</span>
          </div>
        ))}
      </div>
    </Frame>
  )
}

function Terminal({ p, data, withGate }: { p: number; data: Data; withGate: boolean }) {
  const plan = planFrom(data.run, data.plan)
  const budget =
    data.run.run.budget_micros - (data.run.steps.find((s) => s.kind === 'plan')?.cost_micros ?? 0)
  const head = [
    `$ pnpm crew run "${data.run.run.title}"`,
    `Run #${data.run.run.id} started (crew).`,
    '',
    'Plan:',
    ...(plan?.steps ?? []).map((s, i) => `  ${i + 1}. ${s}`),
    'Acceptance:',
    ...(plan?.acceptance ?? []).map((s) => `  - ${s}`),
    `Files: ${plan?.files.join(', ') ?? '—'} · estimate ${plan ? estimate(plan.estimateUsd) : '—'} of ${usd(budget)} left`,
  ]
  const gate = [
    'Approve (y), request changes (c) or reject (n)? y',
    'Approved. The Engineer starts on a throwaway copy.',
  ]
  const all = withGate ? [...head, ...gate] : head
  // Typing: the characters shown grow with the scene's progress; the gate scene starts typed.
  const total = all.join('\n').length
  const shown = withGate
    ? head.join('\n').length + Math.round(p * gate.join('\n').length * 1.4)
    : Math.round(p * total * 1.15)
  const text = all.join('\n').slice(0, shown)
  return (
    <div className="dark grid h-full grid-rows-[auto_1fr] overflow-hidden rounded-xl bg-code-bg">
      <div className="flex h-11 items-center border-b border-[#2E3542] px-4 text-[13px] text-code-dim">
        Terminal · example run
      </div>
      <pre className="m-0 px-6 py-5 font-mono text-[17px]/[1.65] break-words whitespace-pre-wrap text-code-fg">
        {text.split('\n').map((l, i) => (
          <div
            key={i}
            className={cn(
              l.startsWith('Approve (y)') && 'text-crew',
              l.startsWith('$') && 'text-code-fg',
              l.startsWith('  ') && 'text-code-dim',
            )}
          >
            {l || ' '}
          </div>
        ))}
      </pre>
    </div>
  )
}

function Trace({ p, data }: { p: number; data: Data }) {
  const total = runTotal(data.run, Date.now())
  const map = useMemo(() => spans(data.run.steps, total, data.timeline), [data, total])
  // The replay fills the first 80% of the scene, then the whole trace stays on screen.
  const t = Math.min(total, (p / 0.8) * total)
  const view = {
    steps: data.run.steps,
    spans: map,
    total: data.timeline.durationMs || total,
    t: p < 0.8 ? t : undefined,
    growBars: true,
    selected: undefined,
    onSelect: () => {},
    hideQueued: false,
  }
  return (
    <Frame title={`Run #${data.run.run.id} · ${data.run.run.title}`}>
      <div className="[&_.crew-track]:h-2.5">
        <Gantt view={view} />
      </div>
    </Frame>
  )
}

function Diff({ data }: { data: Data }) {
  const files = parseDiff(data.run.run.diff)
  const first = files[0]
  const { run } = data.run
  return (
    <Frame title={`Run #${run.id} · Diff and tests`}>
      <div className="grid gap-4">
        {first && (
          <div className="overflow-hidden rounded-lg border">
            <div className="flex h-11 items-center gap-2.5 border-b bg-muted px-3 font-mono text-[14px] font-medium">
              {first.path}
              <span className="flex-1" />
              <span className="text-success">+{first.additions}</span>
              <span className="text-destructive">−{first.deletions}</span>
            </div>
            <DiffLines
              lines={first.lines.slice(0, 12)}
              label={`Diff of ${first.path}`}
              className="text-[15px]/6"
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          {[
            ['Hidden acceptance tests', run.hidden_passed, run.hidden_total, 'never shown to the agents'],
            [
              'Repository tests · vitest run',
              run.tests_passed,
              run.tests_total,
              'the suite the crew can see',
            ],
          ].map(([title, passed, total, note]) => (
            <div key={String(title)} className="rounded-xl border bg-card px-4 py-3">
              <div className="flex items-center justify-between text-[16px] font-medium">
                {title}
                <Status
                  visual={passed === total ? 'passed' : 'failed'}
                  text={`${passed} / ${total}`}
                  className="font-mono text-[16px]"
                />
              </div>
              <p className="mt-1 text-[14px] text-muted-foreground">{note}</p>
            </div>
          ))}
        </div>
      </div>
    </Frame>
  )
}

function Retro({ p, data }: { p: number; data: Data }) {
  const lesson = data.run.lessons.find((l) => l.status === 'proposed')
  const version = data.versions.find((v) => v.version === lesson?.playbook_version)
  const lines = parseHunks(version?.diff ?? '')
  return (
    <Frame title="Retro → Playbook">
      {lesson && (
        <div className="grid gap-4">
          <dl className="grid grid-cols-[80px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[17px]">
            <dt className="text-[15px] text-muted-foreground">Error</dt>
            <dd className="m-0">{lesson.error}</dd>
            <dt className="text-[15px] text-muted-foreground">Cause</dt>
            <dd className="m-0">{lesson.cause}</dd>
            <dt className="text-[15px] text-muted-foreground">Rule</dt>
            <dd className="m-0 font-semibold">{lesson.rule}</dd>
          </dl>
          {p > 0.3 && version && (
            <div className="overflow-hidden rounded-lg border border-crew-line">
              <div className="flex h-11 items-center gap-2 border-b bg-muted px-3 font-mono text-[14px] font-medium">
                <Icon name="gate" className="text-crew" />
                playbook.md · proposed as v{version.version}
              </div>
              <DiffLines lines={lines} label="Diff of playbook.md" wrap className="text-[15px]/6" />
            </div>
          )}
          {p > 0.6 && (
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  'inline-flex h-11 items-center gap-2 rounded-md bg-primary px-4 text-[15px] font-medium text-primary-foreground',
                  p > 0.8 && 'ring-[3px] ring-ring/50',
                )}
              >
                <Icon name="check" />
                Approve as v{version?.version}
              </span>
              {p > 0.85 && (
                <span className="text-[15px] text-muted-foreground">
                  Only an approved rule enters the playbook.
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </Frame>
  )
}

function NumberScene() {
  const sets = scoreSets()
  const lead = leadSet(sets)
  if (!lead) return <Frame title="Evaluation">{null}</Frame>
  const stats = VARIANTS.map((v) => lead.main.find((m) => m.variant === v)).filter((m) => !!m)
  const top = Math.max(...stats.map((m) => m.passRate.mean))
  const digits = stats.some((m) => m.costUsdPerRequest.mean < 0.01) ? 4 : 3
  const others = sets.slice(1)
  return (
    <Frame title={`Evaluation · ${SET_LABEL[lead.set]}`}>
      <p className="text-[15px] text-muted-foreground">
        {lead.requests} feature requests with hidden tests × {stats.length} variants × {lead.rounds} rounds ·{' '}
        {lead.model}
      </p>
      <h2 className="mt-3 max-w-[1100px] text-[32px] leading-[1.2] font-semibold tracking-[-0.02em]">
        {setHeadline(lead)}
      </h2>
      <div className="mt-6 grid grid-cols-3 gap-4">
        {stats.map((m) => (
          <div key={m.variant} className="rounded-xl border bg-card px-5 py-4">
            <p className="text-[15px] text-muted-foreground">
              {m.variant === 'crew-playbook'
                ? `Crew + playbook v${m.playbookVersion}`
                : VARIANT_LABEL[m.variant]}
            </p>
            <p className="mt-1 flex items-center gap-2 font-mono text-[30px] font-medium">
              {m.passRate.mean === top && <Status visual="passed" label={false} size={22} />}
              {percent(m.passRate.mean)}
              <small className="text-[16px] text-muted-foreground">{sdPoints(m.passRate.sd)}</small>
            </p>
            <p className="font-mono text-[15px] text-muted-foreground">
              ${m.costUsdPerRequest.mean.toFixed(digits)} · {Math.round(m.secondsPerRequest.mean)} s per
              request
            </p>
          </div>
        ))}
      </div>
      {others.map((o) => (
        <p key={o.set} className="mt-5 text-[17px] text-muted-foreground">
          {setHeadline(o)}
        </p>
      ))}
    </Frame>
  )
}

export function DemoPage() {
  useNoIndex()
  useTitle('Demo · Agent Dev Crew')
  const gif = new URLSearchParams(window.location.search).get('mode') === 'gif'
  const [t, setT] = useState(0)
  const run = useApi<RunDetail>(`/api/runs/${SHOWCASE_RUN}`)
  const timeline = useApi<Timeline>(`/api/runs/${SHOWCASE_RUN}/timeline`)
  const planStep = run.data?.steps.find((s) => s.kind === 'plan')
  const fixStep = run.data?.steps.find((s) => s.kind === 'fix')
  const plan = useApi<{ events: EventRow[] }>(
    planStep ? `/api/runs/${SHOWCASE_RUN}/steps/${planStep.id}/events` : null,
  )
  const fix = useApi<{ events: EventRow[] }>(
    fixStep ? `/api/runs/${SHOWCASE_RUN}/steps/${fixStep.id}/events` : null,
  )
  const evaluation = useApi<EvaluationResponse>('/api/evaluation')
  const runs = useApi<RunsResponse>('/api/runs?limit=500')
  const playbook = useApi<{ versions: PlaybookVersion[] }>('/api/playbook')

  const data = useMemo<Data | null>(
    () =>
      run.data && timeline.data && plan.data && fix.data && evaluation.data && runs.data && playbook.data
        ? {
            run: run.data,
            timeline: timeline.data,
            plan: plan.data.events,
            fix: fix.data.events,
            evaluation: evaluation.data,
            runs: runs.data,
            versions: playbook.data.versions,
          }
        : null,
    [run.data, timeline.data, plan.data, fix.data, evaluation.data, runs.data, playbook.data],
  )

  useEffect(() => {
    window.__setTime = (ms: number) => setT(ms)
    if (data) {
      window.__demoCaptions = { video: videoCaptions(scoreSets()), gif: gifCaptions(data.run) }
      window.__demoReady = true
    }
  }, [data])

  if (!data) return <p className="p-6">Loading run #{SHOWCASE_RUN} and the scoreboard…</p>
  const scenes: Scene[] = gif ? GIF_SCENES : VIDEO_SCENES
  const length = gif ? GIF_MS : VIDEO_MS
  const time = Math.min(t, length - 1)
  const scene = sceneAt(scenes, time)
  const p = progress(scene, time)
  const captions = gif ? gifCaptions(data.run) : videoCaptions(scoreSets())
  const caption = captions.find((c) => time >= c.from && time < c.to)

  let body: ReactNode
  if (scene.id === 'problem') body = <Problem p={p} fix={data.fix} />
  else if (scene.id === 'runs') body = <RunsList runs={data.runs} />
  else if (scene.id === 'terminal') body = <Terminal p={p} data={data} withGate={!gif} />
  else if (scene.id === 'gate') body = <Terminal p={p} data={data} withGate />
  else if (scene.id === 'trace') body = <Trace p={p} data={data} />
  else if (scene.id === 'diff') body = <Diff data={data} />
  else if (scene.id === 'retro') body = <Retro p={p} data={data} />
  else body = <NumberScene />

  return (
    <div
      id="stage"
      className="relative grid h-[720px] w-[1280px] grid-rows-[1fr_auto] gap-4 overflow-hidden bg-secondary p-6"
    >
      <div className="min-h-0">{body}</div>
      <p className="m-0 min-h-[46px] rounded-lg bg-foreground px-5 py-2.5 text-[20px] leading-[26px] font-medium text-background">
        {caption?.text ?? ''}
      </p>
    </div>
  )
}
