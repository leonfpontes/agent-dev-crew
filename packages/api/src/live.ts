// Live mode, local only: a run with the person's own key, the real models and the human gate in the
// app. Without ANTHROPIC_API_KEY the API says how to set it up and stays read-only.

import path from 'node:path'

import type { Variant } from '@crew/core'
import {
  anthropicPrice,
  createAnthropicProvider,
  createRetro,
  createRoleSpecs,
  ensurePlaybook,
  runCrew,
  type GateDecider,
  type ModelProvider,
  type RunResult,
} from '@crew/engine'
import type { TraceDb } from '@crew/trace'

export { HOW_TO_RUN_LIVE, liveAvailability, type LiveAvailability } from './live-info.js'

export interface LiveRunner {
  /** Starts a run and resolves with its id as soon as the run row exists. */
  start(request: { title: string; request: string; variant: Variant }): Promise<number>
  /** The run in progress, if any (one at a time: they share the example copy folder and the budget). */
  current(): number | undefined
}

export interface LiveOptions {
  trace: TraceDb
  /** The repository root (for examples/fernhill-orders and .crew/runs). */
  root: string
  gate: GateDecider
  apiKey: string
  /** For tests: a provider that doesn't call the API. */
  provider?: ModelProvider
  onFinished?: (result: RunResult) => void
}

export function createLiveRunner(options: LiveOptions): LiveRunner {
  let running: number | undefined
  const provider = options.provider ?? createAnthropicProvider({ apiKey: options.apiKey })
  return {
    current: () => running,
    start: ({ title, request, variant }) =>
      new Promise<number>((resolve, reject) => {
        if (running !== undefined) return reject(new Error(`Run #${running} is still in progress.`))
        runCrew({
          trace: options.trace,
          provider,
          price: anthropicPrice,
          roles: createRoleSpecs(),
          gate: options.gate,
          request: { title, request },
          variant,
          playbook: variant === 'crew-playbook' ? ensurePlaybook(options.trace) : undefined,
          origin: 'live',
          exampleDir: path.join(options.root, 'examples', 'fernhill-orders'),
          workRoot: path.join(options.root, '.crew', 'runs'),
          retro: createRetro({ trace: options.trace }),
          onStart: (id) => {
            running = id
            resolve(id)
          },
        })
          .then((result) => options.onFinished?.(result))
          .catch(reject)
          .finally(() => (running = undefined))
      }),
  }
}
