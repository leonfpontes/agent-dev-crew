// pnpm --filter @crew/trace seed [file]: a fresh trace database with the replay example data.
// Default file: .crew/replay.sqlite at the repository root (ignored by git).
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { migrate, openTrace } from './db.js'
import { seed } from './seed.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const file = path.resolve(process.argv[2] ?? path.join(root, '.crew/replay.sqlite'))
for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true })
const db = openTrace(file)
migrate(db)
const counts = seed(db, new Date())
db.close()
console.log(`Wrote ${path.relative(process.cwd(), file)}:`, counts)
