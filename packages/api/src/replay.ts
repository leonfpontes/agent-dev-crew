// The replay database: the example runs, with nothing to call and nothing to pay for.
// Locally it is `.crew/replay.sqlite` (`pnpm --filter @crew/trace seed`), opened read-only; where no
// file exists (a serverless function), the same seed is written into an in-memory database.
// With the real scoreboard (evals/results/latest.json) the Evaluation screen and the playbook
// history are measured data; without it they are the seed's example numbers.

import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import {
  EVAL_SETS,
  migrate,
  openTrace,
  seed,
  type EvalSet,
  type SeedEvaluation,
  type TraceDb,
} from '@crew/trace'

/** The replay database with the seed's example evaluation: a file when it exists, else in memory. */
export function openReplay(file?: string, now = new Date()): TraceDb {
  return loadReplay({ file, now }).trace
}

/** The request sets with a scoreboard: evals/results/latest.json (easy) and hard.json. */
export const EVALUATION_SETS = EVAL_SETS
export type EvaluationSet = EvalSet

export interface ReplayOptions {
  /** A seeded database file; opened read-only when it exists. */
  file?: string
  /** The real scoreboard. Seeds the in-memory database, and says the file was seeded with it. */
  evaluation?: SeedEvaluation
  /** The hard set's scoreboard (evals/results/hard.json): seeded into a database of its own. */
  hardEvaluation?: SeedEvaluation
  now?: Date
}

export interface EvaluationMeta {
  model: string
  limitUsd: number
  /** ISO time the evaluation finished. */
  finishedAt: string
  /** What the scoreboard says about its own gaps (budget, missing rounds). */
  notes: string[]
}

/** One request set's Evaluation database (the same shape as ApiOptions.evaluations). */
export interface ReplaySet {
  trace: TraceDb
  exampleData: boolean
  meta?: EvaluationMeta
}

export interface Replay {
  trace: TraceDb
  /** True when the Evaluation numbers are the seed's examples, not a measurement. */
  exampleData: boolean
  /** From the real scoreboard: the model, the cost limit and when it ran. */
  evaluationMeta?: EvaluationMeta
  /** The Evaluation data per set: easy is `trace`; hard, when given, has its own database. */
  evaluations: Partial<Record<EvaluationSet, ReplaySet>>
}

/** The scoreboard fields the Evaluation band shows (model, budgetUsd.total, runAt, notes). */
export function evaluationMetaOf(evaluation: unknown): EvaluationMeta | undefined {
  const e = evaluation as
    { model?: unknown; budgetUsd?: { total?: unknown }; runAt?: unknown; notes?: unknown } | undefined
  if (typeof e?.model !== 'string' || typeof e.budgetUsd?.total !== 'number' || typeof e.runAt !== 'string')
    return undefined
  const notes = Array.isArray(e.notes) ? e.notes.filter((n): n is string => typeof n === 'string') : []
  return { model: e.model, limitUsd: e.budgetUsd.total, finishedAt: e.runAt, notes }
}

/** A database with only the hard set's evaluation (its runs, playbook history and lessons). */
function hardSet(evaluation: SeedEvaluation, now: Date): ReplaySet {
  const trace = openTrace(':memory:')
  migrate(trace)
  seed(trace, now, { evaluation }) // hard.json says `set: "hard"`: the seed picks the hard requests
  return { trace, exampleData: false, meta: evaluationMetaOf(evaluation) }
}

/** The replay database, with the real scoreboard when there is one, and whether it is example data. */
export function loadReplay({
  file,
  evaluation,
  hardEvaluation,
  now = new Date(),
}: ReplayOptions = {}): Replay {
  let trace: TraceDb
  // Only for a file known to be seeded from this scoreboard: the servers seed in memory instead,
  // so a stale file can never show old numbers under a "measured" label.
  if (file && existsSync(file)) {
    trace = new DatabaseSync(file, { readOnly: true })
    trace.exec('PRAGMA foreign_keys = ON;')
  } else {
    trace = openTrace(':memory:')
    migrate(trace)
    seed(trace, now, { evaluation })
  }
  const exampleData = evaluation === undefined
  const evaluationMeta = evaluationMetaOf(evaluation)
  return {
    trace,
    exampleData,
    evaluationMeta,
    evaluations: {
      easy: { trace, exampleData, meta: evaluationMeta },
      ...(hardEvaluation ? { hard: hardSet(hardEvaluation, now) } : {}),
    },
  }
}
