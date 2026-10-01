/**
 * Tests for the build script's CLI flag handling and file I/O.
 *
 * Uses injected fakes so the streaming and file-writing paths can be tested without
 * a real 9MB asset, which is the only part of this script that is not a thin
 * translation of `RimeDictWriter`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  HEADER_SIZE,
  NO_PAGE,
  encodeDirectory,
  encodeHeader,
  encodeLeafPage,
} from '../../core/src/data/btree-codec.js';
import { buildBTree } from '../../core/src/data/btree-builder.js';
import type { DictionaryRow } from '../../core/src/data/dictionary-codec.js';
import {
  FLUSH_INTERVAL,
  buildRimeDictionaries,
  main,
  parseArgs,
  renderGlossSidecar,
  type RimeBuildDeps,
} from './build-rime-dict.js';

function createFakeDeps(overrides: Partial<RimeBuildDeps> = {}): RimeBuildDeps {
  const files = new Map<string, string>();
  return {
    exists: () => true,
    readAsset: () => new Uint8Array(0),
    ensureDir: () => {},
    openFile: (path: string) => {
      let content = '';
      files.set(path, '');
      return {
        write(chunk: string) {
          content += chunk;
          files.set(path, content);
        },
        close() {},
      };
    },
    ...overrides,
  };
}

/**
 * The smallest asset `BTreeDictionary.open` accepts: one leaf page holding no entries,
 * serving as both the root and the whole tree, so a scan has somewhere to land.
 *
 * Built with core's own encoders rather than by hand. A hand-rolled header has to
 * restate the wire format (magic `PDBT`, a one-byte version, little-endian u32s) and
 * silently becomes a corrupt asset the moment any of that is wrong -- which `decodeHeader`
 * rejects before the build reaches the output directory, so a test built that way fails
 * for a reason that has nothing to do with what it is asserting.
 */
function emptyAsset(): Uint8Array {
  const leaf = encodeLeafPage([], NO_PAGE);
  const directoryOffset = HEADER_SIZE;
  const leafOffset = directoryOffset + 8;
  const data = new Uint8Array(leafOffset + leaf.byteLength);
  data.set(encodeHeader({ entryCount: 0, pageCount: 1, rootPageId: 0, directoryOffset }), 0);
  data.set(encodeDirectory([{ offset: leafOffset, length: leaf.byteLength }]), directoryOffset);
  data.set(leaf, leafOffset);
  return data;
}

describe('parseArgs', () => {
  it('returns defaults with no arguments', () => {
    const result = parseArgs([]);
    expect(result.outDir).toContain('rime');
    expect(result.btreePath).toContain('dictionary.btree');
  });

  it('parses --out', () => {
    const result = parseArgs(['--out', '/tmp/test']);
    expect(result.outDir).toBe('/tmp/test');
  });

  it('parses --btree', () => {
    const result = parseArgs(['--btree', '/path/to/btree']);
    expect(result.btreePath).toBe('/path/to/btree');
  });

  it('parses both flags', () => {
    const result = parseArgs(['--out', '/tmp/out', '--btree', '/tmp/btree']);
    expect(result.outDir).toBe('/tmp/out');
    expect(result.btreePath).toBe('/tmp/btree');
  });
});

describe('renderGlossSidecar', () => {
  it('renders an empty table for no glosses', () => {
    const result = renderGlossSidecar(new Map());
    expect(result).toContain('local data = ""');
    expect(result).toContain('local gloss = {}');
  });

  it('renders a single gloss entry', () => {
    const gloss = new Map();
    const byCode = new Map();
    byCode.set('nihao', 'hello');
    gloss.set('你好', byCode);

    const result = renderGlossSidecar(gloss);
    expect(result).toContain('你好');
    expect(result).toContain('nihao');
    expect(result).toContain('hello');
  });

  it('renders multiple codes for the same text', () => {
    const gloss = new Map();
    const byCode = new Map();
    byCode.set('lü', 'green');
    byCode.set('lu', 'record');
    gloss.set('绿', byCode);

    const result = renderGlossSidecar(gloss);
    expect(result).toContain('绿');
    expect(result).toContain('lü');
    expect(result).toContain('lu');
  });

  it('escapes special characters in definitions', () => {
    const gloss = new Map();
    const byCode = new Map();
    byCode.set('test', 'hello "world"\nnew line');
    gloss.set('测试', byCode);

    const result = renderGlossSidecar(gloss);
    expect(result).toContain('\\"');
    expect(result).toContain('\\n');
  });
});

describe('buildRimeDictionaries', () => {
  it('throws when the asset is missing', async () => {
    const deps = createFakeDeps({
      exists: () => false,
    });

    await expect(
      buildRimeDictionaries(
        { btreePath: '/missing.btree', outDir: '/tmp/out' },
        deps
      )
    ).rejects.toThrow('dictionary asset is missing');
  });

  it('creates the output directory', async () => {
    const dirs: string[] = [];

    const deps = createFakeDeps({
      ensureDir: (path: string) => {
        dirs.push(path);
      },
      readAsset: () => emptyAsset(),
    });

    await buildRimeDictionaries(
      { btreePath: '/tmp/test.btree', outDir: '/tmp/test-out' },
      deps
    );

    expect(dirs).toContain('/tmp/test-out');
  });
});

describe('main', () => {
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports the source, every dictionary and the gloss sidecar', async () => {
    const deps = createFakeDeps({ readAsset: () => emptyAsset() });

    await main(['--out', '/tmp/cli-out', '--btree', '/tmp/cli.btree'], deps);

    const reported = log.mock.calls.map((call) => call.join(' ')).join('\n');
    // The build reports what it wrote and where, so a truncated dictionary is visible.
    expect(reported).toContain('/tmp/cli.btree (0 entries)');
    expect(reported).toContain('/tmp/cli-out/pinyinduck.dict.yaml');
    expect(reported).toContain('/tmp/cli-out/pinyinduck_trad.dict.yaml');
    expect(reported).toContain('/tmp/cli-out/lua/pinyinduck_gloss.lua');
    expect(reported).toContain('install.sh');
  });

  it('propagates a missing asset instead of reporting an empty build', async () => {
    const deps = createFakeDeps({ exists: () => false });

    await expect(
      main(['--btree', '/nope.btree', '--out', '/tmp/cli-out'], deps)
    ).rejects.toThrow('dictionary asset is missing');
  });
});

/**
 * A real asset carrying real entries, as opposed to `emptyAsset`'s header-only tree.
 *
 * Uses core's own builder, so the key order and the packed pages are the ones the reader
 * will meet in production rather than something assembled to make a test pass.
 */
function assetWith(rows: DictionaryRow[]): Uint8Array {
  return buildBTree(rows);
}

const INITIALS = ['', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'zh', 'ch', 'sh', 'r', 'z', 'c', 's'];
const FINALS = ['a', 'ai', 'an', 'ang', 'ao', 'e', 'ei', 'en', 'eng', 'i', 'ia', 'ian', 'iao', 'ie', 'in', 'ing', 'iu', 'o', 'ong', 'ou', 'u', 'ua', 'uai', 'uan', 'uang', 'ui', 'un', 'uo'];

/**
 * Builds `count` rows with distinct, valid, toneless-distinct readings.
 *
 * The readings have to be real pinyin or the emitter drops them as unencodable, and they
 * have to reduce to distinct toneless codes or the writer merges them into one menu and
 * the row count stops being a line count.
 */
function manyRows(count: number): DictionaryRow[] {
  const rows: DictionaryRow[] = [];
  let syllable = 0;
  while (rows.length < count) {
    const initial = INITIALS[syllable % INITIALS.length];
    const final = FINALS[Math.floor(syllable / INITIALS.length) % FINALS.length];
    const tone = (Math.floor(syllable / (INITIALS.length * FINALS.length)) % 4) + 1;
    syllable++;
    const i = rows.length;
    rows.push([`字${i}`, `字${i}`, `${initial}${final}${tone}`, `gloss ${i}`, 1000 + i, 1]);
  }
  return rows;
}

/**
 * The real Node dependency set, against a real temporary directory.
 *
 * Every test above injects fakes, so the adapters that actually touch the filesystem and
 * flush a file handle would never run. Building a genuine asset on disk and reading the
 * emitted dictionaries back is the only way to catch a wrong path, a missing `recursive`
 * on `mkdirSync`, or a sink that buffers but never flushes.
 */
describe('buildRimeDictionaries against the real filesystem', () => {
  let root: string;
  let btreePath: string;
  let outDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-rime-real-'));
    btreePath = path.join(root, 'dictionary.btree');
    outDir = path.join(root, 'rime');
    fs.writeFileSync(btreePath, emptyAsset());
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('creates the output directories and writes every file', async () => {
    // No deps argument: this is the production path, `fs` and all.
    const stats = await buildRimeDictionaries({ btreePath, outDir });

    expect(fs.existsSync(path.join(outDir, 'pinyinduck.dict.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'pinyinduck_trad.dict.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'lua', 'pinyinduck_gloss.lua'))).toBe(true);
    expect(stats.files.simplified).toBe(path.join(outDir, 'pinyinduck.dict.yaml'));
    expect(stats.glossFile).toBe(path.join(outDir, 'lua', 'pinyinduck_gloss.lua'));
  });

  it('writes a loadable dictionary header and a closed gloss file', async () => {
    await buildRimeDictionaries({ btreePath, outDir });

    const dict = fs.readFileSync(path.join(outDir, 'pinyinduck.dict.yaml'), 'utf8');
    expect(dict).toContain('name: pinyinduck');
    expect(dict).toContain('columns:');

    const gloss = fs.readFileSync(path.join(outDir, 'lua', 'pinyinduck_gloss.lua'), 'utf8');
    expect(gloss).toContain('local gloss = {}');
    expect(gloss).toContain('return gloss');
  });

  it('reports a missing asset rather than writing an empty dictionary', async () => {
    await expect(
      buildRimeDictionaries({ btreePath: path.join(root, 'absent.btree'), outDir })
    ).rejects.toThrow('dictionary asset is missing');
  });

  it('emits one row per reading, with the gloss sidecar keyed by text and code', async () => {
    // The rows reach the sink through the same callback that fills the Lua sidecar, so
    // this is where both halves of that branch are actually exercised.
    const rows: DictionaryRow[] = [
      ['你好', '你好', 'ni3 hao3', 'hello; hi', 71309, 0],
      ['绿', '綠', 'lu4', 'green', 3000, 4],
    ];
    fs.writeFileSync(btreePath, assetWith(rows));

    const stats = await buildRimeDictionaries({ btreePath, outDir });

    const dict = fs.readFileSync(path.join(outDir, 'pinyinduck.dict.yaml'), 'utf8');
    expect(dict).toContain('你好\tni hao\tnǐ hǎo · hello; hi');
    expect(dict).toContain('绿\tlu\tlù · green');
    // The traditional script reads the other column of the same entry.
    const trad = fs.readFileSync(path.join(outDir, 'pinyinduck_trad.dict.yaml'), 'utf8');
    expect(trad).toContain('綠\tlu\tlù · green');

    const gloss = fs.readFileSync(path.join(outDir, 'lua', 'pinyinduck_gloss.lua'), 'utf8');
    expect(gloss).toContain('你好\\tni hao\\tnǐ hǎo · hello; hi');
    expect(gloss).toContain('绿\\tlu\\tlù · green');
    // Both scripts contribute, so a text whose two columns differ (绿/綠) is keyed twice.
    // That is what lets the filter resolve the traditional candidate too.
    expect(stats.glossEntries).toBe(3);
    expect(stats.entryCount).toBe(2);
    expect(stats.scripts.simplified.rows).toBe(2);
    expect(stats.scripts.traditional.rows).toBe(2);
  });

  it('flushes to disk mid-build rather than only at close', async () => {
    // The sink buffers rows and only calls `writeSync` once the interval is crossed.
    // With a tree larger than the interval, the mid-build branch is the one that runs,
    // and a build that silently lost that flush would still pass an end-state check.
    const rows: DictionaryRow[] = manyRows(FLUSH_INTERVAL + 50);
    fs.writeFileSync(btreePath, assetWith(rows));

    const stats = await buildRimeDictionaries({ btreePath, outDir });

    const dict = fs.readFileSync(path.join(outDir, 'pinyinduck.dict.yaml'), 'utf8');
    // Count the body rows rather than the whole file, so the header block can change
    // without making this assertion about the flush meaningless.
    const bodyRows = dict
      .slice(dict.indexOf('...\n') + 4)
      .split('\n')
      .filter((line) => line.length > 0);

    expect(stats.scripts.simplified.rows).toBe(rows.length);
    // Every row reached the file, which is only true if the buffered flush fired.
    expect(bodyRows).toHaveLength(rows.length);
    // Rows are ordered by reading, not by the order they were supplied, so completeness
    // is checked as a set of glosses: a lost flush would drop a contiguous block of them.
    const glosses = new Set(bodyRows.map((line) => line.split('\t')[2]));
    expect(glosses.size).toBe(rows.length);
    expect(bodyRows[0]).toMatch(/^字\d+\t\S+\t\S.*gloss \d+\t\d+$/);
  });
});
