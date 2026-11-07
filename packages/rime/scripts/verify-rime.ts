/**
 * Runs the generated dictionaries and schemas through a real librime.
 *
 * The rest of this package's tests assert against a *reading* of librime's behaviour:
 * that the body is TSV, that the header must declare a comment column, that
 * `SortHomophones` is a stable sort by weight. Reading a source file is not the same as
 * running it, and a misreading passes every unit test while producing an input method
 * that finds nothing. So this stages each platform's `rime/` folder exactly as its
 * installer would, lets librime deploy it, and types at the result. Weasel and Squirrel
 * bundle the same librime, so one Linux build of it stands in for both.
 *
 *   npm run setup:rime      # once: builds librime and the harness, no sudo
 *   npm run test:rime       # this script, for every platform
 *   npm run test:rime -- --platform macos   # one platform
 *   npm run test:rime:strict   # same, but a missing librime is a failure
 *
 * Without a built librime this reports what is missing and exits 0, so it can sit in a
 * script that a contributor without a C++ toolchain still runs. `--require` (and the
 * strict npm script) turns that skip into a failure for a pre-merge gate.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import {
  SMOKE_CASES,
  evaluateSmoke,
  formatSmokeReport,
  parseSmokeOutput,
  type SmokeRecord,
} from '../src/rime-verify.js';
import { RIME_SCRIPTS } from '../src/rime-dict.js';
import {
  PLATFORM_INFO,
  TEMPLATE_FILES,
  parsePlatformFlag,
  type RimePlatform,
} from '../src/rime-platform.js';
import { DICT_NAMES, platformRimeDir } from './build-rime-dict.js';

const TOOLS_DIR = path.resolve(__dirname, '../tools');
const HARNESS = path.join(TOOLS_DIR, '.local/bin/rime_smoke');
const LIBRIME_DIR = path.join(TOOLS_DIR, 'librime');
/** Stands in for rime-prelude: the presets `import_preset` and the patch target need. */
const SHARED_DATA_DIR = path.join(LIBRIME_DIR, 'data/minimal');

/**
 * The only files taken from librime's sample data.
 *
 * `symbols` and `default` are presets, not content: `punctuator: import_preset: symbols` and
 * `key_binder: import_preset: default` resolve against them, and `default.custom.yaml` patches
 * `default.yaml`. Everything else in that directory is librime's demonstration content —
 * `luna_pinyin`, `cangjie5`, and an `essay.txt` of numeric codes.
 *
 * The sample dictionaries are left out on purpose. They are not what this package installs,
 * and including them puts 880 `Encode failure` lines in the log — one per row of a
 * demonstration dictionary that has nothing to do with the dictionaries under test. A log
 * scanner that has to read past that stops being read, and this check exists to be read.
 */
const SHARED_FILES = ['default.yaml', 'symbols.yaml'] as const;

/** How librime is told to stop complaining and how long it gets before we give up. */
const DEPLOY_TIMEOUT_MS = 300_000;

export interface VerifyOptions {
  /** Treat a missing librime as a failure rather than a skip. */
  require: boolean;
  /** Keep the staged user directory for inspection. */
  keepStaging: boolean;
  /** Whose `rime/` folder to verify. */
  platform: RimePlatform;
  /** Overrides the harness binary. Only the tests set this. */
  harnessPath?: string;
  /** Overrides librime's sample data directory. Only the tests set this. */
  sharedDataDir?: string;
  /** Overrides the directory holding the hand-written schemas and generated dictionaries. */
  rimeDir?: string;
  /** Overrides how long one deploy gets. Only the tests set this. */
  timeoutMs?: number;
}

/** Why librime could not be used, or `null` when it can. */
export function harnessProblem(harnessPath: string, sharedDataDir: string): string | null {
  if (!fs.existsSync(harnessPath)) {
    return `No librime harness at ${harnessPath}.\n` +
      '  Build one with: npm run setup:rime';
  }
  if (!fs.existsSync(sharedDataDir)) {
    return `librime's data directory is missing at ${sharedDataDir}.\n` +
      '  The clone looks incomplete; re-run: npm run setup:rime';
  }
  return null;
}

/**
 * Stages a user directory that mirrors what a Rime install would hold.
 *
 * The hand-written schemas and generated dictionaries go in as they are, and librime's own
 * minimal data directory supplies `default.yaml` and `symbols.yaml` — the presets
 * `key_binder: import_preset: default` and `punctuator: import_preset: symbols` resolve
 * against, and the file `default.custom.yaml` patches. Using librime's copy rather than a
 * hand-written stub means the presets are the engine's own.
 *
 * Nothing else from that directory is copied, and `essay.txt` is the one that matters. On its
 * first deploy librime seeds the user dictionary from it, and its 880 rows are number readings
 * (`二〇〇九`, `七〇`) that no pinyin encoder can turn into a syllable, so every one of them logs
 * `Encode failure`. That is real, it is entirely about a file this package does not install,
 * and left in place it buries the log lines that would be about the dictionaries under test.
 */
export function stageUserDir(rimeDir: string, sharedDataDir: string, target: string): void {
  fs.mkdirSync(target, { recursive: true });
  for (const name of fs.readdirSync(rimeDir)) {
    // The .dict.yaml files are the subject; the compiled build/ directory must not leak in.
    if (name === 'build') continue;
    fs.cpSync(path.join(rimeDir, name), path.join(target, name), { recursive: true });
  }
  for (const name of SHARED_FILES) {
    const destination = path.join(target, name);
    if (fs.existsSync(destination)) continue;
    fs.cpSync(path.join(sharedDataDir, name), destination, { recursive: true });
  }
}

/**
 * Stages librime's shared data directory down to the same two preset files.
 *
 * This is the filter that matters most. librime reads `essay.txt` from the *shared*
 * directory when it seeds the user dictionary, so passing the sample data directory
 * through unchanged reintroduces all 880 warnings regardless of what the staged user
 * directory holds — a user directory with no sample data in it is not enough, because the
 * essay is read from the other side.
 */
export function stageSharedDir(sharedDataDir: string, target: string): void {
  fs.mkdirSync(target, { recursive: true });
  for (const name of SHARED_FILES) {
    fs.cpSync(path.join(sharedDataDir, name), path.join(target, name));
  }
}

/** One harness invocation's records and log. */
export interface HarnessRun {
  records: SmokeRecord[];
  stderr: string;
  timedOut: boolean;
}

/** Types a set of queries into one schema and decodes the result. */
export function runHarness(
  harnessPath: string,
  userDir: string,
  sharedDataDir: string,
  schema: string,
  queries: string[],
  timeoutMs: number = DEPLOY_TIMEOUT_MS
): HarnessRun {
  const result = spawnSync(harnessPath, [userDir, sharedDataDir, schema, ...queries], {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  // `encoding: 'utf8'` is not a promise Node keeps on every path. A process killed by the
  // timeout comes back with zero-length Buffers, which are not strings and so are not equal
  // to one either — `?? ''` does not catch that, and neither does `=== ''`.
  const stdout = result.stdout?.toString() ?? '';
  const stderr = result.stderr?.toString() ?? '';

  if (isTimedOut(result.error, result.status, stdout)) {
    // Whatever it managed to print before the kill is still evidence, and the caller
    // reports the timeout either way, so it is handed back rather than thrown away.
    return { records: parseSmokeOutput(stdout), stderr, timedOut: true };
  }
  if (result.error) throw result.error;
  return { records: parseSmokeOutput(stdout), stderr, timedOut: false };
}

/**
 * Whether a spawn was killed by the timeout rather than having finished.
 *
 * Node reports a `timeout` kill as `error.code === 'ETIMEDOUT'` alongside a null status,
 * and hands back a zero-length Buffer for stdout — the same shape as a process killed from
 * outside. Both readings are checked because they mean the same thing here: the deploy did
 * not finish, and the empty menu that follows must not be read as a schema that finds
 * nothing. That is the expensive mistake. A run that is merely slow is not.
 */
export function isTimedOut(
  error: NodeJS.ErrnoException | undefined,
  status: number | null,
  stdout: string
): boolean {
  // A process that exited on its own, however unhappily, always has a status.
  if (status !== null) return false;
  if (error?.code === 'ETIMEDOUT') return true;
  // Some platforms report the same kill as a bare SIGTERM, with no error at all.
  return error === undefined && stdout === '';
}

export interface VerifyResult {
  ok: boolean;
  skipped: boolean;
  reason: string;
  output: string;
}

/** Stages, runs, and formats. Separated from the CLI so it can be driven from a test. */
export function verifyRime(options: VerifyOptions): VerifyResult {
  const harness = options.harnessPath ?? HARNESS;
  const sharedDataDir = options.sharedDataDir ?? SHARED_DATA_DIR;
  const rimeDir = options.rimeDir ?? platformRimeDir(options.platform);

  const problem = harnessProblem(harness, sharedDataDir);
  if (problem) {
    if (options.require) {
      return { ok: false, skipped: false, reason: problem, output: problem };
    }
    return {
      ok: true,
      skipped: true,
      reason: problem,
      output: `Skipped: ${problem}`,
    };
  }

  // Every file in the folder is generated by build:rime, so any one missing means the same
  // thing. Checking only the dictionaries let a folder with stale dictionaries and no schema
  // (what a pull from before the templates leaves behind) through to librime, which then
  // failed every query with nothing pointing at the cause.
  const required = [
    ...TEMPLATE_FILES,
    ...RIME_SCRIPTS.map((script) => `${DICT_NAMES[script]}.dict.yaml`),
    'lua/pinyinduck_gloss.lua',
  ];
  const absent = required.filter((name) => !fs.existsSync(path.join(rimeDir, name)));
  if (absent.length > 0) {
    const list = absent.join(', ');
    return {
      ok: false,
      skipped: false,
      reason: `Missing from ${rimeDir}: ${list}\n  Build them with: npm run build:rime`,
      output: `Cannot verify: ${rimeDir} is missing ${list}. Run "npm run build:rime" first.`,
    };
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'pinyinduck-rime-'));
  const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'pinyinduck-rime-shared-'));
  try {
    stageUserDir(rimeDir, sharedDataDir, staging);
    stageSharedDir(sharedDataDir, shared);

    const schemas = [...new Set(SMOKE_CASES.map((c) => c.schema))];
    const records: SmokeRecord[] = [];
    const logs: string[] = [];

    const timeoutMs = options.timeoutMs ?? DEPLOY_TIMEOUT_MS;
    for (const schema of schemas) {
      const queries = SMOKE_CASES.filter((c) => c.schema === schema).map((c) => c.query);
      const run = runHarness(harness, staging, shared, schema, queries, timeoutMs);
      if (run.timedOut) {
        return {
          ok: false,
          skipped: false,
          reason: `librime did not finish deploying ${schema}`,
          output:
            `librime did not finish deploying ${schema} within ` +
            `${timeoutMs / 1000}s. The dictionaries are 9MB each; if this machine ` +
            'is simply slow, raise DEPLOY_TIMEOUT_MS in scripts/verify-rime.ts.',
        };
      }
      records.push(...run.records);
      logs.push(run.stderr);
    }

    const report = evaluateSmoke(records, SMOKE_CASES, logs.join('\n'));
    const output = formatSmokeReport(report, SMOKE_CASES);
    return { ok: report.failures.length === 0, skipped: false, reason: '', output };
  } finally {
    if (options.keepStaging) {
      process.stderr.write(`\nStaged user directory kept at ${staging}\n`);
      process.stderr.write(`Staged shared directory kept at ${shared}\n`);
    } else {
      fs.rmSync(staging, { recursive: true, force: true });
      fs.rmSync(shared, { recursive: true, force: true });
    }
  }
}

export interface VerifyCliOptions extends Omit<VerifyOptions, 'platform'> {
  platforms: RimePlatform[];
}

export function parseArgs(args: string[]): VerifyCliOptions {
  return {
    require: args.includes('--require'),
    keepStaging: args.includes('--keep-staging'),
    platforms: parsePlatformFlag(args),
  };
}

/**
 * The CLI entry point.
 *
 * `overrides` exists so the tests can point the run at a stub harness. It is not a way to
 * change behaviour from the command line: the flags below are the whole interface, and a
 * flag that quietly accepted a path would be a way to verify a dictionary that is not the
 * one installed.
 */
export async function main(
  args: string[],
  overrides: Partial<Omit<VerifyOptions, 'platform'>> = {}
): Promise<void> {
  const { platforms, ...parsed } = parseArgs(args);
  const options = { ...parsed, ...overrides };
  console.log('Verifying the PinyinDuck schemas with a real librime...\n');

  for (const platform of platforms) {
    if (platforms.length > 1) console.log(`[${platform}]`);
    const result = verifyRime({ ...options, platform });
    console.log(result.output);

    if (result.skipped) {
      // Said in those words, because a check that exits 0 without running anything reads as
      // a pass to anything that only looks at the exit code — which is a CI log.
      console.log('\nThis is a skip, not a pass: no engine ran. Use --require to make it fail.');
      // The harness is shared, so every other platform would skip for the same reason.
      return;
    }
    if (!result.ok) {
      process.exitCode = 1;
      continue;
    }
    console.log(
      '\nRime accepts the dictionaries and answers real keystrokes. ' +
        `See packages/${platform}/README.md for the checks only a real ${PLATFORM_INFO[platform].os} host can do.\n`
    );
  }
}

// pathToFileURL rather than a `file://` template, which never matches a Windows path
// (`C:\...`) or one with a space in it (%20 in the URL).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
