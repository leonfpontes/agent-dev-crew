// The evaluation's feature requests: evals/requests/requests.json plus, per request, a folder with
// its hidden acceptance tests and a reference solution. The agents never see this folder; the
// harness copies the hidden tests into the run's copy of fernhill-orders at `hidden/` once the crew
// has finished, and they import the app from `../src/index.js`.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { parseRequests, type FeatureRequest } from './contracts.js'

export const MIN_HIDDEN_TESTS = 3
export const MAX_HIDDEN_TESTS = 7

/**
 * The two sets of requests, on the same example. `easy` (evals/requests) is the baseline the first
 * evaluation ran; `hard` (evals/requests-hard) asks in each request for two features that interact,
 * across several routes and modules, and its solutions may add new files under src/.
 */
export const REQUEST_SETS = ['easy', 'hard'] as const
export type RequestSet = (typeof REQUEST_SETS)[number]

export interface RequestSetRules {
  /** Folder under evals/. */
  folder: string
  minHiddenTests: number
  maxHiddenTests: number
  /** Whether a reference solution may add a file the example doesn't have yet. */
  newFiles: boolean
}

export const REQUEST_SET_RULES: Record<RequestSet, RequestSetRules> = {
  easy: {
    folder: 'requests',
    minHiddenTests: MIN_HIDDEN_TESTS,
    maxHiddenTests: MAX_HIDDEN_TESTS,
    newFiles: false,
  },
  hard: { folder: 'requests-hard', minHiddenTests: 10, maxHiddenTests: 20, newFiles: true },
}

export function isRequestSet(value: string): value is RequestSet {
  return (REQUEST_SETS as readonly string[]).includes(value)
}

/** The folder of a set, e.g. `<evalsDir>/requests-hard` for `hard`. */
export function requestSetDir(evalsDir: string, set: RequestSet): string {
  return path.join(evalsDir, REQUEST_SET_RULES[set].folder)
}

/** Loads one set with its own rules (see {@link loadRequests}). */
export function loadRequestSet(evalsDir: string, exampleDir: string, set: RequestSet) {
  return loadRequests(requestSetDir(evalsDir, set), exampleDir, REQUEST_SET_RULES[set])
}

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
  rules: Omit<RequestSetRules, 'folder'> = REQUEST_SET_RULES.easy,
): { requests: LoadedRequest[]; problems: string[] } {
  const { minHiddenTests: min, maxHiddenTests: max } = rules
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
    if (hiddenTestCount < min || hiddenTestCount > max) {
      problems.push(`${request.id}: ${hiddenTestCount} hidden tests, expected ${min} to ${max}`)
    }
    const solutionDir = path.join(dir, 'solution')
    const solutionFiles = existsSync(solutionDir) ? filesUnder(solutionDir) : []
    if (solutionFiles.length === 0) problems.push(`${request.id}: no reference solution`)
    for (const file of solutionFiles) {
      if (!file.startsWith(`src${path.sep}`))
        problems.push(`${request.id}: solution file ${file} is outside src/`)
      else if (!rules.newFiles && !existsSync(path.join(exampleDir, file))) {
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
