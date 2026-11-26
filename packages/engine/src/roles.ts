// What the engine asks of each role. The AI story writes the prompts (in files), picks the models
// and the fallbacks, and returns RoleSpecs; the engine runs them. Nothing here calls a model.

import type { Role } from '@crew/core'
import type { TestFailure } from '@crew/sandbox'
import type { PlaybookSection } from '@crew/trace'

/** The four crew roles, plus the single agent of the `single-agent` variant. */
export type Agent = Role | 'solo'

export interface Plan {
  steps: string[]
  acceptance: string[]
  /** Files the PO expects the Engineer to touch, relative to the repository. */
  files: string[]
  estimateUsd: number
}

export interface Review {
  verdict: 'approve' | 'changes'
  comments: string[]
}

/** Everything a role may need to write its prompt. Only the fields of its moment are set. */
export interface RoleInput {
  title: string
  request: string
  /** The approved plan (Engineer, Reviewer, QA) or the plan being revised (PO). */
  plan?: Plan
  /** The person's comment when they asked the PO for changes. */
  gateComment?: string
  /** The diff of the work so far (Reviewer, QA, fixes). */
  diff?: string
  /** The failing tests that started a fix loop. */
  failures?: TestFailure[]
  /** The Reviewer's comments, passed to the Engineer in a fix loop. */
  reviewComments?: string[]
  /** The fix loop this call belongs to (1 or 2). */
  loop?: number
  /** The playbook, in the `crew-playbook` variant. */
  playbook?: { version: number; content: string }
}

export interface RoleSpec {
  agent: Agent
  /** Prompt file the role uses, kept in the trace (e.g. `prompts/engineer.md`). */
  promptFile: string
  /** The playbook section the role follows (the single agent follows none). */
  playbookSection?: PlaybookSection
  models: { primary: string; fallback?: string }
  /** Model calls per step, tool round trips included, before the step fails. */
  maxTurns: number
  maxTokens: number
  system(input: RoleInput): string
  user(input: RoleInput): string
  /** Playbook rules applied in this call, shown in the step panel. */
  rules?(input: RoleInput): string[]
}

export type RoleSpecs = Record<Agent, RoleSpec>
