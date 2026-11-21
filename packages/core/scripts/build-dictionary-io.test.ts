/**
 * Covers the source-reading, cache and file-writing half of the dictionary builder.
 *
 * These paths are the only ones that touch the network and the filesystem, so they
 * are exercised against an in-memory `fs` and a stubbed `fetch` rather than a real
 * download. The pure parsing and joining logic is covered in build-dictionary.test.ts.
 *
 * `./sources` is mocked so the pins are the fixtures' own hashes: the real pins name the
 * real corpora, which no fixture could match, and the verification is part of what is
 * under test here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import { gunzipSync } from 'zlib';

const { fileStore, dirStore, CEDICT, FREQUENCY, HSK } = vi.hoisted(() => ({
  fileStore: new Map<string, string | Uint8Array>(),
  dirStore: new Set<string>(),
  CEDICT: ['中國 中国 [Zhong1 guo2] /China/', '你好 你好 [Ni3 hao3] /hello/'].join('\n'),
  FREQUENCY: '中国 7000\n你好 5000\n',
  HSK: ['1\t1\t你\tyou', '1\t1\t你好\tyouhao', '2\t2\t中国\tchina'].join('\n'),
}));

vi.mock('./sources', async () => {
  const { createHash } = await import('crypto');
  const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
  return {
    SOURCES: {
      cedict: { file: 'data/cedict.txt', sha256: hash(CEDICT) },
      frequency: { url: 'https://example.test/zh_cn_50k.txt', cacheName: 'zh_cn_50k.txt', sha256: hash(FREQUENCY) },
      hsk: { url: 'https://example.test/hsk.csv', cacheName: 'hsk.csv', sha256: hash(HSK) },
    },
  };
});

// Sources are read back as text and the asset is written as a binary B-tree buffer, so
// the fake filesystem keeps both shapes rather than stringifying everything.
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

import { build, parseArgs, sha256, SOURCE_URLS, type BuildStats } from './build-dictionary';
import { SOURCES } from './sources';
import { BTreeDictionary } from '../src/data/btree-dictionary';
import { LazyPinyinSearchEngine } from '../src/index/lazy-search';
import { DetailFile } from '../src/detail/detail-codec';

const CACHE_DIR = path.resolve(__dirname, '../.cache');
/** Where the mocked CC-CEDICT pin points: the committed copy, never downloaded. */
const CEDICT_FILE = path.resolve(__dirname, '../data/cedict.txt');
const CACHE_FILES = {
  frequency: path.join(CACHE_DIR, 'zh_cn_50k.txt'),
  hsk: path.join(CACHE_DIR, 'hsk.csv'),
} as const;

/** The mocked pins, restored after a test that re-pins one. */
const PINNED_HASHES = Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, v.sha256]));

/** The written asset as bytes. */
function readBytes(p: string): Uint8Array {
  const content = fileStore.get(p);
  if (content === undefined) throw new Error(`missing asset: ${p}`);
  return typeof content === 'string' ? new TextEncoder().encode(content) : content;
}

/** Opens the written asset as a B-tree dictionary. */
function openAsset(p: string) {
  return BTreeDictionary.open(readBytes(p));
}

/** Minimal stand-in for the parts of `Response` that `readPinned` reads. */
function stubResponse(body: string) {
  return { ok: true, status: 200, statusText: 'OK', text: async () => body };
}

/** A failed response with the given status. */
function failedResponse(status: number, statusText: string) {
  return { ok: false, status, statusText, text: async () => '' };
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
  [SOURCE_URLS.frequency]: () => stubResponse(FREQUENCY),
  [SOURCE_URLS.hsk]: () => stubResponse(HSK),
});

/** Seeds the on-disk cache as if a previous build had downloaded the sources. */
function seedCache() {
  fileStore.set(CACHE_FILES.frequency, FREQUENCY);
  fileStore.set(CACHE_FILES.hsk, HSK);
}

let logs: string[];
let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fileStore.clear();
  dirStore.clear();
  // The committed CC-CEDICT is part of every checkout.
  fileStore.set(CEDICT_FILE, CEDICT);
  logs = [];
  consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.join(' '));
  });
});

afterEach(() => {
  for (const [key, hash] of Object.entries(PINNED_HASHES)) {
    (SOURCES as Record<string, { sha256: string }>)[key].sha256 = hash;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  consoleSpy.mockRestore();
});

describe('build', () => {
  it('reads the committed CC-CEDICT, downloads the other two and writes the joined rows', async () => {
    const calls = installFetch(defaultHandlers());
    const out = '/tmp/pinyinduck-test/dictionary.btree';

    const stats: BuildStats = await build(out, false);

    expect(calls.sort()).toEqual([SOURCE_URLS.frequency, SOURCE_URLS.hsk].sort());
    expect(logs.join('\n')).toContain('local   data/cedict.txt');
    const dictionary = openAsset(out);
    expect(dictionary.entryCount).toBe(2);
    expect(dictionary.lookupExact('zhongguo')[0].simplified).toBe('中国');
    expect(stats.emitted).toBe(2);
    expect(stats.cedictLines).toBe(2);
  });

  it('creates the output directory before writing the asset', async () => {
    installFetch(defaultHandlers());
    const out = '/tmp/pinyinduck-nested/deeply/dictionary.btree';

    await build(out, false);

    expect(dirStore.has('/tmp/pinyinduck-nested/deeply')).toBe(true);
    expect(fileStore.has(out)).toBe(true);
  });

  it('refuses a committed CC-CEDICT that no longer matches its pin', async () => {
    // What a checkout that converted line endings would hand the build.
    fileStore.set(CEDICT_FILE, CEDICT.replace(/\n/g, '\r\n'));
    installFetch(defaultHandlers());
    const out = '/tmp/pinyinduck-vendored-mismatch/dictionary.btree';

    const failure = build(out, false);

    await expect(failure).rejects.toThrow(/packages\/core\/data\/cedict\.txt does not match its pinned SHA-256/);
    await expect(failure).rejects.toThrow(/\.gitattributes/);
    expect(fileStore.has(out)).toBe(false);
  });

  it('caches every downloaded source for the next build', async () => {
    installFetch(defaultHandlers());

    await build('/tmp/pinyinduck-cache/dictionary.btree', false);

    expect(fileStore.get(CACHE_FILES.frequency)).toBe(FREQUENCY);
    expect(fileStore.get(CACHE_FILES.hsk)).toBe(HSK);
    // The committed copy is read in place, not duplicated into the cache.
    expect(fileStore.has(path.join(CACHE_DIR, 'cedict.txt'))).toBe(false);
  });

  it('reads through the cache without hitting the network when sources are present', async () => {
    seedCache();
    const calls = installFetch(defaultHandlers());

    const stats = await build('/tmp/pinyinduck-hit/dictionary.btree', true);

    expect(calls).toEqual([]);
    expect(stats.emitted).toBe(2);
    expect(logs.join('\n')).toContain('cached  zh_cn_50k.txt');
  });

  it('re-downloads instead of reading the cache when caching is disabled', async () => {
    seedCache();
    const calls = installFetch(defaultHandlers());

    await build('/tmp/pinyinduck-stale/dictionary.btree', false);

    expect(calls).toHaveLength(2);
    expect(logs.join('\n')).not.toContain('cached  zh_cn_50k.txt');
  });

  it('downloads only the sources that are missing from the cache', async () => {
    fileStore.set(CACHE_FILES.hsk, HSK);
    const calls = installFetch(defaultHandlers());

    const stats = await build('/tmp/pinyinduck-partial/dictionary.btree', true);

    expect(calls).toEqual([SOURCE_URLS.frequency]);
    expect(stats.emitted).toBe(2);
  });

  it('fails loudly when a source cannot be downloaded', async () => {
    installFetch({
      ...defaultHandlers(),
      [SOURCE_URLS.hsk]: () => failedResponse(404, 'Not Found'),
    });

    await expect(build('/tmp/pinyinduck-missing/dictionary.btree', false)).rejects.toThrow(
      /Failed to download .*hsk\.csv: 404 Not Found/
    );
  });

  it('does not write a partial asset when a source fails', async () => {
    installFetch({
      ...defaultHandlers(),
      [SOURCE_URLS.frequency]: () => failedResponse(500, 'Server Error'),
    });
    const out = '/tmp/pinyinduck-partial-write/dictionary.btree';

    await expect(build(out, false)).rejects.toThrow(/500 Server Error/);
    expect(fileStore.has(out)).toBe(false);
  });

  it('refuses to emit an asset when a source contains an unparsable pinyin column', async () => {
    // Pinned to the bad body, so this reaches the parser rather than the hash check.
    (SOURCES.cedict as { sha256: string }).sha256 = sha256('中 中 [1] /middle/');
    fileStore.set(CEDICT_FILE, '中 中 [1] /middle/');
    installFetch(defaultHandlers());
    const out = '/tmp/pinyinduck-invalid/dictionary.btree';

    await expect(build(out, false)).rejects.toThrow(/unparsable pinyin/);
    expect(fileStore.has(out)).toBe(false);
  });

  it('downloads again instead of using a cached copy that does not match its pin', async () => {
    // A cache written by an older, unpinned build holds whatever edition was current then.
    seedCache();
    fileStore.set(CACHE_FILES.frequency, '老 1\n');
    const calls = installFetch(defaultHandlers());

    const stats = await build('/tmp/pinyinduck-stale-cache/dictionary.btree', true);

    expect(calls).toEqual([SOURCE_URLS.frequency]);
    expect(stats.emitted).toBe(2);
    expect(fileStore.get(CACHE_FILES.frequency)).toBe(FREQUENCY);
    expect(logs.join('\n')).toContain('stale   zh_cn_50k.txt does not match its pinned SHA-256');
  });

  it('refuses a download that does not match its pin, and caches nothing', async () => {
    installFetch({
      ...defaultHandlers(),
      [SOURCE_URLS.frequency]: () => stubResponse('中国 1\n'),
    });
    const out = '/tmp/pinyinduck-mismatch/dictionary.btree';

    const failure = build(out, false);

    await expect(failure).rejects.toThrow(/zh_cn_50k\.txt does not match its pinned SHA-256/);
    await expect(failure).rejects.toThrow(`expected ${SOURCES.frequency.sha256}`);
    await expect(failure).rejects.toThrow(`got      ${sha256('中国 1\n')}`);
    await expect(failure).rejects.toThrow(/scripts\/sources\.ts/);
    expect(fileStore.has(CACHE_FILES.frequency)).toBe(false);
    expect(fileStore.has(out)).toBe(false);
  });

  it('reports the corpus sizes it joined', async () => {
    installFetch(defaultHandlers());

    await build('/tmp/pinyinduck-stats/dictionary.btree', false);

    const output = logs.join('\n');
    expect(output).toContain('2 frequency entries');
    expect(output).toContain('3 HSK words');
    expect(output).toContain('0 single characters');
  });

  it('writes a searchable B-tree asset', async () => {
    installFetch(defaultHandlers());
    const out = '/tmp/pinyinduck-default/dictionary.btree';

    await build(out, false);

    const dictionary = openAsset(out);
    const engine = new LazyPinyinSearchEngine(dictionary);
    const result = engine.search('nihao', { limit: 5 });

    expect(dictionary.entryCount).toBe(2);
    // The fixture has no 你 entry, so the only "nihao" reading is the two-character
    // word. It still has to outrank nothing else and be reachable by key.
    expect(result.candidates.map((c) => c.hanzi)).toEqual(['你好']);
    expect(logs.join('\n')).toContain('B+ tree: a client reads only the header');
  });

  it('writes a gzip copy of the asset for the web app to download', async () => {
    // The web app downloads the whole asset, and hosts often do not compress
    // application/octet-stream, so the build ships it compressed itself.
    installFetch(defaultHandlers());
    const out = '/tmp/pinyinduck-gzip/dictionary.btree';

    await build(out, false);

    const compressed = readBytes(`${out}.gz`);
    expect([compressed[0], compressed[1]]).toEqual([0x1f, 0x8b]);
    expect(new Uint8Array(gunzipSync(compressed))).toEqual(readBytes(out));
  });

  it('writes a gzip header that does not depend on the build machine', async () => {
    // The web asset URL is a hash of these bytes. zlib stamps the OS it ran on into
    // header byte 9 (3 on Unix, 10 on Windows), so the build marks it "unknown" (255)
    // instead, and the mtime (bytes 4-7) is zero.
    installFetch(defaultHandlers());
    const out = '/tmp/pinyinduck-gzip-header/dictionary.btree';

    await build(out, false);

    const header = readBytes(`${out}.gz`).subarray(0, 10);
    expect(Array.from(header.subarray(4, 8))).toEqual([0, 0, 0, 0]);
    expect(header[9]).toBe(255);
  });

  it('writes the gzip copy to the path it is given', async () => {
    installFetch(defaultHandlers());
    const out = '/tmp/pinyinduck-gzip-elsewhere/dictionary.btree';
    const compressedOut = '/tmp/pinyinduck-gzip-elsewhere/web/dictionary.btree.gz';

    await build(out, false, compressedOut);

    expect(dirStore.has('/tmp/pinyinduck-gzip-elsewhere/web')).toBe(true);
    expect(new Uint8Array(gunzipSync(readBytes(compressedOut)))).toEqual(readBytes(out));
    expect(fileStore.has(`${out}.gz`)).toBe(false);
  });

  it('writes the Candidate detail file next to the asset, with the same build id', async () => {
    installFetch(defaultHandlers());
    const out = '/tmp/pinyinduck-detail/dictionary.btree';

    await build(out, false);

    const dictionary = openAsset(out);
    const detail = DetailFile.open(readBytes('/tmp/pinyinduck-detail/detail.bin'), dictionary.buildId);
    expect(detail.entryCount).toBe(2);
    const [china] = dictionary.lookupExact('zhongguo');
    expect(detail.record(china.entryIds[0]).senses).toEqual([{ proper: true, text: ['China'] }]);
    expect(logs.join('\n')).toContain('/tmp/pinyinduck-detail/detail.bin');
  });

  it("writes a gzip copy of the detail file next to the asset's gzip copy", async () => {
    installFetch(defaultHandlers());
    const out = '/tmp/pinyinduck-detail-gzip/dictionary.btree';
    const compressedOut = '/tmp/pinyinduck-detail-gzip/web/dictionary.btree.gz';

    await build(out, false, compressedOut);

    const compressed = readBytes('/tmp/pinyinduck-detail-gzip/web/detail.bin.gz');
    expect(compressed[9]).toBe(255);
    expect(new Uint8Array(gunzipSync(compressed))).toEqual(readBytes('/tmp/pinyinduck-detail-gzip/detail.bin'));
  });

  it('round-trips both entries through the B-tree with their frequency and HSK level', async () => {
    // Two rows is too few to force a multi-level tree, so a broken fan-out would pass
    // unnoticed; the assertions below cover the header counts the reader trusts.
    installFetch(defaultHandlers());
    const out = '/tmp/pinyinduck-roundtrip/dictionary.btree';

    await build(out, false);

    const dictionary = openAsset(out);
    expect(dictionary.pageCount).toBeGreaterThan(0);

    const china = dictionary.lookupExact('zhongguo');
    expect(china).toHaveLength(1);
    expect(china[0].simplified).toBe('中国');
    expect(china[0].traditional).toBe('中國');
    expect(china[0].hskLevel).toBe(2);
    // 中国 is the busiest word in the fixture corpus, so it anchors the frequency scale.
    expect(china[0].frequency).toBe(100000);

    const nihao = dictionary.lookupExact('nihao');
    expect(nihao[0].simplified).toBe('你好');
    expect(nihao[0].hskLevel).toBe(1);
    expect(nihao[0].frequency).toBeGreaterThan(0);
    expect(nihao[0].frequency).toBeLessThan(china[0].frequency);
  });
});

describe('parseArgs', () => {
  const defaultBtree = path.resolve(__dirname, '../../web/public/dictionary.btree');
  const defaultCompressed = path.resolve(__dirname, '../../web/src/generated/dictionary.btree.gz');

  it('defaults to the B-tree web asset path and the download cache', () => {
    expect(parseArgs([])).toEqual({
      outPath: defaultBtree,
      compressedOutPath: defaultCompressed,
      useCache: true,
    });
  });

  it('honours --no-cache', () => {
    expect(parseArgs(['--no-cache'])).toEqual({
      outPath: defaultBtree,
      compressedOutPath: defaultCompressed,
      useCache: false,
    });
  });

  it('honours --out', () => {
    // The compressed copy goes next to a custom asset, never over the web app's own.
    expect(parseArgs(['--out', '/tmp/custom.btree'])).toEqual({
      outPath: '/tmp/custom.btree',
      compressedOutPath: '/tmp/custom.btree.gz',
      useCache: true,
    });
  });

  it('combines --out with --no-cache', () => {
    expect(parseArgs(['--out', '/tmp/custom.btree', '--no-cache'])).toEqual({
      outPath: '/tmp/custom.btree',
      compressedOutPath: '/tmp/custom.btree.gz',
      useCache: false,
    });
  });

  it('falls back to the default path when --out is the final argument', () => {
    expect(parseArgs(['--out'])).toEqual({
      outPath: defaultBtree,
      compressedOutPath: defaultCompressed,
      useCache: true,
    });
  });

  it('consumes the argument after --out verbatim', () => {
    // --out takes the next argument whatever it looks like, so a following flag is
    // read as the path rather than being skipped.
    expect(parseArgs(['--out', '--no-cache'])).toEqual({
      outPath: '--no-cache',
      compressedOutPath: '--no-cache.gz',
      useCache: false,
    });
  });

  it('uses the first --out when it is repeated', () => {
    expect(parseArgs(['--out', '/tmp/first.btree', '--out', '/tmp/second.btree']).outPath).toBe(
      '/tmp/first.btree'
    );
  });

  it('has no format option: the B-tree is the only asset it writes', () => {
    // A leftover `--format json` from an old script must not move the output off the
    // B-tree path the web app reads.
    expect(parseArgs(['--format', 'json'])).toEqual({
      outPath: defaultBtree,
      compressedOutPath: defaultCompressed,
      useCache: true,
    });
  });
});

/**
 * The `import.meta.url === pathToFileURL(process.argv[1]).href` guard is evaluated at import
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

  it('writes a B-tree asset to the path given by --out', async () => {
    installFetch(defaultHandlers());
    const out = '/tmp/pinyinduck-cli/dictionary.btree';

    await runAsScript(['--out', out]);
    await flush();

    const dictionary = openAsset(out);
    expect(dictionary.entryCount).toBe(2);
    expect(process.exitCode).toBe(originalExitCode);
  });

  it('reads through the cache by default', async () => {
    seedCache();
    const calls = installFetch(defaultHandlers());
    const out = '/tmp/pinyinduck-cli-cached/dictionary.btree';

    await runAsScript(['--out', out]);
    await flush();

    expect(calls).toEqual([]);
    expect(openAsset(out).entryCount).toBe(2);
  });

  it('reports a download failure and sets a failing exit code', async () => {
    const errors: unknown[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args[0]);
    });
    installFetch({
      ...defaultHandlers(),
      [SOURCE_URLS.hsk]: () => failedResponse(503, 'Service Unavailable'),
    });

    await runAsScript(['--out', '/tmp/pinyinduck-cli-fail/dictionary.btree']);
    await flush();

    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toMatch(/503 Service Unavailable/);
    expect(process.exitCode).toBe(1);
  });
});
