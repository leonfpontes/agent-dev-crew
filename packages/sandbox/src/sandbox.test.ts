import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import {
  BLOCKER,
  NODE_MODULES,
  permissionFlags,
  prepareForVitest,
  runNodeScript,
  runVitest,
} from './index.js'

// On macOS the temporary folder is a symlink (/var → /private/var). The agents get real paths;
// the policy test below passes the symlinked one on purpose.
const rawBox = mkdtempSync(path.join(tmpdir(), 'crew-sandbox-'))
const box = realpathSync(rawBox)
const work = path.join(box, 'repo')
const outside = path.join(box, 'outside.txt')
// The engine creates the copy of the example repository; the child only writes inside it.
mkdirSync(work)
writeFileSync(outside, 'secret')
afterAll(() => rmSync(box, { recursive: true, force: true }))

const script = (name: string, code: string) => {
  const file = path.join(box, name)
  writeFileSync(file, code)
  return file
}
const policy = { read: [box], write: [work] }
const run = async (name: string, code: string, options = {}) =>
  (await runNodeScript(script(name, code), policy, options)).stdout.trim()

describe('permissionFlags', () => {
  it('turns the policy into Node permission flags, with the blocker readable', () => {
    expect(
      permissionFlags({ read: ['/no-such-a'], write: ['/no-such-b'], childProcesses: true, addons: true }),
    ).toEqual([
      '--permission',
      '--allow-fs-read=/no-such-a',
      `--allow-fs-read=${realpathSync(path.dirname(BLOCKER))}`,
      '--allow-fs-write=/no-such-b',
      '--allow-child-process',
      '--allow-addons',
    ])
  })

  it('never allows worker threads, which Node starts without the permission model', () => {
    expect(permissionFlags({ read: [], write: [], childProcesses: true }).join(' ')).not.toContain('worker')
  })

  it('follows symlinks, so a temporary folder on macOS matches what Node checks', () => {
    const flags = permissionFlags({ read: [rawBox], write: [path.join(rawBox, 'repo')] })
    expect(flags[1]).toBe(`--allow-fs-read=${box}`)
    expect(flags).toContain(`--allow-fs-write=${work}`)
  })

  it('refuses relative paths', () => {
    expect(() => permissionFlags({ read: ['repo'], write: [] })).toThrow('Sandbox paths must be absolute')
  })
})

describe('runNodeScript', () => {
  it('gives the child none of the parent environment, only the blocker preload', async () => {
    process.env.CREW_SANDBOX_TEST_SECRET = 'must-not-leak'
    try {
      const out = await run('env.mjs', 'console.log(JSON.stringify(Object.keys(process.env)))')
      expect(JSON.parse(out)).not.toContain('CREW_SANDBOX_TEST_SECRET')
      expect(JSON.parse(out)).toContain('NODE_OPTIONS')
    } finally {
      delete process.env.CREW_SANDBOX_TEST_SECRET
    }
  })

  it('lets the child write only inside its folder', async () => {
    const code = `import fs from 'node:fs'
fs.writeFileSync(${JSON.stringify(path.join(work, 'ok.txt'))}, 'ok')
try { fs.writeFileSync(${JSON.stringify(outside)}, 'changed'); console.log('wrote outside') } catch (e) { console.log(e.code) }`
    expect(await run('write.mjs', code)).toBe('ERR_ACCESS_DENIED')
  })

  it('blocks the network: sockets, named imports, DNS and fetch', async () => {
    const code = `import net, { connect } from 'node:net'
import { lookup } from 'node:dns'
const tryIt = async (f) => { try { await f(); return 'open' } catch (e) { return e.code } }
console.log(JSON.stringify([
  await tryIt(() => net.connect(9, '127.0.0.1')),
  await tryIt(() => connect(9, '127.0.0.1')),
  await tryIt(() => lookup('example.com', () => {})),
  await tryIt(() => fetch('http://127.0.0.1:9')),
]))`
    expect(JSON.parse(await run('net.mjs', code))).toEqual(Array(4).fill('ERR_CREW_SANDBOX_BLOCKED'))
  })

  it('refuses child processes unless the policy allows them, and kills a script that never ends', async () => {
    const spawnCode = `import { execSync } from 'node:child_process'
try { execSync('echo hi'); console.log('spawned') } catch (e) { console.log(e.code) }`
    expect(await run('spawn.mjs', spawnCode)).toBe('ERR_ACCESS_DENIED')
    const r = await runNodeScript(script('loop.mjs', 'while (true) {}'), policy, { timeoutMs: 500 })
    expect(r.timedOut).toBe(true)
  })
})

describe('runVitest', () => {
  const repo = path.join(box, 'vitest-repo')
  mkdirSync(path.join(repo, 'tests'), { recursive: true })
  prepareForVitest(repo)
  writeFileSync(
    path.join(repo, 'tests', 'math.test.ts'),
    `import { expect, test } from 'vitest'
test('adds', () => expect(1 + 1).toBe(2))
test('fails on purpose', () => expect(2 + 2).toBe(5))`,
  )
  writeFileSync(
    path.join(repo, 'tests', 'escape.test.ts'),
    `import { expect, test } from 'vitest'
import fs from 'node:fs'
import { execSync } from 'node:child_process'
const code = async (f: () => unknown) => { try { await f(); return 'open' } catch (e: any) { return e.code } }
test('test code stays in the sandbox', async () => {
  expect(await code(() => fs.readFileSync(${JSON.stringify(outside)}))).toBe('ERR_ACCESS_DENIED')
  expect(await code(() => fetch('http://127.0.0.1:9'))).toBe('ERR_CREW_SANDBOX_BLOCKED')
  expect(await code(() => execSync('echo hi'))).toBe('ERR_CREW_SANDBOX_BLOCKED')
  expect(process.env.CREW_SANDBOX_TEST_SECRET).toBeUndefined()
})`,
  )

  it('runs the tests in forked workers that inherit the sandbox, and reports each failure', async () => {
    process.env.CREW_SANDBOX_TEST_SECRET = 'must-not-leak'
    try {
      const report = await runVitest(repo)
      expect(report.error).toBeUndefined()
      expect({ passed: report.passed, failed: report.failed, total: report.total }).toEqual({
        passed: 2,
        failed: 1,
        total: 3,
      })
      expect(report.failures).toEqual([
        {
          name: 'tests/math.test.ts › fails on purpose',
          message: 'AssertionError: expected 4 to be 5 // Object.is equality',
        },
      ])
    } finally {
      delete process.env.CREW_SANDBOX_TEST_SECRET
    }
  }, 60_000)

  it('reads its dependencies from the store, not the whole repository', () => {
    expect(path.basename(NODE_MODULES)).toMatch(/^(\.pnpm|node_modules)$/)
  })

  it('says why when the runner itself fails', async () => {
    writeFileSync(path.join(repo, 'tests', 'broken.test.ts'), 'this is not typescript (')
    const report = await runVitest(repo, { include: ['tests/broken.test.ts'] })
    expect(report.failed).toBe(1)
    expect(report.failures[0]?.name).toBe('tests/broken.test.ts')
    rmSync(path.join(repo, 'tests', 'broken.test.ts'))
  }, 60_000)
})
