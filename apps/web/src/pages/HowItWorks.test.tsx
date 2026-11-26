import { cleanup, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { leadSet, scoreSets, setHeadline } from '../lib/scoreboards'
import { MODELS, ROLES } from '../lib/landing'
import { PHRASE } from '../lib/share'
import { installApi, renderAt } from '../test/api'
import { axe } from '../test/axe'

afterEach(cleanup)

describe('How it works', () => {
  it('opens at / with the sentence, the commands, the run summary and the measured sentence', async () => {
    installApi({ scoreboard: 'real' })
    renderAt('/')
    expect(screen.getByRole('heading', { level: 1, name: PHRASE })).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Open the demo' })[0]!.getAttribute('href')).toBe('/runs')
    expect(screen.getAllByText(/pnpm demo/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(setHeadline(leadSet()!)!).length).toBeGreaterThan(0)
    const card = await screen.findByRole('figure', {
      name: /^Run 142: Add an order cancellation endpoint, passed/,
    })
    expect(within(card).getByText('example run')).toBeTruthy()
    expect(within(card).getByText('you approve here')).toBeTruthy()
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
    // every scoreboard, the hard set first, with its notes
    const sets = scoreSets()
    const tables = screen.getAllByRole('region', { name: /^Evaluation, (hard|easy) set, by variant$/ })
    expect(tables).toHaveLength(sets.length)
    expect(tables[0]!.getAttribute('aria-label')).toBe(`Evaluation, ${sets[0]!.set} set, by variant`)
    for (const s of sets) for (const n of s.notes) expect(screen.getByText(`Note: ${n}`)).toBeTruthy()
    expect(screen.getByRole('link', { name: /Full scoreboard/ }).getAttribute('href')).toBe('/evaluation')
    expect(screen.getByRole('heading', { name: 'The demo in three commands, without a key' })).toBeTruthy()
    expect(screen.getByText(/stopped at \$0\.25/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Repository' }).getAttribute('href')).toBe(
      'https://github.com/leonfpontes/agent-dev-crew',
    )
    expect(await axe(document.body)).toEqual([])
  })
})
