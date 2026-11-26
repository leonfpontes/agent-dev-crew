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
      const data = await getJson<EvaluationResponse>('/api/evaluation')
      renderAt('/evaluation')
      expect(await screen.findByRole('heading', { level: 1, name: headline(data)! })).toBeTruthy()
      expect(screen.queryByRole('note') !== null).toBe(data.exampleData)
      expect(screen.getByRole('img', { name: /Learning curve/ })).toBeTruthy()
      for (const p of data.learningCurve.points)
        expect(screen.getAllByRole('img', { name: new RegExp(`^v${p.playbookVersion},`) }).length).toBe(1)
      expect(rows()).toHaveLength(data.matrix.length)
      expect(await axe(document.body)).toEqual([])
    },
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
    const data = await getJson<EvaluationResponse>('/api/evaluation')
    renderAt('/evaluation')
    await screen.findByRole('heading', { name: 'Per request' })
    if (data.learningCurve.points.length === 1) expect(screen.getByText(/One point so far/)).toBeTruthy()
    else expect(screen.queryByText(/One point so far/)).toBeNull()
  })
})
