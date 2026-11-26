import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { checkPath, runTool } from './index.js'

const repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'crew-tools-')))
mkdirSync(path.join(repo, 'src'))
mkdirSync(path.join(repo, 'tests'))
mkdirSync(path.join(repo, 'hidden'))
writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const app = 1\n')
writeFileSync(path.join(repo, 'hidden', 'secret.test.ts'), 'hidden test')
writeFileSync(path.join(repo, 'package.json'), '{}')
afterAll(() => rmSync(repo, { recursive: true, force: true }))

const call = (agent: 'po' | 'engineer' | 'reviewer' | 'qa' | 'solo', name: string, input: unknown) =>
  runTool(name, input, { agent, repoDir: repo })

describe('checkPath', () => {
  it.each([
    ['/etc/passwd', 'relative to the repository'],
    ['C:/x', 'relative to the repository'],
    ['../outside.ts', 'outside the repository'],
    ['src/../../outside.ts', 'outside the repository'],
    ['hidden/secret.test.ts', 'Only src/ and tests/'],
    ['package.json', 'Only src/ and tests/'],
    ['src/.env', 'hidden path'],
  ])('refuses %s', (raw, message) => {
    expect(checkPath(raw)).toEqual({ error: expect.stringContaining(message) })
  })

  it('normalizes a path inside the work folders', () => {
    expect(checkPath('src/routes/../app.ts')).toEqual({ file: 'src/app.ts' })
    expect(checkPath('tests\\\\orders.test.ts')).toEqual({ file: 'tests/orders.test.ts' })
  })
})

describe('runTool', () => {
  it('lists only src/ and tests/, never the hidden tests or the config', async () => {
    const out = await call('po', 'list_files', {})
    expect(out).toEqual({ ok: true, output: { files: [{ path: 'src/app.ts', bytes: 21 }] } })
  })

  it('reads a file, and says when it does not exist', async () => {
    expect((await call('reviewer', 'read_file', { path: 'src/app.ts' })).output).toEqual({
      path: 'src/app.ts',
      content: 'export const app = 1\n',
    })
    expect((await call('reviewer', 'read_file', { path: 'src/nope.ts' })).output).toEqual({
      error: 'There is no file "src/nope.ts".',
    })
    expect((await call('reviewer', 'read_file', { path: 'hidden/secret.test.ts' })).ok).toBe(false)
  })

  it('lets each role write only where it may', async () => {
    expect((await call('engineer', 'write_file', { path: 'src/new/feature.ts', content: 'x' })).ok).toBe(true)
    expect(readFileSync(path.join(repo, 'src', 'new', 'feature.ts'), 'utf8')).toBe('x')
    expect((await call('qa', 'write_file', { path: 'tests/new.test.ts', content: 'y' })).ok).toBe(true)
    expect((await call('qa', 'write_file', { path: 'src/app.ts', content: 'z' })).output).toEqual({
      error: 'The qa may write only in tests/.',
    })
    expect((await call('engineer', 'write_file', { path: 'hidden/secret.test.ts', content: 'z' })).ok).toBe(
      false,
    )
    expect(readFileSync(path.join(repo, 'hidden', 'secret.test.ts'), 'utf8')).toBe('hidden test')
  })

  it('refuses a tool the role does not have, and invalid input', async () => {
    expect((await call('po', 'write_file', { path: 'src/x.ts', content: '' })).output).toEqual({
      error: 'The po has no tool "write_file". Tools: list_files, read_file, submit_plan.',
    })
    expect((await call('engineer', 'write_file', { path: 'src/x.ts' })).output).toEqual({
      error: expect.stringContaining('Invalid input at content'),
    })
    expect(
      (await call('engineer', 'write_file', { path: 'src/x.ts', content: 'a'.repeat(100_001) })).ok,
    ).toBe(false)
  })

  it('checks the files of a plan and passes a review through', async () => {
    const plan = { steps: ['a'], acceptance: ['b'], files: ['../x.ts'], estimateUsd: 0.01 }
    expect((await call('po', 'submit_plan', plan)).output).toEqual({
      error: expect.stringContaining('outside the repository'),
    })
    const ok = await call('po', 'submit_plan', { ...plan, files: ['src/app.ts'] })
    expect(ok.plan?.files).toEqual(['src/app.ts'])
    const review = await call('reviewer', 'submit_review', {
      verdict: 'changes',
      comments: ['Name the route.'],
    })
    expect(review.review).toEqual({ verdict: 'changes', comments: ['Name the route.'] })
  })
})
