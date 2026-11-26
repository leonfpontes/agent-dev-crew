// Opens the trace database (one SQLite file under .crew/, or ':memory:' in tests) and moves its
// schema to a version. Node's built-in node:sqlite: nothing to compile on install (ADR 0002).

import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { LATEST_VERSION, MIGRATIONS, type Migration } from './migrations.js'

export type TraceDb = DatabaseSync

/** Opens the database with foreign keys on and, for a file, write-ahead logging. */
export function openTrace(file = ':memory:'): TraceDb {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;')
  return db
}

const BOOKKEEPING = /* sql */ `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT;
`

/** The schema version the database is at (0 = empty). */
export function schemaVersion(db: TraceDb): number {
  db.exec(BOOKKEEPING)
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null }
  return row.v ?? 0
}

function inTransaction(db: TraceDb, work: () => void) {
  db.exec('BEGIN IMMEDIATE')
  try {
    work()
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/**
 * Moves the schema up or down to `target` (default: the latest), one migration per transaction.
 * A migration that fails leaves the database at the version before it. Returns the versions
 * applied (up) or reverted (down), in the order they ran.
 */
export function migrate(
  db: TraceDb,
  target: number = LATEST_VERSION,
  migrations: readonly Migration[] = MIGRATIONS,
): number[] {
  if (!Number.isInteger(target) || target < 0 || target > migrations.length) {
    throw new Error(`Schema version ${target} doesn't exist; the latest is ${migrations.length}.`)
  }
  const current = schemaVersion(db)
  if (current > migrations.length) {
    throw new Error(`The database is at version ${current}, newer than this code (${migrations.length}).`)
  }
  const ran: number[] = []
  for (let v = current + 1; v <= target; v++) {
    const m = migrations[v - 1] as Migration
    inTransaction(db, () => {
      db.exec(m.up)
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        new Date().toISOString(),
      )
    })
    ran.push(v)
  }
  for (let v = current; v > target; v--) {
    const m = migrations[v - 1] as Migration
    inTransaction(db, () => {
      db.exec(m.down)
      db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(m.version)
    })
    ran.push(v)
  }
  return ran
}
