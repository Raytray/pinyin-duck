import fs from 'fs';
import os from 'os';
import path from 'path';
import v8toIstanbul from 'v8-to-istanbul';
import { createCoverageMap, type CoverageMap } from 'istanbul-lib-coverage';
import { createContext } from 'istanbul-lib-report';
import * as reports from 'istanbul-reports';
import type { FullConfig, FullResult, Reporter } from '@playwright/test/reporter';

/**
 * Turns the Chromium V8 coverage collected during the E2E run into a standard
 * Istanbul report for `packages/web/src`.
 *
 * The web package has no unit tests; its behaviour is verified through the browser, so
 * measuring coverage from that run is what reflects the code that actually ships.
 * `@pinyinduck/core` is deliberately excluded here: it is linked into the app from
 * source and already measured by the unit suite in `packages/core`.
 */

/** Where per-test fragments are parked between onTestEnd and onEnd. */
export const WEB_COVERAGE_TMP = path.join(os.tmpdir(), 'pinyinduck-web-coverage');

export interface CoverageThresholds {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
}

/**
 * Floor for the web package, mirroring the per-glob thresholds in
 * `packages/core/vitest.config.ts`. Set well below the current numbers so an unrelated
 * line does not fail the run, but a broad loss of E2E coverage does.
 */
const DEFAULT_THRESHOLDS: CoverageThresholds = {
  statements: 95,
  branches: 90,
  functions: 95,
  lines: 95,
};

/** Percentage of covered items, or 100 when there is nothing to measure. */
function pct(covered: number, total: number): number {
  return total === 0 ? 100 : (covered / total) * 100;
}

/**
 * Maps a dev-server URL onto a repo-relative report key, or null if it is not a
 * TypeScript source file of the web package.
 *
 * Vite serves app modules as `/src/...` and out-of-root files under `/@fs/<abs>`.
 */
export function webSourceKey(url: string): string | null {
  if (!/\.(ts|tsx)$/.test(url.split('?')[0])) return null;

  const fsMarker = '/@fs';
  const absMarker = `${path.sep}packages${path.sep}web${path.sep}src${path.sep}`;

  const fsIndex = url.indexOf(fsMarker);
  if (fsIndex !== -1) {
    const abs = url.slice(fsIndex + fsMarker.length);
    if (abs.includes(absMarker)) {
      return `packages/web/src/${abs.slice(abs.lastIndexOf(absMarker) + absMarker.length)}`;
    }
    return null;
  }

  const marker = '/src/';
  const index = url.indexOf(marker);
  if (index === -1) return null;
  return `packages/web/src/${url.slice(index + marker.length).split('?')[0]}`;
}

export default class WebCoverageReporter implements Reporter {
  private readonly outDir: string;
  private readonly thresholds: CoverageThresholds;

  constructor(options: { outDir?: string; thresholds?: CoverageThresholds } = {}) {
    this.outDir = options.outDir ?? path.join(process.cwd(), 'coverage', 'web');
    this.thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  }

  onBegin(_config: FullConfig): void {
    fs.rmSync(WEB_COVERAGE_TMP, { recursive: true, force: true });
    fs.mkdirSync(WEB_COVERAGE_TMP, { recursive: true });
  }

  onTestEnd(): void {
    // Fragments are written by the coverage fixture in ./coverage-fixtures.ts.
  }

  async onEnd(result: FullResult): Promise<void> {
    if (!fs.existsSync(WEB_COVERAGE_TMP)) return;

    const fragments = fs.readdirSync(WEB_COVERAGE_TMP).filter((f) => f.endsWith('.json'));
    if (fragments.length === 0) {
      process.stdout.write('\nNo web coverage fragments were collected.\n');
      return;
    }

    const coverageMap = createCoverageMap({});
    const seen = new Set<string>();

    for (const fragment of fragments) {
      const raw = JSON.parse(fs.readFileSync(path.join(WEB_COVERAGE_TMP, fragment), 'utf8'));
      if (!Array.isArray(raw)) continue;

      for (const entry of raw) {
        const key = webSourceKey(entry?.url ?? '');
        // `source` is the transpiled text captured while the dev server was still up;
        // v8-to-istanbul needs it to map V8 offsets back to lines.
        if (!key || !entry.source) continue;

        try {
          const converter = v8toIstanbul(key, 0, { source: entry.source });
          await converter.load();
          converter.applyCoverage(entry.functions);
          coverageMap.merge(converter.toIstanbul());
          seen.add(key);
        } catch (err) {
          process.stdout.write(`\nSkipped ${key}: ${(err as Error).message}\n`);
        }
      }
    }

    if (seen.size === 0) {
      process.stdout.write('\nNo web coverage was collected for packages/web/src.\n');
      return;
    }

    fs.rmSync(this.outDir, { recursive: true, force: true });
    fs.mkdirSync(this.outDir, { recursive: true });

    const context = createContext({ dir: this.outDir, coverageMap });
    for (const name of ['text-summary', 'text', 'html', 'lcovonly'] as const) {
      reports.create(name, {}).execute(context);
    }

    this.enforceThresholds(coverageMap, result);
  }

  /**
   * Fails the run when the web package drops below the configured floor.
   *
   * A reporter cannot fail a Playwright run directly, so a breach sets a non-zero
   * exit code. The suite itself may have passed, so the message says plainly that the
   * coverage floor is what failed rather than implying a test broke.
   */
  private enforceThresholds(coverageMap: CoverageMap, result: FullResult): void {
    const summary = coverageMap.getCoverageSummary();
    const actual: Record<keyof CoverageThresholds, number> = {
      statements: pct(summary.statements.covered, summary.statements.total),
      branches: pct(summary.branches.covered, summary.branches.total),
      functions: pct(summary.functions.covered, summary.functions.total),
      lines: pct(summary.lines.covered, summary.lines.total),
    };

    const breaches = (Object.keys(actual) as (keyof CoverageThresholds)[]).filter(
      (metric) => actual[metric] < this.thresholds[metric]
    );

    if (breaches.length === 0) return;

    const detail = breaches
      .map((m) => `  ${m}: ${actual[m].toFixed(2)}% (minimum ${this.thresholds[m]}%)`)
      .join('\n');
    process.stdout.write(`\nWeb coverage is below the configured floor:\n${detail}\n`);
    // A test failure already set a non-zero code; do not overwrite a worse signal.
    if (result.status === 'passed') process.exitCode = 1;
  }
}
