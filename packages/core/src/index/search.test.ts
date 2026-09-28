import { describe, it, expect, beforeEach } from 'vitest';
import { PinyinSearchEngine } from './search.js';
import { DictEntry } from '../types.js';

describe('PinyinSearchEngine', () => {
  let engine: PinyinSearchEngine;

  const mockEntries: DictEntry[] = [
    {
      simplified: '你好',
      traditional: '你好',
      pinyinNumbers: 'ni3 hao3',
      pinyinMarks: 'nǐ hǎo',
      pinyinClean: 'nihao',
      pinyinSyllables: ['ni3', 'hao3'],
      definitions: ['hello', 'how are you'],
      shortGloss: 'hello / how are you',
      frequency: 95000,
      hskLevel: 1,
    },
    {
      simplified: '你',
      traditional: '你',
      pinyinNumbers: 'ni3',
      pinyinMarks: 'nǐ',
      pinyinClean: 'ni',
      pinyinSyllables: ['ni3'],
      definitions: ['you (singular)'],
      shortGloss: 'you (singular)',
      frequency: 98000,
      hskLevel: 1,
    },
    {
      simplified: '泥',
      traditional: '泥',
      pinyinNumbers: 'ni2',
      pinyinMarks: 'ní',
      pinyinClean: 'ni',
      pinyinSyllables: ['ni2'],
      definitions: ['mud', 'clay'],
      shortGloss: 'mud / clay',
      frequency: 25000,
      hskLevel: 4,
    },
    {
      simplified: '他',
      traditional: '他',
      pinyinNumbers: 'ta1',
      pinyinMarks: 'tā',
      pinyinClean: 'ta',
      pinyinSyllables: ['ta1'],
      definitions: ['he', 'him'],
      shortGloss: 'he / him',
      frequency: 92000,
      hskLevel: 1,
    },
    {
      simplified: '塌',
      traditional: '塌',
      pinyinNumbers: 'ta1',
      pinyinMarks: 'tā',
      pinyinClean: 'ta',
      pinyinSyllables: ['ta1'],
      definitions: ['to collapse', 'to cave in'],
      shortGloss: 'to collapse / to cave in',
      frequency: 5000,
      hskLevel: 5,
    },
    {
      simplified: '踏',
      traditional: '踏',
      pinyinNumbers: 'ta4',
      pinyinMarks: 'tà',
      pinyinClean: 'ta',
      pinyinSyllables: ['ta4'],
      definitions: ['to step on', 'to tread'],
      shortGloss: 'to step on / to tread',
      frequency: 18000,
      hskLevel: 4,
    },
    {
      simplified: '是',
      traditional: '是',
      pinyinNumbers: 'shi4',
      pinyinMarks: 'shì',
      pinyinClean: 'shi',
      pinyinSyllables: ['shi4'],
      definitions: ['to be', 'is', 'are'],
      shortGloss: 'to be / is / are',
      frequency: 99000,
      hskLevel: 1,
    },
    {
      simplified: '十',
      traditional: '十',
      pinyinNumbers: 'shi2',
      pinyinMarks: 'shí',
      pinyinClean: 'shi',
      pinyinSyllables: ['shi2'],
      definitions: ['ten', '10'],
      shortGloss: 'ten / 10',
      frequency: 90000,
      hskLevel: 1,
    },
    {
      simplified: '中国',
      traditional: '中國',
      pinyinNumbers: 'zhong1 guo2',
      pinyinMarks: 'zhōng guó',
      pinyinClean: 'zhongguo',
      pinyinSyllables: ['zhong1', 'guo2'],
      definitions: ['China'],
      shortGloss: 'China',
      frequency: 88000,
      hskLevel: 1,
    },
  ];

  beforeEach(() => {
    engine = new PinyinSearchEngine(mockEntries);
  });

  it('finds exact multi-syllable word "nihao"', () => {
    const result = engine.search('nihao');
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].hanzi).toBe('你好');
    expect(result.candidates[0].pinyinMarks).toBe('nǐ hǎo');
    expect(result.candidates[0].shortGloss).toBe('hello / how are you');
  });

  it('ranks common homophone "他" ahead of rare "塌"', () => {
    const result = engine.search('ta');
    expect(result.candidates[0].hanzi).toBe('他');
  });

  it('filters by tone number "ta4" to pick "踏" over "他"', () => {
    const result = engine.search('ta4');
    expect(result.candidates[0].hanzi).toBe('踏');
  });

  it('filters homophone by tone number "shi4" to prioritize "是" over "十"', () => {
    const result = engine.search('shi4');
    expect(result.candidates[0].hanzi).toBe('是');
  });

  it('supports prefix matching when typing "niha"', () => {
    const result = engine.search('niha');
    expect(result.candidates.some((c) => c.hanzi === '你好')).toBe(true);
  });

  it('supports Traditional script toggle', () => {
    const result = engine.search('zhongguo', { script: 'traditional' });
    expect(result.candidates[0].hanzi).toBe('中國');
  });
});
