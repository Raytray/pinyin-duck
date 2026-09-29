import fs from 'fs';
import path from 'path';
import { test as base, expect } from '@playwright/test';
import { WEB_COVERAGE_TMP, webSourceKey } from './web-coverage-reporter.js';

/**
 * Wraps every spec so Chromium's V8 coverage is collected for the duration of the
 * test and handed to the coverage reporter afterwards.
 *
 * Vite serves modules as transpiled text over HTTP rather than as files on disk, so
 * each module's source is fetched while the dev server is still running; the reporter
 * needs it to map V8 byte offsets back to lines.
 *
 * Set PW_SKIP_WEB_COVERAGE=1 to opt out. The profiler stays on for the whole page, so
 * the overhead is real and it is not worth paying when iterating on a single spec.
 */
export const test = base.extend<{ webCoverage: void }>({
  webCoverage: [
    async ({ page }, use, testInfo) => {
      if (process.env.PW_SKIP_WEB_COVERAGE === '1') {
        await use();
        return;
      }

      await page.coverage.startJSCoverage({ resetOnNavigation: false });
      try {
        await use();
      } finally {
        const coverage = await page.coverage.stopJSCoverage();

        const entries = [];
        for (const entry of coverage) {
          if (!webSourceKey(entry.url)) continue;
          try {
            const response = await page.request.get(entry.url);
            if (!response.ok()) continue;
            entries.push({ ...entry, source: await response.text() });
          } catch {
            // A module can be evicted before teardown; skipping it is better than
            // failing the test over a coverage artefact.
          }
        }

        fs.mkdirSync(WEB_COVERAGE_TMP, { recursive: true });
        fs.writeFileSync(
          path.join(WEB_COVERAGE_TMP, `${testInfo.testId}.json`),
          JSON.stringify(entries)
        );
      }
    },
    { auto: true },
  ],
});

export { expect };
