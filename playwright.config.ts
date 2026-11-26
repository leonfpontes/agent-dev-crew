import { defineConfig, devices } from '@playwright/test'

// End-to-end tests run against the built app on E2E_PORT (default 4173). The server is always
// started here, on that port only (--strictPort, never reused), so a busy port fails fast instead
// of testing a server someone else left running.
const port = Number(process.env.E2E_PORT ?? 4173)

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
