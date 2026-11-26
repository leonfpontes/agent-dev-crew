// Records the README GIF and the 1-minute video from the app's /demo page, frame by frame, so every
// run gives the same frames. Captions are part of the frame (English only, no narration) and also
// ship as WebVTT. docs/media/crew-demo.numbers.json keeps the captions it drew, numbers included; a
// test compares them with the scoreboard and the replay run.
// Usage: pnpm record-demo   (builds first; needs ffmpeg on the PATH and Chromium)
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const media = path.join(root, 'docs/media')
mkdirSync(media, { recursive: true })

const VIDEO_MS = 60_000
const GIF_MS = 20_000
const VIDEO_FPS = 15
const GIF_FPS = 10

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

const encode = (args) =>
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  const open = async (mode) => {
    await page.goto(`http://127.0.0.1:${port}/demo?theme=light${mode === 'gif' ? '&mode=gif' : ''}`, {
      waitUntil: 'networkidle',
    })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForFunction(() => window.__demoReady === true)
  }
  const shoot = async (t, file) => {
    await page.evaluate((ms) => window.__setTime(ms), t)
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    await page.locator('#stage').screenshot({ path: file })
  }

  // Video: 60 s at 15 fps, H.264.
  await open('video')
  const captions = await page.evaluate(() => window.__demoCaptions)
  const vdir = mkdtempSync(path.join(tmpdir(), 'crew-video-'))
  const vframes = (VIDEO_MS / 1000) * VIDEO_FPS
  for (let i = 0; i < vframes; i++)
    await shoot((i * 1000) / VIDEO_FPS, path.join(vdir, `f${String(i).padStart(5, '0')}.png`))
  encode([
    '-framerate',
    String(VIDEO_FPS),
    '-i',
    path.join(vdir, 'f%05d.png'),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '22',
    '-movflags',
    '+faststart',
    path.join(media, 'crew-demo.mp4'),
  ])
  rmSync(vdir, { recursive: true })

  // GIF: 20 s at 10 fps, 960 px wide.
  await open('gif')
  const gdir = mkdtempSync(path.join(tmpdir(), 'crew-gif-'))
  const gframes = (GIF_MS / 1000) * GIF_FPS
  for (let i = 0; i < gframes; i++)
    await shoot((i * 1000) / GIF_FPS, path.join(gdir, `f${String(i).padStart(5, '0')}.png`))
  const palette = path.join(gdir, 'palette.png')
  const frames = path.join(gdir, 'f%05d.png')
  encode([
    '-framerate',
    String(GIF_FPS),
    '-i',
    frames,
    '-vf',
    'scale=960:-1:flags=lanczos,palettegen=max_colors=128:stats_mode=diff',
    palette,
  ])
  encode([
    '-framerate',
    String(GIF_FPS),
    '-i',
    frames,
    '-i',
    palette,
    '-lavfi',
    'scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle',
    '-loop',
    '0',
    path.join(media, 'crew-demo.gif'),
  ])
  rmSync(gdir, { recursive: true })

  const ts = (ms) => new Date(ms).toISOString().slice(11, 23)
  writeFileSync(
    path.join(media, 'crew-demo.en.vtt'),
    `WEBVTT\n\n${captions.video.map((c, i) => `${i + 1}\n${ts(c.from)} --> ${ts(c.to)}\n${c.text}\n`).join('\n')}`,
  )
  writeFileSync(path.join(media, 'crew-demo.numbers.json'), `${JSON.stringify(captions, null, 2)}\n`)
  console.log('record-demo: wrote docs/media/crew-demo.mp4, .gif, .en.vtt and .numbers.json')
} finally {
  await browser.close()
  server.kill()
}
