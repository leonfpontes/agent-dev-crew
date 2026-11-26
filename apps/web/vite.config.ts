import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defaultClientConditions, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * Social cards need absolute URLs. SITE_URL is the public origin; on Vercel it falls back to the
 * production domain Vercel exposes. A production deploy without either fails: a relative og:image
 * makes every shared link show no picture.
 */
export function siteOrigin(env: Record<string, string | undefined> = process.env): string {
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL
  const origin = (env.SITE_URL || (vercel ? `https://${vercel}` : '')).replace(/\/$/, '')
  if (!origin && env.VERCEL_ENV === 'production')
    throw new Error(
      'Set SITE_URL (for example https://crew.example.dev): the social cards need an absolute URL.',
    )
  return origin
}

const siteUrl = (): Plugin => ({
  name: 'crew-site-url',
  transformIndexHtml: (html) => html.replaceAll('__SITE_URL__', siteOrigin()),
})

export default defineConfig({
  plugins: [react(), tailwindcss(), siteUrl()],
  // Workspace packages resolve to their source (see tsconfig.base.json, "crew-source").
  resolve: {
    conditions: ['crew-source', ...defaultClientConditions],
    // Tests read files of the repository (the scoreboard, the share images) as @repo/<path>.
    alias: { '@repo': fileURLToPath(new URL('../..', import.meta.url)) },
  },
  // pnpm dev: the API runs on its own (pnpm crew serve, or CREW_API for another port).
  server: { proxy: { '/api': process.env.CREW_API ?? 'http://127.0.0.1:8787' } },
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        // shadcn files start with "use client" (for Next.js); this app doesn't need it.
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
        warn(warning)
      },
    },
  },
  // Screen tests render whole pages on the in-process API (and some run axe): a loaded machine
  // can take seconds, so they wait longer than the 5 s default.
  test: { name: '@crew/web', environment: 'jsdom', setupFiles: ['src/test/setup.ts'], testTimeout: 20_000 },
})
