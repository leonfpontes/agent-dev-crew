// The four screens in a real browser, on the replay API: no console errors, no sideways scroll at
// 1440 and 375 px, and axe with contrast measured on the rendered page in both themes.
import { createRequire } from 'node:module'

import { expect, test, type Page } from '@playwright/test'

const AXE = createRequire(import.meta.url).resolve('axe-core')

const SCREENS = [
  { path: '/', heading: 'Runs' },
  { path: '/runs/142', heading: 'Add an order cancellation endpoint' },
  { path: '/runs/143', heading: 'Validate the SKU before adding to the cart' },
  { path: '/playbook', heading: 'Playbook' },
  { path: '/evaluation', heading: null },
]

function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}

async function axe(page: Page) {
  await page.addScriptTag({ path: AXE })
  return page.evaluate(async () => {
    const r = await (
      window as unknown as {
        axe: { run: (o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> }
      }
    ).axe.run({
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    })
    return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
  })
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 375, height: 812 },
]) {
  for (const theme of ['light', 'dark']) {
    for (const s of SCREENS) {
      test(`${s.path} at ${viewport.width} px, ${theme}: no console errors, no sideways scroll, axe clean`, async ({
        page,
      }) => {
        const errors = watchErrors(page)
        await page.setViewportSize(viewport)
        await page.goto(`${s.path}?theme=${theme}`)
        const h1 = page.getByRole('heading', { level: 1 })
        if (s.heading) await expect(h1).toHaveText(s.heading)
        else await expect(h1).toBeVisible()
        await page.waitForLoadState('networkidle')
        const scroll = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
        expect(scroll).toBeLessThanOrEqual(0)
        expect(await axe(page)).toEqual([])
        expect(errors).toEqual([])
      })
    }
  }
}

test('a run opens from the list, and its step panel follows the Gantt', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Add an order cancellation endpoint' }).click()
  await expect(page).toHaveURL(/\/runs\/142$/)
  await page.getByRole('button', { name: /^Reviewer · review,/ }).click()
  await expect(page.getByRole('region', { name: /Reviewer · review$/ })).toBeVisible()
  await expect(page).toHaveURL(/step=\d+/)
})

test('the replay plays the run and Stop returns to the full trace', async ({ page }) => {
  await page.goto('/runs/142')
  await page.getByRole('button', { name: 'Replay', exact: true }).click()
  await expect(page.getByText(/real time \dm \d\ds of 3m 52s/)).toBeVisible()
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByRole('button', { name: 'Replay', exact: true })).toBeVisible()
})

test('in replay, the gate answers with how to run live (the API refuses the write with 405)', async ({
  page,
}) => {
  await page.goto('/runs/143')
  await page.getByRole('button', { name: /Approve plan/ }).click()
  await expect(page.getByText('Replay mode: the gate stays as recorded')).toBeVisible()
})

test('on a phone, the run has section tabs and the step opens in a sheet', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/runs/142')
  await page.getByRole('button', { name: 'Trace' }).click()
  await page.getByRole('button', { name: /^QA · test, Failed/ }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await expect(sheet.locator('#sheet-step-h')).toHaveText(/QA · test/)
  await sheet.getByRole('button', { name: 'Close step' }).click()
  await expect(sheet).toBeHidden()
})
