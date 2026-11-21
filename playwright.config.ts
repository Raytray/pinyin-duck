import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 5173);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

// Always run headless so a local run and CI exercise the same compositor. The suite
// used to switch to a headed browser whenever a display was present, which made the
// result depend on the machine it started on rather than on the code under test.
// Pass `--headed` (or `npm run test:e2e:headed`) to watch the browser while debugging.
export default defineConfig({
  testDir: './e2e',
  // Locally a dev server already on the port is reused; this stops the run if that
  // server belongs to another checkout, rather than testing its code.
  globalSetup: './e2e/checkout-guard.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ...(process.env.CI
      ? ([['github'], ['html', { open: 'never' }]] as const)
      : ([['list'], ['html', { open: 'never' }]] as const)),
    // The web package has no unit tests, so this is where its coverage comes from.
    ['./e2e/web-coverage-reporter.ts', {}],
  ],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL,
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npm run dev --workspace @pinyinduck/web -- --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
