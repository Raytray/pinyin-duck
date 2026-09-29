import { describe, it, expect } from 'vitest';
import {
  parseCedictLine,
  parseFrequencyList,
  parseHskList,
  normalizeFrequency,
  buildDictRow,
  type RawCedictLine,
} from './build-dictionary';
import { normalizePinyin } from '../src/parser/pinyin.js';
import { formatGloss } from '../src/dictionary/gloss.js';

const cctv: RawCedictLine = {
  traditional: '中國中央電視台',
  simplified: '中国中央电视台',
  pinyin: 'Zhong1 guo2 Zhong1 yang2 Dian4 shi4 tai2',
  definitions: ['China Central Television (CCTV)', 'PRC state TV network'],
};

describe('parseCedictLine', () => {
  it('splits a CC-CEDICT record into its columns', () => {
    const line = `${cctv.traditional} ${cctv.simplified} [${cctv.pinyin}] /${cctv.definitions[0]}/`;
    expect(parseCedictLine(line)).toEqual({ ...cctv, definitions: [cctv.definitions[0]] });
  });

  it('returns null for comments and blank lines', () => {
    expect(parseCedictLine('# comment')).toBeNull();
    expect(parseCedictLine('')).toBeNull();
    expect(parseCedictLine('   ')).toBeNull();
  });

  it('returns null for a malformed record', () => {
    expect(parseCedictLine('single word with no pinyin')).toBeNull();
    expect(parseCedictLine('繁體 简体 [pin1 yin1] /no trailing slash')).toBeNull();
  });

  it('splits multiple definitions', () => {
    const line = '繁體 简体 [zhong1 guo2] /China/the Middle Kingdom/';
    expect(parseCedictLine(line)?.definitions).toEqual(['China', 'the Middle Kingdom']);
  });

  it('keeps a semicolon that belongs to a single definition', () => {
    // CC-CEDICT uses "/" as the only segment separator, so a semicolon inside one
    // definition is part of the text, not a break.
    const line = '繁體 简体 [yang1 sheng1] /to increase; to raise/';
    expect(parseCedictLine(line)?.definitions).toEqual(['to increase; to raise']);
  });

  it('drops empty definition segments', () => {
    const line = '繁體 简体 [ce4 shi4] /western style//';
    expect(parseCedictLine(line)?.definitions).toEqual(['western style']);
  });
});

describe('normalizePinyin', () => {
  it('lowercases the capital initials CC-CEDICT uses for proper nouns', () => {
    expect(normalizePinyin('Zhong1 guo2')).toBe('zhong1 guo2');
  });

  it('collapses runs of whitespace between syllables', () => {
    expect(normalizePinyin('ni3   hao3  ma5')).toBe('ni3 hao3 ma5');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizePinyin('  zhong1 guo2  ')).toBe('zhong1 guo2');
  });
});

describe('formatGloss', () => {
  it('joins definitions with a slash', () => {
    expect(formatGloss(['China', 'the Middle Kingdom'])).toBe('China / the Middle Kingdom');
  });

  it('keeps at most three definitions', () => {
    expect(formatGloss(['a', 'b', 'c', 'd'])).toBe('a / b / c');
  });

  it('drops classifier annotations', () => {
    expect(formatGloss(['CL:個|个[ge4]', 'classifier'])).toBe('classifier');
  });

  it('strips pronunciation bracket tags', () => {
    expect(formatGloss(['see 塔 [ta3]'])).toBe('see 塔');
  });

  it('truncates a long gloss with an ellipsis', () => {
    const gloss = formatGloss(['x'.repeat(100)], 20);
    expect(gloss).toHaveLength(20);
    expect(gloss.endsWith('…')).toBe(true);
  });

  it('returns an empty string for no definitions', () => {
    expect(formatGloss([])).toBe('');
    expect(formatGloss(['  '])).toBe('');
  });
});

describe('parseFrequencyList', () => {
  it('reads "word count" lines into a lookup', () => {
    expect(parseFrequencyList('你好 5000\n中国 7000\n')).toEqual(
      new Map([
        ['你好', 5000],
        ['中国', 7000],
      ])
    );
  });

  it('keeps the last count when a word repeats', () => {
    expect(parseFrequencyList('中国 7000\n中国 8000\n').get('中国')).toBe(8000);
  });

  it('ignores lines whose count is not a finite number', () => {
    expect(parseFrequencyList('中国 abc\n你好 12x\n我 42\n').size).toBe(1);
  });

  it('ignores lines with no count column', () => {
    expect(parseFrequencyList('中国\n').size).toBe(0);
  });
});

describe('parseHskList', () => {
  it('reads tab-separated rows keyed on the hanzi column', () => {
    const content = ['1\t1\t你好\tni3 hao3\thello', '4\t40\t中国\tzhong1 guo2\tChina'].join('\n');
    expect(parseHskList(content)).toEqual(
      new Map([
        ['你好', 1],
        ['中国', 4],
      ])
    );
  });

  it('ignores rows whose level is not 1-6', () => {
    const content = ['0\t1\t甲\tjia3\ta', '7\t2\t乙\tyi3\tb', '3\t3\t丙\tbing3\tc'].join('\n');
    expect(parseHskList(content)).toEqual(new Map([['丙', 3]]));
  });

  it('ignores rows with too few columns', () => {
    expect(parseHskList('1\t1').size).toBe(0);
  });

  it('keeps the easiest level when a word is listed more than once', () => {
    const content = ['5\t1\t猫\tmao1\tcat', '2\t2\t猫\tmao1\tcat'].join('\n');
    expect(parseHskList(content).get('猫')).toBe(2);
  });
});

describe('normalizeFrequency', () => {
  it('maps the busiest word in the corpus to the top of the scale', () => {
    expect(normalizeFrequency(1000, 1000)).toBe(100000);
  });

  it('returns 0 for words absent from the corpus', () => {
    expect(normalizeFrequency(0, 1000)).toBe(0);
  });

  it('stays within 0-100000 across the whole distribution', () => {
    for (const count of [1, 10, 100, 1000, 10000, 100000, 3957141]) {
      const value = normalizeFrequency(count, 1000);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100000);
    }
  });

  it('clamps a count above the corpus maximum instead of exceeding the ceiling', () => {
    expect(normalizeFrequency(5000, 1000)).toBe(100000);
  });

  it('compresses the long tail so mid-frequency words stay distinguishable', () => {
    // A linear map would collapse 10 and 100 of a 1000 maximum onto 1000 and 10000;
    // log scaling must keep them clearly separated.
    expect(normalizeFrequency(10, 1000)).toBeLessThan(normalizeFrequency(100, 1000));
  });

  it('is monotonic in the count', () => {
    let previous = -1;
    for (const count of [1, 5, 50, 500, 5000, 50000]) {
      const value = normalizeFrequency(count, 100000);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('degrades to 0 when the corpus maximum is unknown', () => {
    expect(normalizeFrequency(500, 0)).toBe(0);
  });
});

describe('buildDictRow', () => {
  it('emits a row in the documented column order', () => {
    expect(buildDictRow(cctv, 0, 0)).toEqual([
      '中国中央电视台',
      '中國中央電視台',
      'zhong1 guo2 zhong1 yang2 dian4 shi4 tai2',
      'China Central Television (CCTV) / PRC state TV network',
      0,
      0,
    ]);
  });

  it('carries the normalized frequency and HSK level through', () => {
    const row = buildDictRow(cctv, 58468, 1);
    expect(row[4]).toBe(58468);
    expect(row[5]).toBe(1);
  });

  it('defaults frequency and HSK level to 0 when the word is not in either corpus', () => {
    const row = buildDictRow(cctv);
    expect(row[4]).toBe(0);
    expect(row[5]).toBe(0);
  });

  it('normalizes the pinyin column', () => {
    const row = buildDictRow(cctv, 0, 0);
    expect(row[2]).toBe('zhong1 guo2 zhong1 yang2 dian4 shi4 tai2');
  });
});
