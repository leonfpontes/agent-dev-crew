// The crew's RoleSpecs: one prompt file per role (prompts/*.md), the models with their fallback,
// the turn and token limits, and the user message built from what the engine knows at that moment.
// In the `crew-playbook` variant each role also gets its playbook section, recorded as the rules
// applied. The single agent gets the same models, so the ablation compares crews, not models.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'

import { assertAllowedModel } from './anthropic.js'
import { sectionRules } from './playbook.js'
import type { Agent, RoleInput, RoleSpec, RoleSpecs } from './roles.js'

export const PROMPTS_DIR = new URL('../prompts/', import.meta.url)

/** Primary and fallback model of every role (ADR 0004). */
export const MODELS = { primary: 'claude-haiku-5-5', fallback: 'claude-haiku-4-5-20251001' } as const

export const readPrompt = (name: string) => readFileSync(new URL(`${name}.md`, PROMPTS_DIR), 'utf8').trim()

/** A hash of every prompt file: the prompt version a scoreboard records. */
export const promptVersion = () => {
  const hash = createHash('sha256')
  for (const file of readdirSync(PROMPTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort())
    hash.update(`${file}\n${readFileSync(new URL(file, PROMPTS_DIR), 'utf8')}\n`)
  return hash.digest('hex').slice(0, 12)
}

/** Large inputs are cut so one diff can't fill the context; the agent can still read the files. */
export const MAX_DIFF_CHARS = 20_000
export const MAX_FAILURE_CHARS = 600
export const MAX_FAILURES = 10

const cut = (value: string, max: number, note: string) =>
  value.length <= max ? value : `${value.slice(0, max)}\n… (${note})`

const tag = (name: string, body: string, attrs = '') => `<${name}${attrs}>\n${body.trim()}\n</${name}>`
const escapeAttr = (value: string) => value.replace(/"/g, '&quot;')

/** The user message: the data of this moment, in tags the prompts name. */
export function userMessage(input: RoleInput): string {
  const parts = [tag('request', input.request, ` title="${escapeAttr(input.title)}"`)]
  if (input.plan) {
    const p = input.plan
    parts.push(
      tag(
        'plan',
        [
          'Steps:',
          ...p.steps.map((s, i) => `${i + 1}. ${s}`),
          'Acceptance:',
          ...p.acceptance.map((a) => `- ${a}`),
          `Files: ${p.files.length ? p.files.join(', ') : '(none listed)'}`,
        ].join('\n'),
      ),
    )
  }
  if (input.gateComment) parts.push(tag('gate_comment', input.gateComment))
  if (input.loop) parts.push(tag('fix_loop', `${input.loop} of 2`))
  if (input.failures?.length) {
    const shown = input.failures.slice(0, MAX_FAILURES)
    const more = input.failures.length - shown.length
    parts.push(
      tag(
        'failures',
        [
          ...shown.map((f) => `- ${f.name}: ${cut(f.message, MAX_FAILURE_CHARS, 'message cut')}`),
          ...(more > 0 ? [`- … and ${more} more`] : []),
        ].join('\n'),
      ),
    )
  }
  if (input.reviewComments?.length)
    parts.push(tag('review_comments', input.reviewComments.map((c) => `- ${c}`).join('\n')))
  if (input.diff)
    parts.push(tag('diff', cut(input.diff, MAX_DIFF_CHARS, 'diff cut: read the files for the rest')))
  return parts.join('\n\n')
}

interface Limits {
  maxTurns: number
  maxTokens: number
}

/** Model calls per step (tool round trips included) and output tokens per call. */
export const LIMITS: Record<Agent, Limits> = {
  po: { maxTurns: 10, maxTokens: 4_000 },
  engineer: { maxTurns: 24, maxTokens: 8_000 },
  reviewer: { maxTurns: 10, maxTokens: 4_000 },
  qa: { maxTurns: 16, maxTokens: 8_000 },
  // The single agent plans, codes and tests in one step: about the crew's turns put together.
  solo: { maxTurns: 40, maxTokens: 8_000 },
}

const SECTIONS = { po: 'PO', engineer: 'Engineer', reviewer: 'Reviewer', qa: 'QA' } as const

export interface RoleSpecOptions {
  models?: { primary: string; fallback?: string }
  limits?: Partial<Record<Agent, Partial<Limits>>>
}

export function createRoleSpecs(options: RoleSpecOptions = {}): RoleSpecs {
  const models = options.models ?? { ...MODELS }
  assertAllowedModel(models.primary)
  if (models.fallback) assertAllowedModel(models.fallback)

  const spec = (agent: Agent): RoleSpec => {
    const prompt = readPrompt(agent)
    const section = agent === 'solo' ? undefined : SECTIONS[agent]
    const rules = (input: RoleInput) =>
      section && input.playbook ? sectionRules(input.playbook.content, section) : []
    return {
      agent,
      promptFile: `prompts/${agent}.md`,
      playbookSection: section,
      models,
      ...LIMITS[agent],
      ...options.limits?.[agent],
      system: (input) => {
        const applied = rules(input)
        if (!input.playbook || applied.length === 0) return prompt
        return `${prompt}\n\n${tag(
          'playbook',
          applied.map((r) => `- ${r}`).join('\n'),
          ` version="${input.playbook.version}" section="${section}"`,
        )}\nFollow these rules too: they come from the retrospectives of earlier runs.`
      },
      user: userMessage,
      rules,
    }
  }
  return {
    po: spec('po'),
    engineer: spec('engineer'),
    reviewer: spec('reviewer'),
    qa: spec('qa'),
    solo: spec('solo'),
  }
}
