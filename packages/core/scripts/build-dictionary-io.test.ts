/**
 * Covers the download, cache and file-writing half of the dictionary builder.
 *
 * These paths are the only ones that touch the network and the filesystem, so they
 * are exercised against an in-memory `fs` and a stubbed `fetch` rather than a real
 * download. The pure parsing and joining logic is covered in build-dictionary.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as zlib from 'zlib';
import * as path from 'path';

const { fileStore, dirStore } = vi.hoisted(() => ({
  fileStore: new Map<string, string | Uint8Array>(),
  dirStore: new Set<string>(),
}));

// The builder writes either a JSON string or a binary B-tree buffer, so the fake
// filesystem has to keep both shapes rather than stringifying everything.
vi.mock('fs', () => ({
  existsSync: (p: string) => fileStore.has(p),
  readFileSync: (p: string) => {
    const content = fileStore.get(p);
    if (content === undefined) throw new Error(`ENOENT: ${p}`);
    return content;
  },
  writeFileSync: (p: string, data: string | Uint8Array) => {
    fileStore.set(p, typeof data === 'string' ? data : new Uint8Array(data));
  },
  mkdirSync: (p: string) => {
    dirStore.add(p);
  },
}));

import { build, parseArgs, SOURCE_URLS, type BuildStats } from './build-dictionary';
import { openBTreeDictionaryFromSource } from '../src/data/btree-dictionary';
import { MemoryPageSource } from '../src/data/page-source';
import { LazyPinyinSearchEngine } from '../src/index/lazy-search';

const CACHE_DIR = path.resolve(__dirname, '../.cache');
const CACHE_FILES = {
  cedict: path.join(CACHE_DIR, 'cedict.txt'),
  frequency: path.join(CACHE_DIR, 'zh_cn_50k.txt'),
  hsk: path.join(CACHE_DIR, 'hsk.csv'),
} as const;

const CEDICT = ['中國 中国 [Zhong1 guo2] /China/', '你好 你好 [Ni3 hao3] /hello/'].join('\n');
const FREQUENCY = '中国 7000\n你好 5000\n';
const HSK = ['1\t1\t你\tyou', '1\t1\t你好\tyouhao', '2\t2\t中国\tchina'].join('\n');

/** The written asset as text, for the JSON format. */
function readText(p: string): string {
  const content = fileStore.get(p);
  if (content === undefined) throw new Error(`missing asset: ${p}`);
  return typeof content === 'string' ? content : Buffer.from(content).toString('utf8');
}

/** The written asset as bytes, for the B-tree format. */
function readBytes(p: string): Uint8Array {
  const content = fileStore.get(p);
  if (content === undefined) throw new Error(`missing asset: ${p}`);
  return typeof content === 'string' ? new TextEncoder().encode(content) : content;
}

/** Minimal stand-in for the parts of `Response` that `fetchWithCache` reads. */
function stubResponse(body: string, init: { gzipped?: boolean } = {}) {
  const buffer = Buffer.from(body, 'utf8');
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => body,
    arrayBuffer: async () => {
      const gz = init.gzipped ? zlib.gzipSync(buffer) : buffer;
      return gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) as ArrayBuffer;
    },
  };
}

/** Routes each source URL to its fixture body, and records every call. */
function installFetch(handlers: Record<string, () => unknown>) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    calls.push(url);
    const handler = handlers[url];
    if (!handler) throw new Error(`unexpected fetch: ${url}`);
    return handler();
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

const defaultHandlers = () => ({
  [SOURCE_URLS.cedict]: () => stubResponse(CEDICT, { gzipped: true }),
  [SOURCE_URLS.frequency]: () => stubResponse(FREQUENCY),
  [SOURCE_URLS.hsk]: () => stubResponse(HSK),
});

/** Seeds the on-disk cache as if a previous build had downloaded the sources. */
function seedCache() {
  fileStore.set(CACHE_FILES.cedict, CEDICT);
  fileStore.set(CACHE_FILES.frequency, FREQUENCY);
  fileStore.set(CACHE_FILES.hsk, HSK);
}

let logs: string[];
let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fileStore.clear();
  dirStore.clear();
  logs = [];
  consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.join(' '));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  consoleSpy.mockRestore();
});

describe('build', () => {
  it('downloads all three sources and writes the joined rows to the output path', async () => {
    const calls = installFetch(defaultHandlers());
    const out = '/tmp/pinyinduck-test/dictionary.json';

    const stats: BuildStats = await build(out, false, 'json');

    expect(calls).toEqual(
      expect.arrayContaining([SOURCE_URLS.cedict, SOURCE_URLS.frequency, SOURCE_URLS.hsk])
    );
    const rows = JSON.parse(readText(out));
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toBe('中国');
    expect(stats.emitted).toBe(2);
    expect(stats.cedictLines).toBe(2);
  });

  it('creates the output directory before writing the asset', async () => {
    installFetch(defaultHandlers());
    const out = '/tmp/pinyinduck-nested/deeply/dictionary.json';

    await build(out, false);

    expect(dirStore.has('/tmp/pinyinduck-nested/deeply')).toBe(true);
    expect(fileStore.has(out)).toBe(true);
  });

  it('gunzips the CC-CEDICT download rather than treating it as plain text', async () => {
    installFetch(defaultHandlers());
    const out = '/tmp/pinyinduck-gzip/dictionary.json';

    await build(out, false, 'json');

    // A binary gzip payload parsed as UTF-8 would yield no usable CC-CEDICT lines.
    expect(JSON.parse(readText(out))).toHaveLength(2);
  });

  it('caches every downloaded source for the next build', async () => {
    installFetch(defaultHandlers());

    await build('/tmp/pinyinduck-cache/dictionary.json', false);

    expect(fileStore.get(CACHE_FILES.cedict)).toBe(CEDICT);
    expect(fileStore.get(CACHE_FILES.frequency)).toBe(FREQUENCY);
    expect(fileStore.get(CACHE_FILES.hsk)).toBe(HSK);
  });

  it('reads through the cache without hitting the network when sources are present', async () => {
    seedCache();
    const calls = installFetch(defaultHandlers());

    const stats = await build('/tmp/pinyinduck-hit/dictionary.json', true, 'json');

    expect(calls).toEqual([]);
    expect(stats.emitted).toBe(2);
    expect(logs.join('\n')).toContain('cached  cedict.txt');
  });

  it('re-downloads instead of reading the cache when caching is disabled', async () => {
    seedCache();
    const calls = installFetch(defaultHandlers());

    await build('/tmp/pinyinduck-stale/dictionary.json', false);

    expect(calls).toHaveLength(3);
    expect(logs.join('\n')).not.toContain('cached  cedict.txt');
  });

  it('downloads only the sources that are missing from the cache', async () => {
    fileStore.set(CACHE_FILES.hsk, HSK);
    const calls = installFetch(defaultHandlers());

    const stats = await build('/tmp/pinyinduck-partial/dictionary.json', true);

    expect(calls).toEqual(expect.arrayContaining([SOURCE_URLS.cedict, SOURCE_URLS.frequency]));
    expect(calls).not.toContain(SOURCE_URLS.hsk);
    expect(stats.emitted).toBe(2);
  });

  it('fails loudly when a source cannot be downloaded', async () => {
    installFetch({
      ...defaultHandlers(),
      [SOURCE_URLS.hsk]: () => ({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => '',
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    });

    await expect(build('/tmp/pinyinduck-missing/dictionary.json', false)).rejects.toThrow(
      /Failed to download .*hsk\.csv: 404 Not Found/
    );
  });

  it('does not write a partial asset when a source fails', async () => {
    installFetch({
      ...defaultHandlers(),
      [SOURCE_URLS.cedict]: () => ({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        text: async () => '',
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    });
    const out = '/tmp/pinyinduck-partial-write/dictionary.json';

    await expect(build(out, false)).rejects.toThrow(/500 Server Error/);
    expect(fileStore.has(out)).toBe(false);
  });

  it('refuses to emit an asset when a source contains an unparsable pinyin column', async () => {
    installFetch({
      ...defaultHandlers(),
      [SOURCE_URLS.cedict]: () => stubResponse('中 中 [1] /middle/', { gzipped: true }),
    });
    const out = '/tmp/pinyinduck-invalid/dictionary.json';

    await expect(build(out, false)).rejects.toThrow(/unparsable pinyin/);
    expect(fileStore.has(out)).toBe(false);
  });

  it('reports the corpus sizes it joined', async () => {
    installFetch(defaultHandlers());

    await build('/tmp/pinyinduck-stats/dictionary.json', false, 'json');

    const output = logs.join('\n');
    expect(output).toContain('2 frequency entries');
    expect(output).toContain('3 HSK words');
    expect(output).toContain('0 single characters');
  });

  it('writes a searchable B-tree asset by default rather than JSON', async () => {
    installFetch(defaultHandlers());
    const out = '/tmp/pinyinduck-default/dictionary.btree';

    await build(out, false);

    // The payload is binary, not a JSON document.
    expect(readBytes(out)[0]).not.toBe('['.charCodeAt(0));

    const dictionary = await openBTreeDictionaryFromSource(
      new MemoryPageSource(readBytes(out))
    );
    const engine = new LazyPinyinSearchEngine(dictionary);
    const result = await engine.search('nihao', { limit: 5 });

    expect(dictionary.entryCount).toBe(2);
    // The fixture has no 你 entry, so the only "nihao" reading is the two-character
    // word. It still has to outrank nothing else and be reachable by key.
    expect(result.candidates.map((c) => c.hanzi)).toEqual(['你好']);
    expect(logs.join('\n')).toContain('B+ tree: a client reads only the header');
  });

  it('round-trips both entries through the B-tree with their frequency and HSK level', async () => {
    // Two rows is too few to force a multi-level tree, so a broken fan-out would pass
    // unnoticed; the assertions below cover the header counts the reader trusts.
    installFetch(defaultHandlers());
    const out = '/tmp/pinyinduck-roundtrip/dictionary.btree';

    await build(out, false);

    const dictionary = await openBTreeDictionaryFromSource(
      new MemoryPageSource(readBytes(out))
    );
    expect(dictionary.pageCount).toBeGreaterThan(0);

    const china = await dictionary.lookupExact('zhongguo');
    expect(china).toHaveLength(1);
    expect(china[0].simplified).toBe('中国');
    expect(china[0].traditional).toBe('中國');
    expect(china[0].hskLevel).toBe(2);
    // 中国 is the busiest word in the fixture corpus, so it anchors the frequency scale.
    expect(china[0].frequency).toBe(100000);

    const nihao = await dictionary.lookupExact('nihao');
    expect(nihao[0].simplified).toBe('你好');
    expect(nihao[0].hskLevel).toBe(1);
    expect(nihao[0].frequency).toBeGreaterThan(0);
    expect(nihao[0].frequency).toBeLessThan(china[0].frequency);
  });
});

describe('parseArgs', () => {
  const defaultBtree = path.resolve(__dirname, '../../web/public/dictionary.btree');
  const defaultJson = path.resolve(__dirname, '../../web/public/dictionary.json');

  it('does not read the first argument as a format when --format is absent', () => {
    expect(parseArgs(['json'])).toEqual({ outPath: defaultBtree, useCache: true, format: 'btree' });
    expect(parseArgs(['json', '--no-cache'])).toEqual({
      outPath: defaultBtree,
      useCache: false,
      format: 'btree',
    });
  });

  it('accepts an explicit --format btree', () => {
    expect(parseArgs(['--format', 'btree'])).toEqual({
      outPath: defaultBtree,
      useCache: true,
      format: 'btree',
    });
  });

  it('defaults to the B-tree web asset path and the download cache', () => {
    expect(parseArgs([])).toEqual({ outPath: defaultBtree, useCache: true, format: 'btree' });
  });

  it('honours --no-cache', () => {
    expect(parseArgs(['--no-cache'])).toEqual({
      outPath: defaultBtree,
      useCache: false,
      format: 'btree',
    });
  });

  it('honours --out', () => {
    expect(parseArgs(['--out', '/tmp/custom.btree'])).toEqual({
      outPath: '/tmp/custom.btree',
      useCache: true,
      format: 'btree',
    });
  });

  it('combines --out with --no-cache', () => {
    expect(parseArgs(['--out', '/tmp/custom.btree', '--no-cache'])).toEqual({
      outPath: '/tmp/custom.btree',
      useCache: false,
      format: 'btree',
    });
  });

  it('falls back to the default path when --out is the final argument', () => {
    expect(parseArgs(['--out'])).toEqual({
      outPath: defaultBtree,
      useCache: true,
      format: 'btree',
    });
  });

  it('consumes the argument after --out verbatim', () => {
    // --out takes the next argument whatever it looks like, so a following flag is
    // read as the path rather than being skipped.
    expect(parseArgs(['--out', '--no-cache'])).toEqual({
      outPath: '--no-cache',
      useCache: false,
      format: 'btree',
    });
  });

  it('uses the first --out when it is repeated', () => {
    expect(parseArgs(['--out', '/tmp/first.btree', '--out', '/tmp/second.btree']).outPath).toBe(
      '/tmp/first.btree'
    );
  });

  it('switches the default output to JSON when --format json is given', () => {
    // The default path has to follow the format, otherwise a JSON build would land on
    // top of the B-tree asset the web app reads.
    expect(parseArgs(['--format', 'json'])).toEqual({
      outPath: defaultJson,
      useCache: true,
      format: 'json',
    });
  });

  it('keeps an explicit --out when --format json is given', () => {
    expect(parseArgs(['--format', 'json', '--out', '/tmp/custom.json'])).toEqual({
      outPath: '/tmp/custom.json',
      useCache: true,
      format: 'json',
    });
  });

  it('falls back to the B-tree format for an unknown --format value', () => {
    // An unrecognized format must not silently produce a different asset layout.
    expect(parseArgs(['--format', 'protobuf'])).toEqual({
      outPath: defaultBtree,
      useCache: true,
      format: 'btree',
    });
    expect(parseArgs(['--format'])).toEqual({
      outPath: defaultBtree,
      useCache: true,
      format: 'btree',
    });
  });
});

/**
 * The `import.meta.url === file://${process.argv[1]}` guard is evaluated at import
 * time, so exercising it means setting argv before a fresh dynamic import. That runs
 * `main()` for real, which is the point: it is the only path that actually parses a
 * command line and reports a failure to the shell.
 */
describe('command line entry point', () => {
  const scriptPath = path.join(__dirname, 'build-dictionary.ts');
  let originalArgv: string[];
  let originalExitCode: number | string | null | undefined;

  beforeEach(() => {
    originalArgv = process.argv;
    originalExitCode = process.exitCode;
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    vi.resetModules();
  });

  /** Imports the module as though it had been run as `node <scriptPath> <args>`. */
  async function runAsScript(args: string[]): Promise<void> {
    process.argv = [process.execPath, scriptPath, ...args];
    vi.resetModules();
    await import('./build-dictionary.js');
  }

  /** Lets the un-awaited main() promise settle. */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('writes the asset to the path given by --out', async () => {
    installFetch(defaultHandlers());
    const out = '/tmp/pinyinduck-cli/dictionary.json';

    await runAsScript(['--out', out, '--format', 'json']);
    await flush();

    const rows = JSON.parse(readText(out));
    expect(rows).toHaveLength(2);
    expect(process.exitCode).toBe(originalExitCode);
  });

  it('writes a B-tree asset when no format is requested', async () => {
    installFetch(defaultHandlers());
    const out = '/tmp/pinyinduck-cli/dictionary.btree';

    await runAsScript(['--out', out]);
    await flush();

    // Readable straight back as a B-tree, so the CLI's default really is the format
    // the web app expects rather than a JSON document named .btree.
    const dictionary = await openBTreeDictionaryFromSource(
      new MemoryPageSource(readBytes(out))
    );
    expect(dictionary.entryCount).toBe(2);
    expect(process.exitCode).toBe(originalExitCode);
  });

  it('reads through the cache by default', async () => {
    seedCache();
    const calls = installFetch(defaultHandlers());
    const out = '/tmp/pinyinduck-cli-cached/dictionary.json';

    await runAsScript(['--out', out]);
    await flush();

    expect(calls).toEqual([]);
    expect(fileStore.has(out)).toBe(true);
    expect(readBytes(out)[0]).not.toBe('['.charCodeAt(0));
  });

  it('reports a download failure and sets a failing exit code', async () => {
    const errors: unknown[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args[0]);
    });
    installFetch({
      ...defaultHandlers(),
      [SOURCE_URLS.hsk]: () => ({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: async () => '',
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    });

    await runAsScript(['--out', '/tmp/pinyinduck-cli-fail/dictionary.json']);
    await flush();

    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toMatch(/503 Service Unavailable/);
    expect(process.exitCode).toBe(1);
  });
});
