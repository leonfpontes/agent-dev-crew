import { describe, expect, it } from 'vitest'

import { meanSd, migrate, openTrace, runsSummary, SQL, type RunListRow } from './index.js'

const db = openTrace()
migrate(db)

/** The plan SQLite picks for a query, one line per step. */
const plan = (sql: string) =>
  (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all({}) as { detail: string }[]).map((r) => r.detail)

const PARAMS: Record<keyof typeof SQL, Record<string, null | number | string>> = {
  listRuns: { status: null, variant: null, search: null, limit: 50 },
  getRun: { id: 142 },
  steps: { run: 142 },
  costByRole: { run: 142 },
  events: { step: 1 },
  runLessons: { run: 142 },
  playbookVersions: {},
  evalRounds: { suite: 'main' },
  learningCurve: {},
  requestMatrix: {},
}

describe('screen queries', () => {
  it.each(Object.keys(SQL) as (keyof typeof SQL)[])('%s runs and never scans a whole child table', (name) => {
    expect(() => db.prepare(SQL[name]).all(PARAMS[name])).not.toThrow()
    const lines = plan(SQL[name])
    // A full scan of runs or playbook_versions is fine where the screen lists them all, in index
    // order; steps, events, costs and lessons are always reached through an index.
    expect(
      lines.filter((l) => /^SCAN (s|c|l|e|steps|costs|events|lessons)\b(?! USING)/.test(l)),
      lines.join('\n'),
    ).toEqual([])
  })

  it('reads the Runs list newest first from the start-time index, with no sort', () => {
    const lines = plan(SQL.listRuns)
    expect(lines.some((l) => l.includes('runs_list'))).toBe(true)
    expect(lines.some((l) => l.includes('USE TEMP B-TREE FOR ORDER BY'))).toBe(false)
  })

  it('reads a run, its steps and its costs by key', () => {
    expect(plan(SQL.getRun).join()).toContain('USING INTEGER PRIMARY KEY')
    expect(plan(SQL.steps).join()).toMatch(/SEARCH s USING INDEX sqlite_autoindex_steps_1 \(run_id=\?\)/)
    expect(plan(SQL.steps).join()).toMatch(/SEARCH c USING INDEX costs_by_step \(step_id=\?\)/)
    expect(plan(SQL.events).join()).toContain('events_by_step')
  })

  it('reads the evaluation through the suite index', () => {
    expect(plan(SQL.evalRounds).join()).toContain('runs_by_eval')
    expect(plan(SQL.requestMatrix).join()).toContain('runs_by_eval')
  })
})

describe('meanSd', () => {
  it('gives the mean and the sample standard deviation', () => {
    const { mean, sd, n } = meanSd([0.8, 0.8, 0.7])
    expect(n).toBe(3)
    expect(mean).toBeCloseTo(0.7667, 4)
    expect(sd).toBeCloseTo(0.0577, 4)
  })

  it('gives 0 for one value and NaN for none', () => {
    expect(meanSd([0.7])).toEqual({ mean: 0.7, sd: 0, n: 1 })
    expect(Number.isNaN(meanSd([]).mean)).toBe(true)
  })
})

describe('runsSummary', () => {
  const row = (over: Partial<RunListRow>): RunListRow => ({
    id: 1,
    title: 't',
    status: 'passed',
    failure_reason: null,
    variant: 'crew',
    playbook_version: null,
    origin: 'live',
    started_at: '2026-11-26T10:00:00Z',
    duration_ms: 1000,
    cost_micros: 10,
    tokens: 5,
    fix_loops: 0,
    ...over,
  })

  it('takes the median of finished runs, the mean of the middle two when even', () => {
    expect(runsSummary([row({ duration_ms: 1000 }), row({ duration_ms: 3000 })]).medianDurationMs).toBe(2000)
    expect(runsSummary([row({ duration_ms: null, status: 'waiting' })])).toMatchObject({
      runs: 1,
      finished: 0,
      passed: 0,
      medianDurationMs: null,
    })
  })
})
