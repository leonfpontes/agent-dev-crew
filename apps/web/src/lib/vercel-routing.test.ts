// vercel.json against the app's router: every route of the app opens index.html, anything else gets
// a real 404 (Vercel serves 404.html with that status; it is the app, which shows its 404 page).
import vercel from '@repo/vercel.json'
import { describe, expect, it } from 'vitest'

import { matchRoute } from './router'

describe('vercel.json routing', () => {
  const config = vercel as {
    buildCommand: string
    outputDirectory: string
    rewrites: { source: string; destination: string }[]
  }
  /** The path-to-regexp forms vercel.json uses: a group, `:name(regex)` and `:name*`. */
  const regexOf = (source: string) =>
    new RegExp(`^${source.replace(/\/:\w+\*/g, '(?:/(.*))?').replace(/:\w+\(([^)]+)\)/g, '($1)')}$`)
  const destination = (path: string) => config.rewrites.find((r) => regexOf(r.source).test(path))?.destination

  const appPaths = ['/runs', '/runs/142', '/playbook', '/evaluation', '/share', '/demo']
  const unknown = ['/nope', '/runs/abc', '/runs/142/x', '/evaluations', '/index', '/apix']

  it('opens index.html for every route of the app, and only for those', () => {
    for (const path of appPaths) {
      expect(matchRoute(path).name, path).not.toBe('not-found')
      expect(destination(path), path).toBe('/index.html')
    }
    for (const path of unknown) {
      expect(matchRoute(path).name, path).toBe('not-found')
      expect(destination(path), path).toBeUndefined()
    }
    expect(destination('/api/runs/142')).toBe('/api/handler?path=:path*')
  })

  it('ships a 404.html, which Vercel serves with status 404, so unknown routes get the app 404 page', () => {
    expect(config.buildCommand).toContain(
      `cp ${config.outputDirectory}/index.html ${config.outputDirectory}/404.html`,
    )
  })
})
