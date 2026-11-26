// The replay seed against its sources: the numbers of the approved design, frozen below (the
// requests check lives in evals). If the seed changes, the screens built on it change too.

import { describe, expect, it } from 'vitest'

import {
  apportion,
  diffStat,
  evaluationSummary,
  getRun,
  learningCurve,
  listRuns,
  migrate,
  openTrace,
  playbookHistory,
  requestMatrix,
  runsSummary,
  seed,
  SEED_NOW,
  SEED_PLAYBOOK,
  SEED_REQUESTS,
  stepEvents,
  unifiedDiff,
} from './index.js'

const db = openTrace()
migrate(db)
const counts = seed(db)

// Approved design values (Runs, Run detail, Playbook and Evaluation screens), frozen here.
const DESIGN = {
  runs: { runs: 8, finished: 7, passed: 4, costMicros: 479_000, medianDurationMs: 125_000, fixLoops: 3 },
  runRows: [
    [143, 'waiting', 4_000, 2_616, null],
    [142, 'passed', 51_000, 31_200, 232_000],
    [141, 'passed', 32_000, 19_800, 125_000],
    [140, 'failed', 88_000, 54_000, 341_000],
    [139, 'failed', 250_000, 152_000, 250_000],
    [138, 'rejected', 3_000, 2_100, 48_000],
    [137, 'passed', 27_000, 16_400, 108_000],
    [136, 'passed', 24_000, 14_900, 72_000],
  ],
  costByPart142: { po: 4_000, engineer: 30_000, reviewer: 8_000, qa: 6_000, retro: 3_000 },
  // variant: pass % ± sd, cost per request (micros) ± sd, tokens ± sd, seconds ± sd, fix loops ± sd
  eval: {
    'single-agent': [40, 10, 21_000, 3_000, 13_100, 1_400, 70, 9, 0, 0],
    crew: [63, 6, 46_000, 5_000, 28_400, 2_200, 168, 14, 0.9, 0.2],
    'crew-playbook': [77, 6, 43_000, 4_000, 26_900, 1_900, 151, 11, 0.5, 0.1],
  },
  evalCostMicros: 3_300_000,
  curve: [
    [1, 3, 60, 10],
    [3, 1, 70, 0],
    [5, 1, 70, 0],
    [6, 1, 80, 0],
    [7, 3, 77, 6],
  ],
}

describe('seed', () => {
  it('writes the runs, steps, events, costs, lessons and playbook versions', () => {
    expect(counts).toMatchObject({ runs: 8 + 90 + 60, lessons: 3, playbookVersions: 8 })
    expect(counts.steps).toBeGreaterThan(counts.runs)
    expect(counts.events).toBeGreaterThan(counts.steps)
  })

  it('refuses to seed a database that already has data', () => {
    expect(() => seed(db)).toThrow('The trace database is not empty')
  })

  it('is deterministic for the same now', () => {
    const other = openTrace()
    migrate(other)
    seed(other, SEED_NOW)
    const dump = (d: typeof db) => JSON.stringify(d.prepare('SELECT * FROM events ORDER BY id').all())
    expect(dump(other)).toBe(dump(db))
  })
})

describe('Runs screen', () => {
  const rows = listRuns(db)

  it('lists the 8 recorded runs, newest first, with cost, tokens and duration', () => {
    expect(rows.map((r) => [r.id, r.status, r.cost_micros, r.tokens, r.duration_ms])).toEqual(DESIGN.runRows)
  })

  it('adds up to the numbers above the table', () => {
    expect(runsSummary(rows)).toEqual(DESIGN.runs)
  })

  it('filters by status, variant and search', () => {
    expect(listRuns(db, { status: 'failed' }).map((r) => r.id)).toEqual([140, 139])
    expect(listRuns(db, { variant: 'single-agent' }).map((r) => r.id)).toEqual([136])
    expect(listRuns(db, { search: 'csv' }).map((r) => r.id)).toEqual([138])
    expect(listRuns(db, { limit: 2 })).toHaveLength(2)
  })

  it('shows "2 min ago" for the run at the gate and "Yesterday" for #138', () => {
    const at = (id: number) =>
      (SEED_NOW.getTime() - Date.parse(rows.find((r) => r.id === id)!.started_at)) / 60_000
    expect(at(143)).toBe(2)
    expect(at(138)).toBeGreaterThanOrEqual(24 * 60)
  })
})

describe('Run detail screen', () => {
  const run142 = getRun(db, 142)!

  it('splits the cost of #142 by role for the stacked bar', () => {
    expect(run142.costByPart).toEqual(DESIGN.costByPart142)
  })

  it('has the pipeline of #142 in order, with the fix loop and its two children', () => {
    expect(run142.steps.map((s) => [s.kind, s.status, s.parent_id === null ? 0 : 1])).toEqual([
      ['plan', 'passed', 0],
      ['gate', 'approved', 0],
      ['code', 'passed', 0],
      ['review', 'passed', 0],
      ['test', 'failed', 0],
      ['fix-loop', 'fix-loop', 0],
      ['fix', 'passed', 1],
      ['test', 'passed', 1],
      ['retro', 'passed', 0],
    ])
    const gate = run142.steps[1]!
    expect([gate.decision, gate.decided_by, gate.duration_ms]).toEqual(['approve', 'person', 72_000])
    expect(run142.run).toMatchObject({ hidden_passed: 6, hidden_total: 6, tests_passed: 24, tests_total: 24 })
  })

  it('records the Engineer fix of #142 in full: tokens, prompt, 4 tool calls, response', () => {
    const fix = run142.steps.find((s) => s.kind === 'fix')!
    expect([
      fix.input_tokens + fix.cache_read_tokens,
      fix.cache_read_tokens,
      fix.output_tokens,
      fix.cost_micros,
    ]).toEqual([4_612, 3_408, 788, 11_000])
    expect([fix.attempt, fix.max_attempts, fix.duration_ms]).toEqual([2, 3, 22_000])
    const events = stepEvents(db, fix.id)
    expect(events.filter((e) => e.kind === 'tool.call')).toHaveLength(4)
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(['model.request', 'model.response']))
    expect(events.map((e) => e.seq)).toEqual([...events.map((e) => e.seq)].sort((a, b) => a - b))
  })

  it('has a diff of 3 files, +42 −1', () => {
    const diff = run142.run.diff as string
    expect(diff.match(/^diff --git/gm)).toHaveLength(3)
    expect(diffStat(diff)).toEqual({ added: 42, removed: 1 })
  })

  it('stops #143 at the gate with the plan to approve and nothing after it started', () => {
    const run143 = getRun(db, 143)!
    expect(run143.run).toMatchObject({ status: 'waiting', duration_ms: null })
    expect(run143.steps.map((s) => s.status)).toEqual([
      'passed',
      'waiting',
      'queued',
      'queued',
      'queued',
      'queued',
    ])
    const planEvent = stepEvents(db, run143.steps[0]!.id).find((e) => e.kind === 'model.response')!
    expect(planEvent.payload).toMatchObject({ plan: { files: ['src/routes/cart.ts', 'tests/cart.test.ts'] } })
  })

  it('keeps every event in time order and every cost on a step of the same run', () => {
    const bad = db
      .prepare(
        `SELECT COUNT(*) AS n FROM events a JOIN events b ON a.run_id = b.run_id AND a.seq < b.seq AND a.offset_ms > b.offset_ms`,
      )
      .get() as { n: number }
    expect(bad.n).toBe(0)
    const mismatched = db
      .prepare(
        'SELECT COUNT(*) AS n FROM costs c JOIN steps s ON s.id = c.step_id WHERE s.run_id <> c.run_id',
      )
      .get() as { n: number }
    expect(mismatched.n).toBe(0)
  })

  it('shows the retro of #142: one lesson proposed as v8, one dropped as a duplicate of v6', () => {
    expect(run142.lessons.map((l) => [l.position, l.status, l.playbook_version, l.duplicate_of])).toEqual([
      [1, 'proposed', 8, null],
      [2, 'duplicate', null, 6],
    ])
  })
})

describe('Playbook screen', () => {
  const history = playbookHistory(db)

  it('lists v8 to v1, with v8 waiting for approval', () => {
    expect(history.map((v) => v.version)).toEqual([8, 7, 6, 5, 4, 3, 2, 1])
    expect(history[0]).toMatchObject({
      status: 'proposed',
      source_run_id: 142,
      lesson_run_id: 142,
      lesson_step_kind: 'test',
    })
    expect(history.slice(1).every((v) => v.status === 'approved')).toBe(true)
  })

  it('stores each diff from the version before, and v8 adds one rule to the Engineer', () => {
    for (const [i, v] of SEED_PLAYBOOK.entries()) {
      const stored = history.find((h) => h.version === v.version)!
      expect(stored.diff, `v${v.version}`).toBe(
        i === 0 ? null : unifiedDiff(SEED_PLAYBOOK[i - 1]!.content, v.content),
      )
    }
    const v8 = history[0]!.diff as string
    expect(diffStat(v8)).toEqual({ added: 1, removed: 0 })
    expect(v8).toContain('+- Before changing a status field, find every reader of it')
  })

  it('changes only wording in v2 and v4', () => {
    for (const version of [2, 4])
      expect(diffStat(history.find((h) => h.version === version)!.diff as string)).toEqual({
        added: 1,
        removed: 1,
      })
  })
})

describe('Evaluation screen', () => {
  const round = (n: number, digits = 0) => Number(n.toFixed(digits))

  it.each(Object.entries(DESIGN.eval))(
    '%s matches the design, mean ± sd of 3 rounds',
    (variant, expected) => {
      const v = evaluationSummary(db).find((s) => s.variant === variant)!
      expect(v.rounds).toBe(3)
      expect([
        round(v.passRate.mean * 100),
        round(v.passRate.sd * 100),
        round(v.costMicrosPerRequest.mean),
        round(v.costMicrosPerRequest.sd),
        round(v.tokensPerRequest.mean),
        round(v.tokensPerRequest.sd),
        round(v.durationMsPerRequest.mean / 1000),
        round(v.durationMsPerRequest.sd / 1000),
        round(v.fixLoopsPerRequest.mean, 1),
        round(v.fixLoopsPerRequest.sd, 1),
      ]).toEqual(expected)
    },
  )

  it('costs $3.30 in all, with no gate intervention in 30 crew runs per variant', () => {
    const summary = evaluationSummary(db)
    expect(summary.reduce((s, v) => s + v.costMicros, 0)).toBe(DESIGN.evalCostMicros)
    for (const v of summary.filter((s) => s.variant !== 'single-agent'))
      expect([v.gates, v.gateInterventions]).toEqual([30, 0])
  })

  it('draws the learning curve per playbook version', () => {
    expect(
      learningCurve(db).map((p) => [
        p.playbookVersion,
        p.rounds,
        round(p.passRate.mean * 100),
        round(p.passRate.sd * 100),
      ]),
    ).toEqual(DESIGN.curve)
  })

  it('has one row per request with 3 rounds per variant and the hidden test count', () => {
    const matrix = requestMatrix(db)
    expect(matrix.map((r) => [r.requestId, r.hiddenTests])).toEqual(
      SEED_REQUESTS.map((r) => [r.id, r.hiddenTests]),
    )
    for (const r of matrix)
      for (const v of ['single-agent', 'crew', 'crew-playbook'] as const) expect(r.results[v]).toHaveLength(3)
    expect(matrix[3]!.results['crew-playbook']).toEqual([true, false, false])
  })

  it('never lets an evaluation run use more than 2 fix loops', () => {
    const worst = db
      .prepare(
        "SELECT MAX(n) AS n FROM (SELECT COUNT(*) AS n FROM steps WHERE kind = 'fix-loop' GROUP BY run_id)",
      )
      .get() as { n: number }
    expect(worst.n).toBeLessThanOrEqual(2)
  })
})

describe('apportion', () => {
  it('splits a total into whole parts that add up exactly', () => {
    const parts = apportion(1001, [1, 1, 1])
    expect(parts.reduce((s, p) => s + p, 0)).toBe(1001)
    expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1)
  })
})
