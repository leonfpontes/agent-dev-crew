// Draws the share images from the app's /share page, served by the same server as pnpm demo:
// the GitHub social preview (docs/social-preview.png, set by hand in the repository settings), the
// OG image (apps/web/public/og.png) and the README cover (docs/cover-light.png, docs/cover-dark.png).
// It also writes docs/share.values.json, the numbers the images show; a test compares them with
// the scoreboard and the replay run, so an image can't fall behind its sources.
// Usage: pnpm share-images   (builds first; needs Chromium: pnpm exec playwright install chromium)
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const out = (file) => fileURLToPath(new URL(file, `file://${root}`))

const port = await new Promise((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address()
    s.close(() => resolve(port))
  })
})
const server = spawn(process.execPath, ['packages/api/dist/cli.js', 'serve', '--port', String(port)], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'inherit'],
})
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes('http://127.0.0.1') && resolve())
  server.on('exit', (code) => reject(new Error(`The server stopped (${code}). Run pnpm build first.`)))
})

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 3000 }, deviceScaleFactor: 1 })
  await page.goto(`http://127.0.0.1:${port}/share?theme=light`, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() => window.__shareValues !== undefined)
  for (const [id, file] of [
    ['#art-social', 'docs/social-preview.png'],
    ['#art-og', 'apps/web/public/og.png'],
    ['#art-cover-light', 'docs/cover-light.png'],
    ['#art-cover-dark', 'docs/cover-dark.png'],
  ]) {
    await page.locator(id).screenshot({ path: out(file) })
    console.log(`share-images: wrote ${file}`)
  }
  const values = await page.evaluate(() => window.__shareValues)
  writeFileSync(out('docs/share.values.json'), `${JSON.stringify(values, null, 2)}\n`)
  console.log('share-images: wrote docs/share.values.json')
} finally {
  await browser.close()
  server.kill()
}
