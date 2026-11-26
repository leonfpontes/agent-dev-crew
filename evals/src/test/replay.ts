// Test helper: the replay seed fed with a scoreboard, read back with the screens' queries.
import { evaluationSummary, learningCurve, migrate, openTrace, requestMatrix, seed } from '@crew/trace'
import { expect } from 'vitest'

import type { Results } from '../results.js'

/** Seeds a replay database with the scoreboard and reads it back with the screens' queries. */
export function replayOf(r: Results) {
  const db = openTrace(':memory:')
  migrate(db)
  seed(db, new Date(r.runAt), { evaluation: r })
  return db
}

/** Compares the screens' numbers with the scoreboard (money in micros, so exact up to rounding). */
export function expectReplayToMatch(r: Results) {
  const db = replayOf(r)
  const summary = evaluationSummary(db, 'main')
  for (const m of r.main) {
    const s = summary.find((x) => x.variant === m.variant && x.playbookVersion === m.playbookVersion)!
    expect(s.rounds).toBe(m.rounds)
    expect(s.passRate).toEqual(m.passRate)
    expect(s.costMicrosPerRequest.mean / 1e6).toBeCloseTo(m.costUsdPerRequest.mean, 9)
    expect(s.costMicrosPerRequest.sd / 1e6).toBeCloseTo(m.costUsdPerRequest.sd, 9)
    expect(s.tokensPerRequest).toEqual(m.tokensPerRequest)
    expect(s.durationMsPerRequest.mean / 1000).toBeCloseTo(m.secondsPerRequest.mean, 6)
    expect(s.fixLoopsPerRequest).toEqual(m.fixLoopsPerRequest)
    expect(s.gates).toBe(m.gates)
    expect(s.gateInterventions).toBe(m.gateInterventions)
    expect(s.costMicros / 1e6).toBeCloseTo(m.costUsd, 9)
  }
  expect(learningCurve(db)).toEqual(
    r.curve.map((p) => ({ playbookVersion: p.playbookVersion, rounds: p.rounds, passRate: p.passRate })),
  )
  expect(requestMatrix(db)).toEqual(r.matrix)
  db.close()
}
