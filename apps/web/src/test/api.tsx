// The app's tests talk to the real API handler, in process, over the replay seed: the same answers
// the demo gives, and no fixture to keep in step with the seed. `live` adds a waiting human gate.
import { createApi, loadReplay, type ReplayOptions } from '@crew/api/replay'
import { render } from '@testing-library/react'
import { vi } from 'vitest'

import hard from '@repo/evals/results/hard.json'
import latest from '@repo/evals/results/latest.json'
import { App } from '../App'

/** A fixed clock, so "2 min ago" and the waiting time don't depend on when the tests run. */
export const NOW = new Date('2026-11-26T12:00:00.000Z')

export interface Calls {
  method: string
  path: string
  body?: unknown
}

export function installApi({
  mode = 'replay',
  scoreboard = 'example',
  override,
}: {
  mode?: 'replay' | 'live'
  /** "real" seeds the replay with evals/results/latest.json, as pnpm demo and the public demo do. */
  scoreboard?: 'example' | 'real'
  override?: (path: string) => unknown
} = {}) {
  const replay = loadReplay({
    now: NOW,
    evaluation: scoreboard === 'real' ? (latest as unknown as ReplayOptions['evaluation']) : undefined,
    hardEvaluation: scoreboard === 'real' ? (hard as unknown as ReplayOptions['evaluation']) : undefined,
  })
  const { trace, exampleData } = replay
  // Live: run #143 waits at the gate with a plan, as the engine's WebGate holds it.
  const decided: unknown[] = []
  const plan = {
    steps: ['Look up the SKU in the catalog.'],
    acceptance: ['An unknown SKU answers 404.'],
    files: ['src/routes/cart.ts'],
    estimateUsd: 0.04,
  }
  const pending = new Set(mode === 'live' ? [143] : [])
  const gate = {
    waiting: (id: number) =>
      pending.has(id) ? { runId: id, title: '', plan, revision: 1, budgetLeftMicros: 246_000 } : undefined,
    waitingRuns: () => [...pending],
    answer: (id: number, result: unknown) => {
      if (!pending.delete(id)) return false
      decided.push(result)
      return true
    },
  } as unknown as Parameters<typeof createApi>[0]['gate']
  const api = createApi({
    trace,
    mode,
    exampleData: mode === 'replay' ? exampleData : false,
    evaluationMeta: replay.evaluationMeta,
    evaluations: mode === 'replay' ? replay.evaluations : undefined,
    gate: mode === 'live' ? gate : undefined,
    live: { available: mode === 'live' },
  })
  const calls: Calls[] = []
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://127.0.0.1:5173')
    calls.push({
      method: init?.method ?? 'GET',
      path: url.pathname + url.search,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    const forced = override?.(url.pathname + url.search)
    if (forced instanceof Promise) return forced
    if (forced !== undefined)
      return forced instanceof Response ? forced : new Response(JSON.stringify(forced), { status: 200 })
    return api(new Request(url, { method: init?.method, body: init?.body, headers: init?.headers }))
  })
  return { calls, decided, trace }
}

/** Renders the app at a path. */
export function renderAt(path: string) {
  window.history.replaceState(null, '', path)
  return render(<App />)
}
