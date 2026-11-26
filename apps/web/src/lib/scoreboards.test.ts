import { describe, expect, it } from 'vitest'

import { leadSet, scoreSets, setHeadline, setNumbers } from './scoreboards'

const variant = (v: string, pass: number, sd: number, cost: number, version: number | null = null) => ({
  variant: v,
  playbookVersion: version,
  passRate: { mean: pass, sd },
  costUsdPerRequest: { mean: cost, sd: 0 },
  secondsPerRequest: { mean: 60, sd: 0 },
  fixLoopsPerRequest: { mean: 0, sd: 0 },
})

describe('scoreboards', () => {
  it('reads every scoreboard of evals/results, the hard set first', () => {
    const sets = scoreSets()
    expect(sets.length).toBeGreaterThan(0)
    expect(sets.map((s) => s.set)).toEqual([...sets.map((s) => s.set)].sort((a) => (a === 'hard' ? -1 : 1)))
    for (const s of sets) expect(s.file).toMatch(/^evals\/results\/.+\.json$/)
  })

  it('compares one agent with the best crew variant, in the words the numbers allow', () => {
    const hard = scoreSets({
      'x/evals/results/hard.json': {
        set: 'hard',
        requests: 8,
        rounds: 3,
        main: [
          variant('single-agent', 1, 0, 0.0274),
          variant('crew', 0.875, 0, 0.0529),
          variant('crew-playbook', 0.833, 0.072, 0.064, 12),
        ] as never,
      },
      'x/evals/results/latest.json': {
        set: 'easy',
        requests: 10,
        rounds: 3,
        main: [variant('single-agent', 1, 0, 0.0054), variant('crew', 1, 0, 0.0166)] as never,
      },
    })
    expect(leadSet(hard)!.set).toBe('hard')
    expect(setNumbers(hard[0]!)).toMatchObject({
      oneAgent: 100,
      crew: 88,
      crewLabel: 'the crew',
      costRatio: '1.9×',
    })
    expect(setHeadline(hard[0]!)).toBe(
      'On the hard set, one agent passes all hidden tests on 100% of the requests vs 88% for the crew, which costs 1.9× as much.',
    )
    expect(setHeadline(hard[1]!)).toBe(
      'On the easy set, one agent and the crew both pass all hidden tests on 100% of the requests; the crew costs 3.1× as much.',
    )
  })
})
