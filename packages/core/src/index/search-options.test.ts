import { describe, it, expect } from 'vitest';
import { PinyinSearchEngine } from './search';
import { PinyinTrie } from './trie';
import type { DictEntry } from '../types.js';

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

describe('PinyinSearchEngine option defaults', () => {
  const engine = new PinyinSearchEngine([entry({})]);

  it('returns an empty result for a blank query', () => {
    for (const query of ['', '   ']) {
      const result = engine.search(query);
      expect(result).toEqual({ query: '', segments: [], candidates: [], total: 0 });
    }
  });

  it('normalizes case and surrounding whitespace on the query', () => {
    const result = engine.search('  ZI  ');
    expect(result.query).toBe('zi');
  });

  it('defaults to simplified script', () => {
    const mixed = new PinyinSearchEngine([
      entry({
        simplified: '发',
        traditional: '發',
        pinyinClean: 'fa',
        pinyinNumbers: 'fa1',
        pinyinSyllables: ['fa1'],
      }),
    ]);

    expect(mixed.search('fa').candidates[0].hanzi).toBe('发');
    expect(mixed.search('fa', { script: 'simplified' }).candidates[0].hanzi).toBe('发');
    expect(mixed.search('fa', { script: 'traditional' }).candidates[0].hanzi).toBe('發');
  });

  it('applies a default result limit of 10', () => {
    const many = new PinyinSearchEngine(
      Array.from({ length: 25 }, (_, i) =>
        entry({
          simplified: `字${i}`,
          traditional: `字${i}`,
          pinyinClean: 'zi',
          pinyinNumbers: 'zi4',
          pinyinSyllables: ['zi4'],
        })
      )
    );

    const result = many.search('zi');
    expect(result.candidates).toHaveLength(10);
    // total reports the full match count, not the truncated page.
    expect(result.total).toBe(25);
  });

  it('honors an explicit limit', () => {
    const many = new PinyinSearchEngine(
      Array.from({ length: 25 }, (_, i) =>
        entry({
          simplified: `字${i}`,
          traditional: `字${i}`,
          pinyinClean: 'zi',
          pinyinNumbers: 'zi4',
          pinyinSyllables: ['zi4'],
        })
      )
    );

    expect(many.search('zi', { limit: 3 }).candidates).toHaveLength(3);
  });

  it('skips prefix candidates when exactOnly is set', () => {
    const engine = new PinyinSearchEngine([
      entry({ simplified: '字', pinyinClean: 'zi', pinyinNumbers: 'zi4', pinyinSyllables: ['zi4'] }),
      entry({
        simplified: '紫',
        pinyinClean: 'zi se',
        pinyinNumbers: 'zi3 se4',
        pinyinSyllables: ['zi3', 'se4'],
      }),
    ]);

    expect(engine.search('zi').candidates.map((c) => c.hanzi)).toEqual(['字', '紫']);
    expect(engine.search('zi', { exactOnly: true }).candidates.map((c) => c.hanzi)).toEqual(['字']);
  });

  it('reports segments for the query', () => {
    const result = engine.search('nihao');
    expect(result.segments).toEqual(['ni', 'hao']);
  });

  it('searches on the cleaned query when the input has no segmentable syllables', () => {
    // A query made only of separators cleans to an empty prefix, so there is no
    // first syllable to fall back on. The search must still run rather than throw.
    const engine2 = new PinyinSearchEngine([
      entry({ simplified: '啊', pinyinClean: 'a', pinyinNumbers: 'a5', pinyinSyllables: ['a5'] }),
    ]);

    const result = engine2.search("'");
    expect(result.segments).toEqual([]);
    expect(result.query).toBe("'");
    expect(result.candidates.map((c) => c.hanzi)).toEqual(['啊']);
  });
});

describe('PinyinSearchEngine tone filtering edge cases', () => {
  it('drops an entry with no tone number when a tone is typed', () => {
    // A hand-authored entry can carry a toneless reading. There is no tone to match,
    // so it cannot satisfy a tone filter and must not be offered.
    const engine = new PinyinSearchEngine([
      entry({ simplified: '塔', pinyinClean: 'ta', pinyinNumbers: 'ta', pinyinSyllables: ['ta'] }),
    ]);

    expect(engine.search('ta4').candidates).toEqual([]);
  });

  it('keeps a toneless entry when no tone is typed', () => {
    const engine = new PinyinSearchEngine([
      entry({ simplified: '塔', pinyinClean: 'ta', pinyinNumbers: 'ta', pinyinSyllables: ['ta'] }),
    ]);

    expect(engine.search('ta').candidates.map((c) => c.hanzi)).toEqual(['塔']);
  });

  it('shows only one candidate when two readings share the same hanzi', () => {
    // CC-CEDICT lists 行 under both hang2 and xing2. They are distinct entries, but
    // the candidate list is keyed on displayed text, so the second is deduplicated.
    const engine = new PinyinSearchEngine([
      entry({
        simplified: '行',
        pinyinClean: 'hang',
        pinyinNumbers: 'hang2',
        pinyinSyllables: ['hang2'],
        frequency: 50000,
      }),
      entry({
        simplified: '行',
        pinyinClean: 'hang',
        pinyinNumbers: 'hang5',
        pinyinSyllables: ['hang5'],
        frequency: 40000,
      }),
    ]);

    const result = engine.search('hang');
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
