/**
 * Coverage configuration for `@pinyinduck/core`.
 *
 * The floors are set a little below the current numbers rather than exactly at them,
 * so ordinary work does not fail the build on an unrelated line, but a large
 * regression in the core engine or the dictionary pipeline does. No file is allowed
 * to drop below 80% on any metric.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts', 'scripts/**/*.ts'],
      // Re-export barrels and type-only modules compile to no runnable statements,
      // so counting them would report misleading zeroes for the whole package.
      exclude: ['src/index.ts', 'src/types.ts', '**/*.test.ts'],
      thresholds: {
        // Floor for the package as a whole, including any file the per-glob rules
        // below do not match.
        global: {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        // The dictionary generator is a build-time script, but its download, cache
        // and file-writing paths are covered against a stubbed fetch and an in-memory
        // filesystem (scripts/build-dictionary-io.test.ts), so it is held to the same
        // bar as the runtime engine.
        'scripts/**/*.ts': {
          statements: 95,
          branches: 95,
          functions: 95,
          lines: 95,
        },
        'src/**/*.ts': {
          statements: 95,
          branches: 88,
          functions: 95,
          lines: 95,
        },
      },
    },
  },
});
