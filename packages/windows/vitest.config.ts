/**
 * Coverage configuration for `@pinyinduck/windows`.
 *
 * The package is a dictionary emitter rather than a runtime library, so almost all of
 * it is formatting decisions that have to stay pinned: a weight formula that drifts
 * from the ranker, or a column order that loses the gloss, would both still "work"
 * and quietly change what a learner sees. The floors are therefore set at the level the
 * core package uses for its build scripts.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts', 'scripts/**/*.ts'],
      exclude: ['**/*.test.ts'],
      thresholds: {
        global: {
          statements: 95,
          branches: 95,
          functions: 95,
          lines: 95,
        },
      },
    },
  },
});
