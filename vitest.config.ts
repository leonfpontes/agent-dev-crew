import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [{ test: { name: 'repo', environment: 'node', include: ['tests/**/*.test.ts'] } }],
    coverage: { provider: 'v8', include: ['**/src/**'], exclude: ['**/*.test.*', '**/src/test/**'] },
  },
})
