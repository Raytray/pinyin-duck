import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 5173);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

// Chromium's headless mode never schedules animation frames in this environment:
// `requestAnimationFrame` never fires (verified with --disable-gpu, swiftshader,
// --enable-begin-frame-control and channel:'chromium' alike), even while the app's
// infinite CSS animations are running. Playwright implements the "stable" step of
// its actionability checks on top of rAF, so every click()/hover() would block
// until the 30s test timeout -- 9 tests hung that way while every keyboard-driven
// test passed. A headed browser has a real compositor and produces frames normally.
//
// Headed therefore needs a display; fall back to headless only when there is none.
const hasDisplay = Boolean(process.env.DISPLAY) && process.platform !== 'win32';
const headless = process.env.E2E_HEADLESS ? process.env.E2E_HEADLESS !== '0' : !hasDisplay;

export default defineConfig({
  testDir: './e2e',
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
    headless,
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
