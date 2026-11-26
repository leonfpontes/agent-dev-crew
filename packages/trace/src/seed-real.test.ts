// The replay seed with a real evaluation: its runs give the Evaluation screen the measured numbers,
// its playbook history replaces the example one, and the example runs point at real versions.
import { describe, expect, it } from 'vitest'

import {
  evaluationSummary,
  getRun,
  learningCurve,
  migrate,
  openTrace,
  playbookHistory,
  requestMatrix,
  seed,
  stepEvents,
  type SeedEvaluation,
} from './index.js'

const V1 =
  '# Playbook\n\n## PO\n\n- Plan.\n\n## Engineer\n\n- Read first.\n\n## Reviewer\n\n- Review.\n\n## QA\n\n- Test.\n'
const V2 = V1.replace('- Read first.\n', '- Read first.\n- Run the tests after each write.\n')

const run = (
  id: number,
  extra: Partial<SeedEvaluation['runs'][number]> = {},
): SeedEvaluation['runs'][number] => ({
  id,
  requestId: 'cancel-order',
  variant: 'crew',
  playbookVersion: null,
  suite: 'main',
  round: 1,
  status: 'passed',
  failureReason: null,
  testsPassed: 24,
  testsTotal: 24,
  hiddenPassed: 6,
  hiddenTotal: 6,
  costMicros: 12_345,
  tokens: { input: 100, cacheRead: 9_000, cacheWrite: 4_000, output: 1_500 },
  durationMs: 41_234,
  fixLoops: 0,
  gates: 1,
  ...extra,
})

const EVALUATION: SeedEvaluation = {
  runs: [
    run(1, { suite: 'learning-curve', variant: 'crew-playbook', playbookVersion: 1, round: 11 }),
    run(2, { variant: 'single-agent', gates: 0, costMicros: 3_001, hiddenPassed: 4 }),
    run(3, { fixLoops: 2, status: 'failed', failureReason: 'fix-loops-exhausted', hiddenPassed: 5 }),
    run(4, { variant: 'crew-playbook', playbookVersion: 2, fixLoops: 1 }),
    run(5, { variant: 'single-agent', gates: 0, round: 2 }),
    run(6, {
      round: 2,
      status: 'failed',
      failureReason: 'error',
      gates: 0,
      testsPassed: null,
      testsTotal: null,
      hiddenPassed: 0,
    }),
    run(7, { variant: 'crew-playbook', playbookVersion: 2, round: 2 }),
  ],
  playbook: {
    versions: [
      {
        version: 1,
        title: 'Initial playbook',
        status: 'approved',
        source: 'initial',
        sourceRunId: null,
        decidedBy: null,
        content: V1,
      },
      {
        version: 2,
        title: 'Run the tests after each write',
        status: 'approved',
        source: 'retro',
        sourceRunId: 1,
        decidedBy: 'policy',
        content: V2,
      },
    ],
    lessons: [
      {
        runId: 1,
        position: 1,
        error: 'The engineer wrote without running the tests.',
        cause: 'Nothing asked for it.',
        rule: 'Run the tests after each write.',
        section: 'Engineer',
        status: 'accepted',
        playbookVersion: 2,
        duplicateOf: null,
      },
    ],
  },
}

function seeded() {
  const db = openTrace(':memory:')
  migrate(db)
  seed(db, new Date('2026-11-26T12:00:00Z'), { evaluation: EVALUATION })
  return db
}

describe('seed with a real evaluation', () => {
  it('gives the Evaluation screen the measured numbers, run by run', () => {
    const db = seeded()
    const summary = evaluationSummary(db, 'main')
    const crew = summary.find((s) => s.variant === 'crew')!
    expect(crew.rounds).toBe(2)
    expect(crew.passRate).toEqual({ mean: 0, sd: 0 })
    expect(crew.costMicros).toBe(12_345 * 2)
    expect(crew.fixLoopsPerRequest.mean).toBe(1)
    expect(crew.gates).toBe(1) // the run that failed before the gate has none
    expect(crew.gateInterventions).toBe(0)
    const solo = summary.find((s) => s.variant === 'single-agent')!
    expect(solo.passRate).toEqual({ mean: 0.5, sd: Math.SQRT1_2 })
    expect(solo.tokensPerRequest.mean).toBe(14_600)
    expect(solo.durationMsPerRequest.mean).toBe(41_234)
    expect(learningCurve(db)).toEqual([
      { playbookVersion: 1, rounds: 1, passRate: { mean: 1, sd: 0 } },
      { playbookVersion: 2, rounds: 2, passRate: { mean: 1, sd: 0 } },
    ])
    expect(requestMatrix(db)[0]).toMatchObject({ requestId: 'cancel-order', hiddenTests: 6 })
  })

  it('replaces the playbook history with the real one, plus the example proposal on top', () => {
    const db = seeded()
    const history = playbookHistory(db) as { version: number; status: string; decided_by: string | null }[]
    expect([...new Set(history.map((h) => `${h.version}:${h.status}`))]).toEqual([
      '3:proposed',
      '2:approved',
      '1:approved',
    ])
    expect(history.find((h) => h.version === 2)?.decided_by).toBe('policy')
    const v2Lesson = db.prepare('SELECT run_id, rule FROM lessons WHERE playbook_version = 2').get() as {
      run_id: number
    }
    expect(getRun(db, v2Lesson.run_id)!.run).toMatchObject({ origin: 'eval', eval_suite: 'learning-curve' })
  })

  it('points the example runs at real versions, with the rules those versions have', () => {
    const db = seeded()
    expect(getRun(db, 142)!.run.playbook_version).toBe(2)
    const fix = getRun(db, 142)!.steps.find((s) => s.kind === 'fix')!
    const request = stepEvents(db, fix.id).find((e) => e.kind === 'model.request')!
    expect(request.payload).toMatchObject({
      playbook: { version: 2, section: 'Engineer' },
      rules: ['Read first.', 'Run the tests after each write.'],
    })
    // #142's lesson proposes v3; the example lessons whose rule the real playbook lacks are rejected.
    const lessons = db
      .prepare(
        'SELECT run_id, status, playbook_version FROM lessons WHERE run_id IN (137, 142) ORDER BY run_id, position',
      )
      .all()
    expect(lessons).toEqual([
      { run_id: 137, status: 'rejected', playbook_version: null },
      { run_id: 142, status: 'proposed', playbook_version: 3 },
      { run_id: 142, status: 'rejected', playbook_version: null },
    ])
  })
})
