import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { createApi, MAX_BODY_BYTES, openReplay, serveHttp } from './index.js'

const dist = mkdtempSync(path.join(tmpdir(), 'crew-web-'))
mkdirSync(path.join(dist, 'assets'))
writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Agent Dev Crew</title>')
writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1)')
const server = serveHttp(createApi({ trace: openReplay(), mode: 'replay' }), { port: 0, staticDir: dist })
await new Promise((resolve) => server.once('listening', resolve))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  rmSync(dist, { recursive: true, force: true })
})

describe('local server', () => {
  it('serves the API and the built app on one port, with the app for unknown routes', async () => {
    expect(((await (await fetch(`${base}/api/meta`)).json()) as { mode: string }).mode).toBe('replay')
    const asset = await fetch(`${base}/assets/app.js`)
    expect(asset.headers.get('content-type')).toContain('javascript')
    expect(await (await fetch(`${base}/runs/142`)).text()).toContain('Agent Dev Crew')
  })

  it('never serves a file outside the app folder', async () => {
    const res = await fetch(`${base}/%2e%2e/%2e%2e/etc/passwd`)
    expect(await res.text()).toContain('Agent Dev Crew')
  })

  it('refuses a body over the limit', async () => {
    const res = await fetch(`${base}/api/runs`, { method: 'POST', body: 'x'.repeat(MAX_BODY_BYTES + 1) })
    expect(res.status).toBe(413)
  })
})
