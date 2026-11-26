// The replay database: the recorded example runs, with nothing to call and nothing to pay for.
// Locally it is `.crew/replay.sqlite` (`pnpm --filter @crew/trace seed`), opened read-only; where no
// file exists (a serverless function), the same seed is written into an in-memory database.

import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { migrate, openTrace, seed, type TraceDb } from '@crew/trace'

export function openReplay(file?: string, now = new Date()): TraceDb {
  if (file && existsSync(file)) {
    const db = new DatabaseSync(file, { readOnly: true })
    db.exec('PRAGMA foreign_keys = ON;')
    return db
  }
  const db = openTrace(':memory:')
  migrate(db)
  seed(db, now)
  return db
}
