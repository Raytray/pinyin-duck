import { describe, it, expect } from 'vitest';
import { PinyinSearchEngine } from './search';
import { LazyPinyinSearchEngine } from './lazy-search';
import { PinyinTrie } from './trie';
import { decodeDictionary } from '../data/load-dictionary';
import { buildBTree } from '../data/btree-builder';
import { MemoryPageSource } from '../data/page-source';
import { openBTreeDictionaryFromSource } from '../data/btree-dictionary';
import type { DictionaryRow } from '../data/dictionary-codec';
import type { DictEntry, SearchOptions, SearchResult } from '../types.js';

function entry(partial: Partial<DictEntry>): DictEntry {
  return {
    simplified: '字',
    traditional: '字',
    pinyinNumbers: 'zi4',
    pinyinMarks: 'zì',
    pinyinClean: 'zi',
    pinyinSyllables: ['zi4'],
    shortGloss: 'character',
    frequency: 0,
    hskLevel: undefined,
    ...partial,
  };
}

/**
 * A dictionary row written by field. Clean pinyin, tone marks and syllables are derived
 * from `pinyinNumbers`, exactly as both engines derive them from the shipped asset.
 */
interface Fixture {
  simplified?: string;
  traditional?: string;
  pinyinNumbers?: string;
  shortGloss?: string;
  frequency?: number;
  hskLevel?: number;
}

function row(fixture: Fixture = {}): DictionaryRow {
  const simplified = fixture.simplified ?? '字';
  return [
    simplified,
    fixture.traditional ?? simplified,
    fixture.pinyinNumbers ?? 'zi4',
    fixture.shortGloss ?? 'character',
    fixture.frequency ?? 0,
    fixture.hskLevel ?? 0,
  ];
}

interface Engine {
  search(query: string, options?: SearchOptions): Promise<SearchResult>;
}

// Every case runs through both engines, so the lazy engine alone is shown to cover the
// search options before the trie engine is removed.
const engines: [string, (rows: DictionaryRow[]) => Promise<Engine>][] = [
  [
    'PinyinSearchEngine',
    async (rows) => {
      const engine = new PinyinSearchEngine(decodeDictionary(rows));
      return { search: async (query, options) => engine.search(query, options) };
    },
  ],
  [
    'LazyPinyinSearchEngine',
    async (rows) =>
      new LazyPinyinSearchEngine(
        await openBTreeDictionaryFromSource(new MemoryPageSource(buildBTree(rows)))
      ),
  ],
];

const manyRows = () =>
  Array.from({ length: 25 }, (_, i) => row({ simplified: `字${i}`, pinyinNumbers: 'zi4' }));

describe.each(engines)('%s option defaults', (_name, engineOf) => {
  it('returns an empty result for a blank query', async () => {
    const engine = await engineOf([row()]);
    for (const query of ['', '   ']) {
      const result = await engine.search(query);
      expect(result).toEqual({ query: '', segments: [], candidates: [], total: 0 });
    }
  });

  it('normalizes case and surrounding whitespace on the query', async () => {
    const engine = await engineOf([row()]);
    const result = await engine.search('  ZI  ');
    expect(result.query).toBe('zi');
  });

  it('defaults to simplified script', async () => {
    const mixed = await engineOf([row({ simplified: '发', traditional: '發', pinyinNumbers: 'fa1' })]);

    expect((await mixed.search('fa')).candidates[0].hanzi).toBe('发');
    expect((await mixed.search('fa', { script: 'simplified' })).candidates[0].hanzi).toBe('发');
    expect((await mixed.search('fa', { script: 'traditional' })).candidates[0].hanzi).toBe('發');
  });

  it('applies a default result limit of 10', async () => {
    const many = await engineOf(manyRows());

    const result = await many.search('zi');
    expect(result.candidates).toHaveLength(10);
    // total reports the full match count, not the truncated page.
    expect(result.total).toBe(25);
  });

  it('honors an explicit limit', async () => {
    const many = await engineOf(manyRows());

    expect((await many.search('zi', { limit: 3 })).candidates).toHaveLength(3);
  });

  it('skips prefix candidates when exactOnly is set', async () => {
    const engine = await engineOf([
      row({ simplified: '字', pinyinNumbers: 'zi4' }),
      row({ simplified: '紫', pinyinNumbers: 'zi3 se4' }),
    ]);

    expect((await engine.search('zi')).candidates.map((c) => c.hanzi)).toEqual(['字', '紫']);
    expect((await engine.search('zi', { exactOnly: true })).candidates.map((c) => c.hanzi)).toEqual(['字']);
  });

  it('reports segments for the query', async () => {
    const engine = await engineOf([row()]);
    const result = await engine.search('nihao');
    expect(result.segments).toEqual(['ni', 'hao']);
  });

  it('searches on the cleaned query when the input has no segmentable syllables', async () => {
    // A query made only of separators cleans to an empty prefix, so there is no
    // first syllable to fall back on. The search must still run rather than throw.
    const engine = await engineOf([row({ simplified: '啊', pinyinNumbers: 'a5' })]);

    const result = await engine.search("'");
    expect(result.segments).toEqual([]);
    expect(result.query).toBe("'");
    expect(result.candidates.map((c) => c.hanzi)).toEqual(['啊']);
  });
});

describe.each(engines)('%s tone filtering edge cases', (_name, engineOf) => {
  it('drops an entry with no tone number when a tone is typed', async () => {
    // A hand-authored entry can carry a toneless reading. There is no tone to match,
    // so it cannot satisfy a tone filter and must not be offered.
    const engine = await engineOf([row({ simplified: '塔', pinyinNumbers: 'ta' })]);

    expect((await engine.search('ta4')).candidates).toEqual([]);
  });

  it('keeps a toneless entry when no tone is typed', async () => {
    const engine = await engineOf([row({ simplified: '塔', pinyinNumbers: 'ta' })]);

    expect((await engine.search('ta')).candidates.map((c) => c.hanzi)).toEqual(['塔']);
  });

  it('shows only one candidate when two readings share the same hanzi', async () => {
    // CC-CEDICT lists 行 under both hang2 and xing2. They are distinct entries, but
    // the candidate list is keyed on displayed text, so the second is deduplicated.
    const engine = await engineOf([
      row({ simplified: '行', pinyinNumbers: 'hang2', frequency: 50000 }),
      row({ simplified: '行', pinyinNumbers: 'hang5', frequency: 40000 }),
    ]);

    const result = await engine.search('hang');
    expect(result.total).toBe(1);
    expect(result.candidates.map((c) => c.hanzi)).toEqual(['行']);
    // The more frequent reading is the one that survives deduplication.
    expect(result.candidates[0].pinyinNumbers).toBe('hang2');
  });
});

describe('PinyinTrie', () => {
  const manyEntries = () =>
    Array.from({ length: 30 }, (_, i) =>
      entry({
        simplified: `字${i}`,
        traditional: `字${i}`,
        pinyinClean: 'zi',
        pinyinNumbers: 'zi4',
        pinyinSyllables: ['zi4'],
      })
    );

  const trieOf = (entries: DictEntry[]) => {
    const trie = new PinyinTrie();
    for (const item of entries) {
      trie.insert(item.pinyinClean, item);
    }
    return trie;
  };

  it('stops collecting once maxResults is reached', () => {
    const trie = trieOf(manyEntries());

    expect(trie.searchPrefix('zi', 5)).toHaveLength(5);
    expect(trie.searchPrefix('zi')).toHaveLength(30);
  });

  it('returns nothing for a prefix that does not exist', () => {
    const trie = trieOf([entry({})]);
    expect(trie.searchPrefix('qq')).toEqual([]);
    expect(trie.searchExact('qq')).toEqual([]);
  });

  it('returns nothing when the key stops partway along a path', () => {
    const trie = trieOf([
      entry({ simplified: '你好', pinyinClean: 'nihao', pinyinNumbers: 'ni3 hao3' }),
    ]);
    // "ni" is a real path in the trie, but carries no entries of its own.
    expect(trie.searchExact('ni')).toEqual([]);
  });

  it('walks partial prefixes that are themselves nodes', () => {
    const trie = trieOf([
      entry({ simplified: '你', pinyinClean: 'ni', pinyinNumbers: 'ni3', pinyinSyllables: ['ni3'] }),
      entry({
        simplified: '你好',
        pinyinClean: 'nihao',
        pinyinNumbers: 'ni3 hao3',
        pinyinSyllables: ['ni3', 'hao3'],
      }),
    ]);

    // "ni" is both a complete entry and the start of "nihao"; both must be found.
    expect(trie.searchExact('ni').map((e) => e.simplified)).toEqual(['你']);
    expect(trie.searchPrefix('ni').map((e) => e.simplified).sort()).toEqual(['你', '你好']);
  });

  it('lowercases keys on insert and lookup', () => {
    const trie = trieOf([
      entry({ simplified: '你', pinyinClean: 'ni', pinyinNumbers: 'ni3', pinyinSyllables: ['ni3'] }),
    ]);
    expect(trie.searchExact('NI').map((e) => e.simplified)).toEqual(['你']);
  });

  it('collects entries from child branches as well as the current node', () => {
    // Exercises the recursion in collectAll, where a node has both its own entries
    // and children that also match the prefix.
    const trie = trieOf([
      entry({ simplified: '你', pinyinClean: 'ni', pinyinNumbers: 'ni3', pinyinSyllables: ['ni3'] }),
      entry({
        simplified: '泥',
        pinyinClean: 'nihui',
        pinyinNumbers: 'ni2 hui4',
        pinyinSyllables: ['ni2', 'hui4'],
      }),
    ]);

    expect(trie.searchPrefix('ni').map((e) => e.simplified)).toEqual(['你', '泥']);
  });

  it('stops recursing when a branch fills the cap before its siblings are visited', () => {
    // "ni" is an interior node here: it holds no entry of its own and has two
    // children. Capping at 1 must stop the walk right after the first child
    // subtree fills the cap, leaving the sibling branch entirely unwalked.
    const trie = trieOf([
      entry({ simplified: '泥', pinyinClean: 'nihui', pinyinNumbers: 'ni2 hui4', pinyinSyllables: ['ni2', 'hui4'] }),
      entry({ simplified: '妮', pinyinClean: 'nini', pinyinNumbers: 'ni1 ni5', pinyinSyllables: ['ni1', 'ni5'] }),
    ]);

    expect(trie.searchPrefix('ni', 1).map((e) => e.simplified)).toEqual(['泥']);
    // Uncapped, both branches are reachable.
    expect(trie.searchPrefix('ni').map((e) => e.simplified).sort()).toEqual(['妮', '泥'].sort());
  });

  it('returns nothing for a prefix capped at zero results', () => {
    const trie = trieOf(manyEntries());
    expect(trie.searchPrefix('zi', 0)).toEqual([]);
  });
});
