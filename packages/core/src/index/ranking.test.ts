import { describe, it, expect } from 'vitest';
import { PinyinSearchEngine } from './search';
import { countCharacters } from './ranking';
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

function engineOf(entries: DictEntry[]) {
  return new PinyinSearchEngine(entries);
}

describe('PinyinSearchEngine popularity tiebreakers', () => {
  it('ranks an exact multi-character match above a more frequent partial match', () => {
    // "nihao" must offer 你好 (exact) before 你 (prefix, far more frequent).
    const engine = engineOf([
      entry({
        simplified: '你',
        traditional: '你',
        pinyinNumbers: 'ni3',
        pinyinMarks: 'nǐ',
        pinyinClean: 'ni',
        pinyinSyllables: ['ni3'],
        shortGloss: 'you',
        frequency: 99000,
        hskLevel: 1,
      }),
      entry({
        simplified: '你好',
        traditional: '你好',
        pinyinNumbers: 'ni3 hao3',
        pinyinMarks: 'nǐ hǎo',
        pinyinClean: 'nihao',
        pinyinSyllables: ['ni3', 'hao3'],
        shortGloss: 'hello',
        frequency: 6000,
        hskLevel: 0,
      }),
    ]);

    const { candidates } = engine.search('nihao', { limit: 10 });
    expect(candidates[0].hanzi).toBe('你好');
  });

  it('does not let frequency promote a longer exact match above a common shorter one', () => {
    // 中国 (2 chars) must stay ahead of 中国中央电视台 (8 chars) despite the
    // unbounded length bonus this replaced.
    const long = '中国中央电视台';
    const engine = engineOf([
      entry({
        simplified: long,
        traditional: long,
        pinyinNumbers: 'zhong1 guo2 zhong1 yang2 dian4 shi4 tai2',
        pinyinMarks: 'zhōng guó zhōng yāng diàn shì tái',
        pinyinClean: 'zhongguozhongyangdianshitai',
        pinyinSyllables: [],
        shortGloss: 'CCTV',
        frequency: 0,
      }),
      entry({
        simplified: '中国',
        traditional: '中國',
        pinyinNumbers: 'zhong1 guo2',
        pinyinMarks: 'zhōng guó',
        pinyinClean: 'zhongguo',
        pinyinSyllables: ['zhong1', 'guo2'],
        shortGloss: 'China',
        frequency: 7000,
        hskLevel: 1,
      }),
    ]);

    const { candidates } = engine.search('zhongguo', { limit: 10 });
    expect(candidates[0].hanzi).toBe('中国');
  });

  it('orders equal-quality matches by frequency', () => {
    const engine = engineOf([
      entry({ simplified: '塔', pinyinClean: 'ta', pinyinNumbers: 'ta3', shortGloss: 'rare' }),
      entry({ simplified: '他', pinyinClean: 'ta', pinyinNumbers: 'ta1', shortGloss: 'common', frequency: 90000 }),
    ]);

    const { candidates } = engine.search('ta', { limit: 10 });
    expect(candidates.map((c) => c.hanzi)).toEqual(['他', '塔']);
  });

  it('orders equal-quality matches by HSK level when frequency ties', () => {
    const engine = engineOf([
      entry({ simplified: '乙', pinyinClean: 'yi', pinyinNumbers: 'yi3', shortGloss: 'hard', hskLevel: 6 }),
      entry({ simplified: '甲', pinyinClean: 'yi', pinyinNumbers: 'jia3', shortGloss: 'easy', hskLevel: 1 }),
    ]);

    const { candidates } = engine.search('yi', { limit: 10 });
    expect(candidates[0].hanzi).toBe('甲');
  });

  it('prefers a multi-character word over a single character of equal frequency', () => {
    const engine = engineOf([
      entry({ simplified: '五', pinyinClean: 'wu', pinyinNumbers: 'wu3', shortGloss: 'five' }),
      entry({
        simplified: '午饭',
        pinyinClean: 'wu',
        pinyinNumbers: 'wu3 fan4',
        pinyinSyllables: ['wu3', 'fan4'],
        shortGloss: 'lunch',
      }),
    ]);

    const { candidates } = engine.search('wu', { limit: 10 });
    expect(candidates[0].hanzi).toBe('午饭');
  });

  it('keeps every match quality tier ahead of a maximum-popularity weaker match', () => {
    // The strongest partial match must not lose to a rare exact match, nor the
    // weakest to the strongest, regardless of frequency or HSK.
    const engine = engineOf([
      entry({ simplified: '强', pinyinClean: 'qiang', pinyinNumbers: 'qiang2', shortGloss: 'strong', frequency: 100000, hskLevel: 1 }),
      entry({ simplified: '弱', pinyinClean: 'qiang', pinyinNumbers: 'ruo4', shortGloss: 'weak' }),
    ]);

    const { candidates } = engine.search('qiang', { limit: 10 });
    expect(candidates[0].hanzi).toBe('强');
  });

  it('does not mistake a rare supplementary-plane character for a multi-character word', () => {
    // 𩽾 is one character that needs a surrogate pair, so a UTF-16 length check calls it
    // two characters and hands it the word boost that belongs to 你好. Real corpus
    // entries prove the point: typing "an1" offered 𩽾 (frequency 0) above 安.
    const engine = engineOf([
      entry({
        simplified: '𩽾',
        pinyinClean: 'an',
        pinyinNumbers: 'an1',
        pinyinSyllables: ['an1'],
        shortGloss: 'used in 鮟鱇',
      }),
      entry({
        simplified: '安',
        pinyinClean: 'an',
        pinyinNumbers: 'an1',
        pinyinSyllables: ['an1'],
        shortGloss: 'peaceful',
        frequency: 54888,
      }),
    ]);

    const { candidates } = engine.search('an1', { limit: 10 });
    expect(candidates[0].hanzi).toBe('安');
  });

  it('still gives a genuine two-character word the boost', () => {
    const engine = engineOf([
      entry({ simplified: '𩽾', pinyinClean: 'an', pinyinNumbers: 'an1', pinyinSyllables: ['an1'], shortGloss: 'rare' }),
      entry({ simplified: '安安', pinyinClean: 'anan', pinyinNumbers: 'an1 an1', pinyinSyllables: ['an1', 'an1'], shortGloss: 'word' }),
    ]);

    const { candidates } = engine.search('anan', { limit: 10 });
    expect(candidates[0].hanzi).toBe('安安');
  });
});

describe('PinyinSearchEngine tone filters across word lengths', () => {
  it('does not let one typed tone promote a longer word over the character asked for', () => {
    // Typing "bian3" must answer "which third-tone character?", so 扁 (biǎn) leads.
    // 彼岸 matched on its first syllable alone and used to take the bonus with it.
    const engine = engineOf([
      entry({ simplified: '扁', pinyinClean: 'bian', pinyinNumbers: 'bian3', pinyinSyllables: ['bian3'], shortGloss: 'flat', frequency: 40000 }),
      entry({ simplified: '彼岸', pinyinClean: 'bianan', pinyinNumbers: 'bian3 an4', pinyinSyllables: ['bian3', 'an4'], shortGloss: 'the other shore', frequency: 90000 }),
    ]);

    const { candidates } = engine.search('bian3', { limit: 10 });
    expect(candidates[0].hanzi).toBe('扁');
  });

  it('still filters a longer word when every one of its tones is typed', () => {
    const engine = engineOf([
      entry({ simplified: '你好', pinyinClean: 'nihao', pinyinNumbers: 'ni3 hao3', pinyinSyllables: ['ni3', 'hao3'], shortGloss: 'hello' }),
      entry({ simplified: '尼好', pinyinClean: 'nihao', pinyinNumbers: 'ni2 hao3', pinyinSyllables: ['ni2', 'hao3'], shortGloss: 'a name' }),
    ]);

    const { candidates } = engine.search('nihao33', { limit: 10 });
    expect(candidates.map((c) => c.hanzi)).toEqual(['你好']);
  });

  it('drops a shorter word that cannot supply the tone that was typed', () => {
    const engine = engineOf([
      entry({ simplified: '安', pinyinClean: 'an', pinyinNumbers: 'an', pinyinSyllables: ['an'], shortGloss: 'toneless' }),
    ]);

    expect(engine.search('an1').candidates).toEqual([]);
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
