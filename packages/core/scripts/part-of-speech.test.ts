import { describe, it, expect } from 'vitest';
import { partOfSpeechSources } from './part-of-speech';

/** The labels `partOfSpeechSources` chooses for each entry, [] when none. */
function partOfSpeechLookup(wiktionary: string, handeDict: string) {
  const sources = partOfSpeechSources(wiktionary, handeDict);
  return (subject: ReturnType<typeof entry>) => sources(subject)?.labels ?? [];
}

/** An entry as the lookup sees it: headword and tone-numbered reading. */
function entry(traditional: string, simplified: string, pinyinNumbers: string) {
  return { traditional, simplified, pinyinNumbers };
}

const HANDEDICT_HEADER = '﻿# HanDeDict\n# Lizenz: CC-BY-SA 3.0\n\n';

describe('partOfSpeechSources from HanDeDict', () => {
  it('maps the word-class tag of each sense, in source order without duplicates', () => {
    const lookup = partOfSpeechLookup(
      '',
      HANDEDICT_HEADER +
        '# Ver 2011-05-28T01:27:49Z HanDeDict Stat-New 001>Originalversion\n' +
        '# 上邊 上边 [shang4 bian5] /oben (S)/\n' +
        '上邊 上边 [shang4 bian5] /oben, darüber (Adv)/Oberseite (S, Anat)/oben drauf (Adv)/\n'
    );

    expect(lookup(entry('上邊', '上边', 'shang4 bian5'))).toEqual(['adverb', 'noun']);
  });

  it('maps Zähl to measure word and drops proper names, P, A and unknown tags', () => {
    const lookup = partOfSpeechLookup(
      '',
      HANDEDICT_HEADER +
        '個 个 [ge4] /Zähleinheitswort (Zähl)/einzeln (Adj)/\n' +
        '上 上 [shang4] /auf, über (P)/Gitarre (A)/Herr Shang (Eig, Fam)/oben (Geo)/\n'
    );

    expect(lookup(entry('個', '个', 'ge4'))).toEqual(['measure word', 'adjective']);
    expect(lookup(entry('上', '上', 'shang4'))).toEqual([]);
  });

  it('joins on headword and reading, ignoring capitals and the neutral tone', () => {
    const lookup = partOfSpeechLookup(
      '',
      HANDEDICT_HEADER +
        '後 后 [hou4] /hinter (Adv)/\n' +
        '書 书 [Shu1] /Buch der Urkunden (S)/\n' +
        '喜歡 喜欢 [xi3 huan5] /mögen (V)/\n' +
        '綠 绿 [lu:4] /grün (Adj)/\n'
    );

    expect(lookup(entry('后', '后', 'hou4'))).toEqual([]);
    expect(lookup(entry('後', '后', 'hou3'))).toEqual([]);
    expect(lookup(entry('後', '后', 'hou4'))).toEqual(['adverb']);
    expect(lookup(entry('書', '书', 'shu1'))).toEqual(['noun']);
    expect(lookup(entry('喜歡', '喜欢', 'xi3 huan5'))).toEqual(['verb']);
    expect(lookup(entry('綠', '绿', 'lu:4'))).toEqual(['adjective']);
  });

  it('ignores the word classes of example phrases', () => {
    const lookup = partOfSpeechLookup('', HANDEDICT_HEADER + '里 里 [li3] /Nachbarschaft (S); Bsp.: 鄰里 邻里 -- Nachbarschaft (S)/Meile (Zähl)/\n');

    expect(lookup(entry('里', '里', 'li3'))).toEqual(['noun', 'measure word']);
  });
});

/** A reduced Wiktionary file: its header, then the rows. */
function wiktionary(...rows: string[]): string {
  return ['# Part of speech of Chinese entries in the English Wiktionary', '# sha256 00', ...rows, ''].join('\n');
}

describe('partOfSpeechSources from Wiktionary', () => {
  it('maps the part-of-speech headers of the entry, in page order without duplicates', () => {
    const lookup = partOfSpeechLookup(
      wiktionary(
        '一定\t一定\tyīdìng\tadv',
        '一定\t一定\tyīdìng\tadj',
        '一定\t一定\tyīdìng\tadj',
        '個\t个\tgè\tclassifier',
        '個\t个\tgè\tsuffix',
        '畫蛇添足\t画蛇添足\thuàshétiānzú\tidiom',
        '畫蛇添足\t画蛇添足\thuàshétiānzú\tproverb',
        '你好\t你好\tnǐ hǎo\tphrase',
        '你好\t你好\tnǐ hǎo\tintj'
      ),
      ''
    );

    expect(lookup(entry('一定', '一定', 'yi1 ding4'))).toEqual(['adverb', 'adjective']);
    expect(lookup(entry('個', '个', 'ge4'))).toEqual(['measure word']);
    expect(lookup(entry('畫蛇添足', '画蛇添足', 'hua4 she2 tian1 zu2'))).toEqual(['idiom']);
    expect(lookup(entry('你好', '你好', 'ni3 hao3'))).toEqual(['idiom', 'interjection']);
  });

  it('maps every word class it has a label for and drops the rest', () => {
    const rows = [
      ['noun', 'noun'],
      ['verb', 'verb'],
      ['adj', 'adjective'],
      ['adv', 'adverb'],
      ['pron', 'pronoun'],
      ['num', 'numeral'],
      ['classifier', 'measure word'],
      ['prep', 'preposition'],
      ['conj', 'conjunction'],
      ['particle', 'particle'],
      ['intj', 'interjection'],
      ['idiom', 'idiom'],
      ['proverb', 'idiom'],
      ['phrase', 'idiom'],
    ];
    const lookup = partOfSpeechLookup(
      wiktionary(...rows.map(([pos]) => `字\t字\tzì\t${pos}`), ...['name', 'det', 'postp', 'suffix', 'prefix', 'character'].map((pos) => `名\t名\tmíng\t${pos}`)),
      ''
    );

    expect(lookup(entry('字', '字', 'zi4'))).toEqual([...new Set(rows.map(([, label]) => label))]);
    expect(lookup(entry('名', '名', 'ming2'))).toEqual([]);
  });

  it('reads Latin letters and digits in a reading as written, never as tones', () => {
    const lookup = partOfSpeechLookup(
      wiktionary('AA制\tAA制\tAA zhì\tnoun', '2019冠狀病毒病\t2019冠状病毒病\t2019 guānzhuàng bìngdúbìng\tnoun'),
      ''
    );

    expect(lookup(entry('AA制', 'AA制', 'A A zhi4'))).toEqual(['noun']);
    expect(lookup(entry('2019冠狀病毒病', '2019冠状病毒病', 'guan1 zhuang4 bing4 du2 bing4'))).toEqual(['noun']);
  });
});

describe('partOfSpeechSources with both sources', () => {
  it('takes every label from Wiktionary when it has any for the entry, else from HanDeDict, never merged', () => {
    const lookup = partOfSpeechLookup(
      wiktionary('學生\t学生\txuésheng\tnoun', '中國\t中国\tZhōngguó\tname'),
      HANDEDICT_HEADER +
        '學生 学生 [xue2 sheng5] /Schüler (S)/studieren (V)/\n' +
        '中國 中国 [Zhong1 guo2] /chinesisch (Adj)/\n' +
        '我 我 [wo3] /ich (Pron)/\n'
    );

    expect(lookup(entry('學生', '学生', 'xue2 sheng5'))).toEqual(['noun']);
    expect(lookup(entry('中國', '中国', 'Zhong1 guo2'))).toEqual(['adjective']);
    expect(lookup(entry('我', '我', 'wo3'))).toEqual(['pronoun']);
    expect(lookup(entry('你', '你', 'ni3'))).toEqual([]);
  });
});
