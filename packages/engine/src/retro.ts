// The automatic retrospective: after a crew run, one model call reads what happened (from the
// trace) and the playbook, and returns up to 3 lessons: error, cause, rule, with the role and the
// step where the error showed. The lessons go to the `lessons` table and their rules become a
// proposed playbook version, which counts only once it is approved (decidePlaybookVersion).
//
// A clean run (tests green at the first try, plan approved as it was, no review comments) has
// nothing to learn from, so it skips the model call. The single agent has no roles to teach.

import { PLAYBOOK_SECTIONS, type TraceDb } from '@crew/trace'
import * as v from 'valibot'

import { MODELS, readPrompt } from './agents.js'
import type { RetroContext, RetroResult } from './engine.js'
import { ensurePlaybook, proposePlaybookVersion, type LessonInput } from './playbook.js'
import type { ContentBlock, Message, ModelResponse, ToolSpec } from './provider.js'

export const MAX_LESSONS = 3
const MAX_TOKENS = 4_000
const MAX_DIFF_CHARS = 12_000

const Text = v.pipe(v.string(), v.trim(), v.minLength(3), v.maxLength(400))
const Lessons = v.object({
  lessons: v.pipe(
    v.array(
      v.object({
        error: Text,
        cause: Text,
        rule: v.pipe(Text, v.maxLength(200)),
        section: v.picklist(PLAYBOOK_SECTIONS),
        step: v.optional(v.nullable(v.number())),
      }),
    ),
    v.maxLength(MAX_LESSONS),
  ),
})

export const SUBMIT_LESSONS: ToolSpec = {
  name: 'submit_lessons',
  description: `Submit the lessons of this run (0 to ${MAX_LESSONS}).`,
  inputSchema: {
    type: 'object',
    properties: {
      lessons: {
        type: 'array',
        maxItems: MAX_LESSONS,
        items: {
          type: 'object',
          properties: {
            error: { type: 'string', description: 'What went wrong, as it showed in the run.' },
            cause: { type: 'string', description: 'Why it happened.' },
            rule: { type: 'string', description: 'One general, imperative sentence for next time.' },
            section: { type: 'string', enum: [...PLAYBOOK_SECTIONS] },
            step: { type: 'integer', description: 'The id of the step where the error showed.' },
          },
          required: ['error', 'cause', 'rule', 'section', 'step'],
          additionalProperties: false,
        },
      },
    },
    required: ['lessons'],
    additionalProperties: false,
  },
}

interface StepRow {
  id: number
  parent_id: number | null
  kind: string
  role: string | null
  status: string
  summary: string | null
  attempt: number
  loop_index: number | null
  comment: string | null
}

const ROLE_NAMES: Record<string, string> = { po: 'PO', engineer: 'Engineer', reviewer: 'Reviewer', qa: 'QA' }

/** What happened in a run, from its trace, in the tags the retro prompt names. */
export type RunOutcome = Pick<RetroContext, 'status' | 'failureReason' | 'tests'>

export function describeRun(
  db: TraceDb,
  runId: number,
  outcome: RunOutcome,
  diff: string,
  playbook: string,
): string {
  const run = db.prepare('SELECT title, request FROM runs WHERE id = ?').get(runId) as {
    title: string
    request: string
  }
  const steps = db
    .prepare(
      "SELECT id, parent_id, kind, role, status, summary, attempt, loop_index, comment FROM steps WHERE run_id = ? AND kind <> 'retro' ORDER BY seq",
    )
    .all(runId) as unknown as StepRow[]
  const events = db
    .prepare(
      "SELECT step_id, kind, payload FROM events WHERE run_id = ? AND kind IN ('tool.call', 'tool.result', 'log', 'model.response') ORDER BY seq",
    )
    .all(runId) as { step_id: number | null; kind: string; payload: string }[]

  let plan: unknown
  const lines: string[] = []
  for (const s of steps) {
    const name =
      s.kind === 'gate'
        ? 'Gate'
        : s.kind === 'fix-loop'
          ? `Fix loop ${s.loop_index}`
          : `${ROLE_NAMES[s.role ?? ''] ?? 'Agent'} · ${s.kind}`
    const indent = s.parent_id ? '  ' : ''
    lines.push(
      `${indent}[${s.id}] ${name}, attempt ${s.attempt}: ${s.status}${s.summary ? ` (${s.summary})` : ''}`,
    )
    if (s.comment) lines.push(`${indent}  person: ${s.comment}`)
    for (const e of events.filter((x) => x.step_id === s.id)) {
      const p = JSON.parse(e.payload) as Record<string, unknown>
      if (e.kind === 'model.response' && p.plan) plan = p.plan
      if (e.kind === 'tool.call' && p.tool === 'submit_review') {
        const input = p.input as { verdict?: string; comments?: string[] }
        lines.push(`${indent}  review: ${input.verdict}`)
        for (const c of input.comments ?? []) lines.push(`${indent}  - ${c}`)
      }
      if (e.kind === 'tool.result' && p.by === 'engine') {
        const out = p.output as { failures?: { name: string; message: string }[]; error?: string }
        if (out.error) lines.push(`${indent}  tests did not run: ${out.error.slice(0, 300)}`)
        for (const f of (out.failures ?? []).slice(0, 8))
          lines.push(`${indent}  failing: ${f.name}: ${f.message.slice(0, 300)}`)
      }
      if (e.kind === 'log' && p.level === 'error')
        lines.push(`${indent}  error: ${String(p.message).slice(0, 300)}`)
    }
  }
  const result = [
    `status: ${outcome.status}`,
    outcome.failureReason && `reason: ${outcome.failureReason}`,
    outcome.tests && `tests: ${outcome.tests.passed} / ${outcome.tests.total}`,
  ]
    .filter(Boolean)
    .join(', ')
  return [
    `<request title="${run.title.replace(/"/g, '&quot;')}">\n${run.request}\n</request>`,
    plan ? `<plan>\n${JSON.stringify(plan, null, 2)}\n</plan>` : '',
    `<outcome>\n${result}\n</outcome>`,
    `<steps>\n${lines.join('\n')}\n</steps>`,
    `<diff>\n${diff.length > MAX_DIFF_CHARS ? `${diff.slice(0, MAX_DIFF_CHARS)}\n… (diff cut)` : diff || '(no change)'}\n</diff>`,
    `<playbook>\n${playbook.trim()}\n</playbook>`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** True when the run gives the retro nothing to learn from. */
export function cleanRun(db: TraceDb, runId: number, status: RetroContext['status']): boolean {
  const troubled = db
    .prepare(
      `SELECT COUNT(*) AS n FROM steps WHERE run_id = ? AND kind <> 'retro'
       AND (status IN ('failed', 'changes-requested', 'rejected') OR kind = 'fix-loop' OR fallback_used = 1)`,
    )
    .get(runId) as { n: number }
  const comments = db
    .prepare("SELECT payload FROM events WHERE run_id = ? AND kind = 'tool.call'")
    .all(runId)
    .map(
      (r) =>
        JSON.parse((r as { payload: string }).payload) as { tool: string; input: { comments?: string[] } },
    )
    .some((p) => p.tool === 'submit_review' && (p.input.comments?.length ?? 0) > 0)
  return status === 'passed' && troubled.n === 0 && !comments
}

export interface RetroOptions {
  trace: TraceDb
  models?: { primary: string; fallback?: string }
  now?: () => Date
}

export type RetroLesson = LessonInput & {
  position: number
  status: 'proposed' | 'duplicate'
  playbookVersion: number | null
  duplicateOf: number | null
}

/** The retro hook for runCrew: lessons in the trace and a proposed playbook version. */
export function createRetro(options: RetroOptions): (context: RetroContext) => Promise<RetroResult> {
  const models = options.models ?? { ...MODELS }
  const now = options.now ?? (() => new Date())
  const system = readPrompt('retro')

  return async (context) => {
    if (context.variant === 'single-agent' || cleanRun(options.trace, context.runId, context.status))
      return { lessons: [] }
    const playbook = ensurePlaybook(options.trace, now())
    const messages: Message[] = [
      {
        role: 'user',
        content: describeRun(options.trace, context.runId, context, context.diff, playbook.content),
      },
    ]

    const call = async (model: string): Promise<ModelResponse> =>
      context.complete(
        { agent: 'retro', model, system, messages, tools: [SUBMIT_LESSONS], maxTokens: MAX_TOKENS },
        'prompts/retro.md',
      )
    const ask = async () => {
      try {
        return await call(models.primary)
      } catch (error) {
        if (!models.fallback || (error as Error).name === 'BudgetExceeded') throw error
        return await call(models.fallback)
      }
    }

    // Two tries: a model that answers in text, or with an invalid input, gets one reminder.
    let found: v.InferOutput<typeof Lessons> | undefined
    for (let attempt = 0; attempt < 2 && !found; attempt++) {
      const response = await ask()
      messages.push({ role: 'assistant', content: response.content })
      const use = response.content.find(
        (b): b is Extract<ContentBlock, { type: 'tool_use' }> =>
          b.type === 'tool_use' && b.name === 'submit_lessons',
      )
      const parsed = use ? v.safeParse(Lessons, use.input) : undefined
      if (parsed?.success) found = parsed.output
      else if (use)
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              toolUseId: use.id,
              isError: true,
              content: `Invalid input: ${parsed?.issues.map((i) => i.message).join('; ')}. Call submit_lessons again.`,
            },
          ],
        })
      else
        messages.push({
          role: 'user',
          content: 'Call submit_lessons now, with an empty list if there is no lesson.',
        })
    }
    if (!found) throw new Error('the retro model did not submit valid lessons')

    const stepIds = new Set(
      (
        options.trace.prepare('SELECT id FROM steps WHERE run_id = ?').all(context.runId) as { id: number }[]
      ).map((r) => r.id),
    )
    const lessons: LessonInput[] = found.lessons.map((l) => ({
      error: l.error,
      cause: l.cause,
      rule: l.rule,
      section: l.section,
      // A step the run doesn't have (a model slip) is dropped rather than pointing elsewhere.
      stepId: l.step != null && stepIds.has(l.step) && l.step !== context.stepId ? l.step : null,
    }))
    const proposal = proposePlaybookVersion(options.trace, context.runId, lessons, now())
    const result: RetroLesson[] = proposal.lessons.map((l) => ({
      ...l,
      playbookVersion: l.status === 'proposed' ? (proposal.version ?? null) : null,
      duplicateOf: l.duplicateOf ?? null,
    }))
    return { lessons: result }
  }
}
