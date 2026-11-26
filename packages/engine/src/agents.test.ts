// The crew's role specs: prompts from files, the models, the playbook rules each role receives and
// the user message of each moment.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { createRoleSpecs, initialPlaybook, LIMITS, MODELS, promptVersion, userMessage } from './index.js'
import type { Agent, RoleInput } from './index.js'
import { PLAN, ROOT } from './test/fixtures.js'

const AGENTS: Agent[] = ['po', 'engineer', 'reviewer', 'qa', 'solo']
const roles = createRoleSpecs()
const base: RoleInput = { title: 'Add a cancel route', request: 'Add POST /orders/:id/cancel.' }
const playbook = { version: 3, content: initialPlaybook() }

describe('createRoleSpecs', () => {
  it.each(AGENTS)('gives the %s its own prompt file, Claude Haiku 5.5 and a fallback', (agent) => {
    const spec = roles[agent]
    const file = path.join(ROOT, 'packages/engine', spec.promptFile)
    expect(existsSync(file)).toBe(true)
    expect(spec.system(base)).toBe(readFileSync(file, 'utf8').trim())
    expect(spec.models).toEqual({ primary: 'claude-haiku-5-5', fallback: 'claude-haiku-4-5-20251001' })
    expect(spec).toMatchObject(LIMITS[agent])
  })

  it('gives the single agent the same models as the crew, so the ablation compares crews', () => {
    expect(roles.solo.models).toEqual(roles.engineer.models)
    expect(roles.solo.playbookSection).toBeUndefined()
  })

  it('refuses a model outside the cost allowlist, as primary or fallback, unless it is allowed', () => {
    expect(() => createRoleSpecs({ models: { primary: 'claude-opus-5-5' } })).toThrow(
      'The model "claude-opus-5-5" is not in the allowed models (claude-haiku-5-5, claude-haiku-4-5-20251001)',
    )
    expect(() =>
      createRoleSpecs({ models: { primary: MODELS.primary, fallback: 'claude-opus-4-6' } }),
    ).toThrow('not in the allowed models')
    const allowed = createRoleSpecs({ models: { primary: 'model-x' }, allowedModels: ['model-x'] })
    expect(allowed.po.models.primary).toBe('model-x')
  })

  it('takes other limits per role', () => {
    const custom = createRoleSpecs({ limits: { engineer: { maxTurns: 3 } } })
    expect(custom.engineer).toMatchObject({ maxTurns: 3, maxTokens: LIMITS.engineer.maxTokens })
  })

  it.each([
    ['po', 'PO', 'Write each acceptance criterion'],
    ['engineer', 'Engineer', 'Read every file you change'],
    ['reviewer', 'Reviewer', 'Ask for changes only'],
    ['qa', 'QA', 'Run the full suite'],
  ] as const)(
    'gives the %s its playbook section and records it as the rules applied',
    (agent, section, rule) => {
      const spec = roles[agent]
      expect(spec.playbookSection).toBe(section)
      const input = { ...base, playbook }
      expect(spec.rules!(input)).toEqual([expect.stringContaining(rule)])
      const system = spec.system(input)
      expect(system).toContain(`<playbook version="3" section="${section}">`)
      expect(system).toContain(`- ${spec.rules!(input)[0]}`)
      // Only its own section.
      expect(system.match(/^- /gm)?.length ?? 0).toBeLessThanOrEqual(
        readFileSync(path.join(ROOT, 'packages/engine', spec.promptFile), 'utf8').match(/^- /gm)!.length + 1,
      )
    },
  )

  it('applies no rules without a playbook, and none to the single agent', () => {
    expect(roles.engineer.rules!(base)).toEqual([])
    expect(roles.solo.rules!({ ...base, playbook })).toEqual([])
    expect(roles.solo.system({ ...base, playbook })).not.toContain('<playbook')
  })

  it('versions the prompts with a hash of the files', () => {
    expect(promptVersion()).toMatch(/^[0-9a-f]{12}$/)
    expect(promptVersion()).toBe(promptVersion())
  })
})

describe('userMessage', () => {
  it('puts the request and the approved plan in tags', () => {
    const message = userMessage({ ...base, plan: PLAN })
    expect(message).toContain(
      '<request title="Add a cancel route">\nAdd POST /orders/:id/cancel.\n</request>',
    )
    expect(message).toContain('1. Add the cancel route')
    expect(message).toContain('- A shipped order answers 409')
    expect(message).toContain('Files: src/routes/orders.ts')
  })

  it('gives the PO the plan and the comment when a person asked for changes', () => {
    const message = userMessage({ ...base, plan: PLAN, gateComment: 'Also refunded orders.' })
    expect(message).toContain('<gate_comment>\nAlso refunded orders.\n</gate_comment>')
  })

  it('gives a fix the loop, the failures, the review comments and the diff', () => {
    const failures = Array.from({ length: 12 }, (_, i) => ({ name: `test ${i}`, message: 'x'.repeat(2000) }))
    const message = userMessage({
      ...base,
      plan: PLAN,
      loop: 2,
      failures,
      reviewComments: ['Handle the 404.'],
      diff: '+'.repeat(25_000),
    })
    expect(message).toContain('<fix_loop>\n2 of 2\n</fix_loop>')
    expect(message).toContain('- test 9: ')
    expect(message).not.toContain('- test 10: ')
    expect(message).toContain('- … and 2 more')
    expect(message).toContain('(message cut)')
    expect(message).toContain('<review_comments>\n- Handle the 404.\n</review_comments>')
    expect(message).toContain('(diff cut: read the files for the rest)')
    expect(message.length).toBeLessThan(35_000)
  })

  it('escapes quotes in the title', () => {
    expect(userMessage({ ...base, title: 'Say "hi"' })).toContain('title="Say &quot;hi&quot;"')
  })
})
