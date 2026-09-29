import { describe, it, expect } from 'vitest';
import { PinyinSearchEngine } from './search';
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
});
