// The published scoreboard against its sources: its own runs, the Markdown copy, and the replay
// seed the app reads. If a number in the README or the app disagrees with latest.json, this fails.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { meanSd } from '@crew/trace'
import { describe, expect, it } from 'vitest'

import { parseResults, toMarkdown } from './results.js'
import { expectReplayToMatch } from './test/replay.js'

const resultsRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../results')
// The easy set (the baseline) in latest.json, the hard set in hard.json once it has run.
const boards = [
  { name: 'evals/results/latest.json', stem: 'latest', set: 'easy' },
  { name: 'evals/results/hard.json', stem: 'hard', set: 'hard' },
].filter((b) => existsSync(path.join(resultsRoot, `${b.stem}.json`)))

describe.each(boards)('$name', ({ stem, set }) => {
  const results = parseResults(JSON.parse(readFileSync(path.join(resultsRoot, `${stem}.json`), 'utf8')))

  it('says which request set it measured', () => {
    expect(results.set).toBe(set)
  })

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

  it('is what its .md says', () => {
    const squash = (text: string) =>
      text
        .replace(/[ -]+\|/g, '|')
        .replace(/\|[ -]+/g, '|')
        .trim()
    expect(squash(readFileSync(path.join(resultsRoot, `${stem}.md`), 'utf8'))).toBe(
      squash(toMarkdown(results)),
    )
  })

  // Each set seeds its own replay database (the hard one holds only its evaluation).
  it('is what the replay demo shows: the seed reproduces every number of the scoreboard', () => {
    expectReplayToMatch(results)
  })
})
