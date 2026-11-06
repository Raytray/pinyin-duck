/**
 * Verifies the generated Rime dictionaries against a real librime engine.
 *
 * Stages the real schemas and the real 9.6 MB dictionaries into a temporary user
 * directory, types eight queries, and compares the candidate lists. Fails on anything
 * librime logged.
 *
 * Usage:
 *   npm run test:rime              # skips if librime is not built
 *   npm run test:rime:strict       # fails if librime is not built
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';

const TOOLS_DIR = path.resolve(__dirname, '../tools');
const RIME_DIR = path.resolve(__dirname, '../rime');
const LIBRIME_DIR = path.join(TOOLS_DIR, 'librime');
const HARNESS = path.join(TOOLS_DIR, 'rime_smoke');

/**
 * The pinned queries.
 *
 * Each is a (schema, input, expected candidates) triple. These are the assertions the
 * whole emitter exists to satisfy: the codes, the ordering inside a menu, and the
 * traditional column all have to hold for a learner typing into a real engine.
 */
export interface Query {
  schema: string;
  input: string;
  /** The menu to expect. Omitted only when the query asserts nothing about the menu. */
  expected?: string[];
  /** Text the query is expected to commit, for a digit that selects a whole candidate. */
  expectCommit?: string;
  /** Composition buffer to expect, for a digit that selects only part of the input. */
  expectPreedit?: string;
}

/**
 * The pinned queries.
 *
 * Each is a (schema, input, expected) triple. These are the assertions the whole emitter
 * exists to satisfy: the codes, the ordering inside a menu, and the traditional column all
 * have to hold for a learner typing into a real engine.
 *
 * A query ending in a digit is asserted by what it *did*, not by a menu. Selecting a
 * candidate takes it out of the menu, so a digit that covers the whole input commits the
 * text and leaves nothing behind (`shi2`), while a digit that covers only the first
 * syllable leaves the rest still composing and the committed part visible in the buffer
 * (`nihao2`). Asserting a menu for either would pin the engine's behaviour backwards.
 */
export const QUERIES: Query[] = [
  { schema: 'pinyinduck', input: 'shi', expected: ['是', '十', '使', '试', '诗'] },
  // A digit selects the second candidate outright: it is committed, and the menu is empty
  // because the selected candidate is no longer among the options.
  { schema: 'pinyinduck', input: 'shi2', expectCommit: '十', expected: [] },
  { schema: 'pinyinduck', input: 'an', expected: ['暗', '岸', '按', '安', '案'] },
  { schema: 'pinyinduck', input: 'lv', expected: ['绿', '驴', '旅', '律', '率'] },
  { schema: 'pinyinduck', input: 'nv', expected: ['女', '衄', '籹', '恧', '钕'] },
  { schema: 'pinyinduck', input: 'nihao', expected: ['你好', '你', '呢', '尼', '妮'] },
  // 你 covers only the first syllable, so it is selected for that part alone: the buffer
  // keeps the unselected `hao`, and the menu is whatever that still matches.
  {
    schema: 'pinyinduck',
    input: 'nihao2',
    expectPreedit: '你hao',
    expected: ['好', '号', '浩', '豪', '嚎'],
  },
  { schema: 'pinyinduck_trad', input: 'zhongguo', expected: ['中國', '中古', '種', '重', '鍾'] },
];

/** Files copied into the temporary user directory before the harness runs. */
const STAGED_FILES = [
  'pinyinduck.schema.yaml',
  'pinyinduck_trad.schema.yaml',
  'default.custom.yaml',
  'pinyinduck.dict.yaml',
  'pinyinduck_trad.dict.yaml',
  'lua/pinyinduck_gloss_filter.lua',
];

/** One query's candidates, as the harness reported them. */
export interface QueryResult {
  schema: string;
  input: string;
  candidates: string[];
  /** Text the harness saw committed, or undefined when the query committed nothing. */
  committed?: string;
}

/** What running the harness produced: its exit code, its stdout and its stderr. */
export interface HarnessResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Everything the verifier touches outside its own logic.
 *
 * Injected for the same reason as `RimeBuildDeps` in `build-rime-dict.ts`: the decisions
 * worth pinning are the staging set, the harness protocol and the pass/fail verdict, and
 * none of them needs a compiled librime or a 9.6 MB dictionary to be exercised.
 */
export interface RimeVerifyDeps {
  exists(target: string): boolean;
  copyFile(from: string, to: string): void;
  mkdir(target: string): void;
  mkdtemp(prefix: string): string;
  rm(target: string): void;
  spawnHarness(
    harness: string,
    tempDir: string,
    queries: readonly Query[]
  ): Promise<HarnessResult>;
}

const nodeDeps: RimeVerifyDeps = {
  exists: (p) => fs.existsSync(p),
  copyFile: (from, to) => fs.copyFileSync(from, to),
  mkdir: (p) => fs.mkdirSync(p, { recursive: true }),
  mkdtemp: (prefix) => fs.mkdtempSync(prefix),
  rm: (p) => fs.rmSync(p, { recursive: true, force: true }),
  spawnHarness,
};

/**
 * The shared library librime actually produces.
 *
 * The CMake target is named `rime` (src/CMakeLists.txt), so the file is `librime.so` with
 * no `lib` prefix, and `LIBRARY_OUTPUT_DIRECTORY` puts it under `build/lib/`. Looking for
 * `liblibrime.so` finds nothing, which reads as "not built" and skips the verification
 * rather than failing it.
 */
const LIBRIME_SO = ['build', 'lib', 'librime.so'];

/**
 * Whether the toolchain this verifier needs has been built.
 *
 * Both halves matter: the library without a harness has nothing to drive it, and a
 * harness without the library it links against cannot start.
 */
export function checkLibrime(
  librimeDir: string,
  harness: string,
  deps: RimeVerifyDeps = nodeDeps
): boolean {
  return deps.exists(path.join(librimeDir, ...LIBRIME_SO)) && deps.exists(harness);
}

/**
 * librime's own preset data, copied out of the cloned librime tree.
 *
 * The PinyinDuck schemas are not self-contained: they declare
 * `punctuator/import_preset: symbols` and `key_binder/import_preset: default`, so
 * deployment needs librime's `symbols.yaml` and `default.yaml` to resolve. Without them
 * the schema fails to compile ("error building config: pinyinduck.schema") and every
 * query comes back with an empty candidate list, which reads as a ranking regression
 * rather than a missing input file.
 *
 * `default.yaml` is also what `default.custom.yaml` patches, so it must be present for the
 * scheme switcher list to be built at all.
 */
const LIBRIME_PRESETS = ['default.yaml', 'symbols.yaml'];

function stagePresetFiles(
  librimeDir: string,
  tempDir: string,
  deps: RimeVerifyDeps
): void {
  const presetDir = path.join(librimeDir, 'data', 'minimal');
  for (const file of LIBRIME_PRESETS) {
    const src = path.join(presetDir, file);
    if (deps.exists(src)) {
      deps.copyFile(src, path.join(tempDir, file));
    }
    // Absent presets are not fatal here: the caller has already checked that librime was
    // built, and a tree laid out differently should surface as a candidate mismatch in the
    // output rather than as an exception about a file in someone else's repository.
  }
}

/**
 * Copies the schemas, dictionaries and Lua filter into a throwaway user directory.
 *
 * librime resolves `lua/` relative to its user directory, so the gloss sidecar has to
 * land under `lua/` here for the filter to find it. The filter itself is in `lua/` for the
 * same reason, which is why that directory is created before anything is copied.
 */
export function stageFiles(
  rimeDir: string,
  tempDir: string,
  deps: RimeVerifyDeps = nodeDeps,
  librimeDir: string = LIBRIME_DIR
): void {
  const luaDir = path.join(tempDir, 'lua');
  deps.mkdir(luaDir);
  for (const file of STAGED_FILES) {
    const src = path.join(rimeDir, file);
    if (!deps.exists(src)) {
      throw new Error(`Missing ${src}. Run "npm run build:rime" first.`);
    }
    deps.copyFile(src, path.join(tempDir, file));
  }

  stagePresetFiles(librimeDir, tempDir, deps);

  const glossSrc = path.join(rimeDir, 'lua', 'pinyinduck_gloss.lua');
  if (deps.exists(glossSrc)) {
    deps.copyFile(glossSrc, path.join(luaDir, 'pinyinduck_gloss.lua'));
  }
}

/**
 * Drives the compiled harness over its line protocol and waits for it to exit.
 *
 * The exit code has to be awaited rather than assumed. A crash inside librime surfaces
 * as a non-zero exit, and if the code is read before the child has finished there is
 * nothing to report yet — the comparison downstream would parse an empty candidate list
 * and blame all eight queries for a single crash.
 */
export async function spawnHarness(
  harness: string,
  tempDir: string,
  queries: readonly Query[]
): Promise<HarnessResult> {
  const child = spawn(harness, [], {
    env: { ...process.env, RIME_USER_DIR: tempDir, RIME_LOG_DIR: tempDir },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (data) => {
    stdout += data.toString();
  });
  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  for (const query of queries) {
    child.stdin.write(`SCHEMA ${query.schema}\n`);
    child.stdin.write(`KEYS ${query.input}\n`);
  }
  child.stdin.write('QUIT\n');
  child.stdin.end();

  const code = await new Promise<number>((resolve) => {
    child.on('close', (exitCode) => resolve(exitCode ?? 0));
  });

  return { code, stdout, stderr };
}

/**
 * Reads the harness's transcript back into per-query candidate lists.
 *
 * The protocol is line-based and stateful: `SCHEMA` opens a result, `PREEDIT` and
 * `CANDIDATE` fill it, and the next `SCHEMA` closes it. A line that arrives before any
 * `SCHEMA` belongs to no query and is dropped rather than crashing the parse.
 */
export function parseOutput(output: string): QueryResult[] {
  const lines = output.split('\n');
  const results: QueryResult[] = [];
  let current: QueryResult | null = null;

  for (const line of lines) {
    if (line.startsWith('SCHEMA ')) {
      if (current) results.push(current);
      current = { schema: line.slice(7), input: '', candidates: [] };
    } else if (line.startsWith('PREEDIT ') && current) {
      current.input = line.slice(8);
    } else if (line.startsWith('CANDIDATE ') && current) {
      current.candidates.push(line.slice(10));
    } else if (line.startsWith('COMMITTED ') && current) {
      current.committed = line.slice(10);
    }
  }
  if (current) results.push(current);

  return results;
}

export interface VerifyOptions {
  /** Fail rather than skip when librime has not been built. */
  strict?: boolean;
  queries?: readonly Query[];
  rimeDir?: string;
  librimeDir?: string;
  harness?: string;
}

/**
 * Runs the verification and reports the process exit code.
 *
 * Returned rather than calling `process.exit`, so the verdict can be asserted in a test
 * and so the CLI below can set `exitCode` and let stdout flush instead of cutting it off.
 */
export async function main(
  options: VerifyOptions = {},
  deps: RimeVerifyDeps = nodeDeps
): Promise<number> {
  const queries = options.queries ?? QUERIES;
  const rimeDir = options.rimeDir ?? RIME_DIR;
  const librimeDir = options.librimeDir ?? LIBRIME_DIR;
  const harness = options.harness ?? HARNESS;

  if (!checkLibrime(librimeDir, harness, deps)) {
    const msg = 'librime is not built. Run "npm run setup:rime" first.';
    if (options.strict) {
      console.error(`FAIL: ${msg}`);
      return 1;
    }
    console.log(`SKIP: ${msg}`);
    return 0;
  }

  const tempDir = deps.mkdtemp(path.join(os.tmpdir(), 'pinyinduck-rime-'));

  try {
    stageFiles(rimeDir, tempDir, deps);
    const { code, stdout, stderr } = await deps.spawnHarness(harness, tempDir, queries);

    if (code !== 0) {
      throw new Error(`Harness exited with code ${code}\n${stderr}`);
    }

    const results = parseOutput(stdout);

    let passed = 0;
    let failed = 0;

    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      const result = results[i];

      if (!result) {
        console.error(`FAIL: ${query.schema} ${query.input} — no result`);
        failed++;
        continue;
      }

      const actual = result.candidates;
      const expected = query.expected;

      // A query pinned by expectCommit or expectPreedit asserts what the selection did
      // rather than only the menu, because selecting a candidate removes it from the menu.
      // All three are checked when a query pins them.
      const commitOk =
        query.expectCommit === undefined || result.committed === query.expectCommit;
      const preeditOk =
        query.expectPreedit === undefined || result.input === query.expectPreedit;
      const menuOk =
        expected === undefined ||
        (actual.length === expected.length && actual.every((c, j) => c === expected[j]));

      if (commitOk && preeditOk && menuOk) {
        const shown = query.expectCommit
          ? `committed ${result.committed ?? ''}`
          : actual.join(' ');
        console.log(`PASS: ${query.schema} ${query.input} → ${shown}`);
        passed++;
      } else {
        console.error(`FAIL: ${query.schema} ${query.input}`);
        if (query.expectCommit !== undefined) {
          console.error(`  expected commit: ${query.expectCommit}`);
          console.error(`  actual commit:   ${result.committed ?? '(none)'}`);
        }
        if (query.expectPreedit !== undefined) {
          console.error(`  expected preedit: ${query.expectPreedit}`);
          console.error(`  actual preedit:   ${result.input}`);
        }
        if (expected !== undefined) {
          console.error(`  expected: ${expected.join(' ')}`);
          console.error(`  actual:   ${actual.join(' ')}`);
        }
        failed++;
      }
    }

    console.log(`\n${passed} of ${queries.length} queries behaved as pinned.`);

    return failed > 0 ? 1 : 0;
  } finally {
    deps.rm(tempDir);
  }
}

/* v8 ignore start -- CLI entry point. Runs only under `npm run test:rime`, never on import. */
// pathToFileURL rather than a `file://` template, which never matches a Windows path
// (`C:\...`) or one with a space in it (%20 in the URL).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main({ strict: process.argv.includes('--require') }).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(err);
      process.exitCode = 1;
    }
  );
}
/* v8 ignore stop */