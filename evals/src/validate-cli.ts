// pnpm --filter @crew/evals validate: checks that every request is a fair test.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { formatValidation, validateRequests } from './validate.js'

const evalsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const validation = validateRequests({
  requestsDir: path.join(evalsDir, 'requests'),
  exampleDir: path.join(evalsDir, '../examples/fernhill-orders'),
  workDir: path.join(evalsDir, '../.crew/validate-requests'),
})
console.log(formatValidation(validation))
process.exitCode = validation.ok ? 0 : 1
