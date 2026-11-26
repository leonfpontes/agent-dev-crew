import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installApi, NOW, renderAt } from './test/api'
import { axe } from './test/axe'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW.getTime() + 60_000))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('the shell', () => {
  it('shows the brand, the repository, the replay mode, the three tabs with counts and the example band', async () => {
    installApi()
    renderAt('/runs')
    expect(await screen.findByRole('heading', { level: 1, name: 'Runs' })).toBeTruthy()
    const product = screen.getAllByRole('navigation', { name: 'Product' })[0]!
    expect(within(product).getByRole('link', { name: /Runs/ }).getAttribute('aria-current')).toBe('page')
    expect(await within(product).findByLabelText('1 waiting for you')).toBeTruthy()
    expect(await within(product).findByLabelText('1 proposal')).toBeTruthy()
    expect(screen.getByRole('note').textContent).toContain('All numbers are examples until pnpm eval runs.')
    expect(screen.getAllByText('fernhill-orders').length).toBeGreaterThan(0)
  })

  it('explains replay mode in a popover that Escape closes', async () => {
    installApi()
    const user = userEvent.setup()
    renderAt('/runs')
    const button = await screen.findByRole('button', { name: 'Replay mode: what it means' })
    await user.click(button)
    const pop = screen.getByRole('dialog', { name: 'Replay mode' })
    expect(pop.textContent).toContain('No model calls, no API key, no cost')
    expect(pop.textContent).toContain('pnpm crew serve --live')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Replay mode' })).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('switches the theme and keeps the choice', async () => {
    installApi()
    const user = userEvent.setup()
    renderAt('/runs')
    await user.click(await screen.findByRole('button', { name: 'Switch to dark theme' }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(window.localStorage.getItem('crew-theme')).toBe('dark')
    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('opens the theme from the address (?theme=dark) for captures and links', async () => {
    installApi()
    renderAt('/runs?theme=dark')
    await screen.findByRole('heading', { level: 1, name: 'Runs' })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('answers an unknown address with a 404 page and the way back', async () => {
    installApi()
    renderAt('/nowhere')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This page is not in the trace' }),
    ).toBeTruthy()
    expect(screen.getByText('/nowhere')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open the runs' }).getAttribute('href')).toBe('/runs')
    expect(screen.getByRole('link', { name: 'How it works' }).getAttribute('href')).toBe('/')
    expect(await axe(document.body)).toEqual([])
  })

  it('says what failed and offers a retry when the API is down', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    renderAt('/runs')
    expect(await screen.findByText("Couldn't load the app")).toBeTruthy()
    expect(
      screen.getByText('The API is not reachable. Start it with pnpm demo, then try again.'),
    ).toBeTruthy()
    installApi()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Runs' })).toBeTruthy()
  })
})
