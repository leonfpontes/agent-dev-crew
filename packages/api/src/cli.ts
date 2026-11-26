#!/usr/bin/env node
// pnpm crew serve [--live] [--port 8787]   the API and the built app on 127.0.0.1 (replay by default)
// pnpm crew run "<feature request>" [--variant crew|crew-playbook|single-agent] [--policy]
//                                          a live run in the terminal, with the gate as a prompt
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'

import { VARIANTS, type Variant } from '@crew/core'
import { approveByPolicy, type GateDecider } from '@crew/engine'
import { migrate, openTrace, type SeedEvaluation } from '@crew/trace'

import { HOW_TO_RUN_LIVE, liveAvailability } from './live-info.js'
import { createLiveRunner, createPlaybookDecider } from './live.js'
import { serveHttp } from './node-http.js'
import { loadReplay } from './replay.js'
import { createApi } from './routes.js'
import { WebGate } from './web-gate.js'

/** The repository root: the nearest folder above the working directory with pnpm-workspace.yaml. */
function repoRoot(): string {
  let dir = process.cwd()
  while (!existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error('Run this inside the agent-dev-crew repository.')
    dir = parent
  }
  return dir
}

/** Reads KEY=value lines of .env.local into the environment (only keys not already set). */
function loadEnvLocal(root: string) {
  const file = path.join(root, '.env.local')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (match && process.env[match[1]!] === undefined)
      process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, '')
  }
}

// `pnpm demo -- --port 8891` passes the `--` through: drop it, or the flags after it are ignored.
const { values, positionals } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  allowPositionals: true,
  options: {
    live: { type: 'boolean', default: false },
    port: { type: 'string', default: process.env.PORT ?? '8787' },
    variant: { type: 'string', default: 'crew' },
    policy: { type: 'boolean', default: false },
  },
})
const [command, ...rest] = positionals
const root = repoRoot()
loadEnvLocal(root)

if (command === 'serve') {
  const port = Number(values.port)
  const staticDir = path.join(root, 'apps', 'web', 'dist')
  let api
  if (values.live) {
    const trace = openTrace(path.join(root, '.crew', 'trace.sqlite'))
    migrate(trace)
    const live = liveAvailability(process.env)
    const gate = new WebGate()
    const runner = live.available
      ? createLiveRunner({ trace, root, gate, apiKey: process.env.ANTHROPIC_API_KEY! })
      : undefined
    const playbook = live.available ? createPlaybookDecider(trace) : undefined
    api = createApi({ trace, mode: 'live', live, gate, runner, playbook })
    if (!live.available) console.error(HOW_TO_RUN_LIVE)
  } else {
    const results = path.join(root, 'evals', 'results', 'latest.json')
    const evaluation = existsSync(results)
      ? (JSON.parse(readFileSync(results, 'utf8')) as SeedEvaluation)
      : undefined
    // Seeded in memory from the scoreboard, like the Vercel function: a stale .crew/replay.sqlite can
    // never show old numbers under a "measured" label.
    const replay = loadReplay({ evaluation })
    api = createApi({
      trace: replay.trace,
      mode: 'replay',
      exampleData: replay.exampleData,
      evaluationMeta: replay.evaluationMeta,
    })
  }
  const server = serveHttp(api, { port, staticDir })
  server.on('listening', () =>
    console.log(
      `Agent Dev Crew · ${values.live ? 'live' : 'replay'} · http://127.0.0.1:${port} (API at /api). Stop with Ctrl+C.`,
    ),
  )
  server.on('error', (e) => {
    console.error(`The server didn't start: ${e.message}. Try another port: --port ${port + 1}`)
    process.exitCode = 1
  })
} else if (command === 'run') {
  const request = rest.join(' ').trim()
  const variant = values.variant as Variant
  if (request.length < 20) {
    console.error(
      'Describe the feature in at least 20 characters: pnpm crew run "Add an order cancellation endpoint …"',
    )
    process.exit(1)
  }
  if (!(VARIANTS as readonly string[]).includes(variant)) {
    console.error(`Unknown variant "${variant}". Use one of: ${VARIANTS.join(', ')}.`)
    process.exit(1)
  }
  const live = liveAvailability(process.env)
  if (!live.available) {
    console.error(live.how)
    process.exit(1)
  }
  const trace = openTrace(path.join(root, '.crew', 'trace.sqlite'))
  migrate(trace)
  const terminalGate: GateDecider = {
    async decide({ plan, revision, budgetLeftMicros }) {
      console.log(
        `\nPlan${revision > 1 ? ` v${revision}` : ''}:\n${plan.steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`,
      )
      console.log(`Acceptance:\n${plan.acceptance.map((a) => `  - ${a}`).join('\n')}`)
      console.log(
        `Files: ${plan.files.join(', ') || '—'} · estimate $${plan.estimateUsd} of $${(budgetLeftMicros / 1e6).toFixed(3)} left`,
      )
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      try {
        for (;;) {
          const key = (await rl.question('Approve (y), request changes (c) or reject (n)? '))
            .trim()
            .toLowerCase()
          if (key === 'y') return { decision: 'approve', by: 'person' }
          if (key === 'c' || key === 'n') {
            const comment = (await rl.question(key === 'c' ? 'What should change? ' : 'Why reject? ')).trim()
            if (comment)
              return { decision: key === 'c' ? 'request-changes' : 'reject', by: 'person', comment }
            console.log('A comment is needed: it is the only record of why.')
          }
        }
      } finally {
        rl.close()
      }
    },
  }
  const runner = createLiveRunner({
    trace,
    root,
    gate: values.policy ? approveByPolicy : terminalGate,
    apiKey: process.env.ANTHROPIC_API_KEY!,
    onFinished: (r) => {
      console.log(
        `\nRun #${r.runId}: ${r.status}${r.failureReason ? ` (${r.failureReason})` : ''} · ${r.tests ? `${r.tests.passed} / ${r.tests.total} tests` : 'no tests'} · $${(r.costMicros / 1e6).toFixed(4)}`,
      )
      console.log('See it with: pnpm crew serve --live')
    },
  })
  const id = await runner.start({
    title: request.length > 80 ? `${request.slice(0, 77)}…` : request,
    request,
    variant,
  })
  console.log(`Run #${id} started (${variant}).`)
} else {
  console.log(
    'Usage:\n  pnpm crew serve [--live] [--port 8787]\n  pnpm crew run "<feature request>" [--variant crew|crew-playbook|single-agent] [--policy]',
  )
  process.exitCode = command ? 1 : 0
}
