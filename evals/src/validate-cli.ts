// pnpm --filter @crew/evals validate [-- --set easy|hard]: checks that every request is a fair test.
// Without --set it checks both sets.
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

import { isRequestSet, REQUEST_SET_RULES, REQUEST_SETS, requestSetDir, type RequestSet } from './requests.js'
import { formatValidation, validateRequests } from './validate.js'

const evalsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// `pnpm validate -- --set hard` passes the `--` through.
const argv = process.argv.slice(2).filter((a) => a !== '--')
const { values } = parseArgs({ args: argv, options: { set: { type: 'string' } } })
if (values.set !== undefined && !isRequestSet(values.set))
  throw new Error(`--set must be one of ${REQUEST_SETS.join(', ')} (got "${values.set}").`)
const sets: readonly RequestSet[] = values.set ? [values.set] : REQUEST_SETS

let ok = true
for (const set of sets) {
  const validation = validateRequests({
    requestsDir: requestSetDir(evalsDir, set),
    exampleDir: path.join(evalsDir, '../examples/fernhill-orders'),
    workDir: path.join(evalsDir, `../.crew/validate-requests-${set}`),
    rules: REQUEST_SET_RULES[set],
  })
  console.log(`${set} set\n${formatValidation(validation)}\n`)
  ok &&= validation.ok
}
process.exitCode = ok ? 0 : 1
