import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { attachHskLevels, parseHskLevels, type HskRow } from './hsk-attach';
import { collectEntries, groupHeadwords } from './build-dictionary';
import { SOURCES } from './sources.js';

/** Attaches the HSK rows to the CC-CEDICT lines, giving each group's level (0 for none). */
function attach(cedict: string[], hsk: string[]) {
  const groups = groupHeadwords(collectEntries(cedict.join('\n')));
  const { levels, report } = attachHskLevels(groups, parseHskLevels(hsk.join('\n')));
  return { levels: Object.fromEntries([...groups.keys()].map((key) => [key, levels.get(key) ?? 0])), report };
}

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

describe('attachHskLevels', () => {
  it('gives each reading of a heteronym its own level', () => {
    const cedict = [
      '好 好 [hao3] /good/',
      '好 好 [hao4] /to be fond of/',
      '長 长 [chang2] /long/',
      '長 长 [zhang3] /to grow/',
    ];
    const hsk = ['好\thǎo\t1', '好\thào\t5', '长\tcháng\t2', '长\tzhǎng\t3'];
    expect(attach(cedict, hsk).levels).toEqual({ '好|hao3': 1, '好|hao4': 5, '长|chang2': 2, '长|zhang3': 3 });
  });

  it('leaves a reading the list does not include without a level', () => {
    const cedict = ['行 行 [xing2] /to walk/', '行 行 [hang2] /row/'];
    expect(attach(cedict, ['行\txíng\t1']).levels['行|hang2']).toBe(0);
  });

  it('compares readings without case, spaces, hyphens or apostrophes', () => {
    const cedict = ['天安門 天安门 [tian1 an1 men2] /Tiananmen/', '一路平安 一路平安 [yi1 lu4 ping2 an1] /bon voyage/'];
    const hsk = ['天安门\tTiān’ān-mén\t3', '一路平安\tyí lù píng’ān\t5'];
    expect(attach(cedict, hsk).levels).toEqual({ '天安门|tian1 an1 men2': 3, '一路平安|yi1 lu4 ping2 an1': 5 });
  });

  it('matches a reading exactly before trying anything looser', () => {
    // 东西 dōngxi "thing" is the exact match; dōngxī "east and west" would match once the
    // neutral tone is ignored, and must not take the level too.
    const cedict = ['東西 东西 [dong1 xi5] /thing/', '東西 东西 [dong1 xi1] /east and west/'];
    expect(attach(cedict, ['东西\tdōngxi\t1']).levels).toEqual({ '东西|dong1 xi5': 1, '东西|dong1 xi1': 0 });
  });

  it('undoes 一 and 不 tone sandhi as the second step', () => {
    const cedict = ['一下 一下 [yi1 xia4] /a bit/', '不客氣 不客气 [bu4 ke4 qi5] /you are welcome/', '意義 意义 [yi4 yi4] /meaning/'];
    const hsk = ['一下\tyíxià\t1', '不客气\tbú kèqi\t1', '意义\tyìyì\t4'];
    const { levels, report } = attach(cedict, hsk);
    expect(Object.values(levels)).toEqual([1, 1, 4]);
    expect(report.steps).toEqual({ exact: 1, sandhi: 2, neutralTone: 0, toneless: 0 });
  });

  it('only undoes sandhi on the syllable of 一 or 不 itself', () => {
    // A made-up reading with yī for 意: undoing sandhi on every yì would match it at the
    // second step, but 意 is not 一, so only the tone-blind step does.
    const { report } = attach(['一意孤行 一意孤行 [yi1 yi1 gu1 xing2] /obstinately/'], ['一意孤行\tyíyìgūxíng\t7']);
    expect(report.steps).toEqual({ exact: 0, sandhi: 0, neutralTone: 0, toneless: 1 });
  });

  it('ignores the neutral tone on either side as the third step', () => {
    const cedict = ['學生 学生 [xue2 sheng5] /student/', '網上 网上 [wang3 shang4] /online/'];
    const { levels, report } = attach(cedict, ['学生\txuéshēng\t1', '网上\twǎngshang\t2']);
    expect(Object.values(levels)).toEqual([1, 2]);
    expect(report.steps).toEqual({ exact: 0, sandhi: 0, neutralTone: 2, toneless: 0 });
  });

  it('ignores tones entirely as the last step', () => {
    const { levels, report } = attach(['下載 下载 [xia4 zai3] /to download/'], ['下载\txiàzài\t4']);
    expect(levels['下载|xia4 zai3']).toBe(4);
    expect(report.steps).toEqual({ exact: 0, sandhi: 0, neutralTone: 0, toneless: 1 });
  });

  it('attaches to every group matched at the same step', () => {
    const cedict = ['那 那 [na4] /that/', '那 那 [nei4] /that (colloquial)/', '那 那 [na3] /which/'];
    expect(attach(cedict, ['那\tnà\t1']).levels).toEqual({ '那|na4': 1, '那|nei4': 0, '那|na3': 0 });
    // With no exact match, both near readings match at the tone-blind step.
    expect(attach(['那 那 [na3] /which/', '那 那 [na1] /surname Na/'], ['那\tnà\t1']).levels).toEqual({
      '那|na3': 1,
      '那|na1': 1,
    });
  });

  it('prefers lowercase groups, using a capitalised one only when no lowercase group matches', () => {
    // 华 huà matches the surname 華 [Hua4] exactly and the lowercase 華 [hua2] only
    // without tones; the lowercase reading still wins.
    const cedict = ['華 华 [Hua4] /surname Hua/', '華 华 [hua2] /magnificent/', '中國 中国 [Zhong1 guo2] /China/'];
    const hsk = ['华\thuà\t5', '中国\tZhōngguó\t1'];
    expect(attach(cedict, hsk).levels).toEqual({ '华|hua4': 0, '华|hua2': 5, '中国|zhong1 guo2': 1 });
  });

  it('attaches a missing erhua word to its base form', () => {
    const { levels, report } = attach(['口哨 口哨 [kou3 shao4] /whistle/'], ['口哨儿\tkǒushàor\t5']);
    expect(levels['口哨|kou3 shao4']).toBe(5);
    expect(report.unattached).toEqual([]);
  });

  it('keeps an erhua word that CC-CEDICT lists on its own entry', () => {
    const cedict = ['一點兒 一点儿 [yi1 dian3 r5] /a little/', '一點 一点 [yi1 dian3] /a bit/'];
    expect(attach(cedict, ['一点儿\tyìdiǎnr\t1']).levels).toEqual({ '一点儿|yi1 dian3 r5': 1, '一点|yi1 dian3': 0 });
  });

  it('drops and reports a row whose reading CC-CEDICT lacks or whose word it lacks', () => {
    const cedict = ['誰 谁 [shei2] /who/', '口哨 口哨 [kou3 shao4] /whistle/'];
    const hsk = ['谁\tshéi\t1', '谁\tshuí\t1', '精彩纷呈\tjīngcǎi-fēnchéng\t7', '口哨儿\tkǒushàor\t5', '哨儿\tshàor\t7'];
    const { levels, report } = attach(cedict, hsk);
    expect(Object.values(levels)).toEqual([1, 5]);
    expect(report.attached).toBe(2);
    expect(report.unattached).toEqual([
      { word: '谁', reading: 'shuí', level: 1 },
      { word: '精彩纷呈', reading: 'jīngcǎi-fēnchéng', level: 7 },
      { word: '哨儿', reading: 'shàor', level: 7 },
    ]);
  });

  it('gives a group the lowest level when several rows land on it', () => {
    const { levels, report } = attach(['地方 地方 [di4 fang5] /place/'], ['地方\tdìfāng\t6', '地方\tdìfang\t3']);
    expect(levels['地方|di4 fang5']).toBe(3);
    expect(report.attached).toBe(2);
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
const PINNED_LOOSE_STEPS = { neutralTone: 102, toneless: 3 };

describe('HSK attachment of the committed sources', () => {
  // Pinned so a new CC-CEDICT or syllabus edition that changes the matching fails here
  // rather than silently moving levels.
  const read = (source: { file: string }) => fs.readFileSync(path.resolve(__dirname, '..', source.file), 'utf8');
  const { report } = attachHskLevels(
    groupHeadwords(collectEntries(read(SOURCES.cedict))),
    parseHskLevels(read(SOURCES.hsk))
  );

  it('leaves exactly these rows unattached', () => {
    expect(report.unattached).toEqual(PINNED_UNATTACHED);
    expect(report.attached + report.unattached.length).toBe(10961);
  });

  it('needs the neutral-tone and tone-blind steps for exactly this many rows', () => {
    const { neutralTone, toneless } = report.steps;
    expect({ neutralTone, toneless }).toEqual(PINNED_LOOSE_STEPS);
  });
});
