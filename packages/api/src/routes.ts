// The HTTP API of the trace: a Fetch handler, so the same code serves the local server and a
// serverless function. Replay mode only reads (GET); live mode, on this machine only, also starts a
// run and answers the human gate. Every answer is JSON; errors are `{ error }` with what to do next.

import { VARIANTS, type Variant } from '@crew/core'
import {
  evaluationSummary,
  getRun,
  learningCurve,
  listRuns,
  playbookHistory,
  requestMatrix,
  RUN_STATUSES,
  runsSummary,
  stepEvents,
  type RunStatus,
  type TraceDb,
} from '@crew/trace'
import * as v from 'valibot'

import { HOW_TO_RUN_LIVE, type LiveAvailability } from './live-info.js'
import type { LiveRunner } from './live.js'
import type { EvaluationMeta } from './replay.js'
import type { WebGate } from './web-gate.js'

export type ApiMode = 'replay' | 'live'

export interface PlaybookDecision {
  decision: 'approve' | 'reject'
  /** Approve this text instead of the proposed rule (a proposal with one rule only). */
  rule?: string
}

export interface PlaybookDecider {
  /** Returns the decided version's status; throws an Error whose message the person can act on. */
  decide(version: number, decision: PlaybookDecision): { version: number; status: string }
}

export interface ApiOptions {
  trace: TraceDb
  mode: ApiMode
  /** Live mode: whether a key is set, and what to do when it isn't. */
  live?: LiveAvailability
  /** Whether the Evaluation numbers are examples (default: true in replay, false live). */
  exampleData?: boolean
  /** The real scoreboard's model, cost limit and finish time, shown on the Evaluation band. */
  evaluationMeta?: EvaluationMeta
  /** Live mode: decides a proposed playbook version (approve, reject, or approve an edited rule). */
  playbook?: PlaybookDecider
  /** Live mode with a key: starts runs and holds the gate. */
  runner?: LiveRunner
  gate?: WebGate
}

/** The playback speeds the app offers for a recorded run. */
export const REPLAY_SPEEDS = [1, 4] as const
export const MAX_BODY_BYTES = 32 * 1024
/** Timeline events that keep their payload; the rest (prompts, responses, tool calls) come per step. */
const TIMELINE_PAYLOADS = new Set([
  'run.started',
  'run.finished',
  'step.started',
  'step.finished',
  'gate.waiting',
  'gate.decided',
  'loop.started',
  'budget.exceeded',
  'lesson.proposed',
])
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
const error = (status: number, message: string, extra: Record<string, unknown> = {}) =>
  json({ error: message, ...extra }, status)

const StartRun = v.object({
  request: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(20, 'Describe the feature in at least 20 characters.'),
    v.maxLength(4000),
  ),
  title: v.optional(v.pipe(v.string(), v.trim(), v.minLength(5), v.maxLength(80))),
  variant: v.optional(v.picklist(VARIANTS)),
})
const PlaybookAnswer = v.pipe(
  v.object({
    decision: v.picklist(['approve', 'reject']),
    rule: v.optional(
      v.pipe(v.string(), v.trim(), v.minLength(10, 'A rule needs at least 10 characters.'), v.maxLength(300)),
    ),
  }),
  v.check((a) => a.decision === 'approve' || a.rule === undefined, 'Only an approval can change the rule.'),
)

const GateAnswer = v.pipe(
  v.object({
    decision: v.picklist(['approve', 'request-changes', 'reject']),
    comment: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(2000))),
  }),
  v.check(
    (a) => a.decision === 'approve' || !!a.comment,
    'Request changes and Reject need a comment: it is the only record of why.',
  ),
)

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text()
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new Error(`The body is over ${MAX_BODY_BYTES} bytes.`)
  return text ? JSON.parse(text) : {}
}

const firstIssue = (issues: v.BaseIssue<unknown>[]) => issues[0]?.message ?? 'Invalid input.'

export function createApi(options: ApiOptions): (request: Request) => Promise<Response> {
  const { trace, mode } = options
  const exampleData = options.exampleData ?? mode === 'replay'
  const live =
    mode === 'live'
      ? (options.live ?? { available: false, how: HOW_TO_RUN_LIVE })
      : { available: false, how: HOW_TO_RUN_LIVE }

  const runRow = (id: number) =>
    trace.prepare('SELECT id, duration_ms FROM runs WHERE id = ?').get(id) as
      { id: number; duration_ms: number | null } | undefined

  return async (request) => {
    const url = new URL(request.url)
    const parts = url.pathname.replace(/\/+$/, '').split('/').slice(1) // ['api', ...]
    if (parts[0] !== 'api') return error(404, 'Not found. The API lives under /api.')
    const [, resource, idText, sub, subId, leaf] = parts
    const method = request.method

    if (method !== 'GET' && method !== 'HEAD') {
      if (mode === 'replay')
        return error(405, 'The demo replays example runs and changes nothing.', { how: HOW_TO_RUN_LIVE })
      const origin = request.headers.get('origin')
      if (origin && !LOCAL_ORIGIN.test(origin))
        return error(403, `Origin not allowed: ${origin.slice(0, 100)}.`)
    }

    try {
      // GET /api/meta
      if (resource === 'meta' && !idText) {
        return json({ mode, exampleData, replaySpeeds: REPLAY_SPEEDS, live })
      }

      // /api/runs
      if (resource === 'runs' && !idText) {
        if (method === 'POST') {
          if (!options.runner)
            return error(409, 'Live runs need a key.', { how: live.how ?? HOW_TO_RUN_LIVE })
          const parsed = v.safeParse(StartRun, await readJson(request))
          if (!parsed.success) return error(400, firstIssue(parsed.issues))
          const { request: text, variant = 'crew' } = parsed.output
          const title = parsed.output.title ?? (text.length > 80 ? `${text.slice(0, 77)}…` : text)
          const current = options.runner.current()
          if (current !== undefined)
            return error(409, `Run #${current} is still in progress. Wait for it to finish.`)
          const runId = await options.runner.start({ title, request: text, variant })
          return json({ runId }, 202)
        }
        const status = url.searchParams.get('status') ?? undefined
        const variant = url.searchParams.get('variant') ?? undefined
        if (status && !(RUN_STATUSES as readonly string[]).includes(status))
          return error(400, `Unknown status "${status}". Use one of: ${RUN_STATUSES.join(', ')}.`)
        if (variant && !(VARIANTS as readonly string[]).includes(variant))
          return error(400, `Unknown variant "${variant}". Use one of: ${VARIANTS.join(', ')}.`)
        const limitText = url.searchParams.get('limit')
        const limit = limitText === null ? undefined : Number(limitText)
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 500))
          return error(400, 'limit is a whole number from 1 to 500.')
        const runs = listRuns(trace, {
          status: status as RunStatus | undefined,
          variant: variant as Variant | undefined,
          search: url.searchParams.get('q') ?? undefined,
          limit,
        })
        return json({ runs, summary: runsSummary(runs), waiting: options.gate?.waitingRuns() ?? [] })
      }

      // /api/runs/:id…
      if (resource === 'runs' && idText) {
        const id = Number(idText)
        if (!Number.isInteger(id) || id < 1) return error(400, `"${idText}" is not a run id.`)
        const row = runRow(id)
        if (!row) return error(404, `There is no run #${id}.`)

        if (!sub) {
          const detail = getRun(trace, id)!
          const waiting = options.gate?.waiting(id)
          return json({
            ...detail,
            gate: {
              waiting: !!waiting,
              plan: waiting?.plan ?? null,
              decidable: mode === 'live' && !!waiting,
            },
          })
        }
        if (sub === 'timeline' && !subId) {
          const events = (
            trace
              .prepare(
                'SELECT seq, step_id, offset_ms, kind, payload FROM events WHERE run_id = ? ORDER BY seq',
              )
              .all(id) as {
              seq: number
              step_id: number | null
              offset_ms: number
              kind: string
              payload: string
            }[]
          ).map((e) => ({ ...e, payload: TIMELINE_PAYLOADS.has(e.kind) ? JSON.parse(e.payload) : null }))
          const last = events.at(-1)?.offset_ms ?? 0
          return json({ runId: id, durationMs: row.duration_ms ?? last, replaySpeeds: REPLAY_SPEEDS, events })
        }
        if (sub === 'steps' && subId && leaf === 'events') {
          const stepId = Number(subId)
          const step = trace.prepare('SELECT id FROM steps WHERE id = ? AND run_id = ?').get(stepId, id)
          if (!step) return error(404, `Run #${id} has no step ${subId}.`)
          return json({ events: stepEvents(trace, stepId) })
        }
        if (sub === 'gate' && !subId) {
          if (method !== 'POST') return error(405, 'Answer the gate with POST.')
          if (!options.gate) return error(409, 'Live runs need a key.', { how: live.how ?? HOW_TO_RUN_LIVE })
          const parsed = v.safeParse(GateAnswer, await readJson(request))
          if (!parsed.success) return error(400, firstIssue(parsed.issues))
          if (!options.gate.answer(id, parsed.output))
            return error(409, `Run #${id} is not waiting at the gate.`)
          return json({ runId: id, decision: parsed.output.decision })
        }
      }

      if (resource === 'playbook' && !idText) return json({ versions: playbookHistory(trace) })

      // POST /api/playbook/:version (live): decide a proposed version.
      if (resource === 'playbook' && idText && !sub) {
        if (method !== 'POST') return error(405, 'Decide a playbook version with POST.')
        const version = Number(idText)
        if (!Number.isInteger(version) || version < 1)
          return error(400, `"${idText}" is not a playbook version.`)
        if (!options.playbook)
          return error(409, 'Live runs need a key.', { how: live.how ?? HOW_TO_RUN_LIVE })
        const exists = trace.prepare('SELECT status FROM playbook_versions WHERE version = ?').get(version)
        if (!exists) return error(404, `There is no playbook v${version}.`)
        const parsed = v.safeParse(PlaybookAnswer, await readJson(request))
        if (!parsed.success) return error(400, firstIssue(parsed.issues))
        try {
          return json(options.playbook.decide(version, parsed.output))
        } catch (e) {
          return error(409, (e as Error).message)
        }
      }

      if (resource === 'evaluation' && !idText) {
        return json({
          exampleData,
          ...(options.evaluationMeta ?? {}),
          main: evaluationSummary(trace, 'main'),
          learningCurve: {
            points: learningCurve(trace),
            variants: evaluationSummary(trace, 'learning-curve'),
          },
          matrix: requestMatrix(trace),
        })
      }

      return error(404, `No route for ${method} ${url.pathname}.`)
    } catch (e) {
      if (e instanceof SyntaxError) return error(400, 'The body is not valid JSON.')
      return error(500, `The API failed: ${(e as Error).message}`)
    }
  }
}
