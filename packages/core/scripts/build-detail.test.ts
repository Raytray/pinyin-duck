import { describe, it, expect } from 'vitest';
import { collectEntries, entryGloss } from './build-dictionary';
import { detailRecords } from './build-detail';
import type { DetailRecord } from '../src/detail/detail-codec';

/** The record of the first entry the lines form. */
function recordOf(...lines: string[]): DetailRecord {
  return recordsOf(...lines)[0];
}

/** The records of the entries the lines form, indexed by entry id (file order here). */
function recordsOf(...lines: string[]): DetailRecord[] {
  return detailRecords(collectEntries(lines.join('\n')), entryGloss);
}

describe('detailRecords', () => {
  it('lists common senses before proper noun senses, each in file order, without exact duplicates', () => {
    const record = recordOf(
      '書 书 [Shu1] /the Book of History/',
      '書 书 [shu1] /book/letter/',
      '書 书 [shu1] /letter/document/'
    );

    expect(record.senses).toEqual([
      { proper: false, text: ['book'] },
      { proper: false, text: ['letter'] },
      { proper: false, text: ['document'] },
      { proper: true, text: ['the Book of History'] },
    ]);
  });

  it('stores cross-references as structured traditional, simplified and pinyin', () => {
    const record = recordOf(
      '尚書 尚书 [Shang4 shu1] /same as 書經|书经[Shu1 jing1], compare 尚[shang4] and 書|书/'
    );

    expect(record.senses[0].text).toEqual([
      'same as ',
      { traditional: '書經', simplified: '书经', pinyinNumbers: 'Shu1 jing1' },
      ', compare ',
      { traditional: '尚', simplified: '尚', pinyinNumbers: 'shang4' },
      ' and ',
      { traditional: '書', simplified: '书', pinyinNumbers: '' },
      '',
    ]);
  });

  it('reads Hanzi mixed with Latin letters or digits as one reference, but not the words around it', () => {
    const record = recordOf('95後 95后 [jiu3 wu3 hou4] /born in 1995-99 (cf. 00後|00后[ling2 ling2 hou4], B超[B chao1])/');

    expect(record.senses[0].text).toEqual([
      'born in 1995-99 (cf. ',
      { traditional: '00後', simplified: '00后', pinyinNumbers: 'ling2 ling2 hou4' },
      ', ',
      { traditional: 'B超', simplified: 'B超', pinyinNumbers: 'B chao1' },
      ')',
    ]);
  });

  it('reads a bracketed reading with no Hanzi as a reference to the reading alone', () => {
    const record = recordOf('一 一 [yi1] /one/(also pr. [yao1] when spelling out digits)/');

    expect(record.senses[1].text).toEqual([
      '(also pr. ',
      { traditional: '', simplified: '', pinyinNumbers: 'yao1' },
      ' when spelling out digits)',
    ]);
  });

  it('closes up the spaced umlaut CC-CEDICT writes in some readings', () => {
    const record = recordOf('呂梁 吕梁 [Lu:3 liang2] /see 呂梁市|吕梁市[Lu : 3 liang2 Shi4]/');

    expect(record.senses[0].text[1]).toEqual({ traditional: '呂梁市', simplified: '吕梁市', pinyinNumbers: 'Lu:3 liang2 Shi4' });
  });

  it('pulls every kind of tag out of the senses, in file order and without duplicates', () => {
    const record = recordOf(
      '某 某 [Mou3] /surname Mou/variant of 謀|谋[mou2]/',
      '某 某 [mou3] /some/old variant of 母[mu3]/erhua variant of 某兒|某儿[mou3 r5]/abbr. for 某某[mou3 mou3]/',
      '某 某 [mou3] /also written 厶[mou3]/also pr. [mu3]/Taiwan pr. [mou2]/surname Mou/'
    );

    expect(record.senses).toEqual([{ proper: false, text: ['some'] }]);
    expect(record.tags).toEqual([
      { kind: 'surname', text: ['Mou'] },
      { kind: 'variant', text: ['', { traditional: '謀', simplified: '谋', pinyinNumbers: 'mou2' }, ''] },
      { kind: 'oldVariant', text: ['', { traditional: '母', simplified: '母', pinyinNumbers: 'mu3' }, ''] },
      { kind: 'erhuaVariant', text: ['', { traditional: '某兒', simplified: '某儿', pinyinNumbers: 'mou3 r5' }, ''] },
      { kind: 'abbreviation', text: ['', { traditional: '某某', simplified: '某某', pinyinNumbers: 'mou3 mou3' }, ''] },
      { kind: 'alsoWritten', text: ['', { traditional: '厶', simplified: '厶', pinyinNumbers: 'mou3' }, ''] },
      { kind: 'alsoPronounced', text: ['', { traditional: '', simplified: '', pinyinNumbers: 'mu3' }, ''] },
      { kind: 'taiwanPronounced', text: ['', { traditional: '', simplified: '', pinyinNumbers: 'mou2' }, ''] },
    ]);
  });

  it('keeps senses that only begin like a tag', () => {
    expect(recordOf('姓名 姓名 [xing4 ming2] /surname and given name; full name/').senses).toHaveLength(1);
    expect(recordOf('亦作 亦作 [yi4 zuo4] /also written as/').senses).toHaveLength(1);
  });

  it('keeps see, used in, classifier for and register labels inline in the sense text', () => {
    const record = recordOf(
      '個 个 [ge4] /(literary) individual/classifier for people or objects in general/see 個子|个子[ge4 zi5]/used in 自個兒|自个儿[zi4 ge3 r5]/'
    );

    expect(record.tags).toEqual([]);
    expect(record.senses.map((sense) => sense.text[0])).toEqual([
      '(literary) individual',
      'classifier for people or objects in general',
      'see ',
      'used in ',
    ]);
  });

  it('moves the note after a variant target into the tag gloss', () => {
    const record = recordOf('唸 念 [nian4] /variant of 念[nian4], to read aloud/');

    expect(record.tags).toEqual([
      {
        kind: 'variant',
        text: ['', { traditional: '念', simplified: '念', pinyinNumbers: 'nian4' }, ''],
        gloss: 'to read aloud',
      },
    ]);
  });

  it('gives a variant-only entry its target short gloss', () => {
    const records = recordsOf('㐡 㐡 [nuo4] /old variant of 懦[nuo4]/', '懦 懦 [nuo4] /cowardly/timid/', '吔 吔 [ye1] /variant of 呀[ya1]/');

    expect(records[0].tags[0].gloss).toBe('cowardly / timid');
    // 呀 is not in the dictionary, so there is no gloss to give.
    expect(records[2].tags[0].gloss).toBeUndefined();
  });

  it('finds a target CC-CEDICT gives no reading for by its Hanzi, first in file order', () => {
    const records = recordsOf('癎 癎 [xian2] /variant of 癇|痫/', '癇 痫 [xian2] /epilepsy/', '癇 痫 [jian4] /later/');

    expect(records[0].tags[0].gloss).toBe('epilepsy');
  });

  it('gives no gloss for a target that is itself only a pointer, or a tag that is more than a target', () => {
    const records = recordsOf(
      '甲 甲 [jia3] /variant of 乙[yi3]/',
      '乙 乙 [yi3] /variant of 丙[bing3]/',
      '掱 掱 [pa2] /variant of 扒[pa2] in 扒手[pa2 shou3]/abbr. for 扒[pa2]/',
      '扒 扒 [pa2] /to steal/'
    );

    expect(records[0].tags[0].gloss).toBeUndefined();
    expect(records[2].tags.map((tag) => tag.gloss)).toEqual([undefined, undefined]);
  });

  it('only glosses the variant tags of a variant-only entry', () => {
    const records = recordsOf('勾 勾 [gou1] /to hook/variant of 鉤|钩[gou1]/', '鉤 钩 [gou1] /hook/');

    expect(records[0].tags[0].gloss).toBeUndefined();
  });

  it('collects measure words as the union of every line, in first-seen order', () => {
    const record = recordOf(
      '書 书 [shu1] /book/CL:本[ben3],冊|册[ce4]/',
      '書 书 [shu1] /letter/CL:封[feng1], 本[ben3]/'
    );

    expect(record.senses.map((sense) => sense.text)).toEqual([['book'], ['letter']]);
    expect(record.measureWords).toEqual([
      { traditional: '本', simplified: '本', pinyinNumbers: 'ben3' },
      { traditional: '冊', simplified: '册', pinyinNumbers: 'ce4' },
      { traditional: '封', simplified: '封', pinyinNumbers: 'feng1' },
    ]);
  });

  it('leaves a CL: inside a sense in the sense text', () => {
    const record = recordOf('念 念 [nian4] /to give (sb) a tongue-lashing (CL:頓|顿[dun4])/');

    expect(record.measureWords).toEqual([]);
    expect(record.senses[0].text).toEqual([
      'to give (sb) a tongue-lashing (CL:',
      { traditional: '頓', simplified: '顿', pinyinNumbers: 'dun4' },
      ')',
    ]);
  });

  it('heads an entry only when its simplified candidate stands for several headwords', () => {
    const records = recordsOf('後 后 [hou4] /back/', '后 后 [hou4] /empress/', '書 书 [shu1] /book/');

    expect(records.map((record) => record.heading)).toEqual(['後', '后', '']);
  });

  it('leaves the part-of-speech field empty when no source tags the entry', () => {
    expect(recordOf('書 书 [shu1] /book/').partsOfSpeech).toEqual([]);
  });

  it('fills the part-of-speech field of each entry from the lookup', () => {
    const entries = collectEntries('後 后 [hou4] /back/\n后 后 [hou4] /empress/\n書 书 [shu1] /book/');
    const records = detailRecords(entries, entryGloss, (entry) =>
      entry.traditional === '後' ? ['noun', 'adverb'] : entry.traditional === '書' ? ['noun'] : []
    );

    expect(records.map((record) => record.partsOfSpeech)).toEqual([['noun', 'adverb'], [], ['noun']]);
  });

  it('leaves brackets that hold no reading as text', () => {
    const record = recordOf('括號 括号 [kuo4 hao4] /square brackets [ ]/');

    expect(record.senses[0].text).toEqual(['square brackets [ ]']);
  });
});
