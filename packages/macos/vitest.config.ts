/**
 * Coverage configuration for `@pinyinduck/macos`.
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
      // Flat, not nested under a `global` key. Vitest documents `thresholds.global`, and
      // on 3.2.7 that shape silently checks nothing: the key is not in the list of
      // threshold names, so it is read as a per-glob entry, matched against file paths as
      // the pattern "global" — which matches no file — and the actual global entry is
      // built from `thresholds.branches` and friends, which are then undefined. The run
      // reports its percentages, prints no error, and exits 0 at any coverage at all.
      //
      // Verified by instrumenting `checkThresholds`: with the nested form it receives
      // `[{name: 'global', thresholds: {}, files: 1}, {name: 'global', thresholds: {...},
      // files: 0}]` and checks the empty one. The flat form below is read directly into
      // the global entry and fails the run properly.
      //
      // If this ever reads as redundant, the failing check is the price of the wrong shape.
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});
