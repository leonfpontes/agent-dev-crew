// QA (story Q1): what the four-screen sweep in app.e2e.ts doesn't reach. The keyboard on every screen,
// the Evaluation tabs against evals/results/*.json, the How it works page and its links, and the 404.
import { readFileSync } from 'node:fs'

import { expect, type Page, test } from '@playwright/test'

type Stat = { mean: number; sd: number }
interface Scoreboard {
  set: 'easy' | 'hard'
  requests: number
  rounds: number
  spentUsd: { total: number }
  budgetUsd: { total: number }
  notes?: string[]
  main: { variant: string; playbookVersion: number | null; passRate: Stat; costMicrosPerRequest: Stat }[]
  curve: { playbookVersion: number; rounds: number; passRate: Stat }[]
}
const read = (f: string) =>
  JSON.parse(readFileSync(new URL(`../evals/results/${f}`, import.meta.url), 'utf8')) as Scoreboard
const BOARDS = { hard: read('hard.json'), easy: read('latest.json') }

/** "88% ± 0", "83% ± 7": how the app writes a pass rate. */
const pass = (s: Stat) => `${Math.round(s.mean * 100)}% ± ${Math.round(s.sd * 100)}`
const variant = (b: Scoreboard, v: string) => b.main.find((m) => m.variant === v)!

/** Tabs through the page and lists every stop where focus is not visible. */
async function stopsWithoutRing(page: Page, max = 80) {
  const missing: string[] = []
  const seen = new Set<string>()
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el === document.body) return null
      const s = getComputedStyle(el)
      const ring = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0
      const shadow = s.boxShadow !== 'none'
      // An SVG mark shows focus with its stroke: compare it focused and blurred.
      let stroke = false
      if (el instanceof SVGElement) {
        const on = `${s.stroke} ${s.strokeWidth}`
        el.blur()
        const off = `${getComputedStyle(el).stroke} ${getComputedStyle(el).strokeWidth}`
        el.focus()
        stroke = on !== off
      }
      const path = []
      for (let n: Element | null = el; n && n !== document.body; n = n.parentElement)
        path.unshift(
          `${n.tagName}${n.id ? `#${n.id}` : ''}:${[...(n.parentElement?.children ?? [])].indexOf(n)}`,
        )
      return {
        key: path.join('>'),
        name: `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}"`,
        ok: ring || shadow || stroke,
      }
    })
    if (!info || seen.has(info.key)) break
    seen.add(info.key)
    if (!info.ok) missing.push(info.name)
  }
  return missing
}

test.describe('keyboard', () => {
  for (const theme of ['light', 'dark'] as const)
    for (const path of ['/', '/runs', '/runs/142', '/runs/143', '/playbook', '/evaluation', '/no-such-page'])
      test(`${path}, ${theme}: every Tab stop shows where the focus is`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.goto(`${path}?theme=${theme}`, { waitUntil: 'networkidle' })
        expect(await stopsWithoutRing(page)).toEqual([])
      })

  test('the first Tab is "Skip to content", and Enter moves to the main content', async ({ page }) => {
    for (const path of ['/', '/runs']) {
      await page.goto(path, { waitUntil: 'networkidle' })
      await page.keyboard.press('Tab')
      const skip = page.getByRole('link', { name: 'Skip to content' })
      await expect(skip).toBeFocused()
      await expect(skip).toBeVisible()
      await page.keyboard.press('Enter')
      await expect(page.locator('#main')).toBeFocused()
    }
  })

  test('Runs: ↓ and ↑ move along the rows, Enter opens the run', async ({ page }) => {
    await page.goto('/runs', { waitUntil: 'networkidle' })
    const rows = page.locator('tr[data-run]')
    expect(await rows.count()).toBeGreaterThan(2)
    await rows.first().focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowUp')
    await expect(rows.nth(1)).toBeFocused()
    // One stop in the Tab order: the active row.
    expect(await rows.evaluateAll((rs) => rs.filter((r) => r.getAttribute('tabindex') === '0').length)).toBe(
      1,
    )
    const id = await rows.nth(1).getAttribute('data-run')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/runs/${id}$`))
  })

  test('Run detail: ↓/j and ↑/k walk the Gantt, Enter opens the step', async ({ page }) => {
    await page.goto('/runs/142', { waitUntil: 'networkidle' })
    const steps = page.locator('button[data-step]')
    await steps.first().focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('j')
    await expect(steps.nth(2)).toBeFocused()
    await page.keyboard.press('k')
    await expect(steps.nth(1)).toBeFocused()
    const name = (await steps.nth(1).getAttribute('aria-label')) ?? (await steps.nth(1).innerText())
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/step=\d+/)
    expect(name.length).toBeGreaterThan(3)
  })

  test('Evaluation: the arrows switch Hard and Easy, focus stays on the tab, the address keeps the set', async ({
    page,
  }) => {
    await page.goto('/evaluation', { waitUntil: 'networkidle' })
    const hard = page.getByRole('tab', { name: /^Hard set/ })
    const easy = page.getByRole('tab', { name: /^Easy set/ })
    await expect(hard).toHaveAttribute('aria-selected', 'true')
    await hard.focus()
    await page.keyboard.press('ArrowRight')
    await expect(easy).toBeFocused()
    await expect(easy).toHaveAttribute('aria-selected', 'true')
    await expect(page).toHaveURL(/set=easy/)
    await page.keyboard.press('ArrowLeft')
    await expect(hard).toBeFocused()
    await expect(page).toHaveURL(/set=hard|\/evaluation$/)
  })

  test('Evaluation: each chart point takes focus and is announced with its number', async ({ page }) => {
    await page.goto('/evaluation?set=hard', { waitUntil: 'networkidle' })
    const points = page.locator('main [tabindex="0"][role="img"]')
    expect(await points.count()).toBeGreaterThanOrEqual(BOARDS.hard.curve.length + BOARDS.hard.main.length)
    for (const p of await points.all()) {
      await p.focus()
      await expect(p).toBeFocused()
      expect(await p.getAttribute('aria-label')).toMatch(/\d+%/)
    }
  })
})

test.describe('Evaluation follows evals/results', () => {
  for (const set of ['hard', 'easy'] as const)
    test(`the ${set} tab shows the ${set} scoreboard, its notes and how to reproduce it`, async ({
      page,
    }) => {
      const b = BOARDS[set]
      await page.goto(`/evaluation?set=${set}`, { waitUntil: 'networkidle' })
      const panel = page.getByRole('tabpanel')
      await expect(panel).toContainText(`${b.requests} requests × 3 variants × ${b.rounds} rounds`)
      await expect(panel).toContainText(
        `$${b.spentUsd.total.toFixed(2)} of $${b.budgetUsd.total.toFixed(2)} limit`,
      )
      const table = panel.getByRole('table', { name: 'Cost and quality per variant' })
      for (const [v, label] of [
        ['single-agent', 'Single agent'],
        ['crew', 'Crew'],
        ['crew-playbook', 'Crew + playbook'],
      ] as const)
        await expect(
          table.getByRole('row', { name: new RegExp(`^${label.replace('+', '\\+')} \\$`) }),
        ).toContainText(pass(variant(b, v).passRate))
      for (const point of b.curve)
        await expect(
          panel.getByRole('img', {
            name: new RegExp(`^v${point.playbookVersion}, .*${point.rounds} rounds?$`),
          }),
        ).toHaveCount(1)
      for (const note of b.notes ?? []) await expect(panel).toContainText(note)
      // How we measure it names this set's command and file.
      const how = panel.getByText(/pnpm eval/).first()
      await expect(how).toBeVisible()
      const text = await panel.innerText()
      if (set === 'hard') {
        expect(text).toContain('pnpm eval --set hard')
        expect(text).toContain('hard.json')
        expect(text).not.toMatch(/\blatest\.json\b/)
      } else {
        expect(text).toContain('latest.json')
        expect(text).not.toContain('--set hard')
      }
    })
})

test.describe('How it works', () => {
  test('says "Replay demo · no API key", gives the 3 quickstart commands and the measured hard-set sentence', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    const main = page.getByRole('main')
    await expect(main.getByText('Replay demo · no API key')).toBeVisible()
    for (const cmd of [
      'git clone https://github.com/leonfpontes/agent-dev-crew',
      'cd agent-dev-crew && pnpm install',
      'pnpm demo',
    ])
      await expect(main).toContainText(cmd)
    const h = BOARDS.hard
    const one = Math.round(variant(h, 'single-agent').passRate.mean * 100)
    const crew = Math.round(variant(h, 'crew').passRate.mean * 100)
    await expect(main).toContainText(`${one}% of the hard requests vs ${crew}% for the crew`)
  })

  test('the footer credits Leonardo Pontes with LinkedIn and GitHub, and says nothing about job hunting', async ({
    page,
  }) => {
    await page.goto('/')
    const footer = page.getByRole('contentinfo')
    await expect(footer).toContainText('Built by Leonardo Pontes')
    await expect(footer.getByRole('link', { name: /LinkedIn/ })).toHaveAttribute(
      'href',
      /^https:\/\/(www\.)?linkedin\.com\//,
    )
    await expect(footer.getByRole('link', { name: /^GitHub/ }).first()).toHaveAttribute(
      'href',
      /^https:\/\/github\.com\//,
    )
    await expect(page.locator('body')).not.toContainText(
      /open to work|hiring|aberto a vagas|looking for (a )?(job|role)/i,
    )
  })

  test('the copy button puts the 3 commands on the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Copy commands' }).click()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toContain('git clone https://github.com/leonfpontes/agent-dev-crew')
    expect(copied).toContain('pnpm demo')
    expect(copied).not.toContain('$ ')
  })
})

test.describe('links', () => {
  test('no link anywhere points to "#" or nowhere, and every in-page anchor has its target', async ({
    page,
  }) => {
    const bad: string[] = []
    for (const path of [
      '/',
      '/runs',
      '/runs/142',
      '/runs/143',
      '/playbook',
      '/evaluation',
      '/evaluation?set=easy',
      '/no-such-page',
    ]) {
      await page.goto(path, { waitUntil: 'networkidle' })
      const found = await page.evaluate(() =>
        [...document.querySelectorAll('a')].flatMap((a) => {
          const href = a.getAttribute('href')
          const name = (a.getAttribute('aria-label') ?? a.textContent ?? '').trim().slice(0, 40)
          if (href === null || href === '' || href === '#') return [`${name}: href="${href}"`]
          if (href.startsWith('#') && !document.getElementById(decodeURIComponent(href.slice(1))))
            return [`${name}: ${href} has no target`]
          return []
        }),
      )
      bad.push(...found.map((f) => `${path} · ${f}`))
    }
    expect(bad).toEqual([])
  })

  test('every link inside the app opens a page that exists (no 404 heading)', async ({ page }) => {
    // About 30 pages: load each one and wait for its heading, not for network idle (the replay polls).
    test.setTimeout(90_000)
    const hrefs = new Set<string>()
    for (const path of ['/', '/runs', '/runs/142', '/playbook', '/evaluation', '/no-such-page']) {
      await page.goto(path, { waitUntil: 'networkidle' })
      for (const h of await page
        .locator('a[href^="/"]')
        .evaluateAll((as) => as.map((a) => a.getAttribute('href')!)))
        hrefs.add(h)
    }
    const missing: string[] = []
    for (const href of hrefs) {
      if (/\.(png|svg|gif|mp4|json)$/.test(href)) {
        const r = await page.request.get(href)
        if (!r.ok()) missing.push(`${href}: ${r.status()}`)
        continue
      }
      await page.goto(href, { waitUntil: 'load' })
      await expect(page.locator('h1, [role="alert"]').first()).toBeVisible()
      if (await page.getByRole('heading', { name: 'This page is not in the trace' }).count())
        missing.push(href)
    }
    expect(missing).toEqual([])
  })
})

test('404: says the page is missing, shows the path and offers two ways back that work', async ({ page }) => {
  await page.goto('/runs/9999/nope', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { level: 1, name: 'This page is not in the trace' })).toBeVisible()
  await expect(page.getByText('GET /runs/9999/nope → 404 Not Found')).toBeVisible()
  await expect(page).toHaveTitle(/not|404/i)
  await page.getByRole('link', { name: 'Open the runs' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible()
  await page.goBack()
  await page.getByRole('main').getByRole('link', { name: 'How it works' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/A crew of AI agents/)
})

test('a run that does not exist says so, instead of a blank page or a crash', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/runs/9999', { waitUntil: 'networkidle' })
  await expect(page.getByRole('alert')).toContainText('There is no run #9999.')
  await expect(
    page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Runs' }),
  ).toBeVisible()
  expect(errors).toEqual([])
})
