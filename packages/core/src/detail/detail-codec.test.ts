import { describe, it, expect } from 'vitest';
import {
  DETAIL_MAGIC,
  DetailFile,
  encodeDetailFile,
  type DetailRecord,
} from './detail-codec';

/** 書 shū: common and proper noun senses, measure words, a cross-reference, a tag. */
const shu: DetailRecord = {
  heading: '',
  senses: [
    { proper: false, text: ['book'] },
    { proper: false, text: ['letter'] },
    {
      proper: true,
      text: ['', { traditional: '書經', simplified: '书经', pinyinNumbers: 'Shu1 jing1' }, ' (classic)'],
    },
  ],
  tags: [
    { kind: 'alsoPronounced', text: ['', { traditional: '', simplified: '', pinyinNumbers: 'shu4' }, ''] },
  ],
  measureWords: [
    { traditional: '本', simplified: '本', pinyinNumbers: 'ben3' },
    { traditional: '冊', simplified: '册', pinyinNumbers: 'ce4' },
  ],
  partsOfSpeech: [],
};

/** 唸 niàn: a variant-only entry, which carries its target's gloss. */
const nian: DetailRecord = {
  heading: '唸',
  senses: [],
  tags: [
    {
      kind: 'variant',
      text: ['', { traditional: '念', simplified: '念', pinyinNumbers: 'nian4' }, ''],
      gloss: 'to read aloud',
    },
  ],
  measureWords: [],
  partsOfSpeech: ['noun', 'verb'],
};

const empty: DetailRecord = { heading: '', senses: [], tags: [], measureWords: [], partsOfSpeech: [] };

describe('the Candidate detail file', () => {
  it('round-trips every record by entry id', () => {
    const bytes = encodeDetailFile([shu, nian, empty], 0x1234abcd);
    const file = DetailFile.open(bytes, 0x1234abcd);

    expect(file.entryCount).toBe(3);
    expect(file.buildId).toBe(0x1234abcd);
    expect(file.record(0)).toEqual(shu);
    expect(file.record(1)).toEqual(nian);
    expect(file.record(2)).toEqual(empty);
  });

  it('writes the documented layout byte for byte', () => {
    // Worked by hand from the layout in detail-codec.ts; the Kotlin reader is held to it too.
    const record: DetailRecord = {
      heading: '',
      senses: [{ proper: false, text: ['ab', { traditional: '個', simplified: '个', pinyinNumbers: 'ge4' }, ''] }],
      tags: [],
      measureWords: [],
      partsOfSpeech: ['noun'],
    };
    const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

    expect(hex(encodeDetailFile([record], 0x01020304))).toBe(
      [
        '50 44 44 54 01 00 00 00', // "PDDT", format 1, reserved
        '01 00 00 00 04 03 02 01', // one entry, build id 0x01020304
        '18 00 00 00 30 00 00 00', // the record runs from byte 24 to byte 48
        '00', // no heading
        '01 00 01', // one sense: common, one reference
        '61 62 00', // "ab"
        'e5 80 8b 00 e4 b8 aa 00 67 65 34 00', // 個 个 ge4
        '00', // "" after the reference
        '00 00', // no tags, no measure words
        '01 00', // one part of speech: noun
      ].join(' ')
    );
  });

  it('starts with its magic number', () => {
    const bytes = encodeDetailFile([empty], 1);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe(DETAIL_MAGIC);
  });

  it('refuses a file from another build, as a failed load', () => {
    const bytes = encodeDetailFile([shu], 7);
    expect(() => DetailFile.open(bytes, 8)).toThrow(/build/);
  });

  it('refuses bytes that are not a detail file', () => {
    expect(() => DetailFile.open(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]), 1)).toThrow(
      /not a PinyinDuck Candidate detail file/
    );
    expect(() => DetailFile.open(new Uint8Array(3), 1)).toThrow(/truncated/);
  });

  it('refuses another format version', () => {
    const bytes = encodeDetailFile([empty], 1);
    bytes[4] = 99;
    expect(() => DetailFile.open(bytes, 1)).toThrow(/format 99/);
  });

  it('refuses a file whose offset table runs past its end', () => {
    const bytes = encodeDetailFile([shu, nian], 1);
    expect(() => DetailFile.open(bytes.subarray(0, bytes.length - 5), 1)).toThrow(/truncated/);
  });

  it('refuses an entry id it does not hold', () => {
    const file = DetailFile.open(encodeDetailFile([empty], 1), 1);
    expect(() => file.record(1)).toThrow(/entry 1/);
    expect(() => file.record(-1)).toThrow(/entry -1/);
  });

  it('refuses to write a string holding the zero byte that ends strings', () => {
    expect(() => encodeDetailFile([{ ...empty, heading: 'a\0b' }], 1)).toThrow(/zero byte/);
  });

  it('calls a record cut off mid-string malformed', () => {
    const bytes = encodeDetailFile([shu], 1);
    // End the only record four bytes in, inside "book".
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const start = view.getUint32(16, true);
    view.setUint32(20, start + 4, true);
    expect(() => DetailFile.open(bytes, 1).record(0)).toThrow(/malformed or truncated/);
  });

  it('refuses an offset table that runs past the end of the file', () => {
    const bytes = encodeDetailFile([empty], 1);
    new DataView(bytes.buffer).setUint32(8, 1000, true);
    expect(() => DetailFile.open(bytes, 1)).toThrow(/offset table is truncated/);
  });

  it('refuses a record that ends before it starts', () => {
    const bytes = encodeDetailFile([shu, empty], 1);
    const view = new DataView(bytes.buffer);
    view.setUint32(20, view.getUint32(16, true) - 1, true);
    expect(() => DetailFile.open(bytes, 1).record(0)).toThrow(/entry 0 ends before it starts/);
  });

  it('refuses a record that names an unknown sense kind', () => {
    const bytes = encodeDetailFile([shu], 1);
    // The record is the empty heading, the sense count, then the first sense kind.
    const recordStart = new DataView(bytes.buffer).getUint32(16, true);
    bytes[recordStart + 2] = 7;
    expect(() => DetailFile.open(bytes, 1).record(0)).toThrow(/sense kind 7/);
  });

  it('refuses a record that names an unknown tag or part of speech', () => {
    const bytes = encodeDetailFile([nian], 1);
    // The record is heading, sense count, tag count, then the tag kind.
    const recordStart = bytes.length - recordLength(nian);
    const tagKindAt = recordStart + 1 + '唸'.length * 3 + 1 + 1;
    const bad = bytes.slice();
    bad[tagKindAt] = 200;
    expect(() => DetailFile.open(bad, 1).record(0)).toThrow(/tag kind 200/);

    const badPos = bytes.slice();
    badPos[bytes.length - 1] = 200;
    expect(() => DetailFile.open(badPos, 1).record(0)).toThrow(/part of speech 200/);
  });
});

/** The encoded length of a lone record: the file minus its header and one-record offset table. */
function recordLength(record: DetailRecord): number {
  return encodeDetailFile([record], 1).length - encodeDetailFile([], 1).length - 4;
}
