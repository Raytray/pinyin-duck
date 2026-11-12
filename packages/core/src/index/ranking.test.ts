import { describe, it, expect } from 'vitest';
import { LazyPinyinSearchEngine } from './lazy-search';
import { compareScored, countCharacters } from './ranking';
import { parseToneFilter, syllableToneEnds } from '../parser/pinyin';
import { buildBTree } from '../data/btree-builder';
import { MemoryPageSource } from '../data/page-source';
import { openBTreeDictionaryFromSource } from '../data/btree-dictionary';
import type { DictionaryRow } from '../data/dictionary-codec';

/**
 * A dictionary row written by field. Clean pinyin and tone marks are derived from
 * `pinyinNumbers`, exactly as the engine derives them from the shipped asset.
 */
interface Fixture {
  simplified?: string;
  traditional?: string;
  pinyinNumbers?: string;
  shortGloss?: string;
  frequency?: number;
  hskLevel?: number;
}

function entry(fixture: Fixture): DictionaryRow {
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

/** A lazy engine over an in-memory B-tree built from `rows`. */
async function engineOf(rows: DictionaryRow[]): Promise<LazyPinyinSearchEngine> {
  return new LazyPinyinSearchEngine(
    await openBTreeDictionaryFromSource(new MemoryPageSource(buildBTree(rows)))
  );
}

describe('popularity tiebreakers', () => {
  it('ranks an exact multi-character match above a more frequent partial match', async () => {
    // "nihao" must offer 你好 (exact) before 你 (prefix, far more frequent).
    const engine = await engineOf([
      entry({
        simplified: '你',
        traditional: '你',
        pinyinNumbers: 'ni3',
        shortGloss: 'you',
        frequency: 99000,
        hskLevel: 1,
      }),
      entry({
        simplified: '你好',
        traditional: '你好',
        pinyinNumbers: 'ni3 hao3',
        shortGloss: 'hello',
        frequency: 6000,
        hskLevel: 0,
      }),
    ]);

    const { candidates } = await engine.search('nihao', { limit: 10 });
    expect(candidates[0].hanzi).toBe('你好');
  });

  it('does not let frequency promote a longer exact match above a common shorter one', async () => {
    // 中国 (2 chars) must stay ahead of 中国中央电视台 (8 chars) despite the
    // unbounded length bonus this replaced.
    const long = '中国中央电视台';
    const engine = await engineOf([
      entry({
        simplified: long,
        traditional: long,
        pinyinNumbers: 'zhong1 guo2 zhong1 yang2 dian4 shi4 tai2',
        shortGloss: 'CCTV',
        frequency: 0,
      }),
      entry({
        simplified: '中国',
        traditional: '中國',
        pinyinNumbers: 'zhong1 guo2',
        shortGloss: 'China',
        frequency: 7000,
        hskLevel: 1,
      }),
    ]);

    const { candidates } = await engine.search('zhongguo', { limit: 10 });
    expect(candidates[0].hanzi).toBe('中国');
  });

  it('orders equal-quality matches by frequency', async () => {
    const engine = await engineOf([
      entry({ simplified: '塔', pinyinNumbers: 'ta3', shortGloss: 'rare' }),
      entry({ simplified: '他', pinyinNumbers: 'ta1', shortGloss: 'common', frequency: 90000 }),
    ]);

    const { candidates } = await engine.search('ta', { limit: 10 });
    expect(candidates.map((c) => c.hanzi)).toEqual(['他', '塔']);
  });

  it('orders equal-quality matches by HSK level when frequency ties', async () => {
    const engine = await engineOf([
      entry({ simplified: '乙', pinyinNumbers: 'yi3', shortGloss: 'hard', hskLevel: 6 }),
      entry({ simplified: '一', pinyinNumbers: 'yi1', shortGloss: 'easy', hskLevel: 1 }),
    ]);

    const { candidates } = await engine.search('yi', { limit: 10 });
    expect(candidates[0].hanzi).toBe('一');
  });

  it('prefers a multi-character word over a single character of equal frequency', async () => {
    // Both read "xian" exactly, so only the word boost separates them.
    const engine = await engineOf([
      entry({ simplified: '先', pinyinNumbers: 'xian1', shortGloss: 'first' }),
      entry({ simplified: '西安', pinyinNumbers: 'xi1 an1', shortGloss: "Xi'an" }),
    ]);

    const { candidates } = await engine.search('xian', { limit: 10 });
    expect(candidates[0].hanzi).toBe('西安');
  });

  it('keeps every match quality tier ahead of a maximum-popularity weaker match', async () => {
    // The strongest partial match must not lose to a rare exact match, nor the
    // weakest to the strongest, regardless of frequency or HSK.
    const engine = await engineOf([
      entry({ simplified: '强', pinyinNumbers: 'qiang2', shortGloss: 'strong', frequency: 100000, hskLevel: 1 }),
      entry({ simplified: '墙', pinyinNumbers: 'qiang2', shortGloss: 'wall' }),
    ]);

    const { candidates } = await engine.search('qiang', { limit: 10 });
    expect(candidates[0].hanzi).toBe('强');
  });

  it('does not mistake a rare supplementary-plane character for a multi-character word', async () => {
    // 𩽾 is one character that needs a surrogate pair, so a UTF-16 length check calls it
    // two characters and hands it the word boost that belongs to 你好. Real corpus
    // entries prove the point: typing "an1" offered 𩽾 (frequency 0) above 安.
    const engine = await engineOf([
      entry({
        simplified: '𩽾',
        pinyinNumbers: 'an1',
        shortGloss: 'used in 鮟鱇',
      }),
      entry({
        simplified: '安',
        pinyinNumbers: 'an1',
        shortGloss: 'peaceful',
        frequency: 54888,
      }),
    ]);

    const { candidates } = await engine.search('an1', { limit: 10 });
    expect(candidates[0].hanzi).toBe('安');
  });

  it('still gives a genuine two-character word the boost', async () => {
    const engine = await engineOf([
      entry({ simplified: '𩽾', pinyinNumbers: 'an1', shortGloss: 'rare' }),
      entry({ simplified: '安安', pinyinNumbers: 'an1 an1', shortGloss: 'word' }),
    ]);

    const { candidates } = await engine.search('anan', { limit: 10 });
    expect(candidates[0].hanzi).toBe('安安');
  });
});

describe('tone filters across word lengths', () => {
  it('does not let one typed tone promote a longer word over the character asked for', async () => {
    // Typing "bian3" must answer "which third-tone character?", so 扁 (biǎn) leads.
    // 彼岸 matched on its first syllable alone and used to take the bonus with it.
    const engine = await engineOf([
      entry({ simplified: '扁', pinyinNumbers: 'bian3', shortGloss: 'flat', frequency: 40000 }),
      entry({ simplified: '彼岸', pinyinNumbers: 'bian3 an4', shortGloss: 'the other shore', frequency: 90000 }),
    ]);

    const { candidates } = await engine.search('bian3', { limit: 10 });
    expect(candidates[0].hanzi).toBe('扁');
  });

  it('still filters a longer word when every one of its tones is typed', async () => {
    const engine = await engineOf([
      entry({ simplified: '你好', pinyinNumbers: 'ni3 hao3', shortGloss: 'hello' }),
      entry({ simplified: '尼好', pinyinNumbers: 'ni2 hao3', shortGloss: 'a name' }),
    ]);

    const { candidates } = await engine.search('ni3hao3', { limit: 10 });
    expect(candidates.map((c) => c.hanzi)).toEqual(['你好']);
  });

  it('applies a tone to the syllable it was typed after, not the first one', async () => {
    const engine = await engineOf([
      entry({ simplified: '你好', pinyinNumbers: 'ni3 hao3' }),
      entry({ simplified: '你号', pinyinNumbers: 'ni3 hao4' }),
      entry({ simplified: '泥号', pinyinNumbers: 'ni2 hao4' }),
    ]);

    // "nihao4" constrains hao. Read by order, the 4 used to land on ni and drop all three.
    expect((await engine.search('nihao4')).candidates.map((c) => c.hanzi).sort()).toEqual(['你号', '泥号']);
    // "ni3hao" constrains ni and says nothing about hao.
    expect((await engine.search('ni3hao')).candidates.map((c) => c.hanzi).sort()).toEqual(['你号', '你好']);
  });

  it('rejects a word whose syllables split the typed one differently', async () => {
    // 彼岸 is bi3 an4: it shares the letters of "bian" but has no syllable ending there.
    const engine = await engineOf([
      entry({ simplified: '扁', pinyinNumbers: 'bian3', frequency: 40000 }),
      entry({ simplified: '彼岸', pinyinNumbers: 'bi3 an4', frequency: 90000 }),
    ]);

    expect((await engine.search('bian3')).candidates.map((c) => c.hanzi)).toEqual(['扁']);
  });

  it('neither rewards nor drops a prefix candidate for a tone typed past its end', async () => {
    const engine = await engineOf([
      entry({ simplified: '你', pinyinNumbers: 'ni3', frequency: 99000 }),
      entry({ simplified: '你好', pinyinNumbers: 'ni3 hao3' }),
    ]);

    expect((await engine.search('nihao3')).candidates.map((c) => c.hanzi)).toEqual(['你好', '你']);
  });

  it('drops a shorter word that cannot supply the tone that was typed', async () => {
    const engine = await engineOf([
      entry({ simplified: '安', pinyinNumbers: 'an', shortGloss: 'toneless' }),
    ]);

    expect((await engine.search('an1')).candidates).toEqual([]);
  });
});

describe('countCharacters', () => {
  it('counts characters, not UTF-16 units', () => {
    expect(countCharacters('你')).toBe(1);
    expect(countCharacters('你好')).toBe(2);
    expect(countCharacters('𩽾')).toBe(1);
    expect(countCharacters('𩽾安')).toBe(2);
    expect(countCharacters('')).toBe(0);
  });
});

describe('parseToneFilter', () => {
  it('anchors each tone at the toneless offset where it was typed', () => {
    expect(parseToneFilter('ni3hao3')).toEqual([{ offset: 2, tone: 3 }, { offset: 5, tone: 3 }]);
    expect(parseToneFilter('nihao4')).toEqual([{ offset: 5, tone: 4 }]);
    expect(parseToneFilter("xi1'an1")).toEqual([{ offset: 2, tone: 1 }, { offset: 4, tone: 1 }]);
    expect(parseToneFilter('lv4')).toEqual([{ offset: 2, tone: 4 }]);
  });

  it('ignores digits that are not tones', () => {
    expect(parseToneFilter('ni0')).toEqual([]);
    expect(parseToneFilter('ni9')).toEqual([]);
    expect(parseToneFilter('nihao')).toEqual([]);
  });
});

describe('syllableToneEnds', () => {
  it('reports where each stored syllable ends and its tone', () => {
    expect(syllableToneEnds('ni3 hao3')).toEqual([{ offset: 2, tone: 3 }, { offset: 5, tone: 3 }]);
    expect(syllableToneEnds('lu:4')).toEqual([{ offset: 2, tone: 4 }]);
    expect(syllableToneEnds('an')).toEqual([{ offset: 2, tone: 0 }]);
  });

  it('skips tokens that hold no pinyin letters', () => {
    expect(syllableToneEnds('ka3 er3 · ma3')).toEqual([
      { offset: 2, tone: 3 },
      { offset: 4, tone: 3 },
      { offset: 6, tone: 3 },
    ]);
  });
});

describe('compareScored', () => {
  const base = { simplified: '字', pinyinClean: 'zi', pinyinNumbers: 'zi4', frequency: 0 };

  it('orders by score, then frequency, then key, form and reading', () => {
    const items = [
      { score: 1, entry: { ...base, simplified: '乙' } },
      { score: 1, entry: { ...base, simplified: '甲' } },
      { score: 1, entry: { ...base, pinyinClean: 'za' } },
      { score: 1, entry: { ...base, frequency: 5 } },
      { score: 2, entry: { ...base } },
    ];
    const order = [...items].sort(compareScored).map((item) => items.indexOf(item));
    // 'za' sorts before 'zi'; 乙 (U+4E59) sorts before 甲 (U+7532).
    expect(order).toEqual([4, 3, 2, 0, 1]);
  });
});
