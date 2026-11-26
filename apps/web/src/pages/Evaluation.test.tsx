import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { getJson } from '../lib/api'
import { headline } from '../lib/evaluation'
import type { EvaluationResponse } from '../lib/types'
import { installApi, renderAt } from '../test/api'
import { axe } from '../test/axe'

afterEach(cleanup)

const rows = () => within(screen.getAllByRole('table').at(-1)!).getAllByRole('row').slice(1)

describe('Evaluation', () => {
  it.each(['example', 'real'] as const)(
    'writes the headline from the %s scoreboard, with no number typed by hand',
    async (scoreboard) => {
      installApi({ scoreboard })
      // The page opens on the hard set when the API has it.
      const data = await getJson<EvaluationResponse>(
        scoreboard === 'real' ? '/api/evaluation?set=hard' : '/api/evaluation',
      )
      renderAt('/evaluation')
      expect(await screen.findByRole('heading', { level: 1, name: headline(data)! })).toBeTruthy()
      expect(screen.queryByRole('note') !== null).toBe(data.exampleData)
      expect(screen.getByRole('img', { name: /Learning curve/ })).toBeTruthy()
      for (const p of data.learningCurve.points)
        expect(screen.getAllByRole('img', { name: new RegExp(`^v${p.playbookVersion},`) }).length).toBe(1)
      expect(rows()).toHaveLength(data.matrix.length)
      expect(await axe(document.body)).toEqual([])
    },
    // The whole page plus axe: about 1 s alone, several under a loaded machine.
    20_000,
  )

  it('checks the best value of each metric, and only when one variant has it', async () => {
    installApi()
    renderAt('/evaluation')
    const metrics = (await screen.findByRole('heading', { name: 'All metrics' })).closest('section')!
    const cost = within(metrics).getByRole('rowheader', { name: 'Cost per request' }).closest('tr')!
    expect(within(cost).getAllByText('best')).toHaveLength(1)
    const gate = within(metrics).getByRole('rowheader', { name: 'Gate interventions' }).closest('tr')!
    expect(within(gate).queryByText('best')).toBeNull()
    expect(gate.textContent).toContain('does not apply')
  })

  it('sorts the requests and keeps only where the variants disagree', async () => {
    installApi()
    const user = userEvent.setup()
    renderAt('/evaluation')
    await screen.findByRole('heading', { name: 'Per request' })
    const total = rows().length
    await user.click(screen.getByRole('button', { name: 'Only where variants disagree' }))
    expect(
      screen.getByRole('button', { name: 'Only where variants disagree' }).getAttribute('aria-pressed'),
    ).toBe('true')
    expect(rows().length).toBeLessThan(total)
    expect(screen.getByText(`${rows().length} of ${total} requests`)).toBeTruthy()
  })

  it('says there is nothing to show yet, and gives the command', async () => {
    installApi({
      override: (path) =>
        path === '/api/evaluation'
          ? { exampleData: false, main: [], learningCurve: { points: [], variants: [] }, matrix: [] }
          : undefined,
    })
    renderAt('/evaluation')
    expect(await screen.findByRole('heading', { name: 'Run the evaluation to fill this page' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeTruthy()
    expect(screen.getAllByText(/pnpm eval/).length).toBeGreaterThan(0)
  })

  it('shows a single measured version as one point and says why', async () => {
    installApi({ scoreboard: 'real' })
    const data = await getJson<EvaluationResponse>('/api/evaluation?set=hard')
    renderAt('/evaluation')
    await screen.findByRole('heading', { name: 'Per request' })
    if (data.learningCurve.points.length === 1) expect(screen.getByText(/One point so far/)).toBeTruthy()
    else expect(screen.queryByText(/One point so far/)).toBeNull()
  })
})

describe('Evaluation · two request sets', () => {
  it('opens on the hard set, with a tab for each set, and keeps the choice in the address', async () => {
    installApi({ scoreboard: 'real' })
    const hard = await getJson<EvaluationResponse>('/api/evaluation?set=hard')
    const easy = await getJson<EvaluationResponse>('/api/evaluation?set=easy')
    const user = userEvent.setup()
    renderAt('/evaluation')
    const tabs = await screen.findByRole('tablist', { name: 'Request set' })
    const [first, second] = within(tabs).getAllByRole('tab')
    expect(first!.textContent).toMatch(/^Hard set · \d+ two-part requests$/)
    expect(second!.textContent).toMatch(/^Easy set · \d+ requests$/)
    expect(first!.getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByRole('heading', { level: 1, name: headline(hard)! })).toBeTruthy()
    expect(headline(hard)).toContain('of the hard requests')
    for (const n of hard.notes ?? []) expect(screen.getByText(n)).toBeTruthy()
    await user.click(second!)
    expect(new URLSearchParams(window.location.search).get('set')).toBe('easy')
    expect(await screen.findByRole('heading', { level: 1, name: headline(easy)! })).toBeTruthy()
  })

  it('shows no set tabs when the API has one set', async () => {
    installApi()
    renderAt('/evaluation')
    await screen.findByRole('heading', { name: 'Per request' })
    expect(screen.queryByRole('tablist', { name: 'Request set' })).toBeNull()
  })
})

describe('Evaluation · set tabs and the keyboard', () => {
  it('keeps the focus on the chosen tab while the other set loads', async () => {
    installApi({ scoreboard: 'real' })
    const user = userEvent.setup()
    renderAt('/evaluation')
    const tabs = await screen.findByRole('tablist', { name: 'Request set' })
    const [hard] = within(tabs).getAllByRole('tab')
    hard!.focus()
    await user.keyboard('{ArrowRight}')
    await screen.findByRole('heading', { name: 'Per request' })
    const easy = within(screen.getByRole('tablist', { name: 'Request set' })).getAllByRole('tab')[1]!
    expect(new URLSearchParams(window.location.search).get('set')).toBe('easy')
    expect(easy.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(easy)
  })
})
