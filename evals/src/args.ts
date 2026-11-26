// The flags of `pnpm eval`, checked before anything runs. A budget that isn't a number would turn
// into NaN, and every "spent + run > NaN" check would pass: the cap would be gone. So every number
// is validated here, and a bad value stops the command with what to fix.

import { parseArgs } from 'node:util'

import { isRequestSet, REQUEST_SETS, type RequestSet } from './requests.js'

/** Budgets above this need `--confirm-budget`, so a typo can't buy a large evaluation. */
export const MAX_BUDGET_USD = 20

export interface EvalArgs {
  set: RequestSet
  /** One round of the single agent, no learning: a cheap check of how hard the requests are. */
  probe: boolean
  /** Continue a stopped evaluation in its trace: only the ablation runs it lacks, no learning. */
  resume: boolean
  runBudgetUsd: number
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

export function parseEvalArgs(
  argv: string[],
  defaults:
    { trace: string; out: string } | ((set: RequestSet, probe: boolean) => { trace: string; out: string }),
): EvalArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      set: { type: 'string', default: 'easy' },
      probe: { type: 'boolean', default: false },
      resume: { type: 'boolean', default: false },
      'run-budget': { type: 'string', default: '0.25' },
      rounds: { type: 'string' },
      epochs: { type: 'string', default: '3' },
      budget: { type: 'string' },
      'curve-budget': { type: 'string', default: '3' },
      concurrency: { type: 'string', default: '6' },
      requests: { type: 'string' },
      trace: { type: 'string' },
      out: { type: 'string' },
      report: { type: 'boolean', default: false },
      'confirm-budget': { type: 'boolean', default: false },
    },
  })
  if (!isRequestSet(values.set))
    throw new Error(`--set must be one of ${REQUEST_SETS.join(', ')} (got "${values.set}").`)
  const set: RequestSet = values.set
  const probe = values.probe
  const paths = typeof defaults === 'function' ? defaults(set, probe) : defaults
  const args: EvalArgs = {
    set,
    probe,
    resume: values.resume,
    runBudgetUsd: positive('run-budget', values['run-budget']),
    rounds: count('rounds', values.rounds ?? (probe ? '1' : '3')),
    epochs: count('epochs', values.epochs),
    concurrency: count('concurrency', values.concurrency),
    budgetUsd: positive('budget', values.budget ?? (probe ? '0.5' : '5')),
    curveBudgetUsd: positive('curve-budget', values['curve-budget']),
    requests: values.requests
      ?.split(',')
      .map((r) => r.trim())
      .filter(Boolean),
    trace: values.trace ?? paths.trace,
    out: values.out ?? paths.out,
    report: values.report,
  }
  for (const [name, usd] of [
    ['budget', args.budgetUsd],
    ['curve-budget', args.curveBudgetUsd],
    ['run-budget', args.runBudgetUsd],
  ] as const)
    if (usd > MAX_BUDGET_USD && !values['confirm-budget'])
      throw new Error(
        `--${name} $${usd} is above $${MAX_BUDGET_USD}. Add --confirm-budget if you mean to spend that much.`,
      )
  if (args.requests?.length === 0) throw new Error('--requests needs at least one request id.')
  return args
}
