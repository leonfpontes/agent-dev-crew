// The flags of `pnpm eval`: a value that isn't a valid number stops the command before any call,
// because a NaN budget would make every cap check pass.
import { describe, expect, it } from 'vitest'

import { MAX_BUDGET_USD, parseEvalArgs } from './args.js'
import { Budget } from './harness.js'

const defaults = { trace: '/tmp/eval.sqlite', out: '/tmp/results' }
const parse = (...argv: string[]) => parseEvalArgs(argv, defaults)

describe('parseEvalArgs', () => {
  it('has the defaults of the official run', () => {
    expect(parse()).toEqual({
      set: 'easy',
      probe: false,
      runBudgetUsd: 0.25,
      rounds: 3,
      epochs: 3,
      concurrency: 6,
      budgetUsd: 5,
      curveBudgetUsd: 3,
      requests: undefined,
      trace: '/tmp/eval.sqlite',
      out: '/tmp/results',
      report: false,
    })
  })

  it('reads every flag', () => {
    expect(
      parse(
        '--rounds',
        '1',
        '--epochs',
        '2',
        '--concurrency',
        '4',
        '--budget',
        '0.5',
        '--curve-budget',
        '0.2',
        '--requests',
        'cancel-order, export-csv',
        '--report',
      ),
    ).toMatchObject({
      rounds: 1,
      epochs: 2,
      concurrency: 4,
      budgetUsd: 0.5,
      curveBudgetUsd: 0.2,
      requests: ['cancel-order', 'export-csv'],
      report: true,
    })
  })

  it.each([['5$'], ['abc'], [''], ['0'], ['-1'], ['Infinity'], ['NaN']])(
    'refuses the budget "%s", which would lift the cap',
    (value) => {
      expect(() => parse(`--budget=${value}`)).toThrow('--budget must be a number of dollars above 0')
      expect(() => parse(`--curve-budget=${value}`)).toThrow(
        '--curve-budget must be a number of dollars above 0',
      )
    },
  )

  it.each([['0'], ['1.5'], ['two'], ['-3'], ['']])('refuses %s rounds, epochs or runs at once', (value) => {
    for (const flag of ['rounds', 'epochs', 'concurrency'])
      expect(() => parse(`--${flag}=${value}`)).toThrow(`--${flag} must be a whole number of 1 or more`)
  })

  it('picks the request set, and a probe defaults to 1 round and $0.50 with its own paths', () => {
    const paths = (set: string, probe: boolean) => ({
      trace: `/t/${set}-${probe}`,
      out: `/o/${set}-${probe}`,
    })
    expect(parseEvalArgs(['--set', 'hard'], paths)).toMatchObject({
      set: 'hard',
      rounds: 3,
      budgetUsd: 5,
      trace: '/t/hard-false',
    })
    expect(parseEvalArgs(['--set', 'hard', '--probe', '--run-budget', '0.1'], paths)).toMatchObject({
      set: 'hard',
      probe: true,
      rounds: 1,
      budgetUsd: 0.5,
      runBudgetUsd: 0.1,
      out: '/o/hard-true',
    })
    expect(() => parse('--set', 'medium')).toThrow('--set must be one of easy, hard')
    expect(() => parse('--run-budget=0')).toThrow('--run-budget must be a number of dollars above 0')
  })

  it(`asks for --confirm-budget above $${MAX_BUDGET_USD}`, () => {
    expect(() => parse('--budget', '50')).toThrow('Add --confirm-budget')
    expect(parse('--budget', '50', '--confirm-budget').budgetUsd).toBe(50)
  })

  it('refuses an empty --requests and an unknown flag', () => {
    expect(() => parse('--requests', ' , ')).toThrow('--requests needs at least one request id')
    expect(() => parse('--budjet', '5')).toThrow()
  })
})

describe('Budget', () => {
  it('refuses a cap that is not a finite amount above 0', () => {
    expect(() => new Budget(Number.NaN, {})).toThrow('A budget must be a finite amount above 0')
    expect(() => new Budget(5_000_000, { 'learning-curve': Number.NaN })).toThrow('finite amount')
    expect(() => new Budget(0, {})).toThrow('finite amount')
  })
})
