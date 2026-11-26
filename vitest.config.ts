import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// One run for the whole monorepo. Workspace packages resolve to their source, so tests run on a
// clean clone before any build (TypeScript does the same with the "crew-source" export condition).
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@crew\/core$/, replacement: src('./packages/core/src/index.ts') },
      { find: /^@crew\/sandbox$/, replacement: src('./packages/sandbox/src/index.ts') },
      { find: /^@crew\/evals$/, replacement: src('./evals/src/index.ts') },
      { find: /^@crew\/trace$/, replacement: src('./packages/trace/src/index.ts') },
    ],
  },
  test: {
    projects: [
      { extends: true, test: { name: 'repo', environment: 'node', include: ['tests/**/*.test.ts'] } },
      { extends: true, test: { name: '@crew/core', root: 'packages/core', environment: 'node' } },
      { extends: true, test: { name: '@crew/sandbox', root: 'packages/sandbox', environment: 'node' } },
      { extends: true, test: { name: '@crew/trace', root: 'packages/trace', environment: 'node' } },
      {
        extends: true,
        test: { name: 'fernhill-orders', root: 'examples/fernhill-orders', environment: 'node' },
      },
      {
        extends: true,
        // requests/ holds the hidden tests: they run only against a copy of the example (validate.ts)
        test: {
          name: '@crew/evals',
          root: 'evals',
          environment: 'node',
          exclude: ['requests/**', '**/node_modules/**'],
        },
      },
      'apps/web',
    ],
    coverage: {
      provider: 'v8',
      include: ['**/src/**'],
      exclude: ['**/*.test.*', '**/src/test/**', 'apps/web/src/main.tsx', '.crew/**'],
      // Floors that only go up: engine and rules 80%, screens 60%.
      thresholds: {
        'packages/**/src/**': { lines: 80, functions: 80, branches: 75 },
        'evals/src/**': { lines: 80 },
        'apps/web/src/**': { lines: 60 },
      },
    },
  },
})
