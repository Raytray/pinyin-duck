/**
 * Covers the part of `verify-rime.ts` that does not need a built librime.
 *
 * Running a real engine is `npm run test:rime`, and it is deliberately not a unit test —
 * it needs a C++ toolchain and takes minutes. What is left is staging and orchestration, and
 * staging is where a mistake is invisible: a file that should not be copied produces a
 * dictionary that deploys fine and a log that says nothing useful. So the fixtures below
 * reproduce librime's sample data directory, including the `essay.txt` that costs 880
 * warnings, and assert it stays out.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  harnessProblem,
  isTimedOut,
  main,
  parseArgs,
  runHarness,
  stageSharedDir,
  stageUserDir,
  verifyRime,
} from './verify-rime';
import { SMOKE_CASES } from '../src/rime-verify';

/** A stand-in for librime's `data/minimal`, with the files that actually caused noise. */
function fakeLibrimeData(root: string): void {
  fs.mkdirSync(root, { recursive: true });
  // The two presets, which are content this package depends on.
  fs.writeFileSync(path.join(root, 'default.yaml'), 'schema_list: []\n', 'utf8');
  fs.writeFileSync(path.join(root, 'symbols.yaml'), 'punctuator: {}\n', 'utf8');
  // Everything below is librime's demonstration content.
  fs.writeFileSync(path.join(root, 'essay.txt'), '〇\t981\n二〇\t658\n', 'utf8');
  fs.writeFileSync(path.join(root, 'luna_pinyin.dict.yaml'), '你\tshi4\t0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'luna_pinyin.schema.yaml'), 'schema:\n', 'utf8');
  fs.writeFileSync(path.join(root, 'cangjie5.dict.yaml'), '你\tabcd\t0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'cangjie5.schema.yaml'), 'schema:\n', 'utf8');
}

/** A stand-in for a platform's `rime/` folder, with the two dictionaries present. */
function fakeRimeDir(root: string): void {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'pinyinduck.dict.yaml'), '是\tshi\t0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'pinyinduck_trad.dict.yaml'), '是\tshi\t0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'pinyinduck.schema.yaml'), 'schema:\n', 'utf8');
  fs.writeFileSync(path.join(root, 'pinyinduck_trad.schema.yaml'), 'schema:\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.custom.yaml'), 'patch:\n', 'utf8');
  // The Lua gloss filter and the sidecar it reads, which the schema's `lua_filter` needs.
  fs.mkdirSync(path.join(root, 'lua'), { recursive: true });
  fs.writeFileSync(path.join(root, 'lua/pinyinduck_gloss_filter.lua'), 'return { func = function() end }\n', 'utf8');
  fs.writeFileSync(path.join(root, 'lua/pinyinduck_gloss.lua'), 'return {}\n', 'utf8');
  // A compiled build directory, which must never be staged.
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build/pinyinduck.table.bin'), 'binary', 'utf8');
}

const sortedNames = (dir: string): string[] => fs.readdirSync(dir).sort();

describe('staging a Rime user directory', () => {
  let tmp: string;
  let librimeData: string;
  let rimeDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-rime-test-'));
    librimeData = path.join(tmp, 'minimal');
    rimeDir = path.join(tmp, 'rime');
    fakeLibrimeData(librimeData);
    fakeRimeDir(rimeDir);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('carries our own schemas, dictionaries and patch across', () => {
    const target = path.join(tmp, 'staged');
    stageUserDir(rimeDir, librimeData, target);

    expect(sortedNames(target)).toEqual([
      'default.custom.yaml',
      'default.yaml',
      'lua',
      'pinyinduck.dict.yaml',
      'pinyinduck.schema.yaml',
      'pinyinduck_trad.dict.yaml',
      'pinyinduck_trad.schema.yaml',
      'symbols.yaml',
    ]);
  });

  it('leaves out the compiled build directory, which is derived and not installable', () => {
    // `build/` is what librime writes when it deploys. Staging it back in would make the
    // harness read a stale compiled table instead of recompiling the dictionary, and the
    // verification would then be testing librime's last build rather than today's file.
    const target = path.join(tmp, 'staged');
    stageUserDir(rimeDir, librimeData, target);
    expect(fs.existsSync(path.join(target, 'build'))).toBe(false);
  });

  it('leaves out the sample essay, which is 880 warnings on the first deploy', () => {
    // Not a style choice. On its first deploy librime seeds the user dictionary from
    // `essay.txt`, whose rows are number readings (`二〇〇九`, `七〇`) that no pinyin
    // encoder can turn into a syllable, so every one logs `Encode failure`.
    const target = path.join(tmp, 'staged');
    stageUserDir(rimeDir, librimeData, target);
    expect(fs.existsSync(path.join(target, 'essay.txt'))).toBe(false);
  });

  it('leaves out the demonstration dictionaries, which are not what this package installs', () => {
    const target = path.join(tmp, 'staged');
    stageUserDir(rimeDir, librimeData, target);
    expect(sortedNames(target).filter((n) => /luna|cangjie/.test(n))).toEqual([]);
  });

  it('supplies the two presets the schema resolves against', () => {
    // `punctuator: import_preset: symbols` and `key_binder: import_preset: default`
    // resolve against these, and `default.custom.yaml` patches the second. Using librime's
    // copies rather than a hand-written stub means the presets are the engine's own.
    const target = path.join(tmp, 'staged');
    stageUserDir(rimeDir, librimeData, target);
    expect(fs.readFileSync(path.join(target, 'symbols.yaml'), 'utf8')).toBe('punctuator: {}\n');
  });

  it('does not overwrite a file the package ships itself', () => {
    // The sample data is a fallback. If `rime/` ever grows a `default.yaml` of its own, the
    // one this package installs is the one that must be used.
    fs.writeFileSync(path.join(rimeDir, 'default.yaml'), 'schema_list: [ours]\n', 'utf8');
    const target = path.join(tmp, 'staged');
    stageUserDir(rimeDir, librimeData, target);
    expect(fs.readFileSync(path.join(target, 'default.yaml'), 'utf8')).toBe(
      'schema_list: [ours]\n'
    );
  });
});

describe('staging librime\'s shared data directory', () => {
  let tmp: string;
  let librimeData: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-rime-shared-'));
    librimeData = path.join(tmp, 'minimal');
    fakeLibrimeData(librimeData);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('filters it down to the two preset files', () => {
    const target = path.join(tmp, 'shared');
    stageSharedDir(librimeData, target);
    expect(sortedNames(target)).toEqual(['default.yaml', 'symbols.yaml']);
  });

  it('drops the essay here too, because this is the directory librime reads it from', () => {
    // The user directory filter is not sufficient on its own. Filtering the user directory
    // and passing the sample data through as the *shared* directory still produced all 880
    // warnings, which is what made this function necessary.
    const target = path.join(tmp, 'shared');
    stageSharedDir(librimeData, target);
    expect(fs.existsSync(path.join(target, 'essay.txt'))).toBe(false);
  });
});

describe('harnessProblem', () => {
  it('names the fix when the harness has not been built', () => {
    const problem = harnessProblem('/nowhere/rime_smoke', '/nowhere/minimal');
    expect(problem).toMatch(/No librime harness/);
    expect(problem).toMatch(/npm run setup:rime/);
  });

  it('calls out an incomplete clone when the data directory is gone', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-rime-probe-'));
    try {
      const harness = path.join(tmp, 'rime_smoke');
      fs.writeFileSync(harness, '', 'utf8');
      const problem = harnessProblem(harness, path.join(tmp, 'gone'));
      expect(problem).toMatch(/data directory is missing/);
      expect(problem).toMatch(/npm run setup:rime/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns null when both are present', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-rime-probe-'));
    try {
      fakeLibrimeData(path.join(tmp, 'minimal'));
      const harness = path.join(tmp, 'rime_smoke');
      fs.writeFileSync(harness, '', 'utf8');
      expect(harnessProblem(harness, path.join(tmp, 'minimal'))).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('runHarness', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-rime-harness-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /** Writes an executable stand-in for the C++ harness. */
  const stubHarness = (name: string, body: string): string => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, `#!/bin/sh\n${body}\n`, 'utf8');
    fs.chmodSync(p, 0o755);
    return p;
  };

  it('passes the directories, the schema and every query, in that order', () => {
    // The harness has no other way to know what it was asked, so the argument order is
    // part of the contract between the two files.
    const harness = stubHarness(
      'args.sh',
      'printf "SCHEMA_LIST\\t%s\\n" "$3"\nfor q in "$@"; do :; done\nshift 3\nfor q in "$@"; do printf "CANDIDATE\\t%s\\t0\\t%s\\n" "$q" "$q"; done'
    );
    const run = runHarness(harness, '/user', '/shared', 'pinyinduck', ['shi4', 'lv4']);

    expect(run.records).toEqual([
      { kind: 'schema-list', ids: ['pinyinduck'] },
      { kind: 'candidate', query: 'shi4', index: 0, text: 'shi4', comment: '' },
      { kind: 'candidate', query: 'lv4', index: 0, text: 'lv4', comment: '' },
    ]);
  });

  it('captures stderr, which is the only place librime logs', () => {
    const harness = stubHarness(
      'noisy.sh',
      'printf "SCHEMA_LIST\\tpinyinduck\\n"\necho "W entry_collector.cc:151] Encode failure" >&2'
    );
    const run = runHarness(harness, '/user', '/shared', 'pinyinduck', []);
    expect(run.stderr).toMatch(/Encode failure/);
  });

  it('does not call a run that failed loudly a timeout', () => {
    const harness = stubHarness('failing.sh', 'echo "boom" >&2\nexit 1');
    const run = runHarness(harness, '/user', '/shared', 'pinyinduck', []);
    expect(run.timedOut).toBe(false);
  });

  it('raises rather than reporting a pass when the binary cannot be run', () => {
    // A non-executable file, which is what a half-finished `setup:rime` leaves behind.
    const harness = path.join(tmp, 'not-executable');
    fs.writeFileSync(harness, '', 'utf8');
    expect(() => runHarness(harness, '/user', '/shared', 'pinyinduck', [])).toThrow();
  });
});

describe('isTimedOut', () => {
  // The rule, not the kill. A real kill is exercised below through `runHarness`, with a
  // timeout small enough not to make the suite wait; what is pinned here is the shape,
  // which is where a wrong answer is expensive.
  it('calls the timeout Node reports a timeout', () => {
    // Observed on Node 26 / Linux 6.x: a killed process comes back with
    // `error.code === 'ETIMEDOUT'`, `status === null`, and a zero-length Buffer for
    // stdout. The Buffer is why the earlier `(stdout ?? '') === ''` never fired — a
    // Buffer is not a string and the comparison is false.
    const error = Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' });
    expect(isTimedOut(error, null, '')).toBe(true);
  });

  it('calls a signalled process with no output a timeout too', () => {
    // The other platform's spelling: a bare SIGTERM, null status, and no error at all.
    expect(isTimedOut(undefined, null, '')).toBe(true);
  });

  it('does not call a run that got as far as printing a timeout', () => {
    // A null status with output means the process wrote something and then died. Those
    // records are evidence, and a deploy that got far enough to print is not the failure
    // this check exists to catch.
    expect(isTimedOut(undefined, null, 'SCHEMA_LIST\tpinyinduck\n')).toBe(false);
  });

  it('does not call a completed run a timeout, however it ended', () => {
    // A process that exited on its own, however unhappily, always has a status.
    const error = Object.assign(new Error('killed'), { code: 'EACCES' });
    expect(isTimedOut(undefined, 0, '')).toBe(false);
    expect(isTimedOut(undefined, 143, '')).toBe(false);
    expect(isTimedOut(undefined, 1, '')).toBe(false);
    // An error alongside a status is a failed run, not a kill: the status says it exited.
    expect(isTimedOut(error, 1, '')).toBe(false);
  });
});

describe('a deploy that never finishes', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-rime-slow-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('is reported as a slow machine, not as a schema that finds nothing', async () => {
    // The distinction is the whole reason `timedOut` exists. A killed deploy and a broken
    // schema both produce an empty candidate list; only the first is the machine's fault,
    // and telling a contributor their 9MB dictionary is broken because their laptop was
    // busy is the kind of false report that makes people stop running the check.
    const librimeData = path.join(tmp, 'minimal');
    const rimeDir = path.join(tmp, 'rime');
    fakeLibrimeData(librimeData);
    fakeRimeDir(rimeDir);
    const harness = path.join(tmp, 'slow-harness.sh');
    fs.writeFileSync(harness, '#!/bin/sh\nsleep 30\n', 'utf8');
    fs.chmodSync(harness, 0o755);

    const result = verifyRime({
      platform: 'windows',
      require: false,
      keepStaging: false,
      harnessPath: harness,
      sharedDataDir: librimeData,
      rimeDir,
      timeoutMs: 250,
    });

    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.reason).toMatch(/did not finish deploying/);
    // No candidate list at all, because nothing was learned. An empty menu here would
    // read as "the schema matches nothing", which is a different and much worse claim.
    expect(result.output).not.toMatch(/queries behaved as pinned/);
  });
});

/**
 * A stand-in for the C++ harness that answers every query correctly.
 *
 * It reads nothing: the transcript is generated from the arguments, so this exercises the
 * wiring — staging, argument order, TSV decoding, evaluation, report formatting — and none
 * of librime. A transcript with a mistake in it exercises the evaluation, which is the other
 * half of the wiring and is worth checking too.
 */
function writeStubHarness(dir: string, opts: { breakFor?: string } = {}): string {
  const p = path.join(dir, 'stub-harness.js');
  // One entry per query: the candidates to emit, an optional comment on the first, an
  // optional commit, and an optional preedit. A query ending in a digit selects and
  // commits, so the stub emits the COMMITTED record the case pins; when the selection
  // covers only part of the input, it emits the resulting preedit instead.
  const table: Record<
    string,
    { candidates: string[]; comment?: string; commit?: string; preedit?: string }
  > = {};
  for (const c of SMOKE_CASES) {
    table[c.query] = {
      candidates: c.expect ?? [],
      comment: c.expectComment ? c.expectComment[0] : undefined,
      commit: c.expectCommit,
      preedit: c.expectPreedit,
    };
  }
  fs.writeFileSync(
    p,
    `#!/usr/bin/env node
const [userDir, sharedDir, schema, ...queries] = process.argv.slice(2);
const out = [];
out.push(['SCHEMA_LIST', 'pinyinduck,pinyinduck_trad'].join('\\t'));
out.push(['SCHEMA', schema, 'ok'].join('\\t'));
const table = ${JSON.stringify(table)};
for (const q of queries) {
  const entry = table[q];
  if (!entry) continue;
  out.push(['PREEDIT', q, ${JSON.stringify(opts.breakFor ?? null)} === q ? q : (entry.preedit ?? q)].join('\\t'));
  if (${JSON.stringify(opts.breakFor ?? null)} === q) {
    out.push(['CANDIDATE', q, '0', '错', ''].join('\\t'));
    continue;
  }
  entry.candidates.forEach((text, i) =>
    out.push(['CANDIDATE', q, String(i), text, i === 0 && entry.comment ? entry.comment : ''].join('\\t')));
  if (entry.commit) out.push(['COMMITTED', q, entry.commit].join('\\t'));
}
process.stdout.write(out.join('\\n') + '\\n');
if (process.env.STUB_STDERR) process.stderr.write(process.env.STUB_STDERR);
`,
    'utf8'
  );
  fs.chmodSync(p, 0o755);
  return p;
}

describe('verifyRime end to end, against a stub harness', () => {
  let tmp: string;
  let librimeData: string;
  let rimeDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-rime-e2e-'));
    librimeData = path.join(tmp, 'minimal');
    rimeDir = path.join(tmp, 'rime');
    fakeLibrimeData(librimeData);
    fakeRimeDir(rimeDir);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const run = (harness: string, overrides: Record<string, unknown> = {}) =>
    verifyRime({
      platform: 'windows',
      require: false,
      keepStaging: false,
      harnessPath: harness,
      sharedDataDir: librimeData,
      rimeDir,
      ...overrides,
    });

  it('passes, and says so in terms of what was typed', () => {
    const result = run(writeStubHarness(tmp));

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
    // A green run that only says "8 of 8 passed" is a green run nobody trusts, so the
    // candidates themselves are printed.
    expect(result.output).toMatch(/8 of 8 queries behaved as pinned/);
    expect(result.output).toMatch(/是 十 使 试 诗/);
    expect(result.output).toMatch(/pinyinduck_trad\s+zhongguo\s+中國/);
  });

  it('delivers the gloss, so the run reports no known gap', () => {
    // The gloss was the last known gap: librime has no definition field, so the comment
    // fell back to echoing the code. The Lua filter closes it, so a green run has no gap.
    const result = run(writeStubHarness(tmp));
    expect(result.ok).toBe(true);
    expect(result.output).not.toMatch(/known gap/i);
  });

  it('fails when a query returns the wrong candidates', () => {
    // This is the whole point of running a real engine: a candidate list that drifts from
    // what the dictionary says still compiles, and only a typed query can see it.
    const result = run(writeStubHarness(tmp, { breakFor: 'lv' }));
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/lv/);
  });

  it('fails on an error librime logged, and quotes the line', () => {
    // The log is the only place an `Encode failure` or a config error appears, and a check
    // that greps it without showing what it found is not one anybody can act on.
    const harness = writeStubHarness(tmp);
    process.env.STUB_STDERR =
      'W entry_collector.cc:151] Encode failure: \'一二\'\nE config_compiler.cc:99] error\n';
    try {
      const result = run(harness);
      expect(result.ok).toBe(false);
      expect(result.output).toMatch(/Encode failure/);
    } finally {
      delete process.env.STUB_STDERR;
    }
  });

  it('cleans up both staged directories', () => {
    // Two temp directories per run, on a machine where the whole point of running this is
    // to do it many times. Leaking them would fill a disk with 18MB of copies of the
    // dictionaries before anyone noticed a failure.
    //
    // The run stages into a temp root of its own, not the shared one: build-rime-dict-io
    // makes and removes `pinyinduck-rime-` directories there too, from a test file running
    // in parallel, so counting the shared root before and after raced with it.
    const harness = writeStubHarness(tmp);
    const tmpRoot = path.join(tmp, 'tmp-root');
    fs.mkdirSync(tmpRoot);
    const saved = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP };
    process.env.TMPDIR = process.env.TMP = process.env.TEMP = tmpRoot;
    try {
      // Without these the check below passes whether or not anything is cleaned up: the
      // run has to stage into tmpRoot, and a skipped run stages nothing at all.
      expect(os.tmpdir()).toBe(tmpRoot);
      const result = run(harness);
      expect(result.ok).toBe(true);
      expect(result.skipped).toBe(false);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
    expect(fs.readdirSync(tmpRoot)).toEqual([]);
  });
});

describe('verifyRime without a built librime', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-rime-skip-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('skips, loudly, rather than passing when nothing can run', () => {
    // The default is a skip and not a pass because a contributor without a C++ toolchain
    // still runs this script, and a check that reports success without running anything is
    // worse than no check.
    const result = verifyRime({
      platform: 'windows',
      require: false,
      keepStaging: false,
      harnessPath: path.join(tmp, 'absent'),
      sharedDataDir: path.join(tmp, 'absent'),
      rimeDir: tmp,
    });
    expect(result.skipped).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/^Skipped: /);
  });

  it('fails the same case under --require, for a pre-merge gate', () => {
    const result = verifyRime({
      platform: 'windows',
      require: true,
      keepStaging: false,
      harnessPath: path.join(tmp, 'absent'),
      sharedDataDir: path.join(tmp, 'absent'),
      rimeDir: tmp,
    });
    expect(result.skipped).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('refuses to verify an unbuilt dictionary, and says how to build it', () => {
    // Running the harness against a missing dictionary produces an empty menu that looks
    // like a schema that returns nothing — the exact failure this whole script exists to
    // catch. It is caught earlier, here.
    const rimeDir = path.join(tmp, 'rime');
    fs.mkdirSync(rimeDir, { recursive: true });
    const sharedDataDir = path.join(tmp, 'minimal');
    fakeLibrimeData(sharedDataDir);
    const harness = path.join(tmp, 'rime_smoke');
    fs.writeFileSync(harness, '', 'utf8');

    const result = verifyRime({
      platform: 'windows',
      require: false,
      keepStaging: false,
      harnessPath: harness,
      sharedDataDir,
      rimeDir,
    });
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.output).toMatch(/npm run build:rime/);
  });

  it('refuses a folder with dictionaries but no schema, and names what is missing', () => {
    // What a pull from before the templates leaves behind: git deletes the once-tracked
    // schemas, while the ignored dictionaries from an earlier build stay on disk. Staged as
    // is, librime would deploy nothing and every query would fail with no hint why.
    const rimeDir = path.join(tmp, 'rime');
    fakeRimeDir(rimeDir);
    fs.rmSync(path.join(rimeDir, 'pinyinduck.schema.yaml'));
    fs.rmSync(path.join(rimeDir, 'lua/pinyinduck_gloss_filter.lua'));
    const sharedDataDir = path.join(tmp, 'minimal');
    fakeLibrimeData(sharedDataDir);
    const harness = path.join(tmp, 'rime_smoke');
    fs.writeFileSync(harness, '', 'utf8');

    const result = verifyRime({
      platform: 'windows',
      require: false,
      keepStaging: false,
      harnessPath: harness,
      sharedDataDir,
      rimeDir,
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('pinyinduck.schema.yaml');
    expect(result.output).toContain('lua/pinyinduck_gloss_filter.lua');
    expect(result.output).not.toContain('pinyinduck_trad.schema.yaml');
    expect(result.output).toMatch(/npm run build:rime/);
  });
});

describe('parseArgs', () => {
  it('defaults to a skip rather than a failure', () => {
    // Both flags are opt-in. A contributor without a C++ toolchain runs this on purpose,
    // and failing them for that would teach them not to run it.
    expect(parseArgs([])).toEqual({
      require: false,
      keepStaging: false,
      platforms: ['windows', 'macos'],
    });
  });

  it('narrows the run to one platform, and refuses one it does not know', () => {
    expect(parseArgs(['--platform', 'macos']).platforms).toEqual(['macos']);
    expect(() => parseArgs(['--platform', 'linux'])).toThrow(/Unknown platform "linux"/);
  });

  it('does not read the next flag as the platform', () => {
    // `--platform --require` once failed with `Unknown platform "--require"`.
    expect(parseArgs(['--platform', '--require'])).toEqual({
      require: true,
      keepStaging: false,
      platforms: ['windows', 'macos'],
    });
    expect(parseArgs(['--platform=macos']).platforms).toEqual(['macos']);
  });

  it('reads the two flags, and ignores anything it does not know', () => {
    // No "treat every argument as a path" fallback: a flag that quietly pointed the check
    // at some other dictionary would be a check that passes on the wrong file.
    expect(parseArgs(['--require', '--keep-staging'])).toEqual({
      require: true,
      keepStaging: true,
      platforms: ['windows', 'macos'],
    });
    expect(parseArgs(['--user-dir=/tmp/somewhere-else'])).toEqual({
      require: false,
      keepStaging: false,
      platforms: ['windows', 'macos'],
    });
  });
});

describe('main', () => {
  let tmp: string;
  let librimeData: string;
  let rimeDir: string;
  let logs: string[];

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-rime-main-'));
    librimeData = path.join(tmp, 'minimal');
    rimeDir = path.join(tmp, 'rime');
    fakeLibrimeData(librimeData);
    fakeRimeDir(rimeDir);
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '));
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const output = () => logs.join('\n');

  it('exits 0 and says what was proven, not merely that nothing broke', async () => {
    await main([], { harnessPath: writeStubHarness(tmp), sharedDataDir: librimeData, rimeDir });
    expect(process.exitCode).toBeUndefined();
    expect(output()).toMatch(/Verifying the PinyinDuck schemas with a real librime/);
    expect(output()).toMatch(/Rime accepts the dictionaries/);
    // Both platforms are checked by default, each pointed at its own README.
    expect(output()).toMatch(/packages\/windows\/README\.md/);
    expect(output()).toMatch(/packages\/macos\/README\.md/);
  });

  it('checks only the platform it is given', async () => {
    await main(['--platform', 'macos'], {
      harnessPath: writeStubHarness(tmp),
      sharedDataDir: librimeData,
      rimeDir,
    });
    expect(process.exitCode).toBeUndefined();
    expect(output()).toMatch(/packages\/macos\/README\.md/);
    expect(output()).not.toMatch(/packages\/windows\/README\.md/);
  });

  it('sets a failing exit code when a query is wrong', async () => {
    await main([], {
      harnessPath: writeStubHarness(tmp, { breakFor: 'lv' }),
      sharedDataDir: librimeData,
      rimeDir,
    });
    expect(process.exitCode).toBe(1);
    // The closing reassurance is for a run that proved something. On a failing run it would
    // be a lie printed underneath the failure.
    expect(output()).not.toMatch(/Rime accepts the dictionaries/);
  });

  it('says in words that a skip is not a pass, and still exits 0', async () => {
    // A CI log is read for exit codes. An exit 0 with no engine behind it is exactly the
    // kind of green that hides a broken dictionary, so the line is printed regardless.
    await main([], {
      harnessPath: path.join(tmp, 'absent'),
      sharedDataDir: path.join(tmp, 'absent'),
      rimeDir: tmp,
    });
    expect(process.exitCode).toBeUndefined();
    expect(output()).toMatch(/This is a skip, not a pass/);
    // The harness is shared, so one skip notice covers every platform.
    expect(output().match(/This is a skip, not a pass/g)).toHaveLength(1);
  });

  it('keeps the staged directories when asked, and removes them otherwise', async () => {
    const kept: string[] = [];
    const errors: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      kept.push(String(chunk));
      return true;
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.join(' '));
      return true;
    });

    await main(['--keep-staging'], {
      harnessPath: writeStubHarness(tmp),
      sharedDataDir: librimeData,
      rimeDir,
    });
    const paths = kept.join('\n').match(/\/tmp\/[^\s]+/g) ?? [];
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      // Left behind on purpose, so a failed run can be inspected rather than guessed at.
      // These two are the reason: 18MB of copied dictionaries, twice, per attempt.
      expect(fs.existsSync(p)).toBe(true);
      fs.rmSync(p, { recursive: true, force: true });
    }
  });
});
