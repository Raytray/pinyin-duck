import { describe, it, expect } from 'vitest';
import { buildBTree, sortStoredEntries, storedEntryFromRow } from './btree-builder';
import { HEADER_SIZE, decodeHeader, type StoredEntry } from './btree-codec';
import { openBTreeDictionaryFromSource } from './btree-dictionary';
import { MemoryPageSource } from './page-source';
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
    ...partial,
  };
}

/** Reads back every entry in the tree, so assertions do not depend on page layout. */
async function readAll(bytes: Uint8Array): Promise<StoredEntry[]> {
  const dictionary = await openBTreeDictionaryFromSource(new MemoryPageSource(bytes));
  const all: StoredEntry[] = [];
  await dictionary.scanPrefix('', (entry) => {
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
    });
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

  it('does not mutate the input array', () => {
    const entries = [stored({ key: 'b' }), stored({ key: 'a' })];
    sortStoredEntries(entries);
    expect(entries.map((e) => e.key)).toEqual(['b', 'a']);
  });
});

describe('buildBTree', () => {
  it('emits a header describing the entries it holds', async () => {
    const bytes = buildBTree([china, hello]);

    expect(bytes.length).toBeGreaterThan(HEADER_SIZE);
    const header = decodeHeader(bytes);
    expect(header.entryCount).toBe(2);
    expect(header.directoryOffset).toBe(HEADER_SIZE);
    // Two entries share a single leaf, so that leaf is also the root.
    expect(header.pageCount).toBe(1);
    expect(header.rootPageId).toBe(0);
  });

  it('round-trips every field of every entry', async () => {
    const all = await readAll(buildBTree([china, hello]));

    expect(all).toEqual([storedEntryFromRow(hello), storedEntryFromRow(china)]);
  });

  it('stores entries in key order', async () => {
    const rows: DictionaryRow[] = [
      ['好', '好', 'hao3', 'good', 50000, 1],
      ['尼', '尼', 'ni2', 'nun', 40000, 0],
      ['你', '你', 'ni3', 'you', 90000, 1],
    ];

    const all = await readAll(buildBTree(rows));
    expect(all.map((e) => e.key)).toEqual(['hao', 'ni', 'ni']);
  });

  it('packs many entries into a multi-level tree that still reads back exactly', async () => {
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

    const all = await readAll(bytes);
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

  it('honours tighter leaf and fan-out budgets without losing entries', async () => {
    const rows: DictionaryRow[] = Array.from({ length: 60 }, (_, i) => [
      `字${i}`,
      `字${i}`,
      `zi${(i % 3) + 1}`,
      `gloss ${i}`,
      i,
      0,
    ]);

    const bytes = buildBTree(rows, { maxLeafEntries: 3, maxFanout: 2 });
    const all = await readAll(bytes);

    expect(all).toHaveLength(60);
    expect(all.map((e) => e.simplified).sort()).toEqual(rows.map((r) => r[0]).sort());
  });

  it('keeps one key findable when that key spans several leaves', async () => {
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

    const dictionary = await openBTreeDictionaryFromSource(
      new MemoryPageSource(buildBTree(rows, { maxLeafEntries: 4, maxFanout: 3 }))
    );

    const exact = await dictionary.lookupExact('ni');
    expect(exact).toHaveLength(40);
    // Sorted by descending frequency, so the most frequent reading must be first.
    expect(exact[0].simplified).toBe('字0');
    expect(exact[39].simplified).toBe('字39');

    const scanned: string[] = [];
    await dictionary.scanPrefix('ni', (entry) => {
      scanned.push(entry.simplified);
    });
    expect(scanned).toHaveLength(40);
  });

  it('links the leaf chain so a prefix scan can walk forward across leaves', async () => {
    const rows: DictionaryRow[] = Array.from({ length: 20 }, (_, i) => [
      `字${i}`,
      `字${i}`,
      'hao3',
      'good',
      i,
      0,
    ]);

    const bytes = buildBTree(rows, { maxLeafEntries: 2 });
    const dictionary = await openBTreeDictionaryFromSource(new MemoryPageSource(bytes));

    const seen: string[] = [];
    await dictionary.scanPrefix('hao', (entry) => {
      seen.push(entry.simplified);
    });

    // Every entry shares the key, so the scan has to cross every leaf in the chain.
    expect(seen).toHaveLength(20);
    // Within the key, frequency descending: the largest index is the busiest.
    expect(seen[0]).toBe('字19');
    expect(seen[19]).toBe('字0');
  });

  it('reports a build that fits in the format without a directory overflow', () => {
    // The 4GB ceiling is a guard rather than a routine path; the tiny build here
    // simply confirms the directory is laid out contiguously after the header.
    const bytes = buildBTree([china]);
    const header = decodeHeader(bytes);
    expect(bytes.length).toBeGreaterThanOrEqual(HEADER_SIZE + header.pageCount * 8);
  });
});
