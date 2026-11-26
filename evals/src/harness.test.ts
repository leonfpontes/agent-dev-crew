// The harness with a scripted model (no API): the order of the suites, the learning by policy, the
// budgets that stop runs before they start, and the scoreboard computed from the trace.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createRoleSpecs, flatPrice, ScriptedProvider, text, toolUse, type Script } from '@crew/engine'
import { migrate, openTrace } from '@crew/trace'
import { afterAll, describe, expect, it } from 'vitest'

import { Budget, CURVE_ROUND_BASE, pool, runEvaluation } from './harness.js'
import { loadRequests } from './requests.js'
import { buildResults, parseResults, toMarkdown, type ResultsMeta } from './results.js'
import { expectReplayToMatch } from './test/replay.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const requestsDir = path.join(root, 'evals/requests')
const exampleDir = path.join(root, 'examples/fernhill-orders')
const { requests } = loadRequests(requestsDir, exampleDir)
const one = requests.filter((r) => r.id === 'cancel-order')

const dirs: string[] = []
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))
const temp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'crew-eval-'))
  dirs.push(d)
  return d
}

const PLAN = {
  steps: ['Add the route'],
  acceptance: ['A pending order can be cancelled'],
  files: [],
  estimateUsd: 0.01,
}
const turns =
  (...answers: ReturnType<Script>[]): Script =>
  (_req, turn) =>
    answers[turn] ?? [text('Done.')]

/** A crew that changes nothing (visible tests stay green, hidden tests fail) and a retro with one lesson. */
const provider = () =>
  new ScriptedProvider({
    po: turns([toolUse('submit_plan', PLAN)]),
    engineer: turns(),
    reviewer: turns([toolUse('submit_review', { verdict: 'approve', comments: ['Nothing changed yet.'] })]),
    qa: turns(),
    solo: turns(),
    retro: turns([
      toolUse('submit_lessons', {
        lessons: [
          {
            error: 'The engineer changed nothing.',
            cause: 'It stopped before writing.',
            rule: 'Write the change before you report it done.',
            section: 'Engineer',
            step: 1,
          },
        ],
      }),
    ]),
  })

const roles = createRoleSpecs({ models: { primary: 'model-small' }, allowedModels: ['model-small'] })

function setup() {
  const dir = temp()
  const trace = openTrace(path.join(dir, 'eval.sqlite'))
  migrate(trace)
  return { trace, dir }
}

const meta = (extra: Partial<ResultsMeta> = {}): ResultsMeta => ({
  runAt: '2026-11-26T12:00:00.000Z',
  model: 'model-small',
  fallbackModel: null,
  promptVersion: 'abc123def456',
  repoRef: 'fernhill-orders@0000000',
  requests: 1,
  rounds: 1,
  concurrency: 2,
  budgetUsd: { total: 5, learningCurve: 3, perRun: 0.25 },
  stoppedEarly: false,
  learnedVersion: 1,
  ...extra,
})

describe('Budget', () => {
  it('reserves a run only if it fits the total and its suite, and settles the real spend', () => {
    const b = new Budget(1_000, { 'learning-curve': 400 })
    expect(b.reserve('learning-curve', 300)).toBe(true)
    expect(b.reserve('learning-curve', 300)).toBe(false) // the curve cap
    expect(b.reserve('main', 600)).toBe(true)
    expect(b.reserve('main', 200)).toBe(false) // the total cap counts reservations
    b.settle('learning-curve', 300, 120)
    b.settle('main', 600, 50)
    expect(b.spent).toBe(170)
    expect(b.bySuite).toEqual({ main: 50, 'learning-curve': 120 })
    expect(b.reserve('main', 800)).toBe(true)
  })
})

describe('pool', () => {
  it('runs every item with at most `limit` at once', async () => {
    let running = 0
    let peak = 0
    const done: number[] = []
    await pool([1, 2, 3, 4, 5], 2, async (n) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 5))
      done.push(n)
      running--
    })
    expect(done.sort()).toEqual([1, 2, 3, 4, 5])
    expect(peak).toBe(2)
  })
})

describe('runEvaluation', () => {
  it('learns a version by policy, then runs the ablation on it and the first version’s other rounds', async () => {
    const { trace, dir } = setup()
    const scripted = provider()
    const outcome = await runEvaluation({
      trace,
      provider: scripted,
      price: flatPrice(1, 5),
      requests: one,
      requestsDir,
      exampleDir,
      workRoot: path.join(dir, 'runs'),
      roles,
      retroModels: { primary: 'model-small' },
      rounds: 2,
      epochs: 1,
      concurrency: 3,
    })
    expect(outcome).toMatchObject({ stoppedEarly: false, epochVersions: [1], learnedVersion: 2, errors: [] })
    // 1 learning run + 2 rounds × 3 variants + v1's round 2.
    expect(outcome.runs).toBe(8)
    const runs = trace
      .prepare('SELECT eval_suite, variant, playbook_version, eval_round, hidden_total FROM runs ORDER BY id')
      .all()
    expect(runs).toContainEqual({
      eval_suite: 'learning-curve',
      variant: 'crew-playbook',
      playbook_version: 1,
      eval_round: CURVE_ROUND_BASE + 1,
      hidden_total: 6,
    })
    expect(runs).toContainEqual({
      eval_suite: 'learning-curve',
      variant: 'crew-playbook',
      playbook_version: 1,
      eval_round: CURVE_ROUND_BASE + 2,
      hidden_total: 6,
    })
    expect(runs.filter((r) => (r as { eval_suite: string }).eval_suite === 'main')).toHaveLength(6)
    expect(trace.prepare('SELECT status, decided_by FROM playbook_versions WHERE version = 2').get()).toEqual(
      {
        status: 'approved',
        decided_by: 'policy',
      },
    )
    // The ablation runs no retro: only the learning run asked for lessons.
    expect(scripted.calls.filter((c) => c.agent === 'retro')).toHaveLength(1)

    const results = buildResults(trace, meta({ rounds: 2, learnedVersion: outcome.learnedVersion }))
    expect(results.main.map((m) => [m.variant, m.playbookVersion, m.rounds, m.runs])).toEqual([
      ['single-agent', null, 2, 2],
      ['crew', null, 2, 2],
      ['crew-playbook', 2, 2, 2],
    ])
    expect(results.main[0]!.passRate).toEqual({ mean: 0, sd: 0 })
    expect(results.main[1]!.gates).toBe(2)
    // v1: 2 curve rounds (hollow at 2); v2: the 2 ablation rounds.
    expect(results.curve.map((p) => [p.playbookVersion, p.rounds, p.rules])).toEqual([
      [1, 2, 4],
      [2, 2, 5],
    ])
    expect(results.playbook.lessons).toMatchObject([
      { section: 'Engineer', status: 'accepted', playbookVersion: 2 },
    ])
    expect(results.spentUsd.total).toBeCloseTo(outcome.spentMicros / 1e6, 6)
    expect(results.spentUsd.main + results.spentUsd.learningCurve).toBeCloseTo(results.spentUsd.total, 6)
    expect(parseResults(JSON.parse(JSON.stringify(results)))).toEqual(results)
    // The replay seed fed with this scoreboard shows the same numbers on every screen query.
    expectReplayToMatch(results)
    const md = toMarkdown(results)
    expect(md).toContain('| Crew + playbook v2 (learned) | 0% ± 0 |')
    expect(md).toContain(
      'The retro proposed 1 lessons in 1 learning runs; 1 became rules, taking the playbook from v1 to v2.',
    )
    expect(md).toContain('| v1 | 4 | 2 | 0% ± 0 |')
    trace.close()
  }, 240_000)

  it('refuses rounds, epochs or runs at once that are not whole numbers of 1 or more', async () => {
    const { trace, dir } = setup()
    const base = {
      trace,
      provider: provider(),
      price: flatPrice(1, 5),
      requests: one,
      requestsDir,
      exampleDir,
      workRoot: path.join(dir, 'runs'),
      roles,
    }
    await expect(runEvaluation({ ...base, rounds: 0 })).rejects.toThrow('rounds must be a whole number')
    await expect(runEvaluation({ ...base, concurrency: Number.NaN })).rejects.toThrow(
      'concurrency must be a whole number',
    )
    await expect(runEvaluation({ ...base, totalBudgetMicros: Number.NaN })).rejects.toThrow('finite amount')
    trace.close()
  })

  it('starts no run once the budget left is under one run’s budget, and says it stopped early', async () => {
    const { trace, dir } = setup()
    const scripted = provider()
    const outcome = await runEvaluation({
      trace,
      provider: scripted,
      price: flatPrice(1, 5),
      requests: one,
      requestsDir,
      exampleDir,
      workRoot: path.join(dir, 'runs'),
      roles,
      retroModels: { primary: 'model-small' },
      rounds: 1,
      epochs: 1,
      totalBudgetMicros: 100_000,
      runBudgetMicros: 250_000,
    })
    expect(outcome).toMatchObject({ runs: 0, stoppedEarly: true, spentMicros: 0, learnedVersion: 1 })
    expect(outcome.skipped).toBe(4) // the learning run and the 3 ablation runs
    expect(scripted.calls).toHaveLength(0)
    trace.close()
  })
})
