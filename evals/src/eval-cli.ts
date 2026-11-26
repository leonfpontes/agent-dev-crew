// pnpm eval: the ablation and the learning curve on Claude, under hard budgets, then the scoreboard
// in evals/results/ (latest.json and latest.md). Needs ANTHROPIC_API_KEY; nothing else reads it.
//
//   pnpm eval                                    # 10 requests × 3 variants × 3 rounds + the curve, $5 in all
//   pnpm eval --requests cancel-order --rounds 1 --epochs 1 --budget 0.2   # a quick check
//   pnpm eval --report                           # rewrite the scoreboard from the last trace, no API call
//
// The trace of the evaluation is .crew/eval.sqlite (ignored by git): every run, step, call and cost.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { anthropicPrice, createAnthropicProvider, MODELS, promptVersion, repoRefOf } from '@crew/engine'
import { migrate, openTrace } from '@crew/trace'

import { parseEvalArgs } from './args.js'
import { runEvaluation } from './harness.js'
import { loadRequestSet, requestSetDir } from './requests.js'
import { buildResults, toMarkdown, type ResultsMeta } from './results.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// Every number is checked before anything runs: a budget that isn't a number would lift the cap.
// The easy set keeps the first paths (its readers use them); the hard set and the probes get their own.
const args = parseEvalArgs(process.argv.slice(2), (set, probe) =>
  probe
    ? { trace: path.join(root, `.crew/probe-${set}.sqlite`), out: path.join(root, `.crew/probe-${set}`) }
    : set === 'easy'
      ? { trace: path.join(root, '.crew/eval.sqlite'), out: path.join(root, 'evals/results') }
      : { trace: path.join(root, `.crew/eval-${set}.sqlite`), out: path.join(root, `evals/results/${set}`) },
)
const values = { trace: args.trace, out: args.out, report: args.report }

const micros = (usd: number) => Math.round(usd * 1_000_000)
const requestsDir = requestSetDir(path.join(root, 'evals'), args.set)
const exampleDir = path.join(root, 'examples/fernhill-orders')
const metaFile = `${values.trace}.meta.json`

if (!existsSync(path.join(requestsDir, 'requests.json')))
  throw new Error(
    `The ${args.set} set has no requests yet: ${path.relative(root, requestsDir)}/requests.json is missing.`,
  )
// Each set has its own rules (the hard set's solutions may add files to src/).
const { requests: all, problems } = loadRequestSet(path.join(root, 'evals'), exampleDir, args.set)
if (problems.length) throw new Error(`The requests folder has problems:\n${problems.join('\n')}`)
const wanted = args.requests
const requests = wanted ? all.filter((r) => wanted.includes(r.id)) : all
if (wanted && requests.length !== wanted.length)
  throw new Error(`Unknown request in --requests ${wanted.join(',')}`)

let meta: ResultsMeta
if (values.report) {
  meta = JSON.parse(readFileSync(metaFile, 'utf8')) as ResultsMeta
} else {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey)
    throw new Error('Set ANTHROPIC_API_KEY to run the evaluation (pnpm eval --report needs no key).')
  for (const suffix of ['', '-wal', '-shm']) rmSync(values.trace + suffix, { force: true })
  mkdirSync(path.dirname(values.trace), { recursive: true })
  const trace = openTrace(values.trace)
  migrate(trace)
  const workRoot = path.join(path.dirname(values.trace), 'eval-runs')
  const runAt = new Date().toISOString()
  const concurrency = args.concurrency
  const outcome = await runEvaluation({
    trace,
    provider: createAnthropicProvider({ apiKey }),
    price: anthropicPrice,
    requests,
    requestsDir,
    exampleDir,
    workRoot,
    rounds: args.rounds,
    epochs: args.epochs,
    totalBudgetMicros: micros(args.budgetUsd),
    curveBudgetMicros: micros(args.curveBudgetUsd),
    runBudgetMicros: micros(args.runBudgetUsd),
    variants: args.probe ? ['single-agent'] : undefined,
    learning: !args.probe,
    concurrency,
    log: (line) => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`),
  })
  trace.close()
  rmSync(workRoot, { recursive: true, force: true })
  meta = {
    runAt,
    model: MODELS.primary,
    fallbackModel: MODELS.fallback,
    promptVersion: promptVersion(),
    repoRef: repoRefOf(exampleDir),
    requests: requests.length,
    rounds: args.rounds,
    concurrency,
    budgetUsd: {
      total: args.budgetUsd,
      learningCurve: args.curveBudgetUsd,
      perRun: args.runBudgetUsd,
    },
    stoppedEarly: outcome.stoppedEarly,
    learnedVersion: outcome.learnedVersion,
  }
  writeFileSync(metaFile, JSON.stringify({ ...meta, errors: outcome.errors }, null, 2))
  console.log(
    `spent $${(outcome.spentMicros / 1e6).toFixed(4)} in ${outcome.runs} runs (${outcome.skipped} skipped, ${outcome.errors.length} errors)`,
  )
  if (outcome.errors.length) console.log(outcome.errors.join('\n'))
}

if (!existsSync(values.trace)) throw new Error(`No evaluation trace at ${values.trace}: run pnpm eval first.`)
const trace = openTrace(values.trace)
const results = buildResults(trace, meta)
trace.close()
mkdirSync(values.out, { recursive: true })
writeFileSync(path.join(values.out, 'latest.json'), `${JSON.stringify(results, null, 2)}\n`)
writeFileSync(path.join(values.out, 'latest.md'), toMarkdown(results))
// The repository's own formatter, so `pnpm format:check` passes on the committed scoreboard.
const prettier = createRequire(path.join(root, 'package.json')).resolve('prettier/bin/prettier.cjs')
spawnSync(
  process.execPath,
  [prettier, '--write', path.join(values.out, 'latest.json'), path.join(values.out, 'latest.md')],
  {
    stdio: 'ignore',
  },
)
console.log(`Wrote ${path.relative(process.cwd(), values.out)}/latest.json and latest.md`)
if (args.probe) {
  // How hard each request is for the single agent: the number the data story calibrates against.
  for (const m of results.matrix)
    console.log(
      `probe ${m.requestId}: ${(m.results['single-agent'] ?? []).map((ok) => (ok ? 'pass' : 'fail')).join(' ')}`,
    )
  const solo = results.main.find((x) => x.variant === 'single-agent')
  if (solo)
    console.log(
      `probe: single agent passed ${Math.round(solo.passRate.mean * 100)}% for $${results.spentUsd.total.toFixed(4)}`,
    )
}
if (meta.stoppedEarly) process.exitCode = 2
