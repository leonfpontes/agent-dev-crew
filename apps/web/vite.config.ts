import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defaultClientConditions } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Workspace packages resolve to their source (see tsconfig.base.json, "crew-source").
  resolve: { conditions: ['crew-source', ...defaultClientConditions] },
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        // shadcn files start with "use client" (for Next.js); this app doesn't need it.
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
        warn(warning)
      },
    },
  },
  test: { name: '@crew/web', environment: 'jsdom' },
})
