/**
 * The Candidate detail view, end to end: CC-CEDICT lines through the dictionary build, the
 * B+ tree and the detail file, to what a UI draws for a candidate the engine returns.
 */
import { describe, it, expect } from 'vitest';
import { encodeDictionary, entryGloss, joinCorpora } from './build-dictionary';
import { detailRecords } from './build-detail';
import { BTreeDictionary } from '../src/data/btree-dictionary';
import { LazyPinyinSearchEngine } from '../src/index/lazy-search';
import { DetailFile, encodeDetailFile, type DetailRecord } from '../src/detail/detail-codec';
import { candidateDetail, readingWithMarks } from '../src/detail/detail-view';
import type { Candidate, ScriptType } from '../src/types';

/** Builds both files from `lines` and returns a lookup of the candidates and their detail. */
function build(...lines: string[]) {
  const { rows, entries } = joinCorpora(lines.join('\n'), '', '');
  const { bytes, buildId } = encodeDictionary(rows);
  const dictionary = BTreeDictionary.open(bytes);
  const detail = DetailFile.open(encodeDetailFile(detailRecords(entries, entryGloss), buildId), dictionary.buildId);
  const engine = new LazyPinyinSearchEngine(dictionary);
  const candidate = (query: string, hanzi: string, script: ScriptType): Candidate => {
    const found = engine.search(query, { script, exactOnly: true }).candidates.find((c) => c.hanzi === hanzi);
    if (!found) throw new Error(`no ${hanzi} candidate for ${query}`);
    return found;
  };
  return {
    view: (query: string, hanzi: string, script: ScriptType) =>
      candidateDetail(candidate(query, hanzi, script), script, detail),
  };
}

describe('candidateDetail', () => {
  const hou = build(
    '后 后 [Hou4] /surname Hou/',
    '后 后 [hou4] /empress/queen/',
    '後 后 [hou4] /back/behind/rear/'
  );

  it('groups a simplified candidate by headword, most senses first, with headings in place of a counterpart', () => {
    expect(hou.view('hou4', '后', 'simplified')).toEqual({
      groups: [
        {
          heading: '後',
          tags: [],
          senses: [
            { number: 1, text: 'back', proper: false },
            { number: 2, text: 'behind', proper: false },
            { number: 3, text: 'rear', proper: false },
          ],
          measureWords: [],
        },
        {
          heading: '后',
          tags: ['Surname Hou'],
          senses: [
            { number: 1, text: 'empress', proper: false },
            { number: 2, text: 'queen', proper: false },
          ],
          measureWords: [],
        },
      ],
    });
  });

  it('shows each headword alone in traditional script, with the counterpart only when it differs', () => {
    const back = hou.view('hou4', '後', 'traditional');
    expect(back.counterpart).toBe('后');
    expect(back.groups).toHaveLength(1);
    expect(back.groups[0].heading).toBeUndefined();
    expect(back.groups[0].senses.map((sense) => sense.text)).toEqual(['back', 'behind', 'rear']);

    expect(hou.view('hou4', '后', 'traditional').counterpart).toBeUndefined();
  });

  it('merges 書 Shū and 書 shū, marking the proper noun sense', () => {
    const shu = build('書 书 [Shu1] /abbr. for 書經|书经[Shu1 jing1]/the Book of History/', '書 书 [shu1] /book/letter/');

    const simplified = shu.view('shu1', '书', 'simplified');
    expect(simplified.counterpart).toBe('書');
    expect(simplified.groups).toEqual([
      {
        tags: ['Abbreviation for 书经 Shūjīng'],
        senses: [
          { number: 1, text: 'book', proper: false },
          { number: 2, text: 'letter', proper: false },
          { number: 3, text: 'the Book of History', proper: true },
        ],
        measureWords: [],
      },
    ]);
    expect(shu.view('shu1', '書', 'traditional').counterpart).toBe('书');
  });

  it("shows a variant-only entry's target gloss with its variant tag", () => {
    const nian = build(
      '唸 念 [nian4] /variant of 念[nian4], to read aloud/',
      '懧 懦 [nuo4] /old variant of 懦[nuo4]/',
      '懦 懦 [nuo4] /cowardly/timid/'
    );

    expect(nian.view('nian4', '唸', 'traditional').groups[0].tags).toEqual(['Variant of 念 niàn: to read aloud']);
    expect(nian.view('nuo4', '懧', 'traditional').groups[0]).toEqual({
      tags: ['Old variant of 懦 nuò: cowardly / timid'],
      senses: [],
      measureWords: [],
    });
  });

  it('lists measure words in the active script with tone marks', () => {
    const ge = build('人 人 [ren2] /person/CL:個|个[ge4],位[wei4]/');

    expect(ge.view('ren2', '人', 'simplified').groups[0].measureWords).toEqual(['个 gè', '位 wèi']);
    expect(ge.view('ren2', '人', 'traditional').groups[0].measureWords).toEqual(['個 gè', '位 wèi']);
  });

  it('renders a cross-reference in the active script with tone-marked pinyin', () => {
    const shang = build('尚書 尚书 [shang4 shu1] /see 書經|书经[Shu1 jing1]/also pr. [shang3 shu1]/');

    expect(shang.view('shangshu', '尚书', 'simplified').groups[0]).toMatchObject({
      tags: ['Also pronounced shǎngshū'],
      senses: [{ number: 1, text: 'see 书经 Shūjīng', proper: false }],
    });
    expect(shang.view('shangshu', '尚書', 'traditional').groups[0].senses[0].text).toBe('see 書經 Shūjīng');
  });

  it('renders a cross-reference CC-CEDICT gives no reading for as Hanzi alone', () => {
    const sanbao = build('三寶 三宝 [san1 bao3] /the Three Jewels/also written 三保|三保/');

    expect(sanbao.view('sanbao', '三宝', 'simplified').groups[0].tags).toEqual(['Also written 三保']);
  });

  it('labels every tag kind', () => {
    const mou = build(
      '某 某 [mou3] /some/erhua variant of 某兒|某儿[mou3 r5]/also written 厶[mou3]/Taiwan pr. [mou2]/'
    );

    expect(mou.view('mou3', '某', 'simplified').groups[0].tags).toEqual([
      'Erhua variant of 某儿 mǒur',
      'Also written 厶 mǒu',
      'Taiwan pronunciation móu',
    ]);
  });

  it('shows a part-of-speech line when the entry has one', () => {
    const record: DetailRecord = {
      heading: '',
      senses: [{ proper: false, text: ['book'] }],
      tags: [],
      measureWords: [],
      partsOfSpeech: ['noun', 'verb'],
    };
    const detail = DetailFile.open(encodeDetailFile([record], 1), 1);
    const subject = { entryIds: [0], simplified: '书', traditional: '書' };

    expect(candidateDetail(subject, 'simplified', detail).groups[0].partOfSpeech).toBe('noun · verb');
  });
});

describe('readingWithMarks', () => {
  it('joins the syllables of a word, keeping capitals', () => {
    expect(readingWithMarks('Shu1 jing1')).toBe('Shūjīng');
    expect(readingWithMarks('ge4')).toBe('gè');
  });

  it("separates a syllable that starts with a vowel with an apostrophe", () => {
    expect(readingWithMarks('Xi1 an1')).toBe("Xī'ān");
  });

  it('reads the umlaut, erhua and the neutral tone', () => {
    expect(readingWithMarks('lu:4 r5')).toBe('lǜr');
    expect(readingWithMarks('xian1 sheng5')).toBe('xiānsheng');
  });

  it('splits syllables CC-CEDICT ran together', () => {
    expect(readingWithMarks('xia4hai2')).toBe('xiàhái');
  });

  it('keeps letters and punctuation that are not syllables apart, as written', () => {
    expect(readingWithMarks('T xu4')).toBe('T xù');
    expect(readingWithMarks('ren2 bi3 ren2 , qi4 si3 ren2')).toBe('rénbǐrén, qìsǐrén');
    expect(readingWithMarks('Zhen1 · Ao4 si1 ting1')).toBe('Zhēn · Àosītīng');
  });
});
