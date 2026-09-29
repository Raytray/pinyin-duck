/**
 * Covers the file-writing half of the Rime dictionary build.
 *
 * The pure format logic is pinned in `src/rime-dict.test.ts`; what is left here is the
 * part that touches disk, which is driven against injected fakes so the test does not
 * need the real 9MB asset or a Windows filesystem.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildBTree } from '../../core/src/data/btree-builder.js';
import {
  DICT_NAMES,
  DICT_VERSION,
  buildRimeDictionaries,
  main,
  parseArgs,
  type RimeBuildDeps,
  type RimeFileSink,
} from './build-rime-dict';

/** One dictionary row as the dictionary builder takes it. */
type DictRow = [string, string, string, string, number, number];

const CORPUS: DictRow[] = [
  ['你好', '你好', 'ni3 hao3', 'hello / how are you', 50000, 1],
  ['中国', '中國', 'zhong1 guo2', 'China', 40000, 1],
  ['你', '你', 'ni3', 'you (singular)', 90000, 1],
  // 干 and 乾 share a traditional form, so the traditional dictionary must dedupe them.
  ['干', '乾', 'gan1', 'dry', 1000, 2],
  ['乾', '乾', 'gan1', 'qian (surname)', 500, 3],
];

interface FakeFs {
  deps: RimeBuildDeps;
  files: Map<string, string>;
  dirs: Set<string>;
  closed: string[];
}

function fakeFs(asset: Uint8Array | null): FakeFs {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const closed: string[] = [];

  const openFile = (p: string): RimeFileSink => {
    files.set(p, '');
    return {
      write(chunk) {
        const existing = files.get(p) ?? '';
        files.set(p, existing.length === 0 ? chunk : `${existing}\n${chunk}`);
      },
      close() {
        closed.push(p);
      },
    };
  };

  return {
    files,
    dirs,
    closed,
    deps: {
      exists: (p) => (p.endsWith('.btree') ? asset !== null : files.has(p) || dirs.has(p)),
      readAsset: () => {
        if (!asset) throw new Error(`ENOENT: no asset`);
        return asset;
      },
      ensureDir: (p) => {
        dirs.add(p);
      },
      openFile,
    },
  };
}

/** The rows of a written dictionary, below its header. */
function bodyOf(fs: FakeFs, name: string): string[] {
  const text = fs.files.get(name);
  if (text === undefined) throw new Error(`missing dictionary: ${name}`);
  const lines = text.split('\n');
  const end = lines.indexOf('...');
  return lines.slice(end + 1).filter((line) => line.length > 0);
}

const OUT_DIR = '/out';
const asset = (): Uint8Array => buildBTree(CORPUS.map((row) => [...row] as never));

let fsState: FakeFs;

beforeEach(() => {
  fsState = fakeFs(asset());
});

describe('buildRimeDictionaries', () => {
  it('writes one dictionary per script, named for the schema that reads it', async () => {
    const stats = await buildRimeDictionaries(
      { btreePath: '/asset.btree', outDir: OUT_DIR },
      fsState.deps
    );

    expect(Object.keys(stats.files)).toEqual(['simplified', 'traditional']);
    for (const script of ['simplified', 'traditional'] as const) {
      expect(fsState.files.has(stats.files[script])).toBe(true);
    }
    expect(stats.files.simplified).toContain(`${DICT_NAMES.simplified}.dict.yaml`);
    expect(stats.files.traditional).toContain(`${DICT_NAMES.traditional}.dict.yaml`);
  });

  it('creates the output directory and closes every file it opened', async () => {
    const stats = await buildRimeDictionaries(
      { btreePath: '/asset.btree', outDir: OUT_DIR },
      fsState.deps
    );

    expect(fsState.dirs.has(OUT_DIR)).toBe(true);
    expect(fsState.closed.sort()).toEqual([stats.files.simplified, stats.files.traditional].sort());
  });

  it('starts each file with a header the writer can consume', async () => {
    const stats = await buildRimeDictionaries(
      { btreePath: '/asset.btree', outDir: OUT_DIR },
      fsState.deps
    );
    const text = fsState.files.get(stats.files.simplified) ?? '';

    expect(text.startsWith('#')).toBe(true);
    expect(text).toContain(`name: ${DICT_NAMES.simplified}`);
    expect(text).toContain(`version: "${DICT_VERSION}"`);
    expect(text).toContain('columns:');
  });

  it('emits a four-column TSV row for every entry', async () => {
    const stats = await buildRimeDictionaries(
      { btreePath: '/asset.btree', outDir: OUT_DIR },
      fsState.deps
    );
    const body = bodyOf(fsState, stats.files.simplified);

    expect(body).toHaveLength(CORPUS.length);
    for (const line of body) {
      expect(line.split('\t')).toHaveLength(4);
    }
    expect(body.find((line) => line.startsWith('你好'))).toContain('ni3 hao3');
  });

  it('deduplicates the traditional dictionary, which CC-CEDICT collapses', async () => {
    const stats = await buildRimeDictionaries(
      { btreePath: '/asset.btree', outDir: OUT_DIR },
      fsState.deps
    );
    const trad = bodyOf(fsState, stats.files.traditional);

    // 干 and 乾 are both 乾 in traditional, so four distinct entries become three rows.
    expect(trad.filter((line) => line.startsWith('乾'))).toHaveLength(1);
    // The surviving row is the higher weighted one, so 干's gloss is kept.
    expect(trad.find((line) => line.startsWith('乾'))).toContain('dry');
    expect(stats.scripts.traditional.duplicates).toBe(1);
    expect(stats.scripts.simplified.duplicates).toBe(0);
  });

  it('reports what it read so a truncated build is visible', async () => {
    const stats = await buildRimeDictionaries(
      { btreePath: '/asset.btree', outDir: OUT_DIR },
      fsState.deps
    );

    expect(stats.entryCount).toBe(CORPUS.length);
    expect(stats.scripts.simplified).toEqual({ rows: 5, skipped: 0, duplicates: 0 });
    expect(stats.scripts.traditional).toEqual({ rows: 4, skipped: 0, duplicates: 1 });
  });

  it('explains how to regenerate a missing asset instead of failing on a read', async () => {
    const missing = fakeFs(null);
    await expect(
      buildRimeDictionaries({ btreePath: '/asset.btree', outDir: OUT_DIR }, missing.deps)
    ).rejects.toThrow(/npm run build:dict/);
  });

  it('surfaces a corrupt asset rather than writing a partial dictionary', async () => {
    const corrupt = fakeFs(new Uint8Array([1, 2, 3, 4]));
    await expect(
      buildRimeDictionaries({ btreePath: '/asset.btree', outDir: OUT_DIR }, corrupt.deps)
    ).rejects.toThrow();
  });
});

describe('the real filesystem adapter', () => {
  // The rest of this file injects fakes, which leaves the `fs` implementation — the
  // only code in the package that touches real files — unexercised. Running it against
  // a temp directory is what covers its buffering and its final flush, which is where a
  // "writes the last 4,000 rows" bug would hide.
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinyinduck-rime-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes both dictionaries, creates the directory, and flushes every row', async () => {
    // More rows than the flush interval, so both the periodic write and the final one
    // in close() run.
    const rows: DictRow[] = Array.from({ length: 9000 }, (_, index) => [
      `字${index}`,
      `字${index}`,
      `zi${(index % 5) + 1}`,
      `gloss ${index}`,
      index,
      0,
    ]);
    const assetPath = path.join(dir, 'dictionary.btree');
    fs.writeFileSync(assetPath, buildBTree(rows.map((row) => [...row] as never)));

    const outDir = path.join(dir, 'rime', 'nested');
    const stats = await buildRimeDictionaries({ btreePath: assetPath, outDir });

    expect(stats.entryCount).toBe(9000);
    for (const script of ['simplified', 'traditional'] as const) {
      const lines = fs.readFileSync(stats.files[script], 'utf8').split('\n');
      const body = lines.slice(lines.indexOf('...') + 1).filter(Boolean);
      expect(body).toHaveLength(9000);
      // Every row is four tab-separated columns and ends with a newline.
      expect(body[0].split('\t')).toHaveLength(4);
      expect(lines.at(-1)).toBe('');
    }
  });

  it('reports a missing asset before it creates anything', async () => {
    const outDir = path.join(dir, 'rime');
    await expect(
      buildRimeDictionaries({ btreePath: path.join(dir, 'absent.btree'), outDir })
    ).rejects.toThrow(/npm run build:dict/);
    expect(fs.existsSync(outDir)).toBe(false);
  });
});

describe('parseArgs', () => {
  it('defaults to the shared asset and the rime folder', () => {
    const options = parseArgs([]);
    expect(options.btreePath).toContain(path.join('web', 'public', 'dictionary.btree'));
    expect(options.outDir).toContain(path.join('windows', 'rime'));
  });

  it('accepts an explicit output directory and asset', () => {
    const options = parseArgs(['--out', '/tmp/rime', '--btree', '/tmp/other.btree']);
    expect(options).toEqual({ btreePath: '/tmp/other.btree', outDir: '/tmp/rime' });
  });

  it('ignores a flag with no value rather than writing to undefined', () => {
    expect(parseArgs(['--out'])).toEqual(parseArgs([]));
    expect(parseArgs(['--btree'])).toEqual(parseArgs([]));
  });
});

describe('cli output', () => {
  it('says where the files went and what to do next', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '));
    });

    await main(['--out', OUT_DIR, '--btree', '/asset.btree'], fsState.deps);

    const output = logs.join('\n');
    expect(output).toContain('pinyinduck.dict.yaml');
    expect(output).toContain('install.ps1');
    vi.restoreAllMocks();
  });
});
