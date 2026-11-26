// The evaluation's feature requests: evals/requests/requests.json plus, per request, a folder with
// its hidden acceptance tests and a reference solution. The agents never see this folder; the
// harness copies the hidden tests into the run's copy of fernhill-orders at `hidden/` once the crew
// has finished, and they import the app from `../src/index.js`.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { parseRequests, type FeatureRequest } from './contracts.js'

export const MIN_HIDDEN_TESTS = 3
export const MAX_HIDDEN_TESTS = 7

export interface LoadedRequest extends FeatureRequest {
  /** Number of `it(...)` cases across the hidden test files. */
  hiddenTestCount: number
  /** Files of the reference solution, relative to the example repository (e.g. `src/money.ts`). */
  solutionFiles: string[]
}

function filesUnder(dir: string, base = dir): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const full = path.join(dir, name)
      return statSync(full).isDirectory() ? filesUnder(full, base) : [path.relative(base, full)]
    })
}

/** Counts the test cases of a Vitest file: each `it(` or `test(` at the start of a line. */
export function countTests(source: string): number {
  return source.match(/^\s*(it|test)\(/gm)?.length ?? 0
}

/**
 * Reads and checks the requests folder without running anything: the file parses, every request
 * has its folder, hidden tests and a solution inside `src/` of the example, nothing is left over.
 * Returns the requests and the list of problems (empty when the folder is sound).
 */
export function loadRequests(
  requestsDir: string,
  exampleDir: string,
): { requests: LoadedRequest[]; problems: string[] } {
  const problems: string[] = []
  const requests = parseRequests(JSON.parse(readFileSync(path.join(requestsDir, 'requests.json'), 'utf8')))
  const loaded = requests.map((request): LoadedRequest => {
    const dir = path.join(requestsDir, request.id)
    if (!existsSync(dir)) {
      problems.push(`${request.id}: folder is missing`)
      return { ...request, hiddenTestCount: 0, solutionFiles: [] }
    }
    let hiddenTestCount = 0
    for (const file of request.hiddenTests) {
      const full = path.join(dir, file)
      if (!existsSync(full)) problems.push(`${request.id}: hidden test ${file} is missing`)
      else hiddenTestCount += countTests(readFileSync(full, 'utf8'))
    }
    if (hiddenTestCount < MIN_HIDDEN_TESTS || hiddenTestCount > MAX_HIDDEN_TESTS) {
      problems.push(
        `${request.id}: ${hiddenTestCount} hidden tests, expected ${MIN_HIDDEN_TESTS} to ${MAX_HIDDEN_TESTS}`,
      )
    }
    const solutionDir = path.join(dir, 'solution')
    const solutionFiles = existsSync(solutionDir) ? filesUnder(solutionDir) : []
    if (solutionFiles.length === 0) problems.push(`${request.id}: no reference solution`)
    for (const file of solutionFiles) {
      if (!file.startsWith(`src${path.sep}`))
        problems.push(`${request.id}: solution file ${file} is outside src/`)
      else if (!existsSync(path.join(exampleDir, file))) {
        problems.push(`${request.id}: solution file ${file} does not exist in the example`)
      }
    }
    const expected = new Set([...request.hiddenTests, 'solution'])
    for (const entry of readdirSync(dir)) {
      if (!expected.has(entry)) problems.push(`${request.id}: unexpected file ${entry}`)
    }
    return { ...request, hiddenTestCount, solutionFiles }
  })
  const ids = new Set(requests.map((r) => r.id))
  for (const entry of readdirSync(requestsDir)) {
    if (entry !== 'requests.json' && !ids.has(entry))
      problems.push(`${entry}: folder has no entry in requests.json`)
  }
  return { requests: loaded, problems }
}
