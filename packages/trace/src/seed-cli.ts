// pnpm --filter @crew/trace seed [file] [--example]: a fresh trace database with the replay data.
// Default file: .crew/replay.sqlite at the repository root (ignored by git). The Evaluation data
// and the playbook history come from evals/results/latest.json when it exists (the real scoreboard);
// --example (or no scoreboard) seeds the example numbers instead.
import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { migrate, openTrace } from './db.js'
import { seed, type SeedEvaluation } from './seed.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const args = process.argv.slice(2)
const example = args.includes('--example')
const file = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(root, '.crew/replay.sqlite'))
const results = path.join(root, 'evals/results/latest.json')
const evaluation =
  !example && existsSync(results) ? (JSON.parse(readFileSync(results, 'utf8')) as SeedEvaluation) : undefined
for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true })
const db = openTrace(file)
migrate(db)
const counts = seed(db, new Date(), { evaluation })
db.close()
console.log(
  `Wrote ${path.relative(process.cwd(), file)} (${evaluation ? 'real evaluation' : 'example evaluation'}):`,
  counts,
)
