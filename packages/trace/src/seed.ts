// The replay seed: example data for the four screens, written into a migrated trace database.
// - Runs and Run detail: the eight recorded runs of seed-runs.ts.
// - Playbook: the eight versions of seed-playbook.ts, their diffs and the lessons behind them.
// - Evaluation: 150 runs, 10 requests × 3 variants × 3 rounds (the ablation), plus the playbook
//   learning curve (v1 in 3 rounds; v3, v5 and v6 in 1). The per-round numbers are chosen so the
//   screens read as the approved design: they are example data, never a measurement.
// With a real evaluation (`seed(db, now, { evaluation })`, from evals/results/latest.json) the
// Evaluation data and the playbook history are the measured ones instead, and the example runs
// point at the real playbook versions (see seedReal below).
// Everything is deterministic: the same `now` (and evaluation) gives the same database.

import type { StatementSync } from 'node:sqlite'

import type { Variant } from '@crew/core'

import type { EvalSuite, FailureReason, PlaybookSection, RunStatus } from './contracts.js'
import type { TraceDb } from './db.js'
import { unifiedDiff } from './diff.js'
import { SEED_PLAYBOOK, type SeedPlaybookVersion } from './seed-playbook.js'
import { SEED_REQUESTS } from './seed-requests.js'
import { SEED_MODEL, SEED_RUNS, type SeedRun, type SeedStep, type SeedTokens } from './seed-runs.js'

/** The default "now" of the seed. The replay API can pass the real time to keep "2 min ago" fresh. */
export const SEED_NOW = new Date('2026-11-26T12:00:00.000Z')
export const BUDGET_MICROS = 250_000

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const usd = (dollars: number) => Math.round(dollars * 1_000_000)
const ms = (seconds: number) => Math.round(seconds * 1000)

const splitTokens = (tokens: SeedTokens | number): { input: number; cached: number; out: number } => {
  if (typeof tokens !== 'number')
    return { input: tokens.in - tokens.cached, cached: tokens.cached, out: tokens.out }
  const out = Math.round(tokens * 0.15)
  const allIn = tokens - out
  const cached = Math.round(allIn * 0.6)
  return { input: allIn - cached, cached, out }
}

function requestOf(id: string) {
  const request = SEED_REQUESTS.find((r) => r.id === id)
  if (!request) throw new Error(`Seed run uses unknown request "${id}".`)
  return request
}

class Writer {
  private insertRun: StatementSync
  private insertStep: StatementSync
  private insertCost: StatementSync
  private insertEvent: StatementSync
  private insertLesson: StatementSync
  private insertPlaybook: StatementSync

  constructor(db: TraceDb) {
    this.insertRun = db.prepare(/* sql */ `
    INSERT INTO runs (id, title, request, request_id, variant, playbook_version, origin, eval_suite, eval_round,
      status, failure_reason, repo_ref, model, budget_micros, started_at, duration_ms, tests_passed, tests_total,
      hidden_passed, hidden_total, diff)
    VALUES (:id, :title, :request, :request_id, :variant, :playbook_version, :origin, :eval_suite, :eval_round,
      :status, :failure_reason, :repo_ref, :model, :budget_micros, :started_at, :duration_ms, :tests_passed,
      :tests_total, :hidden_passed, :hidden_total, :diff)`)

    this.insertStep = db.prepare(/* sql */ `
    INSERT INTO steps (run_id, parent_id, seq, kind, role, status, summary, model, attempt, max_attempts, loop_index,
      offset_ms, duration_ms, decision, decided_by, comment)
    VALUES (:run_id, :parent_id, :seq, :kind, :role, :status, :summary, :model, :attempt, :max_attempts, :loop_index,
      :offset_ms, :duration_ms, :decision, :decided_by, :comment)`)

    this.insertCost = db.prepare(/* sql */ `
    INSERT INTO costs (run_id, step_id, model, input_tokens, cache_read_tokens, output_tokens, cost_micros, offset_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)

    this.insertEvent = db.prepare(
      'INSERT INTO events (run_id, step_id, seq, offset_ms, kind, payload) VALUES (?, ?, ?, ?, ?, ?)',
    )

    this.insertLesson = db.prepare(/* sql */ `
    INSERT INTO lessons (run_id, step_id, position, error, cause, rule, section, status, playbook_version, duplicate_of)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)

    this.insertPlaybook = db.prepare(/* sql */ `
    INSERT INTO playbook_versions (version, title, content, diff, status, source, source_run_id, created_at,
      decided_at, decided_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  }

  playbook(now: Date, versions: SeedPlaybookVersion[] = SEED_PLAYBOOK) {
    let previous: string | null = null
    for (const v of versions) {
      const created =
        v.daysAgo === 0 ? new Date(now.getTime() - 20 * MINUTE) : new Date(now.getTime() - v.daysAgo * DAY)
      const decided = v.status === 'proposed' ? null : new Date(created.getTime() + 5 * MINUTE).toISOString()
      this.insertPlaybook.run(
        v.version,
        v.title,
        v.content,
        previous === null ? null : unifiedDiff(previous, v.content),
        v.status,
        v.source,
        v.sourceRunId,
        created.toISOString(),
        decided,
        decided ? (v.decidedBy ?? 'person') : null,
      )
      previous = v.content
    }
  }

  /** Writes one lesson of a run, with no step (the evaluation keeps only run totals). */
  lesson(runId: number, l: SeedEvaluation['playbook']['lessons'][number]) {
    this.insertLesson.run(
      runId,
      null,
      l.position,
      l.error,
      l.cause,
      l.rule,
      l.section,
      l.status,
      l.playbookVersion,
      l.duplicateOf,
    )
  }

  /** Writes a run with its steps, costs, events and lessons. */
  run(
    run: Omit<SeedRun, 'startedMinutesAgo' | 'requestId'> & {
      request: { id: string; title: string; request: string }
      startedAt: Date
      origin: 'example' | 'eval'
      suite?: EvalSuite
      round?: number
    },
  ) {
    this.insertRun.run({
      id: run.id,
      title: run.request.title,
      request: run.request.request,
      request_id: run.request.id,
      variant: run.variant,
      playbook_version: run.playbookVersion,
      origin: run.origin,
      eval_suite: run.suite ?? null,
      eval_round: run.round ?? null,
      status: run.status,
      failure_reason: run.failureReason ?? null,
      repo_ref: run.repoRef,
      model: SEED_MODEL,
      budget_micros: BUDGET_MICROS,
      started_at: run.startedAt.toISOString(),
      duration_ms: run.duration === undefined ? null : ms(run.duration),
      tests_passed: run.tests?.[0] ?? null,
      tests_total: run.tests?.[1] ?? null,
      hidden_passed: run.hidden?.[0] ?? null,
      hidden_total: run.hidden?.[1] ?? null,
      diff: run.diff ?? null,
    })
    const events: { step: number | null; at: number; kind: string; payload: unknown }[] = [
      {
        step: null,
        at: 0,
        kind: 'run.started',
        payload: { variant: run.variant, playbook: run.playbookVersion },
      },
    ]
    if (run.duration !== undefined) {
      events.push({ step: null, at: ms(run.duration), kind: 'run.finished', payload: { status: run.status } })
    }
    const ids: number[][] = []
    let seq = 0
    const write = (s: SeedStep, parent: number | null): number => {
      const id = Number(
        this.insertStep.run({
          run_id: run.id,
          parent_id: parent,
          seq: ++seq,
          kind: s.kind,
          role: s.role ?? null,
          status: s.status,
          summary: s.summary ?? null,
          model: s.cost === undefined ? null : SEED_MODEL,
          attempt: s.attempt ?? 1,
          max_attempts: Math.max(s.maxAttempts ?? 1, s.attempt ?? 1),
          loop_index: s.loop ?? null,
          offset_ms: s.at === undefined ? null : ms(s.at),
          duration_ms: s.dur === undefined ? null : ms(s.dur),
          decision: s.decision ?? null,
          decided_by: s.decidedBy ?? null,
          comment: s.comment ?? null,
        }).lastInsertRowid,
      )
      if (s.cost !== undefined && s.at !== undefined) {
        const t = splitTokens(s.tokens ?? 0)
        this.insertCost.run(
          run.id,
          id,
          SEED_MODEL,
          t.input,
          t.cached,
          t.out,
          usd(s.cost),
          ms(s.at + (s.dur ?? 0)),
        )
      }
      if (s.at !== undefined) {
        events.push({
          step: id,
          at: ms(s.at),
          kind: 'step.started',
          payload: { kind: s.kind, role: s.role ?? null },
        })
        if (s.dur !== undefined) {
          events.push({
            step: id,
            at: ms(s.at + s.dur),
            kind: 'step.finished',
            payload: { status: s.status },
          })
        }
      }
      for (const e of s.events ?? [])
        events.push({ step: id, at: ms(e.at), kind: e.kind, payload: e.payload })
      return id
    }
    for (const s of run.steps) {
      const id = write(s, null)
      ids.push([id, ...(s.children ?? []).map((c) => write(c, id))])
    }
    // Events in time order; at the same instant, the order they were declared.
    events
      .map((e, i) => ({ ...e, i }))
      .sort((a, b) => a.at - b.at || a.i - b.i)
      .forEach((e, i) => this.insertEvent.run(run.id, e.step, i + 1, e.at, e.kind, JSON.stringify(e.payload)))

    for (const [i, lesson] of (run.lessons ?? []).entries()) {
      const [top, child] = lesson.step
      const stepId = child === undefined ? ids[top as number]?.[0] : ids[top as number]?.[child + 1]
      this.insertLesson.run(
        run.id,
        stepId ?? null,
        i + 1,
        lesson.error,
        lesson.cause,
        lesson.rule,
        lesson.section,
        lesson.status,
        lesson.playbookVersion ?? null,
        lesson.duplicateOf ?? null,
      )
    }
  }
}

// ---- Evaluation -----------------------------------------------------------------------------

interface RoundPlan {
  /** 1-based request numbers (in SEED_REQUESTS order) whose hidden tests all pass. */
  passes: number[]
  costUsd: number
  tokens: number
  seconds: number
  fixLoops: number
}

interface EvalSeries {
  suite: EvalSuite
  variant: Variant
  playbookVersion: number | null
  /** Days before now when round 1 started (the main suite starts at 09:12 today). */
  daysAgo: number
  rounds: RoundPlan[]
}

const round = (
  passes: number[],
  costUsd: number,
  tokens: number,
  seconds: number,
  fixLoops: number,
): RoundPlan => ({
  passes,
  costUsd,
  tokens,
  seconds,
  fixLoops,
})

/**
 * Per-round targets. Main suite: one agent 40% ± 10, crew 63% ± 6, crew + playbook v7 77% ± 6,
 * $3.30 in all. Each value is a round mean per request; the three rounds give the ± shown.
 */
export const EVAL_SERIES: EvalSeries[] = [
  {
    suite: 'main',
    variant: 'single-agent',
    playbookVersion: null,
    daysAgo: 0,
    rounds: [
      round([1, 2, 5], 0.018, 11_700, 61, 0),
      round([1, 2, 5, 7], 0.021, 13_100, 70, 0),
      round([1, 2, 5, 7, 9], 0.024, 14_500, 79, 0),
    ],
  },
  {
    suite: 'main',
    variant: 'crew',
    playbookVersion: null,
    daysAgo: 0,
    rounds: [
      round([1, 2, 3, 5, 6, 7], 0.041, 26_200, 154, 7),
      round([1, 2, 3, 5, 7, 9], 0.046, 28_400, 168, 9),
      round([1, 2, 3, 5, 6, 7, 9], 0.051, 30_600, 182, 11),
    ],
  },
  {
    suite: 'main',
    variant: 'crew-playbook',
    playbookVersion: 7,
    daysAgo: 0,
    rounds: [
      round([1, 2, 3, 4, 5, 6, 7, 9], 0.039, 25_000, 140, 4),
      round([1, 2, 3, 5, 6, 7, 8, 9], 0.043, 26_900, 151, 5),
      round([1, 2, 3, 5, 6, 7, 9], 0.047, 28_800, 162, 6),
    ],
  },
  {
    suite: 'learning-curve',
    variant: 'crew-playbook',
    playbookVersion: 1,
    daysAgo: 7,
    rounds: [
      round([1, 2, 5, 6, 7], 0.046, 28_000, 160, 9),
      round([1, 2, 3, 5, 6, 7], 0.045, 27_600, 158, 8),
      round([1, 2, 3, 5, 6, 7, 9], 0.044, 27_200, 155, 7),
    ],
  },
  {
    suite: 'learning-curve',
    variant: 'crew-playbook',
    playbookVersion: 3,
    daysAgo: 5,
    rounds: [round([1, 2, 3, 5, 6, 7, 9], 0.045, 27_500, 156, 7)],
  },
  {
    suite: 'learning-curve',
    variant: 'crew-playbook',
    playbookVersion: 5,
    daysAgo: 3,
    rounds: [round([1, 2, 3, 5, 6, 7, 9], 0.044, 27_100, 153, 6)],
  },
  {
    suite: 'learning-curve',
    variant: 'crew-playbook',
    playbookVersion: 6,
    daysAgo: 2,
    rounds: [round([1, 2, 3, 4, 5, 6, 7, 9], 0.043, 26_800, 150, 5)],
  },
]

/** How much of a round's mean each request takes (mean 1, so the round mean is exact). */
const WEIGHTS = [0.8, 0.9, 1.0, 1.3, 0.7, 1.1, 1.0, 0.8, 1.2, 1.2]

/** Splits `total` by weights into whole numbers that add up to it exactly. */
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0)
  const parts = weights.map((w) => Math.floor((total * w) / sum))
  let left = total - parts.reduce((s, p) => s + p, 0)
  const order = weights
    .map((w, i) => [(total * w) / sum - (parts[i] as number), i] as const)
    .sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (left-- <= 0) break
    parts[i] = (parts[i] as number) + 1
  }
  return parts
}

/** Fix loops per request for a round: heaviest requests first, at most 2 each. */
function loopsFor(total: number): number[] {
  const order = WEIGHTS.map((w, i) => [w, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1])
  const loops = new Array<number>(WEIGHTS.length).fill(0)
  for (let k = 0; k < total; k++) {
    const i = order[k % order.length]![1]
    loops[i] = (loops[i] as number) + 1
  }
  if (loops.some((l) => l > 2)) throw new Error('At most 2 fix loops per run.')
  return loops
}

/** The steps of one evaluation run, splitting its cost, tokens and time across the model steps. */
function evalSteps(
  variant: Variant,
  costMicros: number,
  tokens: number,
  durationMs: number,
  loops: number,
  exhausted: boolean,
  { gate = true, failed = false }: { gate?: boolean; failed?: boolean } = {},
): SeedStep[] {
  if (variant === 'single-agent') {
    return [
      {
        kind: 'solo',
        status: failed ? 'failed' : 'passed',
        at: 0,
        dur: durationMs / 1000,
        cost: costMicros / 1e6,
        tokens,
      },
    ]
  }
  // plan, code, review, test, then per loop a fix and a test
  const weights = [10, 55 - 15 * loops, 20, 15, ...Array.from({ length: loops }, () => [10, 5]).flat()]
  const costs = apportion(costMicros, weights)
  const toks = apportion(tokens, weights)
  const times = apportion(durationMs, weights)
  let at = 0
  let k = 0
  const next = (
    kind: SeedStep['kind'],
    role: SeedStep['role'],
    status: SeedStep['status'],
    extra: Partial<SeedStep> = {},
  ): SeedStep => {
    const s: SeedStep = {
      kind,
      role,
      status,
      at: at / 1000,
      dur: (times[k] as number) / 1000,
      cost: (costs[k] as number) / 1e6,
      tokens: toks[k] as number,
      maxAttempts: 3,
      ...extra,
    }
    at += times[k] as number
    k++
    return s
  }
  // A run that stopped before the gate spent everything in its plan step.
  if (!gate)
    return [
      {
        kind: 'plan',
        role: 'po',
        status: failed ? 'failed' : 'passed',
        at: 0,
        dur: durationMs / 1000,
        cost: costMicros / 1e6,
        tokens,
        maxAttempts: 3,
      },
    ]
  const steps: SeedStep[] = [next('plan', 'po', 'passed')]
  steps.push({
    kind: 'gate',
    status: 'approved',
    at: at / 1000,
    dur: 0,
    decision: 'approve',
    decidedBy: 'policy',
    comment: 'gate: always-approve',
  })
  steps.push(next('code', 'engineer', 'passed'), next('review', 'reviewer', 'passed'))
  steps.push(next('test', 'qa', loops > 0 ? 'failed' : 'passed'))
  for (let l = 1; l <= loops; l++) {
    const start = at
    const fix = next('fix', 'engineer', 'passed', { attempt: l + 1 })
    const last = l === loops
    const test = next('test', 'qa', last && !exhausted ? 'passed' : 'failed')
    steps.push({
      kind: 'fix-loop',
      status: last && exhausted ? 'failed' : 'fix-loop',
      loop: l,
      at: start / 1000,
      dur: (at - start) / 1000,
      children: [fix, test],
    })
  }
  // A run that failed for another reason (budget, error) shows it on its last step.
  if (failed && !exhausted) steps[steps.length - 1] = { ...steps[steps.length - 1]!, status: 'failed' }
  return steps
}

function seedEvaluation(writer: Writer, now: Date) {
  const mainStart = new Date('2026-11-26T09:12:00.000Z').getTime() - (SEED_NOW.getTime() - now.getTime())
  let id = 1000
  for (const series of EVAL_SERIES) {
    // The three variants of the main suite run side by side from 09:12; each series runs its requests in turn.
    let clock = series.daysAgo === 0 ? mainStart : now.getTime() - series.daysAgo * DAY
    for (const [r, plan] of series.rounds.entries()) {
      const n = SEED_REQUESTS.length
      const costs = apportion(usd(plan.costUsd) * n, WEIGHTS)
      const tokens = apportion(plan.tokens * n, WEIGHTS)
      const times = apportion(plan.seconds * 1000 * n, WEIGHTS)
      const loops = loopsFor(plan.fixLoops)
      for (const [i, request] of SEED_REQUESTS.entries()) {
        const passed = plan.passes.includes(i + 1)
        const runLoops = series.variant === 'single-agent' ? 0 : (loops[i] as number)
        const exhausted = runLoops === 2 && !passed
        const duration = (times[i] as number) / 1000
        writer.run({
          id: ++id,
          request,
          variant: series.variant,
          playbookVersion: series.playbookVersion,
          origin: 'eval',
          suite: series.suite,
          round: r + 1,
          status: exhausted ? 'failed' : 'passed',
          failureReason: exhausted ? 'fix-loops-exhausted' : undefined,
          startedAt: new Date(clock),
          duration,
          repoRef: 'fernhill-orders@9c2e71b',
          tests: exhausted ? [23, 24] : [24, 24],
          hidden: [
            passed ? request.hiddenTests : Math.max(0, request.hiddenTests - 1 - (i % 2)),
            request.hiddenTests,
          ],
          steps: evalSteps(
            series.variant,
            costs[i] as number,
            tokens[i] as number,
            times[i] as number,
            runLoops,
            exhausted,
          ),
        })
        clock += (times[i] as number) + 5_000
      }
    }
  }
}

// ---- A real evaluation -----------------------------------------------------------------------

/** What the seed needs from a real evaluation: the shape of evals/results/latest.json (a subset). */
export interface SeedEvaluation {
  runs: {
    id: number
    requestId: string
    variant: Variant
    playbookVersion: number | null
    suite: EvalSuite
    round: number
    status: string
    failureReason: string | null
    testsPassed: number | null
    testsTotal: number | null
    hiddenPassed: number
    hiddenTotal: number
    costMicros: number
    tokens: { input: number; cacheRead: number; cacheWrite: number; output: number }
    durationMs: number
    fixLoops: number
    gates: number
  }[]
  playbook: {
    versions: {
      version: number
      title: string
      status: string
      source: string
      sourceRunId: number | null
      decidedBy: string | null
      content: string
    }[]
    lessons: {
      runId: number
      position: number
      error: string
      cause: string
      rule: string
      section: string
      status: string
      playbookVersion: number | null
      duplicateOf: number | null
    }[]
  }
}

/** The rules of one playbook section (the `- ` lines under `## <section>`). */
function rulesOf(content: string, section: string): string[] {
  const out: string[] = []
  let inside = false
  for (const line of content.split('\n')) {
    const h = /^##\s+(.+?)\s*$/.exec(line)?.[1]
    if (h !== undefined) inside = h === section
    else if (inside && /^\s*-\s+/.test(line)) out.push(line.replace(/^\s*-\s+/, '').trim())
  }
  return out
}

/** Adds a rule as the last line of its section. */
function withRule(content: string, section: string, rule: string): string {
  const lines = content.replace(/\n+$/, '').split('\n')
  const start = lines.findIndex((l) => l.trim() === `## ${section}`)
  if (start === -1) return `${lines.join('\n')}\n\n## ${section}\n\n- ${rule}\n`
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
  if (end === -1) end = lines.length
  let last = end - 1
  while (last > start && lines[last]!.trim() === '') last--
  lines.splice(last + 1, 0, `- ${rule}`)
  return `${lines.join('\n')}\n`
}

/**
 * The replay data with a real evaluation: its playbook history, its runs (one row each, with the
 * steps the Evaluation screen counts) and its lessons. The example runs stay as recorded but point
 * at the real versions: the example's v7 becomes the learned version, older ones count back from
 * it, and run #142's proposal becomes the next version, waiting for a person. Example lessons whose
 * rule the real playbook doesn't have are recorded as rejected.
 */
function seedReal(writer: Writer, now: Date, evaluation: SeedEvaluation) {
  const versions = [...evaluation.playbook.versions].sort((a, b) => a.version - b.version)
  const approved = versions.filter((v) => v.status === 'approved')
  const learned = approved[approved.length - 1]
  if (!learned) throw new Error('The evaluation has no approved playbook version.')
  const runs = [...evaluation.runs].sort((a, b) => a.id - b.id)
  const idOf = new Map(runs.map((r, i) => [r.id, 1001 + i]))
  const count = versions.length

  // The example's proposal (run #142, v8) on top of the learned version.
  const example8 = SEED_PLAYBOOK.find((v) => v.version === 8)!
  const exampleRule = SEED_RUNS.find((r) => r.id === 142)!.lessons![0]!
  const proposal: SeedPlaybookVersion = {
    version: versions[versions.length - 1]!.version + 1,
    title: example8.title,
    source: 'retro',
    sourceRunId: 142,
    status: 'proposed',
    daysAgo: 0,
    content: withRule(learned.content, exampleRule.section, exampleRule.rule),
  }
  writer.playbook(now, [
    ...versions.map((v, i): SeedPlaybookVersion => ({
      version: v.version,
      title: v.title,
      source: v.source as SeedPlaybookVersion['source'],
      sourceRunId: v.sourceRunId === null ? null : (idOf.get(v.sourceRunId) ?? null),
      status: v.status as SeedPlaybookVersion['status'],
      daysAgo: (count - i) / 24, // an hour apart, the newest an hour ago
      content: v.content,
      decidedBy: (v.decidedBy ?? undefined) as SeedPlaybookVersion['decidedBy'],
    })),
    proposal,
  ])

  const contentOf = (version: number) =>
    version === proposal.version ? proposal.content : versions.find((v) => v.version === version)!.content
  const map = (example: number) =>
    example === 8
      ? proposal.version
      : (approved[Math.max(0, approved.length - 1 - (7 - example))] ?? approved[0]!).version
  const remapEvents = (events: SeedStep['events']) =>
    events?.map((e) => {
      const p = e.payload as { playbook?: { version: number; section: PlaybookSection }; rules?: string[] }
      if (!p?.playbook) return e
      const version = map(p.playbook.version)
      return {
        ...e,
        payload: {
          ...p,
          playbook: { ...p.playbook, version },
          rules: rulesOf(contentOf(version), p.playbook.section),
        },
      }
    })
  const remapStep = (step: SeedStep): SeedStep => ({
    ...step,
    events: remapEvents(step.events),
    children: step.children?.map(remapStep),
  })
  for (const run of SEED_RUNS) {
    const { startedMinutesAgo, requestId, ...rest } = run
    writer.run({
      ...rest,
      playbookVersion: run.playbookVersion === null ? null : map(run.playbookVersion),
      steps: run.steps.map(remapStep),
      lessons: run.lessons?.map((l) => {
        const version = l.playbookVersion ?? l.duplicateOf
        const target = version === undefined ? undefined : map(version)
        const has = target !== undefined && rulesOf(contentOf(target), l.section).includes(l.rule)
        if (l.status === 'proposed' && target === proposal.version) return { ...l, playbookVersion: target }
        return has
          ? { ...l, playbookVersion: l.playbookVersion && target, duplicateOf: l.duplicateOf && target }
          : { ...l, status: 'rejected', playbookVersion: undefined, duplicateOf: undefined }
      }),
      request: requestOf(requestId),
      origin: 'example',
      startedAt: new Date(now.getTime() - startedMinutesAgo * MINUTE),
    })
  }

  // The evaluation runs, in the order they ran, 20 seconds apart, ending an hour ago.
  const start = now.getTime() - 60 * MINUTE - runs.length * 20_000
  for (const [i, r] of runs.entries()) {
    const exhausted = r.failureReason === 'fix-loops-exhausted'
    const tokens = r.tokens.input + r.tokens.cacheRead + r.tokens.cacheWrite + r.tokens.output
    writer.run({
      id: idOf.get(r.id)!,
      request: requestOf(r.requestId),
      variant: r.variant,
      playbookVersion: r.playbookVersion,
      origin: 'eval',
      suite: r.suite,
      round: r.round,
      status: r.status as RunStatus,
      failureReason: (r.failureReason ?? undefined) as FailureReason | undefined,
      startedAt: new Date(start + i * 20_000),
      duration: r.durationMs / 1000,
      repoRef: SEED_RUNS[0]!.repoRef,
      tests: r.testsTotal === null ? undefined : [r.testsPassed ?? 0, r.testsTotal],
      hidden: [r.hiddenPassed, r.hiddenTotal],
      steps: evalSteps(r.variant, r.costMicros, tokens, r.durationMs, r.fixLoops, exhausted, {
        gate: r.gates > 0,
        failed: r.status === 'failed',
      }),
    })
  }
  for (const l of evaluation.playbook.lessons) {
    const runId = idOf.get(l.runId)
    if (runId === undefined) continue
    writer.lesson(runId, l)
  }
}

export interface SeedCounts {
  runs: number
  steps: number
  events: number
  costs: number
  lessons: number
  playbookVersions: number
}

/**
 * Writes the example data into an empty, migrated trace database, in one transaction. With
 * `evaluation`, the Evaluation data and the playbook history are the real ones (seedReal).
 */
export function seed(
  db: TraceDb,
  now: Date = SEED_NOW,
  options: { evaluation?: SeedEvaluation } = {},
): SeedCounts {
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
  if (count('runs') + count('playbook_versions') > 0)
    throw new Error('The trace database is not empty; seed an empty one.')
  db.exec('BEGIN IMMEDIATE')
  try {
    const writer = new Writer(db)
    if (options.evaluation) seedReal(writer, now, options.evaluation)
    else seedExample(writer, now)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return {
    runs: count('runs'),
    steps: count('steps'),
    events: count('events'),
    costs: count('costs'),
    lessons: count('lessons'),
    playbookVersions: count('playbook_versions'),
  }
}

function seedExample(writer: Writer, now: Date) {
  writer.playbook(now)
  for (const run of SEED_RUNS) {
    const { startedMinutesAgo, requestId, ...rest } = run
    writer.run({
      ...rest,
      request: requestOf(requestId),
      origin: 'example',
      startedAt: new Date(now.getTime() - startedMinutesAgo * MINUTE),
    })
  }
  seedEvaluation(writer, now)
}
