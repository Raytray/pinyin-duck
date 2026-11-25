/**
 * Covers the download, cache and file-writing half of the bigram builder, against an
 * in-memory `fs` and a stubbed `fetch`, as build-dictionary-io.test.ts does for the
 * dictionary. The segmentation and scoring are covered in build-bigrams.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import { gunzipSync, gzipSync } from 'zlib';

const { fileStore, CEDICT, FREQUENCY, CORPUS } = vi.hoisted(() => ({
  fileStore: new Map<string, string | Uint8Array>(),
  CEDICT: ['我 我 [wo3] /I/', '想 想 [xiang3] /to want/', '喝 喝 [he1] /to drink/'].join('\n'),
  FREQUENCY: '我 100\n想 50\n喝 10\n',
  // Five 我想 and five 想喝, so both survive pruning.
  CORPUS: Array.from({ length: 5 }, () => '我想喝').join('\n') + '\n',
}));

/** The corpus as OPUS serves it. gzip at a fixed level gives the same bytes every time. */
function gzippedCorpus(text: string = CORPUS): Uint8Array {
  return new Uint8Array(gzipSync(Buffer.from(text, 'utf8'), { level: 9 }));
}

vi.mock('./sources', async () => {
  const { createHash } = await import('crypto');
  const zlib = await import('zlib');
  const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
  return {
    SOURCES: {
      cedict: { file: 'data/cedict.txt', sha256: hash(CEDICT) },
      frequency: { url: 'https://example.test/zh_cn_50k.txt', cacheName: 'zh_cn_50k.txt', sha256: hash(FREQUENCY) },
      // Not read by the bigram build; build-dictionary names its URL when it loads.
      handedict: { url: 'https://example.test/handedict.u8', cacheName: 'handedict.u8', sha256: '0'.repeat(64) },
      opensubtitles: {
        url: 'https://example.test/zh_cn.txt.gz',
        cacheName: 'opensubtitles-zh_cn.txt.gz',
        sha256: hash(zlib.gzipSync(Buffer.from(CORPUS, 'utf8'), { level: 9 })),
      },
    },
  };
});

vi.mock('fs', () => ({
  existsSync: (p: string) => fileStore.has(p),
  readFileSync: (p: string, encoding?: string) => {
    const content = fileStore.get(p);
    if (content === undefined) throw new Error(`ENOENT: ${p}`);
    if (encoding && typeof content !== 'string') return new TextDecoder().decode(content);
    return typeof content === 'string' && !encoding ? Buffer.from(content, 'utf8') : content;
  },
  writeFileSync: (p: string, data: string | Uint8Array) => {
    fileStore.set(p, typeof data === 'string' ? data : new Uint8Array(data));
  },
  mkdirSync: () => {},
}));

import { build, parseArgs, BIGRAM_FILE_NAME } from './build-bigrams';
import { SOURCES } from './sources';
import { BigramTable } from '../src/bigram/bigram-codec';

const CACHE_DIR = path.resolve(__dirname, '../.cache');
const CORPUS_CACHE = path.join(CACHE_DIR, 'opensubtitles-zh_cn.txt.gz');
const FREQUENCY_CACHE = path.join(CACHE_DIR, 'zh_cn_50k.txt');
const OUT = '/tmp/pinyinduck-bigrams/bigrams.bin';
const OUT_GZ = '/tmp/pinyinduck-bigrams/web/bigrams.bin.gz';

function readBytes(p: string): Uint8Array {
  const content = fileStore.get(p);
  if (content === undefined) throw new Error(`missing file: ${p}`);
  return typeof content === 'string' ? new TextEncoder().encode(content) : content;
}

function bytesResponse(bytes: Uint8Array) {
  return { ok: true, status: 200, statusText: 'OK', arrayBuffer: async () => bytes.slice().buffer };
}

function installFetch(corpus: () => unknown = () => bytesResponse(gzippedCorpus())) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url === SOURCES.frequency.url) return { ok: true, status: 200, statusText: 'OK', text: async () => FREQUENCY };
      if (url === SOURCES.opensubtitles.url) return corpus();
      throw new Error(`unexpected fetch: ${url}`);
    })
  );
  return calls;
}

beforeEach(() => {
  fileStore.clear();
  fileStore.set(path.resolve(__dirname, '../data/cedict.txt'), CEDICT);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('build', () => {
  it('downloads the corpus, caches it, and writes the table with a gzip copy', async () => {
    const calls = installFetch();
    const stats = await build({ outPath: OUT, compressedOutPath: OUT_GZ, useCache: true });

    expect(calls).toEqual([SOURCES.frequency.url, SOURCES.opensubtitles.url]);
    expect(readBytes(CORPUS_CACHE)).toEqual(gzippedCorpus());
    const table = BigramTable.open(readBytes(OUT));
    expect(table.score('我', '想')).toBeDefined();
    expect(table.score('想', '喝')).toBeDefined();
    expect(table.score('我', '喝')).toBeUndefined();
    expect(new Uint8Array(gunzipSync(readBytes(OUT_GZ)))).toEqual(readBytes(OUT));
    expect(stats).toMatchObject({ lines: 5, distinctPairs: 2, keptPairs: 2 });
  });

  it('reads a cached corpus that matches its pin without downloading it', async () => {
    fileStore.set(CORPUS_CACHE, gzippedCorpus());
    fileStore.set(FREQUENCY_CACHE, FREQUENCY);
    const calls = installFetch();
    await build({ outPath: OUT, compressedOutPath: OUT_GZ, useCache: true });
    expect(calls).toEqual([]);
  });

  it('downloads the corpus again when the cached copy does not match its pin', async () => {
    fileStore.set(CORPUS_CACHE, gzippedCorpus('我想\n'));
    fileStore.set(FREQUENCY_CACHE, FREQUENCY);
    const calls = installFetch();
    await build({ outPath: OUT, compressedOutPath: OUT_GZ, useCache: true });
    expect(calls).toEqual([SOURCES.opensubtitles.url]);
    expect(readBytes(CORPUS_CACHE)).toEqual(gzippedCorpus());
  });

  it('ignores the cache with useCache off', async () => {
    fileStore.set(CORPUS_CACHE, gzippedCorpus());
    const calls = installFetch();
    await build({ outPath: OUT, compressedOutPath: OUT_GZ, useCache: false });
    expect(calls).toContain(SOURCES.opensubtitles.url);
  });

  it('refuses a download that does not match its pin', async () => {
    installFetch(() => bytesResponse(gzippedCorpus('我想\n')));
    await expect(build({ outPath: OUT, compressedOutPath: OUT_GZ, useCache: true })).rejects.toThrow(
      'does not match its pinned SHA-256'
    );
    expect(fileStore.has(CORPUS_CACHE)).toBe(false);
    expect(fileStore.has(OUT)).toBe(false);
  });

  it('reports a failed download', async () => {
    installFetch(() => ({ ok: false, status: 503, statusText: 'Service Unavailable' }));
    await expect(build({ outPath: OUT, compressedOutPath: OUT_GZ, useCache: true })).rejects.toThrow(
      '503 Service Unavailable'
    );
  });
});

describe('parseArgs', () => {
  it('writes beside the dictionary asset and its web copy by default', () => {
    const options = parseArgs([]);
    expect(options.outPath).toMatch(/packages[/\\]web[/\\]public[/\\]bigrams\.bin$/);
    expect(options.compressedOutPath).toMatch(/packages[/\\]web[/\\]src[/\\]generated[/\\]bigrams\.bin\.gz$/);
    expect(options.useCache).toBe(true);
    expect(BIGRAM_FILE_NAME).toBe('bigrams.bin');
  });

  it('puts a custom table and its gzip copy side by side', () => {
    expect(parseArgs(['--out', '/x/b.bin', '--no-cache'])).toEqual({
      outPath: '/x/b.bin',
      compressedOutPath: '/x/b.bin.gz',
      useCache: false,
    });
  });
});
