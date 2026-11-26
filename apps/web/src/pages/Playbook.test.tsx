import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { addedRules, parsePlaybook, provenance } from './Playbook'
import { installApi, NOW, renderAt } from '../test/api'
import { axe } from '../test/axe'
import type { PlaybookVersion } from '../lib/types'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW.getTime() + 60_000))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Playbook', () => {
  it('shows the versions, the proposed playbook with the new rule marked, and the proposal from its run', async () => {
    installApi()
    renderAt('/playbook')
    const versions = await screen.findByRole('navigation', { name: 'Versions' })
    const items = within(versions).getAllByRole('button')
    expect(items[0]!.textContent).toContain('Proposed')
    expect(items[0]!.getAttribute('aria-current')).toBe('true')
    expect(screen.getByText('playbook.md · v8 proposed')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Engineer' })).toBeTruthy()
    const proposal = screen.getByRole('complementary', { name: /Proposed change/ })
    expect(
      await within(proposal).findByText('QA failed: cancelled orders still counted in the daily total.'),
    ).toBeTruthy()
    expect(within(proposal).getByRole('link', { name: 'Run #142' }).getAttribute('href')).toBe('/runs/142')
    expect(within(proposal).getByText(/duplicate of v6/)).toBeTruthy()
    expect(await axe(document.body)).toEqual([])
  })

  it('opens another version from the list', async () => {
    installApi()
    const user = userEvent.setup()
    renderAt('/playbook')
    const versions = await screen.findByRole('navigation', { name: 'Versions' })
    await user.click(within(versions).getByRole('button', { name: /v1/ }))
    expect(screen.getByText('playbook.md · v1 approved')).toBeTruthy()
  })

  it('keeps each version with its diff, where it came from and what the evaluation measured', async () => {
    installApi()
    renderAt('/playbook#v7')
    const history = await screen.findByRole('region', { name: /History · v1 to v8/ })
    expect(within(history).getAllByText('Not measured · no rule changed')).toHaveLength(2)
    expect((await within(history).findAllByText(/^Measured: \d+%/)).length).toBeGreaterThan(0)
    const v7 = document.getElementById('v7') as HTMLDetailsElement
    expect(v7.open).toBe(true)
    expect(within(v7).getByRole('region', { name: 'Diff of v7' })).toBeTruthy()
  })

  it('in replay, a decision on the proposal gets the API explanation', async () => {
    const { calls } = installApi()
    const user = userEvent.setup()
    renderAt('/playbook')
    await user.click(await screen.findByRole('button', { name: 'Approve as v8' }))
    expect(await screen.findByText('Replay mode: the playbook stays as in the example')).toBeTruthy()
    expect(calls.find((c) => c.method === 'POST')).toEqual({
      method: 'POST',
      path: '/api/playbook/8',
      body: { decision: 'approve' },
    })
    await user.click(screen.getByRole('button', { name: 'Edit rule' }))
    expect((screen.getByLabelText('Rule') as HTMLTextAreaElement).value).toContain('find every reader')
  })
})

describe('playbook text', () => {
  it('reads sections and wrapped rules, and the rules a diff adds', () => {
    expect(parsePlaybook('# T\n\n## PO\n- One\n- Two that\n  wraps\n## QA\n- Three')).toEqual([
      { kind: 'h2', text: 'PO' },
      { kind: 'li', text: 'One' },
      { kind: 'li', text: 'Two that wraps' },
      { kind: 'h2', text: 'QA' },
      { kind: 'li', text: 'Three' },
    ])
    expect(addedRules('@@ -1,1 +1,3 @@\n - Old\n+- New rule\n+  that wraps')).toEqual(['New rule that wraps'])
  })

  it('says where each version came from', () => {
    const base = {
      source_run_id: 142,
      lesson_run_id: 142,
      lesson_position: 1,
      lesson_step_role: 'qa',
      lesson_step_kind: 'test',
      lesson_step_attempt: 1,
    }
    expect(provenance({ ...base, source: 'retro' } as PlaybookVersion)).toBe(
      'run #142 · lesson 1 · QA · test, attempt 1',
    )
    expect(provenance({ source: 'manual' } as PlaybookVersion)).toBe('edited by hand')
    expect(provenance({ source: 'initial' } as PlaybookVersion)).toBe('written by hand')
  })
})
