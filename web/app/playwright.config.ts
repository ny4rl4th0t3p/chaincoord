import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/tests',
  globalSetup: './e2e/setup/global-setup.ts',
  globalTeardown: './e2e/setup/global-teardown.ts',
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:3000',
    // Slow down actions slightly so SSE state changes propagate before assertions.
    actionTimeout: 10_000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: {
    command: 'next dev -p 3000',
    url: 'http://localhost:3000',
    // Reuse an already-running dev server outside CI to speed up iteration.
    reuseExistingServer: !process.env.CI,
    env: {
      // Point Next.js rewrites at the test coordd instance (started in globalSetup).
      COORD_BACKEND_URL: 'http://localhost:8181',
      // Expose the backend URL to client-side code so React components make
      // direct cross-origin requests rather than going through Next.js rewrites.
      // This avoids the rewrite matching the /launch/[id] dynamic page route for
      // API sub-path calls (e.g. /launch/{id}/audit).
      NEXT_PUBLIC_API_URL: 'http://localhost:8181',
    },
  },
});
