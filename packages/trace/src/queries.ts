// The reads behind the four screens. Each query is a named constant so the index test can EXPLAIN
// it; the functions run them and shape the rows. Money stays in micros, time in milliseconds.

import type { Role, StepStatus, Variant } from '@crew/core'

import type { TraceDb } from './db.js'
import type { EvalSuite, RunOrigin, RunStatus, StepKind } from './contracts.js'

export interface RunListRow {
  id: number
  title: string
  status: RunStatus
  failure_reason: string | null
  variant: Variant
  playbook_version: number | null
  origin: RunOrigin
  started_at: string
  duration_ms: number | null
  cost_micros: number
  tokens: number
  fix_loops: number
}

export interface RunFilter {
  status?: RunStatus
  variant?: Variant
  /** Part of the title, any case. */
  search?: string
  limit?: number
}

// Runs: everything but the evaluation, newest first. Cost, tokens and fix loops per run come
// from correlated subqueries on indexed columns, so the list stays fast with thousands of runs.
const RUN_COLUMNS = /* sql */ `
  r.id, r.title, r.status, r.failure_reason, r.variant, r.playbook_version, r.origin, r.started_at,
  r.duration_ms,
  (SELECT COALESCE(SUM(c.cost_micros), 0) FROM costs c WHERE c.run_id = r.id) AS cost_micros,
  (SELECT COALESCE(SUM(c.input_tokens + c.cache_read_tokens + c.cache_write_tokens + c.output_tokens), 0)
     FROM costs c WHERE c.run_id = r.id) AS tokens,
  (SELECT COUNT(*) FROM steps s WHERE s.run_id = r.id AND s.kind = 'fix-loop') AS fix_loops`

export const SQL = {
  listRuns: /* sql */ `
    SELECT ${RUN_COLUMNS}
    FROM runs r
    WHERE r.eval_suite IS NULL
      AND (:status IS NULL OR r.status = :status)
      AND (:variant IS NULL OR r.variant = :variant)
      AND (:search IS NULL OR r.title LIKE '%' || :search || '%')
    ORDER BY r.started_at DESC
    LIMIT :limit`,
  getRun: /* sql */ `SELECT * FROM runs WHERE id = :id`,
  steps: /* sql */ `
    SELECT s.*,
      COALESCE(SUM(c.input_tokens), 0)       AS input_tokens,
      COALESCE(SUM(c.cache_read_tokens), 0)  AS cache_read_tokens,
      COALESCE(SUM(c.cache_write_tokens), 0) AS cache_write_tokens,
      COALESCE(SUM(c.output_tokens), 0)      AS output_tokens,
      COALESCE(SUM(c.cost_micros), 0)        AS cost_micros
    FROM steps s LEFT JOIN costs c ON c.step_id = s.id
    WHERE s.run_id = :run
    GROUP BY s.id
    ORDER BY s.seq`,
  costByRole: /* sql */ `
    SELECT COALESCE(s.role, s.kind) AS part, SUM(c.cost_micros) AS cost_micros
    FROM costs c JOIN steps s ON s.id = c.step_id
    WHERE c.run_id = :run
    GROUP BY part`,
  events: /* sql */ `SELECT * FROM events WHERE step_id = :step ORDER BY seq`,
  runLessons: /* sql */ `SELECT * FROM lessons WHERE run_id = :run ORDER BY position`,
  playbookVersions: /* sql */ `
    SELECT p.*, l.run_id AS lesson_run_id, l.position AS lesson_position, s.kind AS lesson_step_kind,
           s.role AS lesson_step_role, s.attempt AS lesson_step_attempt
    FROM playbook_versions p
    LEFT JOIN lessons l ON l.playbook_version = p.version AND l.status IN ('proposed', 'accepted')
    LEFT JOIN steps s ON s.id = l.step_id
    ORDER BY p.version DESC`,
  // One row per evaluation round of a variant (and playbook version): the per-round means the
  // Evaluation screen turns into mean ± standard deviation.
  evalRounds: /* sql */ `
    SELECT r.variant, r.playbook_version, r.eval_round,
      COUNT(*) AS requests,
      SUM(r.hidden_passed = r.hidden_total) AS passed,
      SUM((SELECT COALESCE(SUM(c.cost_micros), 0) FROM costs c WHERE c.run_id = r.id)) AS cost_micros,
      SUM((SELECT COALESCE(SUM(c.input_tokens + c.cache_read_tokens + c.cache_write_tokens + c.output_tokens), 0)
             FROM costs c WHERE c.run_id = r.id)) AS tokens,
      SUM(r.duration_ms) AS duration_ms,
      SUM((SELECT COUNT(*) FROM steps s WHERE s.run_id = r.id AND s.kind = 'fix-loop')) AS fix_loops,
      SUM((SELECT COUNT(*) FROM steps s WHERE s.run_id = r.id AND s.kind = 'gate'
             AND (s.decided_by = 'person' OR s.decision <> 'approve'))) AS gate_interventions,
      SUM((SELECT COUNT(*) FROM steps s WHERE s.run_id = r.id AND s.kind = 'gate')) AS gates
    FROM runs r
    WHERE r.eval_suite = :suite
    GROUP BY r.variant, r.playbook_version, r.eval_round
    ORDER BY r.variant, r.playbook_version, r.eval_round`,
  learningCurve: /* sql */ `
    SELECT r.playbook_version, r.eval_round, COUNT(*) AS requests, SUM(r.hidden_passed = r.hidden_total) AS passed
    FROM runs r
    WHERE r.eval_suite IS NOT NULL AND r.variant = 'crew-playbook'
    GROUP BY r.playbook_version, r.eval_round
    ORDER BY r.playbook_version, r.eval_round`,
  requestMatrix: /* sql */ `
    SELECT r.request_id, r.title, r.hidden_total, r.variant, r.eval_round, r.hidden_passed = r.hidden_total AS passed
    FROM runs r
    WHERE r.eval_suite = 'main'
    ORDER BY r.id`,
} as const

export function listRuns(db: TraceDb, filter: RunFilter = {}): RunListRow[] {
  return db.prepare(SQL.listRuns).all({
    status: filter.status ?? null,
    variant: filter.variant ?? null,
    search: filter.search ?? null,
    limit: filter.limit ?? 100,
  }) as unknown as RunListRow[]
}

export interface RunsSummary {
  runs: number
  finished: number
  passed: number
  costMicros: number
  /** Median duration of finished runs, or null when none finished. */
  medianDurationMs: number | null
  fixLoops: number
}

/** The numbers above the Runs table. */
export function runsSummary(rows: RunListRow[]): RunsSummary {
  const finished = rows.filter((r) => r.duration_ms !== null)
  const durations = finished.map((r) => r.duration_ms as number).sort((a, b) => a - b)
  const mid = Math.floor(durations.length / 2)
  return {
    runs: rows.length,
    finished: finished.length,
    passed: rows.filter((r) => r.status === 'passed').length,
    costMicros: rows.reduce((sum, r) => sum + r.cost_micros, 0),
    medianDurationMs:
      durations.length === 0
        ? null
        : durations.length % 2
          ? (durations[mid] as number)
          : ((durations[mid - 1] as number) + (durations[mid] as number)) / 2,
    fixLoops: rows.reduce((sum, r) => sum + r.fix_loops, 0),
  }
}

export interface StepRow {
  id: number
  run_id: number
  parent_id: number | null
  seq: number
  kind: StepKind
  role: Role | null
  status: StepStatus
  summary: string | null
  model: string | null
  fallback_used: number
  attempt: number
  max_attempts: number
  loop_index: number | null
  offset_ms: number | null
  duration_ms: number | null
  decision: string | null
  decided_by: string | null
  comment: string | null
  input_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  output_tokens: number
  cost_micros: number
}

export interface RunDetail {
  run: Record<string, unknown>
  steps: StepRow[]
  /** Cost per role (or step kind for the gate, retro and solo steps), for the stacked bar. */
  costByPart: Record<string, number>
  lessons: Record<string, unknown>[]
}

/** Everything the Run detail screen needs, or undefined for an unknown run. */
export function getRun(db: TraceDb, id: number): RunDetail | undefined {
  const run = db.prepare(SQL.getRun).get({ id }) as Record<string, unknown> | undefined
  if (!run) return undefined
  const parts = db.prepare(SQL.costByRole).all({ run: id }) as { part: string; cost_micros: number }[]
  return {
    run,
    steps: db.prepare(SQL.steps).all({ run: id }) as unknown as StepRow[],
    costByPart: Object.fromEntries(parts.map((p) => [p.part, p.cost_micros])),
    lessons: db.prepare(SQL.runLessons).all({ run: id }) as Record<string, unknown>[],
  }
}

export interface EventRow {
  id: number
  run_id: number
  step_id: number | null
  seq: number
  offset_ms: number
  kind: string
  payload: unknown
}

/** The prompt, response, tool calls and raw API records of one step, with the payload parsed. */
export function stepEvents(db: TraceDb, stepId: number): EventRow[] {
  return (db.prepare(SQL.events).all({ step: stepId }) as unknown as (EventRow & { payload: string })[]).map(
    (e) => ({
      ...e,
      payload: JSON.parse(e.payload),
    }),
  )
}

export function playbookHistory(db: TraceDb): Record<string, unknown>[] {
  return db.prepare(SQL.playbookVersions).all() as Record<string, unknown>[]
}

/** Mean and sample standard deviation (n − 1); one value has a deviation of 0. */
export function meanSd(values: number[]): { mean: number; sd: number; n: number } {
  const n = values.length
  if (n === 0) return { mean: Number.NaN, sd: Number.NaN, n }
  const mean = values.reduce((s, v) => s + v, 0) / n
  const sd = n < 2 ? 0 : Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1))
  return { mean, sd, n }
}

interface RoundRow {
  variant: Variant
  playbook_version: number | null
  eval_round: number
  requests: number
  passed: number
  cost_micros: number
  tokens: number
  duration_ms: number
  fix_loops: number
  gate_interventions: number
  gates: number
}

export interface VariantStats {
  variant: Variant
  playbookVersion: number | null
  rounds: number
  /** Share of requests whose hidden tests all passed, 0 to 1. */
  passRate: { mean: number; sd: number }
  costMicrosPerRequest: { mean: number; sd: number }
  tokensPerRequest: { mean: number; sd: number }
  durationMsPerRequest: { mean: number; sd: number }
  fixLoopsPerRequest: { mean: number; sd: number }
  gateInterventions: number
  gates: number
  costMicros: number
}

/** The Evaluation table: one row per variant of a suite, each metric as mean ± sd of the rounds. */
export function evaluationSummary(db: TraceDb, suite: EvalSuite = 'main'): VariantStats[] {
  const rows = db.prepare(SQL.evalRounds).all({ suite }) as unknown as RoundRow[]
  const groups = new Map<string, RoundRow[]>()
  for (const row of rows) {
    const key = `${row.variant}|${row.playbook_version ?? ''}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const stat = (list: RoundRow[], pick: (r: RoundRow) => number) => {
    const { mean, sd } = meanSd(list.map(pick))
    return { mean, sd }
  }
  return [...groups.values()].map((list) => ({
    variant: list[0]!.variant,
    playbookVersion: list[0]!.playbook_version,
    rounds: list.length,
    passRate: stat(list, (r) => r.passed / r.requests),
    costMicrosPerRequest: stat(list, (r) => r.cost_micros / r.requests),
    tokensPerRequest: stat(list, (r) => r.tokens / r.requests),
    durationMsPerRequest: stat(list, (r) => r.duration_ms / r.requests),
    fixLoopsPerRequest: stat(list, (r) => r.fix_loops / r.requests),
    gateInterventions: list.reduce((s, r) => s + r.gate_interventions, 0),
    gates: list.reduce((s, r) => s + r.gates, 0),
    costMicros: list.reduce((s, r) => s + r.cost_micros, 0),
  }))
}

export interface CurvePoint {
  playbookVersion: number
  rounds: number
  passRate: { mean: number; sd: number }
}

/** Hidden tests passing for the crew, per playbook version that has evaluation runs. */
export function learningCurve(db: TraceDb): CurvePoint[] {
  const rows = db.prepare(SQL.learningCurve).all() as {
    playbook_version: number
    eval_round: number
    requests: number
    passed: number
  }[]
  const versions = [...new Set(rows.map((r) => r.playbook_version))]
  return versions.map((version) => {
    const mine = rows.filter((r) => r.playbook_version === version)
    const { mean, sd } = meanSd(mine.map((r) => r.passed / r.requests))
    return { playbookVersion: version, rounds: mine.length, passRate: { mean, sd } }
  })
}

export interface MatrixRow {
  requestId: string
  title: string
  hiddenTests: number
  /** Per variant, pass (true) or fail per round, in round order. */
  results: Partial<Record<Variant, boolean[]>>
}

/** The per-request table of the Evaluation screen (main suite). */
export function requestMatrix(db: TraceDb): MatrixRow[] {
  const rows = db.prepare(SQL.requestMatrix).all() as {
    request_id: string
    title: string
    hidden_total: number
    variant: Variant
    passed: number
  }[]
  const byRequest = new Map<string, MatrixRow>()
  for (const r of rows) {
    const row = byRequest.get(r.request_id) ?? {
      requestId: r.request_id,
      title: r.title,
      hiddenTests: r.hidden_total,
      results: {},
    }
    row.results[r.variant] = [...(row.results[r.variant] ?? []), r.passed === 1]
    byRequest.set(r.request_id, row)
  }
  return [...byRequest.values()]
}
