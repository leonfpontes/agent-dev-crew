import { cleanup, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { getJson } from '../lib/api'
import { headline } from '../lib/evaluation'
import { MODELS, ROLES } from '../lib/landing'
import { PHRASE } from '../lib/share'
import type { EvaluationResponse } from '../lib/types'
import { installApi, renderAt } from '../test/api'
import { axe } from '../test/axe'

afterEach(cleanup)

describe('How it works', () => {
  it('opens at / with the sentence, the commands, the run summary and the measured sentence', async () => {
    installApi({ scoreboard: 'real' })
    const evaluation = await getJson<EvaluationResponse>('/api/evaluation')
    renderAt('/')
    expect(screen.getByRole('heading', { level: 1, name: PHRASE })).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Open the demo' })[0]!.getAttribute('href')).toBe('/runs')
    expect(screen.getAllByText(/pnpm demo/).length).toBeGreaterThan(0)
    expect((await screen.findAllByText(headline(evaluation)!)).length).toBeGreaterThan(0)
    const card = await screen.findByRole('figure', {
      name: /^Run 142: Add an order cancellation endpoint, passed/,
    })
    expect(within(card).getByText('example run')).toBeTruthy()
    expect(within(card).getByText('you approve here')).toBeTruthy()
    // measured numbers: no "example numbers" tag
    expect(screen.queryByText('example numbers')).toBeNull()
  })

  it('lists each role with its tools and models, as the engine has them', async () => {
    installApi()
    renderAt('/')
    const table = (
      await screen.findByRole('heading', { name: 'Four roles, one gate, a bounded fix loop' })
    ).closest('section')!
    for (const r of ROLES) {
      const row = within(table).getByRole('cell', { name: r.role }).closest('tr')!
      for (const t of r.tools) expect(within(row).getByText(t)).toBeTruthy()
      expect(row.textContent).toContain(`${MODELS.primary} · ${MODELS.fallback}`)
    }
  })

  it('shows the trace of a step, the lesson with its diff, the scoreboard and the quickstart', async () => {
    installApi({ scoreboard: 'real' })
    renderAt('/')
    expect(await screen.findByText('Fix loop 1 of 2')).toBeTruthy()
    expect(await screen.findByText(/started after QA failed 1 of 24 tests/)).toBeTruthy()
    expect(await screen.findByText('24 passed')).toBeTruthy()
    expect(
      await screen.findByText('QA failed: cancelled orders still counted in the daily total.'),
    ).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Diff of playbook.md' })).toBeTruthy()
    expect(await screen.findByRole('region', { name: 'Evaluation, by variant' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Full scoreboard/ }).getAttribute('href')).toBe('/evaluation')
    expect(screen.getByRole('heading', { name: 'The demo in three commands, without a key' })).toBeTruthy()
    expect(screen.getByText(/stopped at \$0\.25/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Repository' }).getAttribute('href')).toBe(
      'https://github.com/leonfpontes/agent-dev-crew',
    )
    expect(await axe(document.body)).toEqual([])
  })

  it('tags the numbers as examples while the scoreboard is the example one', async () => {
    installApi()
    renderAt('/')
    expect(await screen.findByText('example numbers')).toBeTruthy()
  })
})
