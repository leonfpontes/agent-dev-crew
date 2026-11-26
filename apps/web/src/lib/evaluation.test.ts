import { describe, expect, it } from 'vitest'

import {
  bestOf,
  costDigits,
  headline,
  labelWidth,
  niceMax,
  placeLabels,
  sortRows,
  spread,
  tick,
  times,
} from './evaluation'
import type { EvaluationResponse, MatrixRow, VariantStats } from './types'

const stat = (variant: VariantStats['variant'], pass: number, costMicros: number): VariantStats => ({
  variant,
  playbookVersion: variant === 'crew-playbook' ? 1 : null,
  rounds: 3,
  passRate: { mean: pass, sd: 0.05 },
  costMicrosPerRequest: { mean: costMicros, sd: 500 },
  tokensPerRequest: { mean: 1000, sd: 10 },
  durationMsPerRequest: { mean: 60_000, sd: 1000 },
  fixLoopsPerRequest: { mean: 0, sd: 0 },
  gateInterventions: 0,
  gates: 30,
  costMicros: costMicros * 30,
})
const data = (main: VariantStats[]): EvaluationResponse => ({
  exampleData: false,
  main,
  learningCurve: { points: [], variants: [] },
  matrix: [],
})

describe('the headline follows the numbers, whichever way they fall', () => {
  it('crew ahead by more than the two ± together', () => {
    expect(headline(data([stat('single-agent', 0.4, 21_000), stat('crew-playbook', 0.7667, 43_000)]))).toBe(
      'The crew with the playbook passes all hidden tests on 77% of the requests vs 40% for one agent, at 2× the cost.',
    )
  })
  it('compares one agent with the best crew variant, and calls an equal score a tie', () => {
    expect(
      headline(
        data([
          stat('single-agent', 1, 5_450),
          stat('crew', 1, 16_639),
          stat('crew-playbook', 0.9667, 15_922),
        ]),
      ),
    ).toBe(
      'One agent and the crew both pass all hidden tests on 100% of the requests; the crew costs 3.1× as much.',
    )
  })
  it('calls a gap within the ± a tie too', () => {
    expect(headline(data([stat('single-agent', 1, 5_000), stat('crew-playbook', 0.95, 15_000)]))).toBe(
      'One agent and the crew with the playbook pass all hidden tests on 100% and 95% of the requests, a gap within the ±; the crew costs 3× as much.',
    )
  })
  it('one agent ahead', () => {
    expect(headline(data([stat('single-agent', 0.9, 5_000), stat('crew', 0.5, 15_000)]))).toBe(
      'One agent passes all hidden tests on 90% of the requests vs 50% for the crew, which costs 3× as much.',
    )
  })
  it('nothing to compare', () => {
    expect(headline(data([stat('crew', 1, 1)]))).toBeNull()
  })
})

describe('evaluation helpers', () => {
  it('times, digits, axis steps and ticks', () => {
    expect(times(2.04)).toBe('2×')
    expect(times(3.06)).toBe('3.1×')
    expect(costDigits([5_450, 16_000])).toBe(4)
    expect(costDigits([21_000, 46_000])).toBe(3)
    expect(niceMax(0.055)).toBeCloseTo(0.06)
    expect(niceMax(0.0205)).toBeCloseTo(0.03)
    expect(tick(0.015)).toBe('0.015')
    expect(tick(0.03)).toBe('0.03')
    expect(tick(0)).toBe('0.00')
  })

  it('checks every best value on a tie, and none when all share it', () => {
    const a = stat('single-agent', 1, 5_000)
    const b = stat('crew', 1, 16_000)
    const c = stat('crew-playbook', 0.97, 15_000)
    expect(bestOf([a, b, c], (s) => s.passRate.mean, true)).toEqual(['single-agent', 'crew'])
    expect(bestOf([a, b], (s) => s.passRate.mean, true)).toEqual([])
    expect(bestOf([a, b], (s) => s.costMicrosPerRequest.mean)).toEqual(['single-agent'])
    expect(bestOf([a], (s) => s.costMicrosPerRequest.mean)).toEqual([])
  })

  it('sorts requests by disagreement, weakness and size', () => {
    const rows: MatrixRow[] = [
      {
        requestId: 'a',
        title: 'A',
        hiddenTests: 3,
        results: { 'single-agent': [true, true, true], 'crew-playbook': [true, true, true] },
      },
      {
        requestId: 'b',
        title: 'B',
        hiddenTests: 7,
        results: { 'single-agent': [false, false, false], 'crew-playbook': [true, true, false] },
      },
      {
        requestId: 'c',
        title: 'C',
        hiddenTests: 5,
        results: { 'single-agent': [true, false, false], 'crew-playbook': [false, false, false] },
      },
    ]
    expect(spread(rows[1]!)).toBe(2)
    expect(sortRows(rows, 'order').map((r) => r.requestId)).toEqual(['a', 'b', 'c'])
    expect(sortRows(rows, 'disagree').map((r) => r.requestId)).toEqual(['b', 'c', 'a'])
    expect(sortRows(rows, 'weak').map((r) => r.requestId)).toEqual(['c', 'b', 'a'])
    expect(sortRows(rows, 'hidden').map((r) => r.requestId)).toEqual(['b', 'c', 'a'])
  })

  it('places labels of close marks without overlap', () => {
    const marks = [
      { x: 160, y: 20, text: 'Single agent · 100% · $0.0054' },
      { x: 400, y: 20, text: 'Crew · 100% · $0.0166' },
      { x: 390, y: 26, text: 'Crew + playbook · 97% · $0.0159' },
    ]
    const out = placeLabels(marks)
    const boxes = out.map((o, i) => {
      const w = labelWidth(marks[i]!.text)
      const l = o.anchor === 'start' ? o.x : o.anchor === 'end' ? o.x - w : o.x - w / 2
      return { l, r: l + w, t: o.y - 11, b: o.y + 3 }
    })
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!
        const b = boxes[j]!
        expect(a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b).toBe(false)
      }
  })
})
