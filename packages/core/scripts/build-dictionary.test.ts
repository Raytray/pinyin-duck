import { describe, it, expect } from 'vitest';
import {
  parseCedictLine,
  parseFrequencyList,
  parseHskLevels,
  normalizeFrequency,
  joinCorpora,
  encodeDictionary,
  orderHeadwords,
  type HskRow,
  type RawCedictLine,
} from './build-dictionary';
import * as fs from 'fs';
import * as path from 'path';
import { normalizePinyin } from '../src/parser/pinyin.js';
import { SOURCES } from './sources.js';
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

describe('parseHskLevels', () => {
  it('reads word, reading and level, skipping the header comments', () => {
    const content = ['# HSK 3.0 word levels', '#', '好\thǎo\t1', '谢谢\txièxie\t1', '卡\tqiǎ\t7', ''].join('\n');
    expect(parseHskLevels(content)).toEqual([
      { word: '好', reading: 'hǎo', level: 1 },
      { word: '谢谢', reading: 'xièxie', level: 1 },
      { word: '卡', reading: 'qiǎ', level: 7 },
    ]);
  });

  it('refuses a row whose level is not 1-7', () => {
    expect(() => parseHskLevels('好\thǎo\t8')).toThrow(/好/);
  });
});

describe('HSK attachment', () => {
  /** The HSK level a build gives the group of `simplified` at `pinyinNumbers`. */
  function levelOf(cedict: string[], hsk: string[], simplified: string, pinyinNumbers: string): number {
    const { rows } = joinCorpora(cedict.join('\n'), '', hsk.join('\n'));
    const row = rows.find((r) => r[0] === simplified && r[2] === pinyinNumbers);
    if (!row) throw new Error(`no row for ${simplified} ${pinyinNumbers}`);
    return row[5];
  }

  it('gives each reading of a heteronym its own level', () => {
    const cedict = [
      '好 好 [hao3] /good/',
      '好 好 [hao4] /to be fond of/',
      '長 长 [chang2] /long/',
      '長 长 [zhang3] /to grow/',
    ];
    const hsk = ['好\thǎo\t1', '好\thào\t5', '长\tcháng\t2', '长\tzhǎng\t3'];
    expect(levelOf(cedict, hsk, '好', 'hao3')).toBe(1);
    expect(levelOf(cedict, hsk, '好', 'hao4')).toBe(5);
    expect(levelOf(cedict, hsk, '长', 'chang2')).toBe(2);
    expect(levelOf(cedict, hsk, '长', 'zhang3')).toBe(3);
  });

  it('leaves a reading the list does not include without a level', () => {
    const cedict = ['行 行 [xing2] /to walk/', '行 行 [hang2] /row/'];
    expect(levelOf(cedict, ['行\txíng\t1'], '行', 'hang2')).toBe(0);
  });

  it('gives traditional-only rows their group level', () => {
    const { rows } = joinCorpora(['後 后 [hou4] /back/', '后 后 [hou4] /empress/'].join('\n'), '', '后\thòu\t1');
    expect(rows.map((row) => row[5])).toEqual([1, 1, 1]);
  });

  it('compares readings without case, spaces, hyphens or apostrophes', () => {
    const cedict = ['天安門 天安门 [tian1 an1 men2] /Tiananmen/', '一路平安 一路平安 [yi1 lu4 ping2 an1] /bon voyage/'];
    const hsk = ['天安门\tTiān’ān-mén\t3', '一路平安\tyí lù píng’ān\t5'];
    expect(levelOf(cedict, hsk, '天安门', 'tian1 an1 men2')).toBe(3);
    expect(levelOf(cedict, hsk, '一路平安', 'yi1 lu4 ping2 an1')).toBe(5);
  });

  it('matches a reading exactly before trying anything looser', () => {
    // 东西 dōngxi "thing" is the exact match; dōngxī "east and west" would match once the
    // neutral tone is ignored, and must not take the level too.
    const cedict = ['東西 东西 [dong1 xi5] /thing/', '東西 东西 [dong1 xi1] /east and west/'];
    const hsk = ['东西\tdōngxi\t1'];
    expect(levelOf(cedict, hsk, '东西', 'dong1 xi5')).toBe(1);
    expect(levelOf(cedict, hsk, '东西', 'dong1 xi1')).toBe(0);
  });

  it('undoes 一 and 不 tone sandhi as the second step', () => {
    const cedict = ['一下 一下 [yi1 xia4] /a bit/', '不客氣 不客气 [bu4 ke4 qi5] /you are welcome/', '意義 意义 [yi4 yi4] /meaning/'];
    const hsk = ['一下\tyíxià\t1', '不客气\tbú kèqi\t1', '意义\tyìyì\t4'];
    const { rows, hsk: report } = joinCorpora(cedict.join('\n'), '', hsk.join('\n'));
    expect(rows.map((row) => row[5])).toEqual([1, 1, 4]);
    expect(report.steps).toEqual([1, 2, 0, 0]);
  });

  it('only undoes sandhi on the syllable of 一 or 不 itself', () => {
    // A made-up reading with yī for 意: undoing sandhi on every yì would match it at the
    // second step, but 意 is not 一, so only the tone-blind step does.
    const cedict = ['一意孤行 一意孤行 [yi1 yi1 gu1 xing2] /obstinately/'];
    const { hsk } = joinCorpora(cedict.join('\n'), '', '一意孤行\tyíyìgūxíng\t7');
    expect(hsk.steps).toEqual([0, 0, 0, 1]);
  });

  it('ignores the neutral tone on either side as the third step', () => {
    const cedict = ['學生 学生 [xue2 sheng5] /student/', '網上 网上 [wang3 shang4] /online/'];
    const hsk = ['学生\txuéshēng\t1', '网上\twǎngshang\t2'];
    const { rows, hsk: report } = joinCorpora(cedict.join('\n'), '', hsk.join('\n'));
    expect(rows.map((row) => row[5])).toEqual([1, 2]);
    expect(report.steps).toEqual([0, 0, 2, 0]);
  });

  it('ignores tones entirely as the last step', () => {
    const { rows, hsk } = joinCorpora('下載 下载 [xia4 zai3] /to download/', '', '下载\txiàzài\t4');
    expect(rows[0][5]).toBe(4);
    expect(hsk.steps).toEqual([0, 0, 0, 1]);
  });

  it('attaches to every group matched at the same step', () => {
    const cedict = ['那 那 [na4] /that/', '那 那 [nei4] /that (colloquial)/', '那 那 [na3] /which/'];
    const { rows } = joinCorpora(cedict.join('\n'), '', '那\tnà\t1');
    expect(rows.map((row) => [row[2], row[5]])).toEqual([
      ['na4', 1],
      ['nei4', 0],
      ['na3', 0],
    ]);
    // With no exact match, both near readings match at the tone-blind step.
    const loose = joinCorpora(['那 那 [na3] /which/', '那 那 [na1] /surname Na/'].join('\n'), '', '那\tnà\t1');
    expect(loose.rows.map((row) => row[5])).toEqual([1, 1]);
  });

  it('prefers lowercase groups, using a capitalised one only when no lowercase group matches', () => {
    // 华 huà matches the surname 華 [Hua4] exactly and the lowercase 華 [hua2] only
    // without tones; the lowercase reading still wins.
    const cedict = ['華 华 [Hua4] /surname Hua/', '華 华 [hua2] /magnificent/', '中國 中国 [Zhong1 guo2] /China/'];
    const hsk = ['华\thuà\t5', '中国\tZhōngguó\t1'];
    expect(levelOf(cedict, hsk, '华', 'hua2')).toBe(5);
    expect(levelOf(cedict, hsk, '华', 'hua4')).toBe(0);
    expect(levelOf(cedict, hsk, '中国', 'zhong1 guo2')).toBe(1);
  });

  it('attaches a missing erhua word to its base form', () => {
    const cedict = ['口哨 口哨 [kou3 shao4] /whistle/'];
    const { rows, hsk } = joinCorpora(cedict.join('\n'), '', '口哨儿\tkǒushàor\t5');
    expect(rows[0][5]).toBe(5);
    expect(hsk.unattached).toEqual([]);
  });

  it('keeps an erhua word that CC-CEDICT lists on its own entry', () => {
    const cedict = ['一點兒 一点儿 [yi1 dian3 r5] /a little/', '一點 一点 [yi1 dian3] /a bit/'];
    const hsk = ['一点儿\tyìdiǎnr\t1'];
    expect(levelOf(cedict, hsk, '一点儿', 'yi1 dian3 r5')).toBe(1);
    expect(levelOf(cedict, hsk, '一点', 'yi1 dian3')).toBe(0);
  });

  it('drops and reports a row whose reading CC-CEDICT lacks or whose word it lacks', () => {
    const cedict = ['誰 谁 [shei2] /who/', '口哨 口哨 [kou3 shao4] /whistle/'];
    const hsk = ['谁\tshéi\t1', '谁\tshuí\t1', '精彩纷呈\tjīngcǎi-fēnchéng\t7', '口哨儿\tkǒushàor\t5', '哨儿\tshàor\t7'];
    const { rows, hsk: report } = joinCorpora(cedict.join('\n'), '', hsk.join('\n'));
    expect(rows.map((row) => row[5])).toEqual([1, 5]);
    expect(report.attached).toBe(2);
    expect(report.unattached).toEqual([
      { word: '谁', reading: 'shuí', level: 1 },
      { word: '精彩纷呈', reading: 'jīngcǎi-fēnchéng', level: 7 },
      { word: '哨儿', reading: 'shàor', level: 7 },
    ]);
  });

  it('gives a group the lowest level when several rows land on it', () => {
    const cedict = ['地方 地方 [di4 fang5] /place/'];
    const { rows, hsk } = joinCorpora(cedict.join('\n'), '', ['地方\tdìfāng\t6', '地方\tdìfang\t3'].join('\n'));
    expect(rows[0][5]).toBe(3);
    expect(hsk.attached).toBe(2);
  });
});

/** Readings CC-CEDICT lacks (谁 shuí, 嗯 ǹg, 熟 shóu, 血 xiě) and a word it lacks altogether. */
const PINNED_UNATTACHED: HskRow[] = [
  { word: '谁', reading: 'shuí', level: 1 },
  { word: '嗯', reading: 'ǹg', level: 4 },
  { word: '熟', reading: 'shóu', level: 4 },
  { word: '血', reading: 'xiě', level: 4 },
  { word: '精彩纷呈', reading: 'jīngcǎi-fēnchéng', level: 7 },
];
/** Rows that match only ignoring the neutral tone, and only ignoring tones (下载, 温差, 一晃). */
const PINNED_LOOSE_STEPS = [102, 3];

describe('HSK attachment of the committed sources', () => {
  // Pinned so a new CC-CEDICT or syllabus edition that changes the matching fails here
  // rather than silently moving levels.
  const read = (source: { file: string }) => fs.readFileSync(path.resolve(__dirname, '..', source.file), 'utf8');
  const { hsk } = joinCorpora(read(SOURCES.cedict), '', read(SOURCES.hsk));

  it('leaves exactly these rows unattached', () => {
    expect(hsk.unattached).toEqual(PINNED_UNATTACHED);
    expect(hsk.attached + hsk.unattached.length).toBe(10961);
  });

  it('needs the neutral-tone and tone-blind steps for exactly this many rows', () => {
    expect(hsk.steps.slice(2)).toEqual(PINNED_LOOSE_STEPS);
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
  const hsk = ['你\tnǐ\t1', '中国\tZhōngguó\t2'].join('\n');

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

  it('computes the base word cost as the scaled ln of the corpus total', () => {
    // Total 12100, maximum 7000: 100000 * ln(12100) / ln(7001), rounded.
    expect(joinCorpora(cedict, frequency, hsk).baseWordCost).toBe(106180);
  });

  it('has no base word cost without a frequency corpus', () => {
    expect(joinCorpora(cedict, '', hsk).baseWordCost).toBe(0);
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
    expect(stats.merged).toBe(1);
  });

  it('merges lines with an identical headword and reading into one entry', () => {
    const dupe = ['行 行 [hang2] /to walk/', '行 行 [hang2] /to stroll/'].join('\n');
    const { rows, stats } = joinCorpora(dupe, '', '');
    expect(rows).toHaveLength(1);
    expect(stats.merged).toBe(1);
  });

  it('treats a differently-cased pinyin column as the same reading', () => {
    const dupe = ['中 中 [zhong1] /middle/', '中 中 [Zhong1] /middle/'].join('\n');
    const { stats } = joinCorpora(dupe, '', '');
    expect(stats.merged).toBe(1);
  });

  it('reduces frequency by 10x for surname entries', () => {
    const cedict = '张 张 [Zhang1] /surname Zhang/\n';
    const frequency = '张 1000\n';
    const { rows } = joinCorpora(cedict, frequency, '');
    expect(rows[0][4]).toBe(10000);
  });

  it('glosses a merged entry from its non-surname line when the surname line comes second', () => {
    const dupe = ['能 能 [neng2] /to be able to/', '能 能 [neng2] /surname Neng/'].join('\n');
    const { rows, stats } = joinCorpora(dupe, '', '');
    expect(rows).toHaveLength(1);
    expect(rows[0][3]).toBe('to be able to');
    expect(stats.merged).toBe(1);
  });

  it('glosses a merged entry from its non-surname line when the surname line comes first', () => {
    const dupe = ['能 能 [neng2] /surname Neng/', '能 能 [neng2] /to be able to/'].join('\n');
    const { rows } = joinCorpora(dupe, '', '');
    expect(rows).toHaveLength(1);
    expect(rows[0][3]).toBe('to be able to');
  });

  it('keeps full frequency for an entry that has any non-surname line', () => {
    const dupe = ['单 单 [dan1] /mountain/surname Shan/', '单 单 [dan1] /bill/list/'].join('\n');
    const frequency = '单 1000\n';
    const { rows } = joinCorpora(dupe, frequency, '');
    expect(rows).toHaveLength(1);
    expect(rows[0][3]).toBe('bill / list');
    expect(rows[0][4]).toBe(100000);
  });

  it('treats a line as a surname line even when its surname sense is not listed first', () => {
    // With no frequency data both readings score 0, so only the surname rule can decide.
    // The shortened gloss "mountain / surname Shan" does not start with "surname ", and
    // judging the existing row by its gloss used to keep it.
    const dupe = ['单 单 [dan1] /mountain/surname Shan/', '单 单 [dan1] /bill/list/'].join('\n');
    const { rows } = joinCorpora(dupe, '', '');
    expect(rows).toHaveLength(1);
    expect(rows[0][3]).toBe('bill / list');
  });

  it('accounts for every CC-CEDICT line as starting an entry or merged into one', () => {
    const dupes = [
      '能 能 [neng2] /surname Neng/',
      '能 能 [neng2] /to be able to/', // merged into the entry the first line started
      '能 能 [neng2] /surname Neng/', // merged too
      '中 中 [zhong1] /middle/',
    ].join('\n');
    const { rows, stats } = joinCorpora(dupes, '', '');
    expect(rows).toHaveLength(2);
    expect(stats.merged).toBe(2);
    expect(stats.entries + stats.merged).toBe(stats.cedictLines);
  });

  it('returns no rows for an empty corpus', () => {
    const { rows, stats } = joinCorpora('', '', '');
    expect(rows).toEqual([]);
    expect(stats).toMatchObject({ cedictLines: 0, emitted: 0, merged: 0 });
  });

  it('refuses to emit a row whose pinyin column cannot be parsed', () => {
    const broken = '中 中 [1] /middle/';
    expect(() => joinCorpora(broken, '', '')).toThrow(/unparsable pinyin/);
  });

  it('merges a capitalised proper-noun line into the common entry with the same headword', () => {
    const shu = [
      '書 书 [Shu1] /abbr. for 書經|书经[Shu1 jing1]/',
      '書 书 [shu1] /book/letter/document/CL:本[ben3],冊|册[ce4],部[bu4]/to write/',
    ].join('\n');
    const { rows, entries } = joinCorpora(shu, '', '');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ traditional: '書', simplified: '书', pinyinNumbers: 'shu1' });
    expect(entries[0].lines.map((line) => line.pinyin)).toEqual(['Shu1', 'shu1']);
    expect(rows).toHaveLength(1);
  });

  it('takes the short gloss from the common line, not an earlier proper-noun line', () => {
    const shu = [
      '書 书 [Shu1] /abbr. for 書經|书经[Shu1 jing1]/',
      '書 书 [shu1] /book/letter/document/CL:本[ben3],冊|册[ce4],部[bu4]/to write/',
    ].join('\n');
    const { rows } = joinCorpora(shu, '', '');
    expect(rows[0][3]).toBe('book / letter / document');
  });

  it('gives a single-headword entry one row, for both scripts, carrying its entry id', () => {
    const { rows } = joinCorpora('好 好 [hao3] /good/\n你 你 [ni3] /you/', '', '');
    expect(rows.map((row) => [row[0], row[6], row[7]])).toEqual([
      ['好', [0], undefined],
      ['你', [1], undefined],
    ]);
  });

  it('numbers entries in the order the B+ tree stores their rows, and lists them by id', () => {
    // Storage order is by toneless pinyin, so 好 hǎo comes before 你 nǐ whatever the file says.
    // Neighbouring rows then have neighbouring ids, which is what keeps the asset small.
    const { rows, entries } = joinCorpora('你 你 [ni3] /you/\n好 好 [hao3] /good/', '', '');
    expect(entries.map((entry) => [entry.id, entry.simplified])).toEqual([
      [0, '好'],
      [1, '你'],
    ]);
    expect(rows.map((row) => [row[0], row[6]])).toEqual([
      ['你', [1]],
      ['好', [0]],
    ]);
  });

  describe('headwords sharing a simplified form', () => {
  const hou = [
    '后 后 [Hou4] /surname Hou/',
    '后 后 [hou4] /empress/queen/',
    '後 后 [hou4] /behind/back/rear/',
  ].join('\n');

  it('keeps 後 hòu and 后 hòu as separate entries', () => {
    const { entries } = joinCorpora(hou, '', '');
    expect(entries.map((entry) => [entry.id, entry.traditional, entry.lines.length])).toEqual([
      [0, '后', 2],
      [1, '後', 1],
    ]);
  });

  it('writes one simplified-only row standing for both, glossed with the first sense of each', () => {
    // 後 has three senses and 后 two (its surname line is a tag, not a sense), so 後 leads.
    const { rows } = joinCorpora(hou, '', '');
    const simplified = rows.filter((row) => row[7] === 'simplified');
    expect(simplified).toEqual([['后', '後', 'hou4', 'behind / empress', 0, 0, [1, 0], 'simplified']]);
  });

  it('writes one traditional-only row per headword, each with its own gloss', () => {
    const { rows } = joinCorpora(hou, '', '');
    const traditional = rows.filter((row) => row[7] === 'traditional');
    expect(traditional.map((row) => [row[1], row[3], row[6]])).toEqual([
      ['后', 'empress / queen', [0]],
      ['後', 'behind / back / rear', [1]],
    ]);
    expect(rows).toHaveLength(3);
  });

  it('orders headwords with as many senses as each other by file order', () => {
    const tied = ['乾 干 [gan1] /dry/', '幹 干 [gan1] /trunk/'].join('\n');
    const { rows } = joinCorpora(tied, '', '');
    expect(rows.find((row) => row[7] === 'simplified')?.[3]).toBe('dry / trunk');
  });

  it('leaves out a headword with no senses of its own, such as a variant-only one', () => {
    // 昰 is only "variant of 是", so 是 shì keeps the gloss it has on its own.
    const shi = [
      '是 是 [shi4] /to be/correct; right; true/very well/',
      '昰 是 [shi4] /variant of 是[shi4]/',
    ].join('\n');
    const { rows } = joinCorpora(shi, '', '');
    expect(rows.find((row) => row[7] === 'simplified')?.[3]).toBe('to be / correct; right; true / very well');
  });

  it("falls back to the first headword's gloss when no headword has a sense", () => {
    const variants = ['甲 丙 [bing3] /variant of 丙[bing3]/', '乙 丙 [bing3] /old variant of 丙[bing3]/'].join('\n');
    const { rows } = joinCorpora(variants, '', '');
    expect(rows.find((row) => row[7] === 'simplified')?.[3]).toBe('variant of 丙');
  });

  it('breaks a sense-count tie by file order, not by entry id', () => {
    // Entry ids follow storage order, where 乾 sorts before 幹; the file lists 幹 first.
    const tied = ['幹 干 [gan1] /trunk/', '乾 干 [gan1] /dry/'].join('\n');
    const { rows, entries } = joinCorpora(tied, '', '');
    expect(entries.map((entry) => entry.traditional)).toEqual(['乾', '幹']);
    expect(orderHeadwords(entries).map((entry) => entry.traditional)).toEqual(['幹', '乾']);
    expect(rows.find((row) => row[7] === 'simplified')?.[3]).toBe('trunk / dry');
  });

  it('counts senses as the Candidate detail does, so a sense that only begins like a tag counts', () => {
    // "also written as" is 亦作's meaning, not an also-written tag; 甲 has one sense too, and
    // comes first in the file, so only counting 亦作's sense puts it first.
    const lines = ['甲 作 [zuo4] /to do/', '亦作 作 [zuo4] /also written as/to make/'].join('\n');
    const { rows } = joinCorpora(lines, '', '');
    expect(rows.find((row) => row[7] === 'simplified')?.[3]).toBe('also written as / to do');
  });

  it('keeps the joined gloss within the short gloss length limit', () => {
    const long = [`甲 甲 [jia3] /${'a'.repeat(40)}/`, `乙 甲 [jia3] /${'b'.repeat(40)}/`].join('\n');
    const { rows } = joinCorpora(long, '', '');
    const gloss = rows.find((row) => row[7] === 'simplified')![3];
    expect(gloss).toHaveLength(65);
    expect(gloss.endsWith('…')).toBe(true);
  });

  it('ranks the merged row as the old single row did: the surname cut only when every line is a surname', () => {
    const { rows } = joinCorpora(hou, '后 1000\n', '');
    expect(rows.map((row) => row[4])).toEqual([100000, 100000, 100000]);
    const surnames = joinCorpora('张 张 [Zhang1] /surname Zhang/\n張 张 [Zhang1] /surname Zhang/', '张 1000\n', '');
    expect(surnames.rows.map((row) => row[4])).toEqual([10000, 10000, 10000]);
  });
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

describe('encodeDictionary', () => {
  const rows = joinCorpora('你 你 [ni3] /you/\n好 好 [hao3] /good/', '', '').rows;

  it('stamps the asset with a build id derived from its contents', () => {
    const { bytes, buildId } = encodeDictionary(rows);
    const dictionary = BTreeDictionary.open(bytes);
    expect(dictionary.buildId).toBe(buildId);
    expect(buildId).not.toBe(0);
    expect(encodeDictionary(rows).buildId).toBe(buildId);
  });

  it('writes the base word cost into the header', () => {
    expect(BTreeDictionary.open(encodeDictionary(rows, 106180).bytes).baseWordCost).toBe(106180);
  });

  it('gives a different build id when the entry ids change', () => {
    const renumbered = rows.map((row): typeof row => [...row.slice(0, 6), [9]] as typeof row);
    expect(encodeDictionary(renumbered).buildId).not.toBe(encodeDictionary(rows).buildId);
  });
});
