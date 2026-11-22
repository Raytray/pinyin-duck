import { describe, it, expect } from 'vitest';
import { BIGRAM_HEADER_SIZE, BigramTable, encodeBigramFile as encodeWith, type BigramPair, type EncodeBigramOptions } from './bigram-codec';

/** The real build's offset, with a step of 1 so scores come back exactly. */
const EXACT: EncodeBigramOptions = { scoreOffset: 119936, scoreStep: 1 };

function encodeBigramFile(pairs: BigramPair[], options: EncodeBigramOptions = EXACT): Uint8Array {
  return encodeWith(pairs, options);
}

const PAIRS: BigramPair[] = [
  { first: '我', second: '想', score: 99000 },
  { first: '想', second: '喝', score: 88000 },
  { first: '想', second: '和', score: 87000 },
  { first: '喝', second: '咖啡', score: 110000 },
];

describe('BigramTable', () => {
  it('finds the score stored for a pair of simplified forms', () => {
    const table = BigramTable.open(encodeBigramFile(PAIRS));
    expect(table.score('想', '喝')).toBe(88000);
    expect(table.score('喝', '咖啡')).toBe(110000);
    expect(table.score('我', '想')).toBe(99000);
  });
});

describe('BigramTable misses', () => {
  const table = BigramTable.open(encodeBigramFile(PAIRS));

  it('has no score for a pair it never stored, even when both words are known', () => {
    expect(table.score('我', '喝')).toBeUndefined();
    // Order matters: 喝 then 想 is not 想 then 喝.
    expect(table.score('喝', '想')).toBeUndefined();
  });

  it('has no score when either word is unknown', () => {
    expect(table.score('你', '想')).toBeUndefined();
    expect(table.score('想', '茶')).toBeUndefined();
  });
});

describe('encodeBigramFile', () => {
  it('round-trips every pair', () => {
    const table = BigramTable.open(encodeBigramFile(PAIRS));
    expect(table.pairCount).toBe(4);
    expect(table.wordCount).toBe(5);
    const key = (pair: BigramPair) => `${pair.first} ${pair.second} ${pair.score}`;
    expect([...table.pairs()].map(key).sort()).toEqual(PAIRS.map(key).sort());
  });

  it('keeps words outside the Basic Multilingual Plane apart from the ones around them', () => {
    // 𠮷 (U+20BB7) is the surrogate pair D842 DFB7 in UTF-16, so by code unit it sorts
    // before ～ (U+FF5E) although its code point is higher. Ids follow code-unit order.
    const pairs: BigramPair[] = [
      { first: '𠮷', second: '中', score: 100001 },
      { first: '中', second: '𠮷', score: 100002 },
      { first: '～', second: '中', score: 100003 },
    ];
    const table = BigramTable.open(encodeBigramFile(pairs));
    expect(table.score('𠮷', '中')).toBe(100001);
    expect(table.score('中', '𠮷')).toBe(100002);
    expect(table.score('～', '中')).toBe(100003);
  });

  it('records the score offset and step in the header', () => {
    const table = BigramTable.open(encodeBigramFile(PAIRS, { scoreOffset: 120000, scoreStep: 64 }));
    expect(table.scoreOffset).toBe(120000);
    expect(table.scoreStep).toBe(64);
  });

  it('rounds each score to the nearest step below the offset', () => {
    const pairs: BigramPair[] = [
      // 119936 - 88010 = 31926, 498.8 steps of 64: rounded to 499, so 119936 - 499 * 64.
      { first: '想', second: '喝', score: 88010 },
      { first: '我', second: '想', score: 119936 },
      { first: '喝', second: '咖啡', score: 0 },
    ];
    const table = BigramTable.open(encodeBigramFile(pairs, { scoreOffset: 119936, scoreStep: 64 }));
    expect(table.score('想', '喝')).toBe(88000);
    expect(table.score('我', '想')).toBe(119936);
    // 119936 / 64 = 1874 steps, which lands exactly on 0.
    expect(table.score('喝', '咖啡')).toBe(0);
  });

  it('encodes an empty table', () => {
    const table = BigramTable.open(encodeBigramFile([]));
    expect(table.pairCount).toBe(0);
    expect(table.score('我', '想')).toBeUndefined();
  });

  it('stores a score as far below the offset as a u16 step count reaches', () => {
    const table = BigramTable.open(
      encodeBigramFile([{ first: '我', second: '想', score: 0 }], { scoreOffset: 0xffff, scoreStep: 1 })
    );
    expect(table.score('我', '想')).toBe(0);
  });

  it('refuses a score that is negative, fractional or above the offset', () => {
    for (const score of [-1, 1.5, 119937]) {
      expect(() => encodeBigramFile([{ first: '我', second: '想', score }])).toThrow('A bigram score must be');
    }
  });

  it('refuses a score more steps below the offset than a u16 holds, and a step below 1', () => {
    expect(() => encodeBigramFile([{ first: '我', second: '想', score: 0 }], { scoreOffset: 0x10000, scoreStep: 1 })).toThrow(
      'scores more than 65535 steps of 1 below the offset'
    );
    expect(() => encodeBigramFile(PAIRS, { scoreOffset: 1000, scoreStep: 0 })).toThrow('scoreStep at least 1');
  });

  it('refuses a pair listed twice', () => {
    expect(() => encodeBigramFile([...PAIRS, { first: '想', second: '喝', score: 100000 }])).toThrow(
      'The bigram 想 喝 is listed twice'
    );
  });
});

describe('BigramTable.open', () => {
  const bytes = encodeBigramFile(PAIRS);

  it('refuses a file with the wrong magic number', () => {
    const bad = bytes.slice();
    bad[0] = 'X'.charCodeAt(0);
    expect(() => BigramTable.open(bad)).toThrow('not a PinyinDuck bigram file');
  });

  it('refuses a file of another format version', () => {
    const bad = bytes.slice();
    bad[4] = 2;
    expect(() => BigramTable.open(bad)).toThrow('built with format 2, but this reader expects 1');
  });

  it('refuses a truncated header', () => {
    expect(() => BigramTable.open(bytes.subarray(0, 10))).toThrow('the header is truncated');
  });

  it('refuses a sorted word index that names no word', () => {
    const bad = bytes.slice();
    const view = new DataView(bad.buffer);
    const wordCount = view.getUint32(8, true);
    const textLength = view.getUint32(16, true);
    view.setUint32(BIGRAM_HEADER_SIZE + (wordCount + 1) * 4 + textLength, wordCount, true);
    expect(() => BigramTable.open(bad)).toThrow('the sorted word index');
  });

  it('refuses a truncated body', () => {
    expect(() => BigramTable.open(bytes.subarray(0, bytes.length - 1))).toThrow('malformed or truncated');
  });

  it('refuses a word whose text runs past the word table', () => {
    const bad = bytes.slice();
    // Word 0's end offset, the second entry after the header.
    new DataView(bad.buffer).setUint32(BIGRAM_HEADER_SIZE + 4, 0xffff, true);
    expect(() => BigramTable.open(bad)).toThrow('word 0 is out of bounds');
  });

  it('refuses a pair index that does not end at the pair count', () => {
    const bad = bytes.slice();
    new DataView(bad.buffer).setUint32(12, 3, true);
    // Shrink the file by one pair (a u24 id and a u16 step count) so only the index is inconsistent.
    expect(() => BigramTable.open(bad.subarray(0, bad.length - 5))).toThrow('the pair index does not end');
  });

  it('reads a table that sits inside a larger buffer', () => {
    const padded = new Uint8Array(bytes.length + 8);
    padded.set(bytes, 8);
    expect(BigramTable.open(padded.subarray(8)).score('想', '喝')).toBe(88000);
  });
});
