import { describe, it, expect } from 'vitest';
import {
  parseCedictLine,
  parseFrequencyList,
  parseHskList,
  normalizeFrequency,
  buildDictRow,
  joinCorpora,
  type RawCedictLine,
} from './build-dictionary';
import { normalizePinyin } from '../src/parser/pinyin.js';
import { buildBTree } from '../src/data/btree-builder.js';
import { BTreeDictionary } from '../src/data/btree-dictionary.js';

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

describe('joinCorpora', () => {
  const cedict = [
    '# CC-CEDICT comment line',
    '中國 中国 [Zhong1 guo2] /China/',
    '你好 你好 [Ni3 hao3] /hello/hi/',
    '你 你 [Ni3] /you/',
    '五 五 [Wu3] /five/',
    '龘 龘 [da4] /a rare dragon character/',
    'not a valid cedict line at all',
    '',
  ].join('\n');

  const frequency = '中国 7000\n你好 5000\n五 100\n';
  const hsk = ['1\t1\t你\tyou', '2\t2\t中国\tchina'].join('\n');

  it('emits one row per valid CC-CEDICT line and reports the count', () => {
    const { stats } = joinCorpora(cedict, frequency, hsk);
    expect(stats.cedictLines).toBe(5);
    expect(stats.emitted).toBe(5);
  });

  it('joins frequency and HSK data onto the matching rows', () => {
    const { rows } = joinCorpora(cedict, frequency, hsk);
    const china = rows.find((r) => r[0] === '中国')!;
    // 7000 of a 7000 corpus maximum reaches the top of the scale.
    expect(china[4]).toBe(100000);
    expect(china[5]).toBe(2);
  });

  it('reports coverage counts for frequency, HSK and single characters', () => {
    const { stats } = joinCorpora(cedict, frequency, hsk);
    expect(stats.withFrequency).toBe(3);
    expect(stats.withHsk).toBe(2);
    // 你, 五 and 龘 are single characters; 中国 and 你好 are not.
    expect(stats.singleChar).toBe(3);
  });

  it('leaves frequency and HSK at 0 for a word missing from both corpora', () => {
    const { rows } = joinCorpora(cedict, frequency, hsk);
    const rare = rows.find((r) => r[0] === '龘')!;
    expect(rare[4]).toBe(0);
    expect(rare[5]).toBe(0);
  });

  it('keeps distinct readings of the same word as separate rows', () => {
    const multi = ['行 行 [hang2] /to walk/', '行 行 [xing2] /a row/', '行 行 [hang2] /to walk/'].join(
      '\n'
    );
    const { rows, stats } = joinCorpora(multi, '', '');
    expect(rows.map((r) => r[2])).toEqual(['hang2', 'xing2']);
    expect(stats.dropped).toBe(1);
  });

  it('deduplicates an identical word and reading even when the definitions differ', () => {
    const dupe = ['行 行 [hang2] /to walk/', '行 行 [hang2] /to stroll/'].join('\n');
    const { rows, stats } = joinCorpora(dupe, '', '');
    expect(rows).toHaveLength(1);
    expect(stats.dropped).toBe(1);
  });

  it('treats a differently-cased pinyin column as the same reading', () => {
    const dupe = ['中 中 [zhong1] /middle/', '中 中 [Zhong1] /middle/'].join('\n');
    const { stats } = joinCorpora(dupe, '', '');
    expect(stats.dropped).toBe(1);
  });

  it('reduces frequency by 10x for surname entries', () => {
    const cedict = '张 张 [Zhang1] /surname Zhang/\n';
    const frequency = '张 1000\n';
    const { rows } = joinCorpora(cedict, frequency, '');
    expect(rows[0][4]).toBe(10000);
  });

  it('keeps the non-surname entry when a duplicate entry is a surname', () => {
    const dupe = ['能 能 [neng2] /to be able to/', '能 能 [neng2] /surname Neng/'].join('\n');
    const { rows, stats } = joinCorpora(dupe, '', '');
    expect(rows).toHaveLength(1);
    expect(rows[0][3]).toBe('to be able to');
    expect(stats.dropped).toBe(1);
  });

  it('replaces a surname entry when a duplicate non-surname entry appears', () => {
    const dupe = ['能 能 [neng2] /surname Neng/', '能 能 [neng2] /to be able to/'].join('\n');
    const { rows } = joinCorpora(dupe, '', '');
    expect(rows).toHaveLength(1);
    expect(rows[0][3]).toBe('to be able to');
  });

  it('replaces an existing entry when a duplicate entry has higher frequency', () => {
    const dupe = ['单 单 [dan1] /mountain/surname Shan/', '单 单 [dan1] /bill/list/'].join('\n');
    const frequency = '单 1000\n';
    const { rows } = joinCorpora(dupe, frequency, '');
    expect(rows).toHaveLength(1);
    expect(rows[0][3]).toBe('bill / list');
    expect(rows[0][4]).toBe(100000);
  });

  it('recognizes an existing surname entry whose surname sense is not listed first', () => {
    // With no frequency data both readings score 0, so only the surname rule can decide.
    // The shortened gloss "mountain / surname Shan" does not start with "surname ", and
    // judging the existing row by its gloss used to keep it.
    const dupe = ['单 单 [dan1] /mountain/surname Shan/', '单 单 [dan1] /bill/list/'].join('\n');
    const { rows } = joinCorpora(dupe, '', '');
    expect(rows).toHaveLength(1);
    expect(rows[0][3]).toBe('bill / list');
  });

  it('accounts for every CC-CEDICT line as emitted or dropped', () => {
    const dupes = [
      '能 能 [neng2] /surname Neng/',
      '能 能 [neng2] /to be able to/', // replaces the surname row
      '能 能 [neng2] /surname Neng/', // dropped in favour of the regular row
      '中 中 [zhong1] /middle/',
    ].join('\n');
    const { rows, stats } = joinCorpora(dupes, '', '');
    expect(rows).toHaveLength(2);
    expect(stats.dropped).toBe(2);
    expect(stats.emitted + stats.dropped).toBe(stats.cedictLines);
  });

  it('returns no rows for an empty corpus', () => {
    const { rows, stats } = joinCorpora('', '', '');
    expect(rows).toEqual([]);
    expect(stats).toMatchObject({ cedictLines: 0, emitted: 0, dropped: 0 });
  });

  it('refuses to emit a row whose pinyin column cannot be parsed', () => {
    const broken = '中 中 [1] /middle/';
    expect(() => joinCorpora(broken, '', '')).toThrow(/unparsable pinyin/);
  });

  it('round-trips its rows through the B-tree, each reachable by its toneless key', () => {
    const { rows } = joinCorpora(cedict, frequency, hsk);
    const dictionary = BTreeDictionary.open(
      buildBTree(rows)
    );
    expect(rows).toHaveLength(5);
    expect(dictionary.entryCount).toBe(5);
    const expected: [string, string][] = [
      ['zhongguo', '中国'],
      ['nihao', '你好'],
      ['ni', '你'],
      ['wu', '五'],
      ['da', '龘'],
    ];
    for (const [key, simplified] of expected) {
      const found = dictionary.lookupExact(key);
      expect(found.map((e) => e.simplified), key).toEqual([simplified]);
    }
  });
});
