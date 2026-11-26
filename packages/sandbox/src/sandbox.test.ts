import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { permissionFlags, runNodeScript } from './index.js'

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

describe('permissionFlags', () => {
  it('turns the policy into Node permission flags', () => {
    expect(permissionFlags({ read: ['/no-such-a'], write: ['/no-such-b'] })).toEqual([
      '--permission',
      '--allow-fs-read=/no-such-a',
      '--allow-fs-write=/no-such-b',
    ])
  })

  it('follows symlinks, so a temporary folder on macOS matches what Node checks', () => {
    const flags = permissionFlags({ read: [rawBox], write: [path.join(rawBox, 'repo')] })
    expect(flags[1]).toBe(`--allow-fs-read=${box}`)
    expect(flags[2]).toBe(`--allow-fs-write=${work}`)
  })

  it('refuses relative paths', () => {
    expect(() => permissionFlags({ read: ['repo'], write: [] })).toThrow('Sandbox paths must be absolute')
  })
})

describe('runNodeScript', () => {
  it('gives the child none of the parent environment', async () => {
    process.env.CREW_SANDBOX_TEST_SECRET = 'must-not-leak'
    try {
      const r = await runNodeScript(
        script('env.mjs', 'console.log(JSON.stringify(Object.keys(process.env)))'),
        policy,
      )
      expect(r.exitCode).toBe(0)
      expect(r.stdout).not.toContain('CREW_SANDBOX_TEST_SECRET')
    } finally {
      delete process.env.CREW_SANDBOX_TEST_SECRET
    }
  })

  it('lets the child write only inside its folder', async () => {
    const code = `import fs from 'node:fs'
fs.writeFileSync(${JSON.stringify(path.join(work, 'ok.txt'))}, 'ok')
try { fs.writeFileSync(${JSON.stringify(outside)}, 'changed'); console.log('wrote outside') } catch (e) { console.log(e.code) }`
    const r = await runNodeScript(script('write.mjs', code), policy)
    expect(r.stdout.trim()).toBe('ERR_ACCESS_DENIED')
  })

  it('refuses child processes and kills a script that never ends', async () => {
    const spawnCode = `import { execSync } from 'node:child_process'
try { execSync('echo hi'); console.log('spawned') } catch (e) { console.log(e.code) }`
    expect((await runNodeScript(script('spawn.mjs', spawnCode), policy)).stdout.trim()).toBe(
      'ERR_ACCESS_DENIED',
    )
    const r = await runNodeScript(script('loop.mjs', 'while (true) {}'), policy, { timeoutMs: 500 })
    expect(r.timedOut).toBe(true)
  })
})
