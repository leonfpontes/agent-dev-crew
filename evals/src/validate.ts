// Proves each request is a fair test: its hidden tests fail on the example as it ships (the work is
// not done yet) and all pass on the reference solution, which also keeps every visible test green
// and type-checks. One Vitest run and one tsc run cover the ten requests.

import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { loadRequests, type LoadedRequest } from './requests.js'

export interface RequestResult {
  id: string
  hiddenTests: number
  /** Hidden tests failing on the example as it ships: must be at least 1. */
  failingBefore: number
  /** Hidden tests failing on the reference solution: must be 0. */
  failingAfter: number
  /** Visible tests (tests/) of the example failing on the reference solution: must be 0. */
  visibleFailingAfter: number
  visibleTests: number
  ok: boolean
}

export interface Validation {
  results: RequestResult[]
  /** Static problems, type errors and requests that are not fair tests. */
  problems: string[]
  ok: boolean
}

export interface ValidateOptions {
  requestsDir: string
  exampleDir: string
  /** A scratch folder inside the repository (so `vitest` resolves); it is emptied first. */
  workDir: string
}

interface VitestJson {
  testResults: { name: string; assertionResults: { status: string }[] }[]
}

const require = createRequire(import.meta.url)
const binOf = (pkg: string, bin: string) =>
  path.join(path.dirname(require.resolve(`${pkg}/package.json`)), bin)

function copyExample(exampleDir: string, target: string) {
  for (const part of ['src', 'tests'])
    cpSync(path.join(exampleDir, part), path.join(target, part), { recursive: true })
}

function prepare(requests: LoadedRequest[], { requestsDir, exampleDir, workDir }: ValidateOptions) {
  rmSync(workDir, { recursive: true, force: true })
  for (const request of requests) {
    for (const state of ['before', 'after'] as const) {
      const target = path.join(workDir, state, request.id)
      copyExample(exampleDir, target)
      for (const file of request.hiddenTests) {
        mkdirSync(path.join(target, 'hidden'), { recursive: true })
        cpSync(path.join(requestsDir, request.id, file), path.join(target, 'hidden', path.basename(file)))
      }
      if (state === 'after')
        cpSync(path.join(requestsDir, request.id, 'solution'), target, { recursive: true })
    }
  }
  writeFileSync(
    path.join(workDir, 'vitest.config.mjs'),
    "export default { test: { include: ['**/*.test.ts'], environment: 'node', reporters: ['json'] } }\n",
  )
  writeFileSync(
    path.join(workDir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2023',
        lib: ['ES2023', 'DOM'],
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noUncheckedIndexedAccess: true,
        noEmit: true,
        skipLibCheck: true,
        types: ['node'],
      },
      include: ['after/**/*.ts'],
    }),
  )
}

export function validateRequests(options: ValidateOptions): Validation {
  const { requests, problems } = loadRequests(options.requestsDir, options.exampleDir)
  if (problems.length > 0) return { results: [], problems, ok: false }
  prepare(requests, options)

  const report = path.join(options.workDir, 'vitest.json')
  spawnSync(
    process.execPath,
    [binOf('vitest', 'vitest.mjs'), 'run', '--root', options.workDir, '--outputFile', report],
    { cwd: options.workDir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } },
  )
  const json = JSON.parse(readFileSync(report, 'utf8')) as VitestJson

  const tsc = spawnSync(process.execPath, [binOf('typescript', 'bin/tsc'), '-p', options.workDir], {
    encoding: 'utf8',
  })
  if (tsc.status !== 0) problems.push(`reference solutions don't type-check:\n${tsc.stdout}${tsc.stderr}`)

  const tally = (state: string, id: string, folder: 'hidden' | 'tests') => {
    const prefix = path.join(options.workDir, state, id, folder) + path.sep
    const cases = json.testResults.filter((f) => f.name.startsWith(prefix)).flatMap((f) => f.assertionResults)
    return { total: cases.length, failing: cases.filter((c) => c.status !== 'passed').length }
  }

  const results = requests.map((request): RequestResult => {
    const before = tally('before', request.id, 'hidden')
    const after = tally('after', request.id, 'hidden')
    const visible = tally('after', request.id, 'tests')
    const result = {
      id: request.id,
      hiddenTests: request.hiddenTestCount,
      failingBefore: before.failing,
      failingAfter: after.failing,
      visibleFailingAfter: visible.failing,
      visibleTests: visible.total,
      ok: false,
    }
    if (before.total !== request.hiddenTestCount || after.total !== request.hiddenTestCount) {
      problems.push(
        `${request.id}: Vitest ran ${before.total}/${after.total} hidden tests, expected ${request.hiddenTestCount}`,
      )
    } else if (before.failing === 0) {
      problems.push(`${request.id}: every hidden test already passes on the example, so it measures nothing`)
    } else if (after.failing > 0) {
      problems.push(`${request.id}: ${after.failing} hidden tests fail on the reference solution`)
    } else if (visible.failing > 0 || visible.total === 0) {
      problems.push(`${request.id}: the reference solution breaks ${visible.failing} visible tests`)
    } else {
      result.ok = true
    }
    return result
  })
  return { results, problems, ok: problems.length === 0 }
}

/** One line per request, for the terminal. */
export function formatValidation({ results, problems, ok }: Validation): string {
  const rows = results.map(
    (r) =>
      `${r.ok ? '✓' : '✗'} ${r.id.padEnd(18)} ${r.hiddenTests} hidden · ${r.failingBefore} fail before · ` +
      `${r.failingAfter} fail after · ${r.visibleTests - r.visibleFailingAfter}/${r.visibleTests} visible`,
  )
  return [
    ...rows,
    ...problems.map((p) => `✗ ${p}`),
    ok ? 'All requests are fair tests.' : 'Validation failed.',
  ].join('\n')
}
