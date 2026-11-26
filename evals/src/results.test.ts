// The published scoreboard against its sources: its own runs, the Markdown copy, and the replay
// seed the app reads. If a number in the README or the app disagrees with latest.json, this fails.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { meanSd } from '@crew/trace'
import { describe, expect, it } from 'vitest'

import { parseResults, toMarkdown } from './results.js'
import { expectReplayToMatch } from './test/replay.js'

const resultsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../results')
const results = parseResults(JSON.parse(readFileSync(path.join(resultsDir, 'latest.json'), 'utf8')))

describe('evals/results/latest.json', () => {
  it('agrees with its own runs: pass rate and cost per variant, rounds, and the total spent', () => {
    for (const m of results.main) {
      const mine = results.runs.filter((x) => x.suite === 'main' && x.variant === m.variant)
      const rounds = [...new Set(mine.map((x) => x.round))]
      expect(rounds).toHaveLength(m.rounds)
      const rate = meanSd(
        rounds.map((round) => {
          const these = mine.filter((x) => x.round === round)
          return these.filter((x) => x.hiddenPassed === x.hiddenTotal).length / these.length
        }),
      )
      expect({ mean: rate.mean, sd: rate.sd }).toEqual(m.passRate)
      expect(mine.reduce((s, x) => s + x.costMicros, 0) / 1e6).toBeCloseTo(m.costUsd, 9)
    }
    const total = results.runs.reduce((s, x) => s + x.costMicros, 0) / 1e6
    expect(total).toBeCloseTo(results.spentUsd.total, 9)
    expect(results.spentUsd.total).toBeLessThanOrEqual(results.budgetUsd.total)
    expect(results.spentUsd.learningCurve).toBeLessThanOrEqual(results.budgetUsd.learningCurve)
  })

  it('has every round of every request when it did not stop early', () => {
    if (results.stoppedEarly) return
    for (const m of results.main) expect(m.runs).toBe(results.requests * results.rounds)
  })

  it('is what latest.md says', () => {
    const squash = (text: string) =>
      text
        .replace(/[ -]+\|/g, '|')
        .replace(/\|[ -]+/g, '|')
        .trim()
    expect(squash(readFileSync(path.join(resultsDir, 'latest.md'), 'utf8'))).toBe(squash(toMarkdown(results)))
  })

  it('is what the replay demo shows: the seed reproduces every number of the scoreboard', () => {
    expectReplayToMatch(results)
  })
})
