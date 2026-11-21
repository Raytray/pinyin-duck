import { describe, it, expect } from 'vitest';
import { buildBTree, sortStoredEntries, storedEntryFromRow } from './btree-builder';
import {
  HEADER_SIZE,
  decodeDirectory,
  decodeHeader,
  decodeLeafPage,
  type StoredEntry,
} from './btree-codec';
import { BTreeDictionary } from './btree-dictionary';
import type { DictionaryRow } from './dictionary-codec';

const china: DictionaryRow = ['中国', '中國', 'zhong1 guo2', 'China', 58468, 1];
const hello: DictionaryRow = ['你好', '你好', 'ni3 hao3', 'hello; hi', 71309, 0];

function stored(partial: Partial<StoredEntry> & { key: string }): StoredEntry {
  return {
    simplified: '字',
    traditional: '字',
    pinyinNumbers: partial.key,
    shortGloss: 'gloss',
    frequency: 0,
    hskLevel: 0,
    entryIds: [],
    ...partial,
  };
}

/** Reads back every entry in the tree, so assertions do not depend on page layout. */
function readAll(bytes: Uint8Array): StoredEntry[] {
  const dictionary = BTreeDictionary.open(bytes);
  const all: StoredEntry[] = [];
  dictionary.scanPrefix('', (entry) => {
    all.push(entry);
  });
  return all;
}

describe('storedEntryFromRow', () => {
  it('keys the entry on its toneless pinyin', () => {
    expect(storedEntryFromRow(china)).toEqual({
      key: 'zhongguo',
      simplified: '中国',
      traditional: '中國',
      pinyinNumbers: 'zhong1 guo2',
      shortGloss: 'China',
      frequency: 58468,
      hskLevel: 1,
      entryIds: [],
    });
  });

  it('carries the entry ids and the script the row is a candidate in', () => {
    const hou: DictionaryRow = ['后', '後', 'hou4', 'behind / empress', 9, 0, [41, 7], 'simplified'];
    expect(storedEntryFromRow(hou)).toMatchObject({ entryIds: [41, 7], onlyIn: 'simplified' });
    expect(storedEntryFromRow(china)).not.toHaveProperty('onlyIn');
  });

  it('falls back to the simplified form when no traditional form is stored', () => {
    expect(storedEntryFromRow(['台', '', 'tai2', 'platform', 10, 0]).traditional).toBe('台');
  });
});

describe('sortStoredEntries', () => {
  it('sorts by key, then by descending frequency', () => {
    const sorted = sortStoredEntries([
      stored({ key: 'ni', simplified: '乙', frequency: 5 }),
      stored({ key: 'hao', simplified: '好' }),
      stored({ key: 'ni', simplified: '你', frequency: 90000 }),
    ]);

    // "hao" sorts before "ni"; within "ni" the common reading leads.
    expect(sorted.map((e) => e.simplified)).toEqual(['好', '你', '乙']);
  });

  it('breaks a frequency tie by HSK level, then by form, so builds are reproducible', () => {
    const sorted = sortStoredEntries([
      stored({ key: 'yi', simplified: '乙', hskLevel: 6 }),
      stored({ key: 'yi', simplified: '甲', hskLevel: 1 }),
    ]);

    expect(sorted.map((e) => e.simplified)).toEqual(['甲', '乙']);
  });

  it('breaks a full tie by traditional form, then script, whatever order the rows came in', () => {
    const rows = [
      stored({ key: 'hou', simplified: '后', traditional: '后', onlyIn: 'traditional' }),
      stored({ key: 'hou', simplified: '后', traditional: '後', onlyIn: 'traditional' }),
      stored({ key: 'hou', simplified: '后', traditional: '後', onlyIn: 'simplified' }),
    ];
    const expected = [
      ['后', 'traditional'],
      ['後', 'simplified'],
      ['後', 'traditional'],
    ];
    for (const order of [rows, [...rows].reverse()]) {
      expect(sortStoredEntries(order).map((e) => [e.traditional, e.onlyIn])).toEqual(expected);
    }
  });

  it('does not mutate the input array', () => {
    const entries = [stored({ key: 'b' }), stored({ key: 'a' })];
    sortStoredEntries(entries);
    expect(entries.map((e) => e.key)).toEqual(['b', 'a']);
  });
});

describe('buildBTree', () => {
  it('emits a header describing the entries it holds', () => {
    const bytes = buildBTree([china, hello]);

    expect(bytes.length).toBeGreaterThan(HEADER_SIZE);
    const header = decodeHeader(bytes);
    expect(header.entryCount).toBe(2);
    expect(header.directoryOffset).toBe(HEADER_SIZE);
    // Two entries share a single leaf, so that leaf is also the root.
    expect(header.pageCount).toBe(1);
    expect(header.rootPageId).toBe(0);
    expect(header.buildId).toBe(0);
  });

  it('writes the build id it is given into the header', () => {
    expect(decodeHeader(buildBTree([china], { buildId: 0xcafe1234 })).buildId).toBe(0xcafe1234);
  });

  it('round-trips every field of every entry', () => {
    const all = readAll(buildBTree([china, hello]));

    expect(all).toEqual([storedEntryFromRow(hello), storedEntryFromRow(china)]);
  });

  it('stores entries in key order', () => {
    const rows: DictionaryRow[] = [
      ['好', '好', 'hao3', 'good', 50000, 1],
      ['尼', '尼', 'ni2', 'nun', 40000, 0],
      ['你', '你', 'ni3', 'you', 90000, 1],
    ];

    const all = readAll(buildBTree(rows));
    expect(all.map((e) => e.key)).toEqual(['hao', 'ni', 'ni']);
  });

  it('reads back every entry id across leaf boundaries, where the id deltas restart', () => {
    const rows: DictionaryRow[] = Array.from({ length: 300 }, (_, i) => [
      `字${i}`,
      `字${i}`,
      `zi${(i % 4) + 1}`,
      'g',
      i,
      0,
      i % 7 === 0 ? [200000 - i, i] : [200000 - i],
    ]);

    const bytes = buildBTree(rows, { maxLeafEntries: 16 });
    expect(decodeHeader(bytes).pageCount).toBeGreaterThan(10);
    const ids = new Map(readAll(bytes).map((e) => [e.simplified, e.entryIds]));
    for (const row of rows) expect(ids.get(row[0]), row[0]).toEqual(row[6]);
  });

  it('packs many entries into a multi-level tree that still reads back exactly', () => {
    // Enough distinct keys to force leaves to split and internal levels to fan out.
    const rows: DictionaryRow[] = Array.from({ length: 500 }, (_, i) => [
      `字${i}`,
      `字${i}`,
      `zi${(i % 4) + 1}`,
      `gloss ${i}`,
      i,
      (i % 6) + 1,
    ]);

    const bytes = buildBTree(rows);
    const header = decodeHeader(bytes);
    expect(header.entryCount).toBe(500);
    expect(header.pageCount).toBeGreaterThan(3);

    const all = readAll(bytes);
    expect(all).toHaveLength(500);
    expect(all.map((e) => e.simplified).sort()).toEqual(rows.map((r) => r[0]).sort());

    // The tree is ordered: key ascending, and within a key the most frequent reading
    // first. A prefix scan therefore meets the best candidates before the worst.
    for (let i = 1; i < all.length; i++) {
      const prev = all[i - 1];
      const cur = all[i];
      const ordered =
        prev.key < cur.key ||
        (prev.key === cur.key &&
          (prev.frequency > cur.frequency ||
            (prev.frequency === cur.frequency && prev.simplified <= cur.simplified)));
      expect(ordered, `out of order at ${i}: ${prev.key}/${prev.simplified} then ${cur.key}/${cur.simplified}`).toBe(
        true
      );
    }
  });

  it('honours tighter leaf and fan-out budgets without losing entries', () => {
    const rows: DictionaryRow[] = Array.from({ length: 60 }, (_, i) => [
      `字${i}`,
      `字${i}`,
      `zi${(i % 3) + 1}`,
      `gloss ${i}`,
      i,
      0,
    ]);

    const bytes = buildBTree(rows, { maxLeafEntries: 3, maxFanout: 2 });
    const all = readAll(bytes);

    expect(all).toHaveLength(60);
    expect(all.map((e) => e.simplified).sort()).toEqual(rows.map((r) => r[0]).sort());
  });

  it('keeps one key findable when that key spans several leaves', () => {
    // A single pinyin reading can be shared by far more entries than fit in one
    // leaf. Descent has to resolve to the leaf that *starts* holding the key, or the
    // earlier (here: higher-scoring) entries are silently skipped.
    const many = Array.from({ length: 40 }, (_, i): DictionaryRow => [
      `字${i}`,
      `字${i}`,
      'ni3',
      `gloss ${i}`,
      100000 - i,
      0,
    ]);
    const rows: DictionaryRow[] = [...many, ['尾', '尾', 'wei3', 'tail', 90000, 0]];

    const dictionary = BTreeDictionary.open(
      buildBTree(rows, { maxLeafEntries: 4, maxFanout: 3 })
    );

    const exact = dictionary.lookupExact('ni');
    expect(exact).toHaveLength(40);
    // Sorted by descending frequency, so the most frequent reading must be first.
    expect(exact[0].simplified).toBe('字0');
    expect(exact[39].simplified).toBe('字39');

    const scanned: string[] = [];
    dictionary.scanPrefix('ni', (entry) => {
      scanned.push(entry.simplified);
    });
    expect(scanned).toHaveLength(40);
  });

  it('links the leaf chain so a prefix scan can walk forward across leaves', () => {
    const rows: DictionaryRow[] = Array.from({ length: 20 }, (_, i) => [
      `字${i}`,
      `字${i}`,
      'hao3',
      'good',
      i,
      0,
    ]);

    const bytes = buildBTree(rows, { maxLeafEntries: 2 });
    const dictionary = BTreeDictionary.open(bytes);

    const seen: string[] = [];
    dictionary.scanPrefix('hao', (entry) => {
      seen.push(entry.simplified);
    });

    // Every entry shares the key, so the scan has to cross every leaf in the chain.
    expect(seen).toHaveLength(20);
    // Within the key, frequency descending: the largest index is the busiest.
    expect(seen[0]).toBe('字19');
    expect(seen[19]).toBe('字0');
  });

  it('fills each leaf right up to the byte budget and never past it', () => {
    // Each of these entries encodes to 19 bytes: key "a" (2), two 3-byte hanzi (4 + 4),
    // "a1" (3), gloss "g" (2), a one-byte frequency varint, the HSK byte, an empty entry id
    // list (1) and the script byte. A leaf page adds a 7-byte header, so a 64-byte budget
    // holds exactly three entries.
    const rows: DictionaryRow[] = Array.from({ length: 10 }, (_, i) => ['字', '字', 'a1', 'g', i, 0]);

    const leafSizes = (maxLeafBytes: number) => {
      const bytes = buildBTree(rows, { maxLeafBytes });
      const header = decodeHeader(bytes);
      return decodeDirectory(bytes.subarray(header.directoryOffset), header.pageCount)
        .map(({ offset, length }) => bytes.subarray(offset, offset + length))
        .filter((page) => page[0] === 1)
        .map((page) => ({ entries: decodeLeafPage(page).entries.length, bytes: page.byteLength }));
    };

    expect(leafSizes(64)).toEqual([
      { entries: 3, bytes: 64 },
      { entries: 3, bytes: 64 },
      { entries: 3, bytes: 64 },
      { entries: 1, bytes: 26 },
    ]);
    // One byte less and the third entry no longer fits.
    expect(leafSizes(63).map((leaf) => leaf.entries)).toEqual([2, 2, 2, 2, 2]);
  });

  it('reports a build that fits in the format without a directory overflow', () => {
    // The 4GB ceiling is a guard rather than a routine path; the tiny build here
    // simply confirms the directory is laid out contiguously after the header.
    const bytes = buildBTree([china]);
    const header = decodeHeader(bytes);
    expect(bytes.length).toBeGreaterThanOrEqual(HEADER_SIZE + header.pageCount * 8);
  });
});
