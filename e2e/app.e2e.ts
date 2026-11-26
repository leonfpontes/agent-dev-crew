import { expect, test } from '@playwright/test'

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 375, height: 812 },
]) {
  test(`the app opens with the Atlas theme at ${viewport.width} px, with no console errors`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(e.message))
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1, name: 'Agent Dev Crew' })).toBeVisible()
    await expect(page.getByText('Replay mode')).toBeVisible()
    // The Atlas tokens are loaded: the page background is the theme's --background, not the default.
    const background = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
    )
    expect(background).not.toBe('')
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    expect(scroll).toBeLessThanOrEqual(0)
    expect(errors).toEqual([])
  })
}
