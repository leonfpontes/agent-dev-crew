// Runs a repository's Vitest tests inside the sandbox: the runner reads only the repository and the
// dependencies, writes only the repository, has no network, and its test workers (forked child
// processes, which inherit the permission flags) can't start processes. The repository needs a
// package.json and a pnpm-workspace.yaml at its root (`prepareForVitest`), so the runner never looks
// above it: the permission model denies reading files outside, even ones that don't exist.

import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { realPath } from './permissions.js'
import { runNodeScript } from './run.js'

export interface TestFailure {
  name: string
  message: string
}

export interface TestReport {
  passed: number
  failed: number
  total: number
  failures: TestFailure[]
  /** Set when the runner itself failed (syntax error, timeout): no test result could be read. */
  error?: string
  durationMs: number
}

const require = createRequire(import.meta.url)
const VITEST = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
/**
 * Where the runner and its dependencies are installed, read-only for the sandbox: pnpm's store
 * (`node_modules/.pnpm`) when there is one, else the `node_modules` folder that holds Vitest.
 */
export const NODE_MODULES = (() => {
  const real = realPath(VITEST)
  const store = real.lastIndexOf(`${path.sep}node_modules${path.sep}.pnpm${path.sep}`)
  if (store >= 0) return real.slice(0, store + `${path.sep}node_modules${path.sep}.pnpm`.length)
  return real.slice(
    0,
    real.lastIndexOf(`${path.sep}node_modules${path.sep}`) + `${path.sep}node_modules`.length,
  )
})()

/** Writes the files the sandboxed runner needs at the root of a repository copy. */
export function prepareForVitest(repoDir: string, include: string[] = ['tests/**/*.test.ts']): void {
  writeFileSync(
    path.join(repoDir, 'package.json'),
    '{ "name": "sandbox-copy", "private": true, "type": "module" }\n',
  )
  writeFileSync(path.join(repoDir, 'pnpm-workspace.yaml'), 'packages: []\n')
  writeFileSync(
    path.join(repoDir, 'vitest.config.mjs'),
    `export default ${JSON.stringify({
      cacheDir: '.vite',
      test: {
        include,
        environment: 'node',
        pool: 'forks',
        reporters: ['json'],
        outputFile: '.test-results.json',
      },
    })}\n`,
  )
}

interface VitestJson {
  numPassedTests: number
  numFailedTests: number
  numTotalTests: number
  testResults: {
    name: string
    message?: string
    assertionResults: { fullName: string; status: string; failureMessages: string[] }[]
  }[]
}

const firstLine = (text: string) =>
  text
    .split('\n')
    .find((l) => l.trim())
    ?.trim()
    .slice(0, 300) ?? ''

/** Runs the tests matching `include` in the sandbox and reads the report. */
export async function runVitest(
  repoDir: string,
  { include = ['tests/**/*.test.ts'], timeoutMs = 120_000 }: { include?: string[]; timeoutMs?: number } = {},
): Promise<TestReport> {
  const repo = realPath(repoDir)
  // The include goes in the config the sandbox owns (the agents can't write it), rewritten per run.
  prepareForVitest(repo, include)
  rmSync(path.join(repo, '.test-results.json'), { force: true })
  const started = Date.now()
  const result = await runNodeScript(
    VITEST,
    { read: [repo, NODE_MODULES], write: [repo], childProcesses: true, addons: true },
    { cwd: repo, timeoutMs },
    ['run', '--root', repo, '--configLoader', 'native'],
  )
  const durationMs = Date.now() - started
  let json: VitestJson
  try {
    json = JSON.parse(readFileSync(path.join(repo, '.test-results.json'), 'utf8')) as VitestJson
  } catch {
    const reason = result.timedOut
      ? `the tests ran past ${timeoutMs} ms`
      : firstLine(result.stderr || result.stdout)
    return {
      passed: 0,
      failed: 0,
      total: 0,
      failures: [],
      error: reason || 'the test runner failed',
      durationMs,
    }
  }
  const failures: TestFailure[] = []
  for (const file of json.testResults) {
    const relative = path.relative(repo, file.name)
    if (file.assertionResults.length === 0 && file.message)
      failures.push({ name: relative, message: firstLine(file.message) })
    for (const a of file.assertionResults) {
      if (a.status === 'failed')
        failures.push({ name: `${relative} › ${a.fullName}`, message: firstLine(a.failureMessages[0] ?? '') })
    }
  }
  const failedFiles = json.testResults.filter((f) => f.assertionResults.length === 0 && f.message).length
  return {
    passed: json.numPassedTests,
    failed: json.numFailedTests + failedFiles,
    total: json.numTotalTests,
    failures: failures.slice(0, 20),
    durationMs,
  }
}
