// The flags of `pnpm eval`, checked before anything runs. A budget that isn't a number would turn
// into NaN, and every "spent + run > NaN" check would pass: the cap would be gone. So every number
// is validated here, and a bad value stops the command with what to fix.

import { parseArgs } from 'node:util'

/** Budgets above this need `--confirm-budget`, so a typo can't buy a large evaluation. */
export const MAX_BUDGET_USD = 20

export interface EvalArgs {
  rounds: number
  epochs: number
  concurrency: number
  budgetUsd: number
  curveBudgetUsd: number
  requests?: string[]
  trace: string
  out: string
  report: boolean
}

const positive = (name: string, raw: string): number => {
  const n = Number(raw)
  if (raw.trim() === '' || !Number.isFinite(n) || n <= 0)
    throw new Error(`--${name} must be a number of dollars above 0, like 5 or 0.5 (got "${raw}").`)
  return n
}

const count = (name: string, raw: string): number => {
  const n = Number(raw)
  if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(n) || n < 1)
    throw new Error(`--${name} must be a whole number of 1 or more (got "${raw}").`)
  return n
}

export function parseEvalArgs(argv: string[], defaults: { trace: string; out: string }): EvalArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      rounds: { type: 'string', default: '3' },
      epochs: { type: 'string', default: '3' },
      budget: { type: 'string', default: '5' },
      'curve-budget': { type: 'string', default: '3' },
      concurrency: { type: 'string', default: '6' },
      requests: { type: 'string' },
      trace: { type: 'string', default: defaults.trace },
      out: { type: 'string', default: defaults.out },
      report: { type: 'boolean', default: false },
      'confirm-budget': { type: 'boolean', default: false },
    },
  })
  const args: EvalArgs = {
    rounds: count('rounds', values.rounds),
    epochs: count('epochs', values.epochs),
    concurrency: count('concurrency', values.concurrency),
    budgetUsd: positive('budget', values.budget),
    curveBudgetUsd: positive('curve-budget', values['curve-budget']),
    requests: values.requests
      ?.split(',')
      .map((r) => r.trim())
      .filter(Boolean),
    trace: values.trace,
    out: values.out,
    report: values.report,
  }
  for (const [name, usd] of [
    ['budget', args.budgetUsd],
    ['curve-budget', args.curveBudgetUsd],
  ] as const)
    if (usd > MAX_BUDGET_USD && !values['confirm-budget'])
      throw new Error(
        `--${name} $${usd} is above $${MAX_BUDGET_USD}. Add --confirm-budget if you mean to spend that much.`,
      )
  if (args.requests?.length === 0) throw new Error('--requests needs at least one request id.')
  return args
}
