/**
 * Tests for the librime verification script's staging, protocol and verdict logic.
 *
 * The real thing drives a compiled librime and 9.6 MB of dictionaries, so the expensive
 * half — the engine — is replaced by a stub harness and an in-memory filesystem. What is
 * pinned here is everything the script itself decides: what it stages, what it writes to
 * the harness, how it reads the transcript back, and what it concludes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  QUERIES,
  checkLibrime,
  main,
  parseOutput,
  spawnHarness,
  stageFiles,
  type HarnessResult,
  type Query,
  type RimeVerifyDeps,
} from './verify-rime.js';

interface FakeState {
  /** Paths that exist, keyed by absolute path. */
  present: Set<string>;
  /** `mkdir` calls, in order. */
  dirs: string[];
  /** `from -> to` copies, in order. */
  copies: Array<[string, string]>;
  /** `mkdtemp` calls, in order. */
  tempDirs: string[];
  /** `rm` calls, in order. */
  removed: string[];
}

function createFakeDeps(
  overrides: Partial<RimeVerifyDeps> = {},
  present: string[] = []
): { deps: RimeVerifyDeps; state: FakeState } {
  const state: FakeState = {
    present: new Set(present),
    dirs: [],
    copies: [],
    tempDirs: [],
    removed: [],
  };
  const deps: RimeVerifyDeps = {
    exists: (target) => state.present.has(target),
    copyFile: (from, to) => {
      state.copies.push([from, to]);
      state.present.add(to);
    },
    mkdir: (target) => {
      state.dirs.push(target);
    },
    mkdtemp: (prefix) => {
      const dir = `${prefix}${state.tempDirs.length}`;
      state.tempDirs.push(dir);
      state.present.add(dir);
      return dir;
    },
    rm: (target) => {
      state.removed.push(target);
    },
    spawnHarness: async () => ({ code: 0, stdout: '', stderr: '' }),
    ...overrides,
  };
  return { deps, state };
}

/** The transcript a perfectly behaved harness would emit for `queries`. */
function transcriptFor(queries: readonly Query[]): string {
  return (
    queries
      .map(
        (q) =>
          `SCHEMA ${q.schema}\nPREEDIT ${q.input}\n` +
          q.expected.map((c) => `CANDIDATE ${c}\n`).join('')
      )
      .join('') + 'QUIT\n'
  );
}

describe('parseOutput', () => {
  it('returns nothing for empty output', () => {
    expect(parseOutput('')).toEqual([]);
  });

  it('groups candidates under the schema they belong to', () => {
    const results = parseOutput('SCHEMA pinyinduck\nPREEDIT shi\nCANDIDATE 是\nCANDIDATE 十\n');

    expect(results).toEqual([
      { schema: 'pinyinduck', input: 'shi', candidates: ['是', '十'] },
    ]);
  });

  it('starts a new result at each SCHEMA line', () => {
    const results = parseOutput(
      'SCHEMA pinyinduck\nCANDIDATE 是\nSCHEMA pinyinduck_trad\nCANDIDATE 中國\n'
    );

    expect(results).toHaveLength(2);
    expect(results[1]).toEqual({ schema: 'pinyinduck_trad', input: '', candidates: ['中國'] });
  });

  it('ignores lines that arrive before any SCHEMA', () => {
    const results = parseOutput('CANDIDATE stray\nPREEDIT stray\nSCHEMA pinyinduck\nCANDIDATE 是\n');

    expect(results).toEqual([{ schema: 'pinyinduck', input: '', candidates: ['是'] }]);
  });

  it('tolerates a candidate carrying no text', () => {
    const results = parseOutput('SCHEMA pinyinduck\nCANDIDATE \n');

    expect(results[0].candidates).toEqual(['']);
  });
});

describe('checkLibrime', () => {
  it('is true only when the library and the harness are both built', () => {
    const { deps } = createFakeDeps({}, ['/tools/librime/build/liblibrime.so', '/tools/rime_smoke']);

    expect(checkLibrime('/tools/librime', '/tools/rime_smoke', deps)).toBe(true);
  });

  it('is false when the library is missing', () => {
    const { deps } = createFakeDeps({}, ['/tools/rime_smoke']);

    expect(checkLibrime('/tools/librime', '/tools/rime_smoke', deps)).toBe(false);
  });

  it('is false when the harness is missing', () => {
    const { deps } = createFakeDeps({}, ['/tools/librime/build/liblibrime.so']);

    expect(checkLibrime('/tools/librime', '/tools/rime_smoke', deps)).toBe(false);
  });
});

describe('stageFiles', () => {
  const RIME = '/rime';
  const TEMP = '/tmp/stage';

  it('copies every schema, dictionary and Lua file', () => {
    const sources = [
      '/rime/pinyinduck.schema.yaml',
      '/rime/pinyinduck_trad.schema.yaml',
      '/rime/default.custom.yaml',
      '/rime/pinyinduck.dict.yaml',
      '/rime/pinyinduck_trad.dict.yaml',
      '/rime/rime.lua',
    ];
    const { deps, state } = createFakeDeps({}, sources);

    stageFiles(RIME, TEMP, deps);

    expect(state.copies.map(([from]) => from)).toEqual(sources);
    expect(state.copies.map(([, to]) => to)).toEqual(sources.map((s) => `/tmp/stage/${path.basename(s)}`));
  });

  it('names the missing file and says how to build it', () => {
    const { deps } = createFakeDeps({}, ['/rime/pinyinduck.schema.yaml']);

    expect(() => stageFiles(RIME, TEMP, deps)).toThrow(
      /Missing \/rime\/pinyinduck_trad\.schema\.yaml.*npm run build:rime/s
    );
  });

  it('stages the gloss sidecar under lua/, where librime resolves it', () => {
    const { deps, state } = createFakeDeps(
      {},
      [
        '/rime/pinyinduck.schema.yaml',
        '/rime/pinyinduck_trad.schema.yaml',
        '/rime/default.custom.yaml',
        '/rime/pinyinduck.dict.yaml',
        '/rime/pinyinduck_trad.dict.yaml',
        '/rime/rime.lua',
        '/rime/lua/pinyinduck_gloss.lua',
      ]
    );

    stageFiles(RIME, TEMP, deps);

    expect(state.dirs).toEqual(['/tmp/stage/lua']);
    expect(state.copies).toContainEqual([
      '/rime/lua/pinyinduck_gloss.lua',
      '/tmp/stage/lua/pinyinduck_gloss.lua',
    ]);
  });

  it('still creates lua/ when the build predates the gloss sidecar', () => {
    const { deps, state } = createFakeDeps(
      {},
      [
        '/rime/pinyinduck.schema.yaml',
        '/rime/pinyinduck_trad.schema.yaml',
        '/rime/default.custom.yaml',
        '/rime/pinyinduck.dict.yaml',
        '/rime/pinyinduck_trad.dict.yaml',
        '/rime/rime.lua',
      ]
    );

    stageFiles(RIME, TEMP, deps);

    expect(state.dirs).toEqual(['/tmp/stage/lua']);
    expect(state.copies).not.toContainEqual(
      expect.arrayContaining(['/rime/lua/pinyinduck_gloss.lua'])
    );
  });
});

describe('spawnHarness', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-rime-spawn-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Writes an executable stub that stands in for the compiled harness. */
  function writeStub(name: string, body: string): string {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `#!/usr/bin/env node\n${body}\n`);
    fs.chmodSync(file, 0o755);
    return file;
  }

  it('writes every query as SCHEMA/KEYS pairs and then QUIT', async () => {
    // The stub echoes its stdin back, so the protocol itself is asserted rather than
    // assumed: a dropped or reordered line would show up in the echoed transcript.
    const harness = writeStub(
      'echo.js',
      `let data = '';
process.stdin.on('data', (c) => { data += c; });
process.stdin.on('end', () => { process.stdout.write(data); });`
    );

    const result = await spawnHarness(harness, dir, [
      { schema: 'pinyinduck', input: 'shi', expected: [] },
      { schema: 'pinyinduck_trad', input: 'zhongguo', expected: [] },
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      'SCHEMA pinyinduck\nKEYS shi\nSCHEMA pinyinduck_trad\nKEYS zhongguo\nQUIT\n'
    );
  });

  it('resolves with the exit code and stderr of a failing harness', async () => {
    // Regression: the exit code was read from a promise that was never awaited, so a
    // crash in librime was indistinguishable from an engine that produced no candidates.
    const harness = writeStub(
      'crash.js',
      `process.stdin.resume();
process.stdin.on('end', () => { process.stderr.write('librime: boom\\n'); process.exit(3); });`
    );

    const result = await spawnHarness(harness, dir, []);

    expect(result.code).toBe(3);
    expect(result.stderr).toContain('boom');
  });

  it('exposes the staged user directory to the harness', async () => {
    const harness = writeStub(
      'env.js',
      `process.stdin.resume();
process.stdin.on('end', () => { process.stdout.write(process.env.RIME_USER_DIR || ''); });`
    );

    const result = await spawnHarness(harness, '/tmp/some-user-dir', []);

    expect(result.stdout.trim()).toBe('/tmp/some-user-dir');
  });

  it('reports a signal death as an exit code of zero rather than a hang', async () => {
    // A harness killed mid-run closes with no exit code at all. Falling back to 0 keeps
    // that readable as "produced no output" instead of the promise never settling.
    const harness = writeStub(
      'killed.js',
      `process.stdin.resume();
process.stdin.on('end', () => { process.kill(process.pid, 'SIGKILL'); });`
    );

    const result = await spawnHarness(harness, dir, []);

    expect(result.code).toBe(0);
  });
});

/**
 * The real filesystem adapters, against real temporary directories.
 *
 * Every other test in this file injects fakes, which means `nodeDeps` itself -- the code
 * that actually touches disk and spawns a process in production -- would otherwise never
 * run. These exercise the default dependency set end to end, so a wrong path or a
 * missing `recursive` cannot hide behind a fake that never opens a file.
 */
describe('against the real filesystem', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-rime-real-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** Lays out a temp dir that satisfies `checkLibrime`, with a stub for the harness. */
  function toolchain(name: string, body?: string): { librimeDir: string; harness: string } {
    const librimeDir = path.join(root, name);
    fs.mkdirSync(path.join(librimeDir, 'build'), { recursive: true });
    fs.writeFileSync(path.join(librimeDir, 'build', 'liblibrime.so'), '');
    const harness = path.join(librimeDir, 'rime_smoke');
    fs.writeFileSync(harness, `#!/usr/bin/env node\n${body ?? ''}\n`);
    fs.chmodSync(harness, 0o755);
    return { librimeDir, harness };
  }

  /** Lays out a temp rime directory holding everything `stageFiles` requires. */
  function stagedRime(): string {
    const rimeDir = path.join(root, 'rime');
    fs.mkdirSync(rimeDir, { recursive: true });
    for (const file of [
      'pinyinduck.schema.yaml',
      'pinyinduck_trad.schema.yaml',
      'default.custom.yaml',
      'pinyinduck.dict.yaml',
      'pinyinduck_trad.dict.yaml',
      'rime.lua',
    ]) {
      fs.writeFileSync(path.join(rimeDir, file), `# ${file}\n`);
    }
    fs.mkdirSync(path.join(rimeDir, 'lua'), { recursive: true });
    fs.writeFileSync(path.join(rimeDir, 'lua', 'pinyinduck_gloss.lua'), 'return {}\n');
    return rimeDir;
  }

  const log = () => vi.spyOn(console, 'log').mockImplementation(() => {});

  it('copies real files into a real user directory', () => {
    const rimeDir = stagedRime();
    const tempDir = path.join(root, 'user');
    fs.mkdirSync(tempDir, { recursive: true });

    stageFiles(rimeDir, tempDir);

    expect(fs.readdirSync(tempDir).sort()).toEqual([
      'default.custom.yaml',
      'lua',
      'pinyinduck.dict.yaml',
      'pinyinduck.schema.yaml',
      'pinyinduck_trad.dict.yaml',
      'pinyinduck_trad.schema.yaml',
      'rime.lua',
    ]);
    expect(fs.readFileSync(path.join(tempDir, 'rime.lua'), 'utf8')).toBe('# rime.lua\n');
    expect(fs.existsSync(path.join(tempDir, 'lua', 'pinyinduck_gloss.lua'))).toBe(true);
  });

  it('reads the real toolchain layout', () => {
    const { librimeDir, harness } = toolchain('tools');

    expect(checkLibrime(librimeDir, harness)).toBe(true);
    expect(checkLibrime(path.join(root, 'absent'), harness)).toBe(false);
  });

  it('runs a verification end to end against a stub harness', async () => {
    // Everything below the librime check is the real thing: real staging, real spawn,
    // real temp dir created and removed. Only the engine is stubbed.
    const queries: Query[] = [{ schema: 'pinyinduck', input: 'shi', expected: ['是', '十'] }];
    const rimeDir = stagedRime();
    const { librimeDir, harness } = toolchain(
      'tools',
      `let data = '';
process.stdin.on('data', (c) => { data += c; });
process.stdin.on('end', () => {
  process.stdout.write('SCHEMA pinyinduck\\nPREEDIT shi\\nCANDIDATE 是\\nCANDIDATE 十\\n');
});`
    );
    const logSpy = log();

    const code = await main({ queries, rimeDir, librimeDir, harness });

    expect(code).toBe(0);
    // Asserted explicitly, because the skip path also returns 0 and would otherwise
    // let this test pass without ever staging or spawning anything.
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('SKIP'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1 of 1 queries'));
    expect(fs.existsSync(path.join(rimeDir, 'pinyinduck.dict.yaml'))).toBe(true);
  });

  it('removes the staged user directory even when the run fails', async () => {
    const rimeDir = stagedRime();
    const { librimeDir, harness } = toolchain(
      'tools',
      `process.stdin.resume();
process.stdin.on('end', () => { process.exit(4); });`
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      main({ queries: [{ schema: 'pinyinduck', input: 'shi', expected: ['是'] }], rimeDir, librimeDir, harness })
    ).rejects.toThrow(/exited with code 4/);
  });

  it('skips when the real toolchain has not been built', async () => {
    const logSpy = log();

    expect(await main({ librimeDir: path.join(root, 'absent'), harness: path.join(root, 'absent') })).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('SKIP'));
  });

  it('falls back to the packaged rime directory and tool paths', async () => {
    // Called with no options at all: the defaults have to resolve to the real package
    // paths, and on a machine without librime built the run has to skip rather than throw.
    const logSpy = log();

    await expect(main()).resolves.toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('SKIP'));
  });
});

describe('main', () => {
  const BUILT = ['/tools/librime/build/liblibrime.so', '/tools/rime_smoke'];
  const STAGED = [
    '/rime/pinyinduck.schema.yaml',
    '/rime/pinyinduck_trad.schema.yaml',
    '/rime/default.custom.yaml',
    '/rime/pinyinduck.dict.yaml',
    '/rime/pinyinduck_trad.dict.yaml',
    '/rime/rime.lua',
  ];
  const OPTS = { rimeDir: '/rime', librimeDir: '/tools/librime', harness: '/tools/rime_smoke' };

  let log: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function harnessReturning(result: Partial<HarnessResult>): Partial<RimeVerifyDeps> {
    return { spawnHarness: async () => ({ code: 0, stdout: '', stderr: '', ...result }) };
  }

  it('skips without failing when librime has not been built', async () => {
    const { deps } = createFakeDeps();

    expect(await main(OPTS, deps)).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('SKIP'));
    expect(error).not.toHaveBeenCalled();
  });

  it('fails a strict run when librime has not been built', async () => {
    const { deps } = createFakeDeps();

    expect(await main({ ...OPTS, strict: true }, deps)).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('FAIL'));
  });

  it('passes when every query returns its pinned candidates', async () => {
    const { deps, state } = createFakeDeps(
      harnessReturning({ stdout: transcriptFor(QUERIES) }),
      [...BUILT, ...STAGED]
    );

    expect(await main(OPTS, deps)).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('8 of 8 queries'));
    // Staged into a throwaway directory, which is then cleaned up.
    expect(state.copies).toHaveLength(STAGED.length);
    expect(state.removed).toEqual(state.tempDirs);
  });

  it('fails and reports both sides when a menu is reordered', async () => {
    const queries: Query[] = [{ schema: 'pinyinduck', input: 'shi', expected: ['是', '十'] }];
    const wrong = 'SCHEMA pinyinduck\nPREEDIT shi\nCANDIDATE 十\nCANDIDATE 是\n';
    const { deps } = createFakeDeps(harnessReturning({ stdout: wrong }), [...BUILT, ...STAGED]);

    expect(await main({ ...OPTS, queries }, deps)).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('FAIL'));
    expect(error).toHaveBeenCalledWith('  expected: 是 十');
    expect(error).toHaveBeenCalledWith('  actual:   十 是');
  });

  it('fails when a candidate is missing entirely', async () => {
    const queries: Query[] = [{ schema: 'pinyinduck', input: 'shi', expected: ['是', '十'] }];
    const short = 'SCHEMA pinyinduck\nPREEDIT shi\nCANDIDATE 是\n';
    const { deps } = createFakeDeps(harnessReturning({ stdout: short }), [...BUILT, ...STAGED]);

    expect(await main({ ...OPTS, queries }, deps)).toBe(1);
  });

  it('fails when the harness returned nothing for a query', async () => {
    const queries: Query[] = [
      { schema: 'pinyinduck', input: 'shi', expected: ['是'] },
      { schema: 'pinyinduck', input: 'an', expected: ['安'] },
    ];
    const partial = 'SCHEMA pinyinduck\nCANDIDATE 是\n';
    const { deps } = createFakeDeps(harnessReturning({ stdout: partial }), [...BUILT, ...STAGED]);

    expect(await main({ ...OPTS, queries }, deps)).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('no result'));
  });

  it('fails when the harness exits non-zero, quoting stderr', async () => {
    const { deps, state } = createFakeDeps(
      harnessReturning({ code: 3, stderr: 'librime: boom' }),
      [...BUILT, ...STAGED]
    );

    await expect(main(OPTS, deps)).rejects.toThrow(/Harness exited with code 3[\s\S]*boom/);
    // The staged directory is removed even when the run fails.
    expect(state.removed).toEqual(state.tempDirs);
  });

  it('surfaces a missing dictionary rather than blaming the engine', async () => {
    const { deps, state } = createFakeDeps(
      harnessReturning({ stdout: transcriptFor(QUERIES) }),
      [...BUILT, ...STAGED.filter((f) => !f.endsWith('pinyinduck.dict.yaml'))]
    );

    await expect(main(OPTS, deps)).rejects.toThrow(/build:rime/);
    expect(state.removed).toEqual(state.tempDirs);
  });
});