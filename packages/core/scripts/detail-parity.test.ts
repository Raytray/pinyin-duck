import { describe, it, expect } from 'vitest';
import { encodeDictionary, entryGloss, joinCorpora } from './build-dictionary';
import { detailRecords } from './build-detail';
import { detailParityLines } from './detail-parity';
import { BTreeDictionary } from '../src/data/btree-dictionary';
import { LazyPinyinSearchEngine } from '../src/index/lazy-search';
import { DetailFile, encodeDetailFile, type DetailRecord } from '../src/detail/detail-codec';

function fixture(lines: string[], edit: (records: DetailRecord[]) => void = () => {}) {
  const { rows, entries } = joinCorpora(lines.join('\n'), '', '');
  const { bytes, buildId } = encodeDictionary(rows);
  const dictionary = BTreeDictionary.open(bytes);
  const records = detailRecords(entries, entryGloss);
  edit(records);
  return {
    engine: new LazyPinyinSearchEngine(dictionary),
    detail: DetailFile.open(encodeDetailFile(records, buildId), buildId),
  };
}

describe('detailParityLines', () => {
  it('pins every entry the cases reach in both scripts, and each grouped candidate in simplified', () => {
    const { engine, detail } = fixture([
      '后 后 [Hou4] /surname Hou/',
      '后 后 [hou4] /empress/',
      '後 后 [hou4] /back/behind/CL:個|个[ge4]/',
    ]);

    const lines = detailParityLines(engine, detail, [{ query: 'hou4', script: 'traditional' }], 12);

    expect(lines).toEqual([
      '>后\t后\thou4\tsimplified\t1',
      'group',
      'tag\tSurname Hou',
      'sense\t1\tempress',
      '',
      '>后\t后\thou4\ttraditional\t1',
      'group',
      'tag\tSurname Hou',
      'sense\t1\tempress',
      '',
      '>后\t後\thou4\tsimplified\t1',
      'counterpart\t後',
      'group',
      'sense\t1\tback',
      'sense\t2\tbehind',
      'mw\t个 gè',
      '',
      '>后\t後\thou4\ttraditional\t1',
      'counterpart\t后',
      'group',
      'sense\t1\tback',
      'sense\t2\tbehind',
      'mw\t個 gè',
      '',
    ]);
  });

  it('pins a grouped candidate with its group headings, and the entries inside it', () => {
    const { engine, detail } = fixture(['后 后 [hou4] /empress/', '後 后 [hou4] /back/behind/']);

    const lines = detailParityLines(engine, detail, [{ query: 'hou4', script: 'simplified' }], 12);

    expect(lines.filter((line) => line.startsWith('>'))).toEqual([
      '>后\t后\thou4\tsimplified\t1',
      '>后\t后\thou4\ttraditional\t1',
      '>后\t後\thou4\tsimplified\t1',
      '>后\t後\thou4\tsimplified\t2',
      '>后\t後\thou4\ttraditional\t1',
    ]);
    const grouped = lines.indexOf('>后\t後\thou4\tsimplified\t2');
    expect(lines.slice(grouped, lines.indexOf('', grouped))).toEqual([
      '>后\t後\thou4\tsimplified\t2',
      'group\t後',
      'sense\t1\tback',
      'sense\t2\tbehind',
      'group\t后',
      'sense\t1\tempress',
    ]);
  });

  it('marks proper noun senses and writes the part-of-speech line', () => {
    const { engine, detail } = fixture(['書 书 [Shu1] /the Book of History/', '書 书 [shu1] /book/'], (records) => {
      records[0].partsOfSpeech = ['noun', 'verb'];
    });

    const lines = detailParityLines(engine, detail, [{ query: 'shu', script: 'simplified' }], 12);

    expect(lines.slice(0, 7)).toEqual([
      '>书\t書\tshu1\tsimplified\t1',
      'counterpart\t書',
      'group',
      'pos\tnoun · verb',
      'sense\t1\tbook',
      'proper\t2\tthe Book of History',
      '',
    ]);
  });
});
