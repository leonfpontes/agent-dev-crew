import { describe, expect, it } from 'vitest'

import {
  LATEST_VERSION,
  migrate,
  MIGRATIONS,
  openTrace,
  schemaVersion,
  type Migration,
  type TraceDb,
} from './index.js'

const objects = (db: TraceDb) =>
  (
    db
      .prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
      .all() as {
      type: string
      name: string
    }[]
  ).map((o) => `${o.type} ${o.name}`)

const TABLES = ['costs', 'events', 'lessons', 'playbook_versions', 'runs', 'schema_migrations', 'steps']

describe('migrations', () => {
  it('go up to the latest version with the six tables and the screen indexes', () => {
    const db = openTrace()
    expect(migrate(db)).toEqual([1, 2])
    expect(schemaVersion(db)).toBe(LATEST_VERSION)
    const all = objects(db)
    expect(all.filter((o) => o.startsWith('table ')).map((o) => o.slice(6))).toEqual(TABLES)
    expect(all.filter((o) => o.startsWith('index ')).length).toBe(10)
  })

  it('go back down to an empty database, and up again', () => {
    const db = openTrace()
    migrate(db)
    expect(migrate(db, 0)).toEqual([2, 1])
    expect(objects(db)).toEqual(['table schema_migrations'])
    expect(migrate(db)).toEqual([1, 2])
    expect(objects(db).filter((o) => o.startsWith('table '))).toHaveLength(TABLES.length)
  })

  it.each(MIGRATIONS.map((m) => [m.version, m.name] as const))(
    'migration %i (%s) is undone exactly by its down',
    (version) => {
      const db = openTrace()
      migrate(db, version - 1)
      const before = objects(db)
      migrate(db, version)
      expect(objects(db)).not.toEqual(before)
      migrate(db, version - 1)
      expect(objects(db)).toEqual(before)
    },
  )

  it('does nothing when the database is already at the target', () => {
    const db = openTrace()
    migrate(db)
    expect(migrate(db)).toEqual([])
  })

  it('refuses a version that does not exist, or a database newer than the code', () => {
    const db = openTrace()
    expect(() => migrate(db, 3)).toThrow("Schema version 3 doesn't exist; the latest is 2.")
    expect(() => migrate(db, -1)).toThrow("Schema version -1 doesn't exist")
    migrate(db)
    db.prepare("INSERT INTO schema_migrations VALUES (9, 'from the future', '2030-01-01')").run()
    expect(() => migrate(db)).toThrow('The database is at version 9, newer than this code (2).')
  })

  it('rolls back a migration that fails, leaving the version before it', () => {
    const db = openTrace()
    const broken: Migration[] = [
      ...MIGRATIONS,
      { version: 3, name: 'broken', up: 'CREATE TABLE half (id INTEGER); SELECT * FROM missing;', down: '' },
    ]
    expect(() => migrate(db, 3, broken)).toThrow(/no such table: missing/)
    expect(schemaVersion(db)).toBe(2)
    expect(objects(db)).not.toContain('table half')
  })

  it('keeps a file database, with write-ahead logging', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const path = await import('node:path')
    const dir = mkdtempSync(path.join(tmpdir(), 'crew-trace-'))
    const file = path.join(dir, 'nested', 'trace.sqlite')
    const db = openTrace(file)
    migrate(db)
    expect((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode).toBe('wal')
    db.close()
    const again = openTrace(file)
    expect(schemaVersion(again)).toBe(LATEST_VERSION)
    again.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('schema rules', () => {
  const fresh = () => {
    const db = openTrace()
    migrate(db)
    db.prepare(
      "INSERT INTO playbook_versions (version, title, content, status, source, created_at, decided_at) VALUES (1, 'v1', '# Rules', 'approved', 'initial', '2026-11-19', '2026-11-19')",
    ).run()
    return db
  }
  const run = (over: Record<string, unknown> = {}) => ({
    id: 1,
    title: 'Paginate GET /orders',
    request: 'GET /orders returns at most limit orders.',
    request_id: null,
    variant: 'crew',
    playbook_version: null,
    origin: 'live',
    eval_suite: null,
    eval_round: null,
    status: 'passed',
    failure_reason: null,
    repo_ref: 'fernhill-orders@9c2e71b',
    model: 'claude-haiku-5-5',
    budget_micros: 250000,
    started_at: '2026-11-26T10:00:00.000Z',
    duration_ms: 1000,
    ...over,
  })
  const insertRun = (db: TraceDb, over: Record<string, unknown> = {}) => {
    const r = run(over)
    const cols = Object.keys(r)
    db.prepare(`INSERT INTO runs (${cols.join(', ')}) VALUES (${cols.map((c) => `:${c}`).join(', ')})`).run(
      r as Record<string, null | number | string>,
    )
  }

  it('accepts a well-formed run', () => {
    const db = fresh()
    insertRun(db)
    expect(db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({ n: 1 })
  })

  it.each([
    ['an unknown status', { status: 'done' }],
    ['an unknown variant', { variant: 'two-agents' }],
    ['a failed run without a reason', { status: 'failed' }],
    ['a reason on a run that did not fail', { failure_reason: 'error' }],
    ['a finished run without a duration', { duration_ms: null }],
    ['a waiting run with a duration', { status: 'waiting' }],
    ['an evaluation run without a round', { origin: 'eval', eval_suite: 'main', request_id: 'cancel-order' }],
    ['a crew-playbook run without a playbook version', { variant: 'crew-playbook' }],
    ['a crew run with a playbook version', { playbook_version: 1 }],
    ['a playbook version that does not exist', { variant: 'crew-playbook', playbook_version: 4 }],
  ])('refuses %s', (_name, over) => {
    expect(() => insertRun(fresh(), over)).toThrow()
  })

  it('refuses a step with an unknown status, a role on the gate or a decision off the gate', () => {
    const db = fresh()
    insertRun(db)
    const step = db.prepare(
      'INSERT INTO steps (run_id, seq, kind, role, status, decision, decided_by) VALUES (1, ?, ?, ?, ?, ?, ?)',
    )
    expect(() => step.run(1, 'code', 'engineer', 'done', null, null)).toThrow()
    expect(() => step.run(2, 'gate', 'po', 'approved', 'approve', 'person')).toThrow()
    expect(() => step.run(3, 'code', 'engineer', 'passed', 'approve', 'person')).toThrow()
    expect(() => step.run(4, 'gate', null, 'approved', 'approve', null)).toThrow()
    step.run(5, 'gate', null, 'approved', 'approve', 'policy')
  })

  it('refuses event payloads that are not JSON', () => {
    const db = fresh()
    insertRun(db)
    const event = db.prepare(
      "INSERT INTO events (run_id, seq, offset_ms, kind, payload) VALUES (1, ?, 0, 'log', ?)",
    )
    expect(() => event.run(1, '{not json')).toThrow()
    event.run(2, '{"ok":true}')
  })

  it('deletes the steps, events, costs and lessons of a deleted run', () => {
    const db = fresh()
    insertRun(db)
    db.prepare(
      "INSERT INTO steps (id, run_id, seq, kind, role, status) VALUES (10, 1, 1, 'code', 'engineer', 'passed')",
    ).run()
    db.prepare(
      "INSERT INTO events (run_id, step_id, seq, offset_ms, kind) VALUES (1, 10, 1, 0, 'step.started')",
    ).run()
    db.prepare(
      "INSERT INTO costs (run_id, step_id, model, input_tokens, output_tokens, cost_micros, offset_ms) VALUES (1, 10, 'm', 1, 1, 1, 0)",
    ).run()
    db.prepare(
      "INSERT INTO lessons (run_id, step_id, position, error, cause, rule, section, status) VALUES (1, 10, 1, 'e', 'c', 'r', 'QA', 'rejected')",
    ).run()
    db.prepare('DELETE FROM runs WHERE id = 1').run()
    for (const table of ['steps', 'events', 'costs', 'lessons']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toEqual({ n: 0 })
    }
  })
})
