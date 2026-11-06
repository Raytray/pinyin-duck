import { describe, it, expect } from 'vitest';
import { LazyPinyinSearchEngine, storedEntryToCandidate, storedEntryToScorable } from './lazy-search';
import { DEFAULT_MAX_MATCHES } from './ranking';
import { openBTreeDictionaryFromSource } from '../data/btree-dictionary';
import { MemoryPageSource } from '../data/page-source';
import { buildBTree } from '../data/btree-builder';
import { PinyinSearchEngine } from './search';
import { decodeDictionary } from '../data/load-dictionary';
import type { DictionaryRow } from '../data/dictionary-codec';
import type { StoredEntry } from '../data/btree-codec';

const rows: DictionaryRow[] = [
  ['你好', '你好', 'ni3 hao3', 'hello; hi', 60000, 0],
  ['你', '你', 'ni3', 'you (informal)', 98000, 1],
  ['尼', '尼', 'ni2', 'nun', 30000, 0],
  ['妮', '妮', 'ni1', 'girl', 12000, 0],
  ['呢', '呢', 'ne5', 'question particle', 40000, 0],
  ['霓虹灯', '霓虹燈', 'ni2 hong2 deng1', 'neon light', 200, 0],
  ['中国', '中國', 'zhong1 guo2', 'China', 58468, 1],
  ['中', '中', 'zhong1', 'middle', 50000, 0],
  ['你好吗', '你好嗎', 'ni3 hao3 ma5', 'how are you', 5000, 1],
];

async function engineWith(source = rows) {
  const dictionary = await openBTreeDictionaryFromSource(
    new MemoryPageSource(buildBTree(source))
  );
  return { dictionary, engine: new LazyPinyinSearchEngine(dictionary) };
}

const hanziOf = (result: { candidates: { hanzi: string }[] }) =>
  result.candidates.map((c) => c.hanzi);

describe('LazyPinyinSearchEngine', () => {
  it('exposes the entry count of the dictionary it reads', async () => {
    const { dictionary, engine } = await engineWith();
    expect(engine.entryCount).toBe(dictionary.entryCount);
    expect(engine.entryCount).toBe(rows.length);
  });

  it('returns an empty result for a blank query', async () => {
    const { engine } = await engineWith();
    for (const query of ['', '   ']) {
      expect(await engine.search(query)).toEqual({
        query: '',
        segments: [],
        candidates: [],
        total: 0,
      });
    }
  });

  it('ranks an exact multi-character match above a more frequent partial match', async () => {
    // The headline ranking rule: 你 must not bury 你好 for the query "nihao".
    const { engine } = await engineWith();
    const result = await engine.search('nihao', { limit: 10 });

    expect(hanziOf(result)[0]).toBe('你好');
    expect(hanziOf(result)).toContain('你');
  });

  it('normalizes case and surrounding whitespace', async () => {
    const { engine } = await engineWith();
    const result = await engine.search('  NIHAO  ');
    expect(result.query).toBe('nihao');
    expect(hanziOf(result)[0]).toBe('你好');
  });

  it('reports the syllables it segmented out of the query', async () => {
    const { engine } = await engineWith();
    expect((await engine.search('nihao')).segments).toEqual(['ni', 'hao']);
  });

  it('falls back to the first syllable for a multi-syllable query', async () => {
    // "hao" is not a word in the fixture, so only the first-syllable fallback can
    // surface 你 as a partial match.
    const { engine } = await engineWith();
    const result = await engine.search('nihao', { limit: 10 });
    expect(hanziOf(result)).toContain('你');
  });

  it('paginates with limit and offset over the full ranked list', async () => {
    const { engine } = await engineWith();
    const all = await engine.search('ni', { limit: 20 });

    const page1 = await engine.search('ni', { limit: 2, offset: 0 });
    const page2 = await engine.search('ni', { limit: 2, offset: 2 });

    expect(hanziOf(page1)).toEqual(hanziOf(all).slice(0, 2));
    expect(hanziOf(page2)).toEqual(hanziOf(all).slice(2, 4));
    // total is the size of the whole match set, not of the returned page.
    expect(page1.total).toBe(all.total);
  });

  it('skips prefix candidates when exactOnly is set', async () => {
    const { engine } = await engineWith();
    const all = hanziOf(await engine.search('ni', { limit: 20 }));
    const exact = hanziOf(await engine.search('ni', { limit: 20, exactOnly: true }));

    expect(exact.every((h) => all.includes(h))).toBe(true);
    expect(exact.length).toBeLessThan(all.length);
  });

  it('returns nothing for pinyin the dictionary does not contain', async () => {
    const { engine } = await engineWith();
    const result = await engine.search('qqq');
    expect(result.candidates).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('projects the traditional form when that script is selected', async () => {
    const { engine } = await engineWith();
    const result = await engine.search('nihongdeng', { limit: 5, script: 'traditional' });

    expect(hanziOf(result)).toContain('霓虹燈');
    // The simplified form is still what identifies the candidate.
    expect(result.candidates[0].simplified).toBe('霓虹灯');
  });

  it('drops an entry whose tones cannot satisfy a typed tone filter', async () => {
    const { engine } = await engineWith();

    // 你 is ni3 and 尼 is ni2, so a "ni3" filter must not offer 尼.
    const result = await engine.search('ni3', { limit: 10 });
    expect(hanziOf(result)).toContain('你');
    expect(hanziOf(result)).not.toContain('尼');
  });

  it('ranks ties and picks representatives exactly like the trie engine', async () => {
    // Equal-score readings of one hanzi, plus equal-score distinct hanzi, inserted in an
    // order that differs from the B-tree's key order.
    const tied: DictionaryRow[] = [
      ['甲', '甲', 'ma1', 'a', 100, 0],
      ['乙', '乙', 'ma1', 'b', 100, 0],
      ['行', '行', 'hang4', 'row', 100, 0],
      ['行', '行', 'hang2', 'to walk', 100, 0],
    ];
    const { engine } = await engineWith(tied);
    const trie = new PinyinSearchEngine(decodeDictionary(tied));

    for (const query of ['ma', 'm', 'hang', 'h']) {
      const lazy = await engine.search(query, { limit: 10 });
      const eager = trie.search(query, { limit: 10 });
      expect(lazy.candidates.map((c) => c.id)).toEqual(eager.candidates.map((c) => c.id));
    }
  });

  it('deduplicates readings that share a displayed form', async () => {
    // 行 under two readings is one candidate, not two.
    const duplicated: DictionaryRow[] = [
      ['行', '行', 'hang2', 'to walk', 50000, 0],
      ['行', '行', 'xing2', 'to conduct', 40000, 0],
      ['行', '行', 'hang2', 'duplicate', 100, 0],
    ];
    const { engine } = await engineWith(duplicated);
    const result = await engine.search('hang', { limit: 10 });

    expect(result.total).toBe(1);
    expect(hanziOf(result)).toEqual(['行']);
    // The more frequent reading is the one that survives.
    expect(result.candidates[0].pinyinNumbers).toBe('hang2');
  });

  it('bounds the scan so a wide prefix cannot run without limit', async () => {
    // 50 readings under a two-letter prefix, none of them an exact match for it, so
    // the prefix scan is the only thing that can find them.
    const many: DictionaryRow[] = Array.from({ length: 50 }, (_, i) => [
      `字${i}`,
      `字${i}`,
      `n${i}ian3`,
      'gloss',
      i,
      0,
    ]);
    const { engine } = await engineWith(many);

    const capped = await engine.search('n', { limit: 50, maxMatches: 5 });
    const uncapped = await engine.search('n', { limit: 50 });

    expect(capped.total).toBeLessThanOrEqual(5);
    expect(uncapped.total).toBe(50);
  });

  it('always looks up exact readings, whatever the scan budget is', async () => {
    // The exact key holds the readings that match the query outright, so the budget
    // trims the prefix tail and never the exact matches themselves.
    const { engine } = await engineWith();
    const result = await engine.search('ni', { limit: 50, maxMatches: 1 });

    expect(hanziOf(result)).toEqual(expect.arrayContaining(['你', '尼', '妮']));
  });

  it('takes its default scan budget from the shared ranking constant', async () => {
    const { engine } = await engineWith();
    // The budget is shared with the eager engine so both report the same totals.
    expect(DEFAULT_MAX_MATCHES).toBe(16384);
    // "ni" exactly plus "nihao", "nihaoma" and "nihongdeng" under it.
    expect((await engine.search('ni', { limit: 50 })).total).toBe(6);
  });

  it('orders equally scored candidates deterministically', async () => {
    // Same frequency, same HSK level, same key: only the tie-break can order these,
    // and it must not depend on page layout or scan order.
    const tied: DictionaryRow[] = [
      ['丙', '丙', 'bing3', 'third', 0, 0],
      ['甲', '甲', 'bing3', 'first', 0, 0],
      ['乙', '乙', 'bing3', 'second', 0, 0],
    ];
    const { engine } = await engineWith(tied);

    const first = hanziOf(await engine.search('bing', { limit: 10 }));
    const second = hanziOf(await engine.search('bing', { limit: 10 }));

    // Tie order falls back to the code-unit order of the displayed form.
    expect(first).toEqual(['丙', '乙', '甲']);
    expect(second).toEqual(first);
  });

  it('keeps the leftover pinyin when a candidate is a partial match', async () => {
    const { engine } = await engineWith();
    const result = await engine.search('nihao', { limit: 10 });
    const ni = result.candidates.find((c) => c.hanzi === '你')!;

    expect(ni.matchedPinyin).toBe('ni');
    expect(ni.remainingPinyin).toBe('hao');
  });

  it('leaves no remainder for a candidate that consumes the whole query', async () => {
    const { engine } = await engineWith();
    const result = await engine.search('nihao', { limit: 10 });
    const nihao = result.candidates.find((c) => c.hanzi === '你好')!;

    expect(nihao.matchedPinyin).toBe('nihao');
    expect(nihao.remainingPinyin).toBe('');
  });

  it('derives tone marks for the displayed pinyin', async () => {
    const { engine } = await engineWith();
    const result = await engine.search('nihao', { limit: 10 });

    expect(result.candidates[0].pinyinMarks).toBe('nǐ hǎo');
  });

  it('surfaces the stored gloss and frequency on each candidate', async () => {
    const { engine } = await engineWith();
    const [first] = (await engine.search('nihao', { limit: 1 })).candidates;

    expect(first.shortGloss).toBe('hello; hi');
    expect(first.frequency).toBe(60000);
  });

  it('agrees with the in-memory trie engine on the full dictionary', async () => {
    // The two engines share the ranking formula, so over the real fixture corpus
    // they must return the same top candidates and the same total.
    const { engine } = await engineWith();
    const eager = new PinyinSearchEngine(decodeDictionary(rows));

    for (const query of ['ni', 'nihao', 'zhongguo', 'ne', 'hao', 'n']) {
      const lazyResult = await engine.search(query, { limit: 20 });
      const eagerResult = eager.search(query, { limit: 20 });

      expect(hanziOf(lazyResult), `candidates differ for "${query}"`).toEqual(
        hanziOf(eagerResult)
      );
      expect(lazyResult.total).toBe(eagerResult.total);
    }
  });
});

describe('storedEntry projection', () => {
  const entry: StoredEntry = {
    key: 'ni',
    simplified: '你',
    traditional: '你',
    pinyinNumbers: 'ni3',
    shortGloss: 'you',
    frequency: 100,
    hskLevel: 1,
  };

  it('exposes the key as the clean pinyin the scorer expects', () => {
    expect(storedEntryToScorable(entry)).toEqual({
      simplified: '你',
      pinyinClean: 'ni',
      pinyinNumbers: 'ni3',
      frequency: 100,
      hskLevel: 1,
    });
  });

  it('treats a zero HSK level as unknown rather than HSK zero', () => {
    expect(storedEntryToScorable({ ...entry, hskLevel: 0 }).hskLevel).toBeUndefined();
  });

  it('builds a candidate with derived tone marks', () => {
    const candidate = storedEntryToCandidate(entry, 'simplified', 'nihao');

    expect(candidate.hanzi).toBe('你');
    expect(candidate.pinyinMarks).toBe('nǐ');
    expect(candidate.remainingPinyin).toBe('hao');
  });
});
