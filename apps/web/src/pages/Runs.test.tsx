import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installApi, NOW, renderAt } from '../test/api'
import { axe } from '../test/axe'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW.getTime() + 60_000))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)

describe('Runs', () => {
  it('lists the runs with the one waiting for you first, and the numbers above', async () => {
    installApi()
    renderAt('/runs')
    await screen.findByRole('table')
    const first = rows()[0]!
    expect(first.textContent).toContain('Waiting for you')
    expect(first.textContent).toContain('#143')
    const strip = screen.getByText('Total cost').closest('dl')!
    expect(strip.textContent).toMatch(/Runs8/)
    expect(strip.textContent).toContain('of 7 finished')
    expect(
      screen.getByText('Showing 8 of 8 example runs · replay mode replays them without calling a model'),
    ).toBeTruthy()
    // status = shape + word: the over-budget run says so, the rejected run uses the gate's diamond with a cross
    const over = rows().find((r) => r.textContent?.includes('Rate-limit POST /orders'))!
    expect(within(over).getByText('Over budget')).toBeTruthy()
    const rejected = rows().find((r) => r.textContent?.includes('Export orders as CSV'))!
    expect(rejected.querySelector('[data-status="rejected"]')).not.toBeNull()
    expect(await axe(document.body)).toEqual([])
  })

  it('with the real scoreboard, says the runs are examples and points to the measured numbers', async () => {
    installApi({ scoreboard: 'real' })
    renderAt('/runs')
    const footer = (await screen.findByText(/^Showing 8 of 8 example runs/)).closest('p')!
    expect(footer.textContent).toBe(
      'Showing 8 of 8 example runs · replay mode replays them without calling a model · the measured numbers are in Evaluation',
    )
    expect(within(footer).getByRole('link', { name: 'Evaluation' }).getAttribute('href')).toBe('/evaluation')
  })

  it('filters by status, variant and search, and says when nothing matches', async () => {
    installApi()
    const user = userEvent.setup()
    renderAt('/runs')
    await screen.findByRole('table')
    await user.click(screen.getByRole('tab', { name: /Failed/ }))
    expect(rows().map((r) => r.textContent)).toEqual([
      expect.stringContaining('#140'),
      expect.stringContaining('#139'),
    ])
    await user.click(screen.getByRole('tab', { name: /All/ }))
    await user.type(screen.getByPlaceholderText('Search requests'), 'orders')
    expect(rows().every((r) => /orders/i.test(r.textContent ?? ''))).toBe(true)
    await user.type(screen.getByPlaceholderText('Search requests'), 'zzz')
    expect(screen.getByText('No runs match these filters.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(rows()).toHaveLength(8)
  })

  it('opens a run with the whole row, the arrow keys and Enter; / goes to the search', async () => {
    installApi()
    const user = userEvent.setup()
    renderAt('/runs')
    await screen.findByRole('table')
    rows()[0]!.focus()
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(rows()[1])
    await user.keyboard('{Enter}')
    expect(window.location.pathname).toBe('/runs/142')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Add an order cancellation endpoint' }),
    ).toBeTruthy()
    await user.click(screen.getByRole('link', { name: 'Runs' }))
    await screen.findByRole('table')
    await user.keyboard('/')
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Search requests'))
  })

  it('keeps New run for live mode, and says how', async () => {
    installApi()
    renderAt('/runs')
    const button = await screen.findByRole('button', { name: 'New run' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/Live runs happen on your machine/)).toBeTruthy()
  })

  it('starts a live run from the dialog and opens it', async () => {
    // Live with a key, but no runner in the test: the start answer is the API's 202 contract.
    installApi({ mode: 'live' })
    const api = globalThis.fetch
    const posted: unknown[] = []
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      if (init?.method !== 'POST' || String(input) !== '/api/runs') return api(input, init)
      posted.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ runId: 144 }), { status: 202 })
    })
    const user = userEvent.setup()
    renderAt('/runs')
    await user.click(await screen.findByRole('button', { name: 'New run' }))
    const start = screen.getByRole('button', { name: 'Start run' })
    expect((start as HTMLButtonElement).disabled).toBe(true)
    await user.type(screen.getByLabelText('Feature request'), 'Add a refund endpoint for paid orders')
    await user.click(start)
    expect(window.location.pathname).toBe('/runs/144')
    expect(posted).toEqual([{ request: 'Add a refund endpoint for paid orders', variant: 'crew-playbook' }])
  })

  it('shows skeleton rows while loading, and the empty state with the command when there is no run', async () => {
    let release = () => {}
    const empty = {
      runs: [],
      summary: { runs: 0, finished: 0, passed: 0, costMicros: 0, medianDurationMs: null, fixLoops: 0 },
      waiting: [],
    }
    installApi({
      override: (path) =>
        path.startsWith('/api/runs?limit')
          ? new Promise<Response>((r) => (release = () => r(new Response(JSON.stringify(empty))))).then(
              (x) => x,
            )
          : undefined,
    })
    renderAt('/runs')
    expect(await screen.findByLabelText('Loading runs')).toBeTruthy()
    release()
    expect(await screen.findByRole('heading', { name: 'No runs on this machine yet' })).toBeTruthy()
    expect(screen.getByText('$ pnpm demo')).toBeTruthy()
  })
})
