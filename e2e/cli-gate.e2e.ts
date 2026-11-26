// QA (story Q1): the human gate in the terminal, `pnpm crew run "<request>"`, answered with y, c and n.
// The built CLI runs as a user would, with a stand-in for the Messages API loaded by `node --import`
// (e2e/fixtures/fake-anthropic.mjs): no key, no cost. It runs in a temporary root with a copy of the
// example repository, so it never reads the repository's .env.local or writes its .crew/.
import { spawn } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

const repo = fileURLToPath(new URL('..', import.meta.url))
const cli = path.join(repo, 'packages/api/dist/cli.js')
const fake = path.join(repo, 'e2e/fixtures/fake-anthropic.mjs')
const REQUEST = 'Add an order cancellation endpoint for pending orders'

interface Logged {
  model: string
  tools: string[]
  user: string
  key: string
}

/** A terminal session with the CLI: wait for text on stdout, then type a line. */
function session(args: string[]) {
  const root = mkdtempSync(path.join(tmpdir(), 'crew-cli-'))
  writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages: []\n')
  cpSync(path.join(repo, 'examples/fernhill-orders'), path.join(root, 'examples/fernhill-orders'), {
    recursive: true,
    filter: (src) => !src.includes('node_modules'),
  })
  const log = path.join(root, 'model-calls.jsonl')
  writeFileSync(log, '')
  const child = spawn(process.execPath, ['--import', fake, cli, ...args], {
    cwd: root,
    env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: 'sk-fake-for-tests', FAKE_ANTHROPIC_LOG: log },
  })
  let out = ''
  child.stdout.on('data', (d: Buffer) => (out += d.toString()))
  child.stderr.on('data', (d: Buffer) => (out += d.toString()))
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve))
  const count = (text: string) => out.split(text).length - 1
  return {
    root,
    output: () => out,
    exited,
    /** Waits until `text` has appeared `times` times on the terminal. */
    async waitFor(text: string, times = 1, timeout = 30_000) {
      const end = Date.now() + timeout
      while (count(text) < times) {
        if (Date.now() > end) throw new Error(`Timed out waiting for "${text}" ×${times}. Output:\n${out}`)
        await new Promise((r) => setTimeout(r, 50))
      }
    },
    type: (line: string) => child.stdin.write(`${line}\n`),
    calls: () =>
      readFileSync(log, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Logged),
    steps: () => {
      const db = new DatabaseSync(path.join(root, '.crew/trace.sqlite'), { readOnly: true })
      try {
        return db
          .prepare('SELECT kind, role, status, decision, decided_by, comment FROM steps ORDER BY seq')
          .all() as {
          kind: string
          role: string | null
          decision: string | null
          decided_by: string | null
          comment: string | null
        }[]
      } finally {
        db.close()
      }
    },
    kill: () => child.kill(),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

const PROMPT = 'Approve (y), request changes (c) or reject (n)? '

test('c sends the comment back to the PO, an empty comment is refused, and n ends the run with its reason', async () => {
  test.setTimeout(90_000)
  const s = session(['run', REQUEST])
  try {
    await s.waitFor(PROMPT)
    expect(s.output()).toContain('Plan:\n  1. Add DELETE /orders/:id')
    expect(s.output()).toContain('Acceptance:\n  - A pending order becomes cancelled')
    expect(s.output()).toMatch(/Files: src\/orders\.ts · estimate \$0\.02 of \$0\.\d{3} left/)

    // c with no comment: asked again, nothing sent back.
    s.type('c')
    await s.waitFor('What should change? ')
    s.type('')
    await s.waitFor('A comment is needed: it is the only record of why.')
    await s.waitFor(PROMPT, 2)

    // c with a comment: the PO plans again, with the comment in its turn.
    s.type('c')
    await s.waitFor('What should change? ', 2)
    s.type('Also answer 404 for an order that does not exist')
    await s.waitFor('Plan v2:')
    await s.waitFor(PROMPT, 3)

    // n with a reason: the run ends there.
    s.type('n')
    await s.waitFor('Why reject? ')
    s.type('Out of scope this sprint')
    await s.waitFor('Run #1: rejected')
    expect(await s.exited).toBe(0)

    const calls = s.calls()
    const po = calls.filter((c) => c.tools.includes('submit_plan'))
    expect(po).toHaveLength(2)
    expect(po[1]!.user).toContain('Also answer 404 for an order that does not exist')
    // Nobody writes code after a rejection, and the key sent is the one in the environment.
    expect(calls.filter((c) => c.tools.includes('write_file'))).toEqual([])
    expect(new Set(calls.map((c) => c.key))).toEqual(new Set(['sk-fake-for-tests']))
    expect(calls.every((c) => !/sonnet/i.test(c.model))).toBe(true)

    const gates = s.steps().filter((st) => st.kind === 'gate')
    expect(gates.map((g) => [g.decision, g.decided_by, g.comment])).toEqual([
      ['request-changes', 'person', 'Also answer 404 for an order that does not exist'],
      ['reject', 'person', 'Out of scope this sprint'],
    ])
  } finally {
    s.kill()
    s.cleanup()
  }
})

test('n asks for a reason too, and y lets the Engineer start', async () => {
  test.setTimeout(120_000)
  const s = session(['run', REQUEST])
  try {
    await s.waitFor(PROMPT)
    s.type('n')
    await s.waitFor('Why reject? ')
    s.type('   ')
    await s.waitFor('A comment is needed: it is the only record of why.')
    await s.waitFor(PROMPT, 2)
    s.type('Y')
    await s.waitFor('Run #1: ', 1, 100_000)
    expect(await s.exited).toBe(0)

    expect(s.calls().some((c) => c.tools.includes('write_file'))).toBe(true)
    const steps = s.steps()
    const gates = steps.filter((st) => st.kind === 'gate')
    expect(gates.map((g) => [g.decision, g.decided_by, g.comment])).toEqual([['approve', 'person', null]])
    const order = steps.filter((st) => st.role).map((st) => st.role)
    expect(order.slice(0, 2)).toEqual(['po', 'engineer'])
  } finally {
    s.kill()
    s.cleanup()
  }
})

test('without a key, run says how to run live and exits 1 before any model call', async () => {
  const child = spawn(process.execPath, ['--import', fake, cli, 'run', REQUEST], {
    cwd: repo,
    env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: '' },
  })
  let out = ''
  child.stderr.on('data', (d: Buffer) => (out += d.toString()))
  const code = await new Promise<number | null>((r) => child.on('exit', r))
  expect(code).toBe(1)
  expect(out).toContain('ANTHROPIC_API_KEY')
  expect(out).toContain('pnpm crew serve --live')
})
