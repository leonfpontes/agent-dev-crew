import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defaultClientConditions } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Workspace packages resolve to their source (see tsconfig.base.json, "crew-source").
  resolve: { conditions: ['crew-source', ...defaultClientConditions] },
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
