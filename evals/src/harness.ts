// The evaluation harness: the ablation (single agent × crew × crew with the learned playbook,
// `rounds` rounds of every request) and the learning curve, under hard budgets.
//
// Order:
//   1. Learning (suite `learning-curve`): each epoch runs every request with the crew and the
//      current playbook, with the retro on; then the logged policy approves the proposals in order.
//      An epoch with nothing new ends the learning.
//   2. Ablation (suite `main`): every request × variant × round, no retro. `crew-playbook` runs the
//      learned version, so those three rounds are also the curve's last point.
//   3. The first version gets its other rounds (suite `learning-curve`, no retro), so the curve's
//      first and last points have every round and the middle ones have one.
//
// Budgets: before a run starts, the harness reserves the run's own budget (the engine never spends
// more than that); a run that wouldn't fit the total or its suite's cap doesn't start. So the spend
// can't pass the caps, whatever the runs cost.

import { rmSync } from 'node:fs'
import path from 'node:path'

import type { Variant } from '@crew/core'
import {
  approveByPolicy,
  createRetro,
  createRoleSpecs,
  currentPlaybook,
  decidePlaybookVersion,
  ensurePlaybook,
  runCrew,
  scoreHiddenTests,
  type ModelProvider,
  type PriceFn,
  type RoleSpecs,
} from '@crew/engine'
import type { EvalSuite, TraceDb } from '@crew/trace'

import type { LoadedRequest } from './requests.js'

/** Curve runs number their rounds from here, so they never share a round with the main suite. */
export const CURVE_ROUND_BASE = 10
export const RUN_BUDGET_MICROS = 250_000
export const MAIN_VARIANTS: Variant[] = ['single-agent', 'crew', 'crew-playbook']

export interface EvalOptions {
  trace: TraceDb
  provider: ModelProvider
  price: PriceFn
  requests: LoadedRequest[]
  requestsDir: string
  exampleDir: string
  workRoot: string
  roles?: RoleSpecs
  retroModels?: { primary: string; fallback?: string }
  rounds?: number
  /** Learning epochs at most (stops early when an epoch proposes nothing). */
  epochs?: number
  totalBudgetMicros?: number
  curveBudgetMicros?: number
  runBudgetMicros?: number
  concurrency?: number
  testTimeoutMs?: number
  /** Variants of the ablation (default all three). A probe runs only the single agent. */
  variants?: Variant[]
  /** Learning epochs and the curve's other rounds (default on). Off for a probe. */
  learning?: boolean
  /**
   * Resume a stopped evaluation in the same trace: runs only the ablation runs it doesn't have yet
   * (same suite, variant, round and request), on the playbook version already learned. Use it with
   * `learning: false`, so no curve round is left half done.
   */
  skipExisting?: boolean
  log?: (line: string) => void
  now?: () => Date
}

export interface EvalJob {
  suite: EvalSuite
  variant: Variant
  request: LoadedRequest
  round: number
  playbookVersion?: number
  retro: boolean
}

export interface EvalOutcome {
  spentMicros: number
  spentBySuite: Record<EvalSuite, number>
  runs: number
  skipped: number
  stoppedEarly: boolean
  /** The playbook version each learning epoch ran, then the learned one. */
  epochVersions: number[]
  learnedVersion: number
  errors: string[]
}

/** Spend and reservations against the total cap and each suite's cap. */
export class Budget {
  spent = 0
  private reserved = 0
  readonly bySuite: Record<EvalSuite, number> = { main: 0, 'learning-curve': 0 }
  private reservedBySuite: Record<EvalSuite, number> = { main: 0, 'learning-curve': 0 }

  constructor(
    readonly total: number,
    readonly caps: Partial<Record<EvalSuite, number>>,
  ) {
    // NaN would make every "spent + run > cap" check false and lift the cap: refuse it here too.
    for (const cap of [total, ...Object.values(caps)])
      if (!Number.isFinite(cap) || (cap as number) <= 0)
        throw new Error(`A budget must be a finite amount above 0, got ${cap}.`)
  }

  reserve(suite: EvalSuite, micros: number): boolean {
    if (this.spent + this.reserved + micros > this.total) return false
    const cap = this.caps[suite]
    if (cap !== undefined && this.bySuite[suite] + this.reservedBySuite[suite] + micros > cap) return false
    this.reserved += micros
    this.reservedBySuite[suite] += micros
    return true
  }

  settle(suite: EvalSuite, reservedMicros: number, spentMicros: number) {
    this.reserved -= reservedMicros
    this.reservedBySuite[suite] -= reservedMicros
    this.spent += spentMicros
    this.bySuite[suite] += spentMicros
    for (const wake of this.waiting.splice(0)) wake()
  }

  private waiting: (() => void)[] = []

  /**
   * Reserves when the run fits; otherwise waits for a run in flight to settle and tries again (a
   * finished run frees its reservation and usually spent far less). False only when nothing is in
   * flight and the run still doesn't fit: the budget is really spent.
   */
  async reserveOrWait(suite: EvalSuite, micros: number): Promise<boolean> {
    for (;;) {
      if (this.reserve(suite, micros)) return true
      if (this.reserved === 0) return false
      await new Promise<void>((wake) => this.waiting.push(wake))
    }
  }
}

/** Runs `jobs` with at most `limit` at a time, in order. */
export async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) await work(items[next++]!)
  })
  await Promise.all(workers)
}

export async function runEvaluation(options: EvalOptions): Promise<EvalOutcome> {
  const {
    trace,
    provider,
    price,
    requests,
    rounds = 3,
    epochs = 3,
    runBudgetMicros = RUN_BUDGET_MICROS,
    concurrency = 6,
  } = options
  for (const [name, n] of Object.entries({ rounds, epochs, concurrency, runBudgetMicros }))
    if (!Number.isSafeInteger(n) || n < 1)
      throw new Error(`${name} must be a whole number of 1 or more, got ${n}.`)
  const log = options.log ?? (() => {})
  const now = options.now ?? (() => new Date())
  const roles = options.roles ?? createRoleSpecs()
  const budget = new Budget(options.totalBudgetMicros ?? 5_000_000, {
    'learning-curve': options.curveBudgetMicros ?? 3_000_000,
  })
  const outcome: EvalOutcome = {
    spentMicros: 0,
    spentBySuite: budget.bySuite,
    runs: 0,
    skipped: 0,
    stoppedEarly: false,
    epochVersions: [],
    learnedVersion: 1,
    errors: [],
  }
  const first = ensurePlaybook(trace, now())
  const retro = createRetro({ trace, models: options.retroModels, now })

  const runJob = async (job: EvalJob) => {
    const label = `${job.suite} ${job.variant}${job.playbookVersion ? ` v${job.playbookVersion}` : ''} r${job.round} ${job.request.id}`
    if (!(await budget.reserveOrWait(job.suite, runBudgetMicros))) {
      outcome.skipped++
      outcome.stoppedEarly = true
      log(`skip  ${label}: the budget left can't cover one more run`)
      return
    }
    let spent = 0
    try {
      const playbook =
        job.variant === 'crew-playbook'
          ? { version: job.playbookVersion!, content: versionContent(trace, job.playbookVersion!) }
          : undefined
      const result = await runCrew({
        trace,
        provider,
        price,
        roles,
        gate: approveByPolicy,
        request: { id: job.request.id, title: job.request.title, request: job.request.request },
        variant: job.variant,
        playbook,
        origin: 'eval',
        evalSuite: job.suite,
        evalRound: job.round,
        exampleDir: options.exampleDir,
        workRoot: options.workRoot,
        budgetMicros: runBudgetMicros,
        testTimeoutMs: options.testTimeoutMs,
        retro: job.retro ? retro : undefined,
      })
      spent = result.costMicros
      const files = job.request.hiddenTests.map((f) => path.join(options.requestsDir, job.request.id, f))
      const hidden = await scoreHiddenTests(trace, result.runId, result.workspace.dir, files, {
        timeoutMs: options.testTimeoutMs,
      })
      // The failing hidden tests go to the log (not the trace): what the data story calibrates with.
      if (hidden.error) log(`      hidden tests did not run: ${hidden.error.slice(0, 300)}`)
      for (const f of hidden.failures)
        log(`      hidden fail ${job.request.id}: ${f.name}: ${f.message.replace(/\s+/g, ' ').slice(0, 300)}`)
      rmSync(path.dirname(result.workspace.dir), { recursive: true, force: true })
      outcome.runs++
      log(
        `done  ${label}: #${result.runId} ${result.status}${result.failureReason ? ` (${result.failureReason})` : ''}, hidden ${hidden.passed}/${hidden.total}, $${(spent / 1e6).toFixed(4)}`,
      )
    } catch (error) {
      outcome.errors.push(`${label}: ${(error as Error).message}`)
      log(`error ${label}: ${(error as Error).message}`)
    } finally {
      budget.settle(job.suite, runBudgetMicros, spent)
      outcome.spentMicros = budget.spent
    }
  }

  const variants = options.variants ?? MAIN_VARIANTS
  const learning = options.learning ?? true

  // 1. Learning.
  for (let epoch = 1; learning && epoch <= epochs; epoch++) {
    const version = currentPlaybook(trace).version
    outcome.epochVersions.push(version)
    log(`learning epoch ${epoch}: playbook v${version}`)
    const jobs = requests.map((request): EvalJob => ({
      suite: 'learning-curve',
      variant: 'crew-playbook',
      request,
      round: CURVE_ROUND_BASE + 1,
      playbookVersion: version,
      retro: true,
    }))
    await pool(jobs, concurrency, runJob)
    const proposed = trace
      .prepare("SELECT version FROM playbook_versions WHERE status = 'proposed' ORDER BY version")
      .all() as { version: number }[]
    for (const p of proposed) decidePlaybookVersion(trace, p.version, 'approve', 'policy', now())
    log(`learning epoch ${epoch}: ${proposed.length} proposals approved by policy`)
    if (proposed.length === 0 || outcome.stoppedEarly) break
  }
  outcome.learnedVersion = currentPlaybook(trace).version
  // The learned version is measured by the ablation; drop it from the epochs list if it ran there.
  if (outcome.epochVersions.at(-1) === outcome.learnedVersion) outcome.epochVersions.pop()

  // 2. Ablation.
  const main: EvalJob[] = []
  for (let round = 1; round <= rounds; round++)
    for (const request of requests)
      for (const variant of variants)
        main.push({
          suite: 'main',
          variant,
          request,
          round,
          playbookVersion: variant === 'crew-playbook' ? outcome.learnedVersion : undefined,
          retro: false,
        })
  const done = new Set(
    (
      trace
        .prepare(
          "SELECT variant, eval_round, request_id FROM runs WHERE eval_suite = 'main' AND status <> 'running'",
        )
        .all() as { variant: string; eval_round: number; request_id: string }[]
    ).map((r) => `${r.variant}|${r.eval_round}|${r.request_id}`),
  )
  const todo = options.skipExisting
    ? main.filter((j) => !done.has(`${j.variant}|${j.round}|${j.request.id}`))
    : main
  log(
    `ablation: ${todo.length} runs${todo.length < main.length ? ` (${main.length - todo.length} already in the trace)` : ''}, crew-playbook on v${outcome.learnedVersion}`,
  )
  await pool(todo, concurrency, runJob)

  // 3. The first version's other rounds (its first round was learning epoch 1).
  if (learning && outcome.learnedVersion !== first.version && outcome.epochVersions[0] === first.version) {
    const extra: EvalJob[] = []
    for (let round = 2; round <= rounds; round++)
      for (const request of requests)
        extra.push({
          suite: 'learning-curve',
          variant: 'crew-playbook',
          request,
          round: CURVE_ROUND_BASE + round,
          playbookVersion: first.version,
          retro: false,
        })
    log(`curve: v${first.version} rounds 2 to ${rounds}, ${extra.length} runs`)
    await pool(extra, concurrency, runJob)
  }
  return outcome
}

function versionContent(trace: TraceDb, version: number): string {
  const row = trace.prepare('SELECT content FROM playbook_versions WHERE version = ?').get(version) as
    { content: string } | undefined
  if (!row) throw new Error(`Playbook v${version} doesn't exist.`)
  return row.content
}
