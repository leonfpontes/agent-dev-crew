// pnpm --filter @crew/trace seed [file] [--example] [--set easy|hard]: a fresh trace database with
// the replay data.
// - easy (default): .crew/replay.sqlite at the repository root (ignored by git). The Evaluation data
//   and the playbook history come from evals/results/latest.json when it exists (the real
//   scoreboard); --example (or no scoreboard) seeds the example numbers instead.
// - hard: .crew/replay-hard.sqlite, only the evaluation of evals/results/hard.json, which must exist.
import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { EVAL_SETS, type EvalSet } from './contracts.js'
import { migrate, openTrace } from './db.js'
import { seed, type SeedEvaluation } from './seed.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const { values, positionals } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: { example: { type: 'boolean', default: false }, set: { type: 'string', default: 'easy' } },
  allowPositionals: true,
})
if (!(EVAL_SETS as readonly string[]).includes(values.set)) {
  console.error(`--set must be one of ${EVAL_SETS.join(', ')}.`)
  process.exit(1)
}
const set = values.set as EvalSet
const file = path.resolve(
  positionals[0] ?? path.join(root, set === 'hard' ? '.crew/replay-hard.sqlite' : '.crew/replay.sqlite'),
)
const results = path.join(root, `evals/results/${set === 'hard' ? 'hard' : 'latest'}.json`)
if (set === 'hard' && (values.example || !existsSync(results))) {
  console.error('The hard set has no example data: it seeds only from evals/results/hard.json.')
  process.exit(1)
}
const evaluation =
  !values.example && existsSync(results)
    ? (JSON.parse(readFileSync(results, 'utf8')) as SeedEvaluation)
    : undefined
if (evaluation && (evaluation.set ?? 'easy') !== set) {
  console.error(`${path.relative(root, results)} measured the ${evaluation.set} set, not ${set}.`)
  process.exit(1)
}
for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true })
const db = openTrace(file)
migrate(db)
const counts = seed(db, new Date(), { evaluation })
db.close()
console.log(
  `Wrote ${path.relative(process.cwd(), file)} (${evaluation ? `real ${set} evaluation` : 'example evaluation'}):`,
  counts,
)
