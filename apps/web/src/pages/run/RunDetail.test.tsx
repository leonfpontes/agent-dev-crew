import { act, cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installApi, NOW, renderAt } from '../../test/api'
import { axe } from '../../test/axe'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW.getTime() + 60_000))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const strip = () => screen.getAllByText('Duration')[0]!.closest('dl')!

describe('Run detail · a passed run', () => {
  it('shows the header strip, the gate record and the result', async () => {
    installApi()
    renderAt('/runs/142')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Add an order cancellation endpoint' }),
    ).toBeTruthy()
    expect(strip().textContent).toContain('Passed')
    expect(strip().textContent).toContain('of $0.25 budget')
    expect(within(strip()).getByRole('img', { name: /PO \$0\.004.*of a \$0\.25 budget/ })).toBeTruthy()
    expect(strip().textContent).toMatch(/24 \/ 24.*6 \/ 6 hidden/)
    expect(screen.getByRole('heading', { name: 'Human gate · approved by you' })).toBeTruthy()
    expect(screen.getByText('“Plan matches the request. Refunds stay out of scope.”')).toBeTruthy()
    const result = screen.getByRole('heading', { name: 'Result · passed' }).closest('section')!
    expect(result.textContent).toContain('acceptance tests passed')
    expect(result.textContent).toContain('Used 1 of 2')
  })

  it('draws the pipeline and the Gantt, and opens the newest recorded step in the panel', async () => {
    installApi()
    renderAt('/runs/142')
    await screen.findByRole('heading', { name: 'Pipeline and trace' })
    expect(await screen.findByRole('button', { name: /^Engineer, Passed, 1m 03s, \$0\.030$/ })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Human gate, Approved/ })).toHaveLength(2)
    expect(screen.getByText(/QA failed and sent the work back to the Engineer: 1 fix loop of 2/)).toBeTruthy()
    const panel = await screen.findByRole('region', { name: /Engineer · fix$/ })
    expect(panel.textContent).toContain('Fix loop 1 of 2 · attempt 2')
    expect(await within(panel).findByText('Playbook rules applied · v7')).toBeTruthy()
    expect(
      within(panel)
        .getByRole('link', { name: /§ Engineer/ })
        .getAttribute('href'),
    ).toBe('/playbook#engineer')
    expect(within(panel).getByText('24 passed')).toBeTruthy()
    const current = screen.getAllByRole('button', { current: true })
    expect(current.some((b) => b.getAttribute('aria-label')?.startsWith('Engineer · fix'))).toBe(true)
  })

  it('selects a step from a Gantt row, keeps it in the address, and shows its raw API records', async () => {
    installApi()
    const user = userEvent.setup()
    renderAt('/runs/142')
    await user.click(await screen.findByRole('button', { name: /^Reviewer · review, Passed/ }))
    expect(new URLSearchParams(window.location.search).get('step')).not.toBeNull()
    const reviewer = await screen.findByRole('region', { name: /Reviewer · review$/ })
    expect(
      await within(reviewer).findByText(/The trace keeps no prompt, response or tool calls/),
    ).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /^Engineer · fix, Passed/ }))
    const panel = await screen.findByRole('region', { name: /Engineer · fix$/ })
    await user.click(await within(panel).findByRole('tab', { name: 'Raw' }))
    expect(within(panel).getByText('request.json')).toBeTruthy()
    expect(within(panel).getByText(/"stop_reason": "end_turn"/)).toBeTruthy()
    await user.keyboard('{ArrowUp}')
  })

  it('lists the changed files, opens their diff, and shows the two test suites and the lessons', async () => {
    installApi()
    const user = userEvent.setup()
    renderAt('/runs/142')
    const files = await screen.findByRole('list', { name: 'Changed files' })
    expect(within(files).getAllByRole('link')).toHaveLength(3)
    expect(screen.getByRole('region', { name: 'Diff of src/routes/orders.ts' })).toBeTruthy()
    await user.click(within(files).getByRole('link', { name: /daily-total\.ts/ }))
    expect(
      within(files)
        .getByRole('link', { name: /daily-total\.ts/ })
        .getAttribute('aria-current'),
    ).toBe('true')
    expect(screen.getByText('Hidden acceptance tests')).toBeTruthy()
    expect(screen.getByText('Repository tests · vitest run')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Retro · 2 lessons' })).toBeTruthy()
    expect(screen.getByText('Proposed as playbook v8')).toBeTruthy()
    expect(screen.getByText('Dropped · duplicate of v6')).toBeTruthy()
    expect(await axe(document.body)).toEqual([])
  })

  it('replays the run at 4×: the clock and the counters move, and Stop returns to the full trace', async () => {
    installApi()
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const user = userEvent.setup()
    renderAt('/runs/142')
    await user.click(await screen.findByRole('button', { name: /^Replay$/ }))
    const tick = async (ms: number) => {
      now += ms
      await act(async () => frames.splice(0).forEach((f) => f(now)))
    }
    await tick(10_000) // 40 s of run time at 4×
    expect(screen.getByText(/0:10 of 0:58/)).toBeTruthy()
    expect(screen.getByText(/real time 0m 40s of 3m 52s/)).toBeTruthy()
    expect(strip().textContent).toContain('Replaying')
    expect(strip().textContent).toContain('$0.004')
    expect(screen.getByRole('button', { name: /^Engineer, Queued/ })).toBeTruthy()
    // 1× slows the clock down
    await user.click(screen.getByRole('radio', { name: '1×' }))
    expect(screen.getByRole('radio', { name: '1×' }).getAttribute('aria-checked')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(strip().textContent).toContain('Passed')
    expect(screen.getByRole('button', { name: /^Replay$/ })).toBeTruthy()
  })
})

describe('Run detail · the human gate', () => {
  it('puts the waiting gate on top, with the plan, the budget left and the three decisions', async () => {
    installApi()
    renderAt('/runs/143')
    const gate = await screen.findByRole('region', {
      name: 'Human gate · approve the plan before the Engineer writes code',
    })
    expect(await within(gate).findByText(/Look up the SKU/)).toBeTruthy()
    expect(gate.textContent).toContain('left in the budget')
    expect(within(gate).getByRole('button', { name: /Approve plan/ })).toBeTruthy()
    expect(
      (within(gate).getByRole('button', { name: /Request changes/ }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect((within(gate).getByRole('button', { name: /Reject/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Nothing runs after the gate until you decide.')).toBeTruthy()
    // queued steps stay out of the Gantt while the gate waits, but the pipeline shows them
    expect(screen.queryByRole('button', { name: /^Engineer · code/ })).toBeNull()
    expect(screen.getByRole('button', { name: /^Engineer, Queued/ })).toBeTruthy()
    expect(await axe(document.body)).toEqual([])
  })

  it('in replay, answers a decision with the API explanation: the demo changes nothing', async () => {
    const { calls } = installApi()
    const user = userEvent.setup()
    renderAt('/runs/143')
    await user.click(await screen.findByRole('button', { name: /Approve plan/ }))
    expect(await screen.findByText('Replay mode: the gate stays as recorded')).toBeTruthy()
    expect(screen.getByText('The demo replays recorded runs and changes nothing.')).toBeTruthy()
    expect(calls.find((c) => c.method === 'POST')).toEqual({
      method: 'POST',
      path: '/api/runs/143/gate',
      body: { decision: 'approve' },
    })
  })

  it('takes A / C / R only while the panel has focus, and asks for a comment first', async () => {
    const { calls } = installApi()
    const user = userEvent.setup()
    renderAt('/runs/143')
    await screen.findByRole('button', { name: /Approve plan/ })
    await user.keyboard('a')
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
    document.getElementById('gate-panel')!.focus()
    await user.keyboard('r')
    expect(screen.getByText('Write a comment first: Request changes and Reject need one.')).toBeTruthy()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
    await user.type(screen.getByLabelText(/Comment/), 'Keep stock checks out of scope')
    expect(calls.some((c) => c.method === 'POST')).toBe(false) // typing "r" or "a" in the comment decides nothing
    document.getElementById('gate-panel')!.focus()
    await user.keyboard('c')
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      decision: 'request-changes',
      comment: 'Keep stock checks out of scope',
    })
  })

  it('live: approves through POST /api/runs/:id/gate and reloads the run', async () => {
    const { decided } = installApi({ mode: 'live' })
    const user = userEvent.setup()
    renderAt('/runs/143')
    const gate = await screen.findByRole('region', { name: /Human gate/ })
    expect(await within(gate).findByText('Look up the SKU in the catalog.')).toBeTruthy()
    await user.click(within(gate).getByRole('button', { name: /Approve plan/ }))
    expect(decided).toEqual([{ decision: 'approve' }])
    expect(await screen.findByText('Decision sent: approve.')).toBeTruthy()
  })
})

describe('Run detail · failed, over budget, rejected, single agent, unknown', () => {
  it('names the failed QA after the last fix loop', async () => {
    installApi()
    renderAt('/runs/140')
    expect(await screen.findByText('Run #140 failed at QA · fix loop 2 of 2 used')).toBeTruthy()
  })

  it('says the budget stopped the run, with a full red bar', async () => {
    installApi()
    renderAt('/runs/139')
    expect(
      await screen.findByText('Run #139 stopped: the next call would pass the $0.25 budget'),
    ).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: '100% of the budget used' })).toBeTruthy()
    expect(strip().textContent).toContain('Over budget')
  })

  it('keeps the reason of a rejected plan, and no diff', async () => {
    installApi()
    renderAt('/runs/138')
    expect(await screen.findByRole('heading', { name: 'You rejected the PO plan · run #138' })).toBeTruthy()
    expect(screen.getByText(/No diff: the run ended at the gate/)).toBeTruthy()
  })

  it('shows the single agent as one step, with no gate', async () => {
    installApi()
    renderAt('/runs/136')
    expect(
      await screen.findByText(/One agent plans, writes code and runs the tests in a single step/),
    ).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /Human gate/ })).toBeNull()
  })

  it('answers an unknown run with the API sentence and a retry', async () => {
    installApi()
    renderAt('/runs/999')
    expect(await screen.findByText("Couldn't load run #999")).toBeTruthy()
    expect(screen.getByText('There is no run #999.')).toBeTruthy()
  })
})
