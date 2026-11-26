// Shared test setup: an in-memory trace, simple role specs (the real prompts come from the AI story),
// and paths to the example and to one request's reference solution, all inside the repository.
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { migrate, openTrace } from '@crew/trace'

import type { Agent, RoleSpec, RoleSpecs } from '../roles.js'

/** The repository root: the nearest folder above this file with pnpm-workspace.yaml. */
export const ROOT = (() => {
  let dir = path.dirname(fileURLToPath(import.meta.url))
  while (!existsSync(path.join(dir, 'pnpm-workspace.yaml'))) dir = path.dirname(dir)
  return dir
})()

export const EXAMPLE = path.join(ROOT, 'examples', 'fernhill-orders')
export const CANCEL_ORDER = path.join(ROOT, 'evals', 'requests', 'cancel-order')
export const REQUEST = {
  id: 'cancel-order',
  title: 'Add an order cancellation endpoint',
  request: 'Add POST /orders/:id/cancel for pending or paid orders.',
}

export function freshTrace() {
  const db = openTrace(':memory:')
  migrate(db)
  return db
}

export const workRoot = () => mkdtempSync(path.join(tmpdir(), 'crew-engine-'))

const spec = (agent: Agent, extra: Partial<RoleSpec> = {}): RoleSpec => ({
  agent,
  promptFile: `prompts/${agent}.md`,
  playbookSection:
    agent === 'solo'
      ? undefined
      : ({ po: 'PO', engineer: 'Engineer', reviewer: 'Reviewer', qa: 'QA' } as const)[agent],
  models: { primary: 'model-small' },
  maxTurns: 6,
  maxTokens: 1000,
  system: (input) => `You are the ${agent}.${input.playbook ? ` Playbook v${input.playbook.version}.` : ''}`,
  user: (input) =>
    [
      input.request,
      input.gateComment && `Changes: ${input.gateComment}`,
      input.failures?.length && `Failing: ${input.failures.length}`,
    ]
      .filter(Boolean)
      .join('\n'),
  rules: () => [],
  ...extra,
})

export function testRoles(overrides: Partial<Record<Agent, Partial<RoleSpec>>> = {}): RoleSpecs {
  return {
    po: spec('po', overrides.po),
    engineer: spec('engineer', overrides.engineer),
    reviewer: spec('reviewer', overrides.reviewer),
    qa: spec('qa', overrides.qa),
    solo: spec('solo', overrides.solo),
  }
}

/** The reference solution of cancel-order as `write_file` inputs (paths relative to the repository). */
export function solutionWrites(): { path: string; content: string }[] {
  const root = path.join(CANCEL_ORDER, 'solution')
  const out: { path: string; content: string }[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else
        out.push({
          path: path.relative(root, full).split(path.sep).join('/'),
          content: readFileSync(full, 'utf8'),
        })
    }
  }
  walk(root)
  return out
}

export const PLAN = {
  steps: ['Add the cancel route', 'Leave cancelled orders out of the daily total'],
  acceptance: ['A pending order can be cancelled', 'A shipped order answers 409'],
  files: ['src/routes/orders.ts'],
  estimateUsd: 0.05,
}
