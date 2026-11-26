// Live mode, local only: a run with the person's own key, the real models and the human gate in the
// app. Without ANTHROPIC_API_KEY the API says how to set it up and stays read-only.

import path from 'node:path'

import type { Variant } from '@crew/core'
import {
  anthropicPrice,
  createAnthropicProvider,
  createRetro,
  createRoleSpecs,
  decidePlaybookVersion,
  ensurePlaybook,
  runCrew,
  type GateDecider,
  type ModelProvider,
  type RunResult,
} from '@crew/engine'
import { unifiedDiff, type TraceDb } from '@crew/trace'

import type { PlaybookDecider } from './routes.js'

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

/**
 * Decides proposed playbook versions for the app: approve or reject in order (the engine's rule), and
 * approve an edited rule. An edit replaces the one proposed rule in the version's content, its diff
 * and its lesson before the approval, so the trace keeps what was actually approved.
 */
export function createPlaybookDecider(trace: TraceDb, now: () => Date = () => new Date()): PlaybookDecider {
  return {
    decide(version, { decision, rule }) {
      if (rule !== undefined) editProposedRule(trace, version, rule)
      const decided = decidePlaybookVersion(trace, version, decision, 'person', now())
      return { version: decided.version, status: decided.status }
    },
  }
}

function editProposedRule(trace: TraceDb, version: number, rule: string) {
  const target = trace
    .prepare('SELECT content, status FROM playbook_versions WHERE version = ?')
    .get(version) as { content: string; status: string } | undefined
  if (!target) throw new Error(`There is no playbook v${version}.`)
  if (target.status !== 'proposed') throw new Error(`Playbook v${version} was already ${target.status}.`)
  const lessons = trace
    .prepare("SELECT id, rule FROM lessons WHERE playbook_version = ? AND status = 'proposed'")
    .all(version) as { id: number; rule: string }[]
  if (lessons.length !== 1) {
    throw new Error(
      `Playbook v${version} proposes ${lessons.length} rules; edit works on a proposal with one rule.`,
    )
  }
  const old = lessons[0]!
  const line = `- ${old.rule}`
  if (!target.content.includes(line))
    throw new Error(`The rule of playbook v${version} is not in its content.`)
  const content = target.content.replace(line, `- ${rule}`)
  const before = trace.prepare('SELECT content FROM playbook_versions WHERE version = ?').get(version - 1) as
    { content: string } | undefined
  trace.exec('BEGIN')
  try {
    trace
      .prepare('UPDATE playbook_versions SET content = ?, diff = ? WHERE version = ?')
      .run(content, before ? unifiedDiff(before.content, content) : null, version)
    trace.prepare('UPDATE lessons SET rule = ? WHERE id = ?').run(rule, old.id)
    trace.exec('COMMIT')
  } catch (e) {
    trace.exec('ROLLBACK')
    throw e
  }
}
