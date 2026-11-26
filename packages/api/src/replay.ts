// The replay database: the recorded runs, with nothing to call and nothing to pay for.
// Locally it is `.crew/replay.sqlite` (`pnpm --filter @crew/trace seed`), opened read-only; where no
// file exists (a serverless function), the same seed is written into an in-memory database.
// With the real scoreboard (evals/results/latest.json) the Evaluation screen and the playbook
// history are measured data; without it they are the seed's example numbers.

import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { migrate, openTrace, seed, type SeedEvaluation, type TraceDb } from '@crew/trace'

/** The replay database with the seed's example evaluation: a file when it exists, else in memory. */
export function openReplay(file?: string, now = new Date()): TraceDb {
  return loadReplay({ file, now }).trace
}

export interface ReplayOptions {
  /** A seeded database file; opened read-only when it exists. */
  file?: string
  /** The real scoreboard. Seeds the in-memory database, and says the file was seeded with it. */
  evaluation?: SeedEvaluation
  now?: Date
}

export interface Replay {
  trace: TraceDb
  /** True when the Evaluation numbers are the seed's examples, not a measurement. */
  exampleData: boolean
}

/** The replay database, with the real scoreboard when there is one, and whether it is example data. */
export function loadReplay({ file, evaluation, now = new Date() }: ReplayOptions = {}): Replay {
  // `pnpm demo` seeds the file from the same scoreboard right before it serves it.
  if (file && existsSync(file)) {
    const trace = new DatabaseSync(file, { readOnly: true })
    trace.exec('PRAGMA foreign_keys = ON;')
    return { trace, exampleData: evaluation === undefined }
  }
  const trace = openTrace(':memory:')
  migrate(trace)
  seed(trace, now, { evaluation })
  return { trace, exampleData: evaluation === undefined }
}
