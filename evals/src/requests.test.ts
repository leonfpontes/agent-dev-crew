import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { SEED_REQUESTS } from '@crew/trace'
import { describe, expect, it } from 'vitest'

import {
  countTests,
  isRequestSet,
  loadRequests,
  REQUEST_SET_RULES,
  REQUEST_SETS,
  requestSetDir,
} from './requests.js'
import { formatValidation, validateRequests } from './validate.js'

const evalsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requestsDir = path.join(evalsDir, 'requests')
const exampleDir = path.join(evalsDir, '../examples/fernhill-orders')

describe('evals/requests', () => {
  const { requests, problems } = loadRequests(requestsDir, exampleDir)

  it('has 10 requests with their hidden tests and a reference solution, and nothing else', () => {
    expect(problems).toEqual([])
    expect(requests).toHaveLength(10)
  })

  it('has 3 to 7 hidden tests per request, 51 in all', () => {
    expect(requests.map((r) => [r.id, r.hiddenTestCount])).toEqual([
      ['cancel-order', 6],
      ['paginate-orders', 5],
      ['validate-sku', 4],
      ['discount-codes', 7],
      ['receipt-email', 3],
      ['rate-limit-orders', 6],
      ['export-csv', 5],
      ['fix-rounding', 4],
      ['partial-refund', 6],
      ['search-orders', 5],
    ])
  })

  it('writes every request in English for a made-up store, through its HTTP API', () => {
    for (const r of requests) {
      expect(r.request, r.id).toMatch(/^[\x20-\x7E]+$/)
      expect(r.request, r.id).toMatch(/\b(order|cart)/i)
    }
  })

  it('keeps the hidden tests away from the example repository the agents work on', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)],
      )
    const example = files(path.join(exampleDir, 'src'))
      .concat(files(path.join(exampleDir, 'tests')))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n')
    expect(example).not.toMatch(/evals\/requests|hidden\//)
    for (const r of requests) for (const t of r.hiddenTests) expect(example).not.toContain(t)
  })

  it('reports what is wrong with a broken folder', () => {
    const dir = path.join(evalsDir, '../.crew/broken-requests')
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(path.join(dir, 'stray'), { recursive: true })
    mkdirSync(path.join(dir, 'too-few', 'solution', 'lib'), { recursive: true })
    writeFileSync(path.join(dir, 'too-few', 'too-few.test.ts'), "it('only one', () => {})\n")
    writeFileSync(path.join(dir, 'too-few', 'solution', 'lib', 'x.ts'), '')
    writeFileSync(path.join(dir, 'too-few', 'notes.md'), '')
    const request = (id: string, hiddenTests: string[]) => ({
      id,
      title: `Title ${id}`,
      request: 'A request long enough.',
      hiddenTests,
    })
    writeFileSync(
      path.join(dir, 'requests.json'),
      JSON.stringify([
        request('too-few', ['too-few.test.ts', 'gone.test.ts']),
        request('no-folder', ['x.test.ts']),
      ]),
    )
    expect(loadRequests(dir, exampleDir).problems).toEqual([
      'too-few: hidden test gone.test.ts is missing',
      'too-few: 1 hidden tests, expected 3 to 7',
      'too-few: solution file lib/x.ts is outside src/',
      'too-few: unexpected file notes.md',
      'no-folder: folder is missing',
      'stray: folder has no entry in requests.json',
    ])
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('request sets', () => {
  it('has the easy baseline in evals/requests and the hard set in evals/requests-hard', () => {
    expect(REQUEST_SETS).toEqual(['easy', 'hard'])
    expect(requestSetDir(evalsDir, 'easy')).toBe(requestsDir)
    expect(requestSetDir(evalsDir, 'hard')).toBe(path.join(evalsDir, 'requests-hard'))
    expect([isRequestSet('hard'), isRequestSet('medium')]).toEqual([true, false])
  })

  it('applies the hard rules: 4 to 8 hidden tests, and a solution may add a file under src/', () => {
    const dir = path.join(evalsDir, '../.crew/hard-rules')
    rmSync(dir, { recursive: true, force: true })
    const write = (file: string, text: string) => {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
      writeFileSync(path.join(dir, file), text)
    }
    const cases = (n: number) => Array.from({ length: n }, (_, i) => `it('case ${i}', () => {})`).join('\n')
    write('eight/eight.test.ts', cases(8))
    write('eight/solution/src/routes/new-route.ts', '')
    write('three/three.test.ts', cases(3))
    write('three/solution/src/money.ts', '')
    write(
      'requests.json',
      JSON.stringify(
        ['eight', 'three'].map((id) => ({
          id,
          title: `Title ${id}`,
          request: 'A request long enough.',
          hiddenTests: [`${id}.test.ts`],
        })),
      ),
    )
    expect(loadRequests(dir, exampleDir, REQUEST_SET_RULES.hard).problems).toEqual([
      'three: 3 hidden tests, expected 4 to 8',
    ])
    expect(loadRequests(dir, exampleDir).problems).toEqual([
      'eight: 8 hidden tests, expected 3 to 7',
      'eight: solution file src/routes/new-route.ts does not exist in the example',
    ])
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('countTests', () => {
  it('counts it( and test( at the start of a line', () => {
    expect(countTests("it('a', f)\n  test('b', f)\n  // it('c')\nconst x = 'it('")).toBe(2)
  })
})

describe('validateRequests', () => {
  it('proves each request is a fair test: hidden tests fail before, pass on the solution, visible tests stay green', () => {
    const workDir = path.join(evalsDir, '../.crew/validate-requests-test')
    const validation = validateRequests({ requestsDir, exampleDir, workDir })
    rmSync(workDir, { recursive: true, force: true })
    expect(validation.problems, formatValidation(validation)).toEqual([])
    expect(validation.results).toHaveLength(10)
    for (const r of validation.results) {
      expect(r.failingBefore, r.id).toBeGreaterThan(0)
      expect(r.failingAfter, r.id).toBe(0)
      expect([r.visibleTests, r.visibleFailingAfter], r.id).toEqual([20, 0])
    }
    expect(formatValidation(validation)).toContain('All requests are fair tests.')
  }, 180_000)
})

// Moved from @crew/trace (its seed must match the requests); the check lives here so the trace
// doesn't depend on the evaluation, which now depends on the trace.
describe('the replay seed', () => {
  it('freezes the evaluation requests exactly as evals/requests has them', () => {
    const { requests, problems } = loadRequests(requestsDir, exampleDir)
    expect(problems).toEqual([])
    expect(SEED_REQUESTS).toEqual(
      requests.map((r) => ({ id: r.id, title: r.title, request: r.request, hiddenTests: r.hiddenTestCount })),
    )
  })
})
