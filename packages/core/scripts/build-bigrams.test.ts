import { describe, it, expect } from 'vitest';
import { BigramCounter } from './build-bigrams';

/** A slice of CC-CEDICT holding the words of 我想喝咖啡 and the ways to mis-split it. */
const CEDICT = [
  '# CC-CEDICT',
  '',
  '我 我 [wo3] /I; me/',
  '想 想 [xiang3] /to think; to want/',
  '喝 喝 [he1] /to drink/',
  '和 和 [he2] /and/',
  '咖 咖 [ka1] /(phonetic)/',
  '啡 啡 [fei1] /(phonetic)/',
  '咖啡 咖啡 [ka1 fei1] /coffee/',
  '祥和 祥和 [xiang2 he2] /auspicious and peaceful/',
  '祥 祥 [xiang2] /auspicious/',
  '你 你 [ni3] /you/',
  '好 好 [hao3] /good/',
  '你好 你好 [ni3 hao3] /hello/',
  'T恤 T恤 [T xu4] /T-shirt/',
  // Two headwords with one simplified form are one word to the segmenter.
  '後 后 [hou4] /back/',
  '后 后 [hou4] /empress/',
  // 一 alone is no headword here, only as the start of 一起.
  '一起 一起 [yi1 qi3] /together/',
  // Nine characters: longer than any word the segmenter considers.
  '中华人民共和国国歌 中华人民共和国国歌 [Zhong1 hua2 Ren2 min2 Gong4 he2 guo2 guo2 ge1] /national anthem/',
].join('\n');

const FREQUENCY = ['我 1000', '想 400', '喝 50', '和 300', '咖啡 40', '你 800', '好 600', '你好 200', ''].join('\n');

describe('BigramCounter.segment', () => {
  const counter = new BigramCounter(CEDICT, FREQUENCY);

  it('splits a run of Hanzi into the most probable dictionary words', () => {
    expect(counter.segment('我想喝咖啡')).toEqual([['我', '想', '喝', '咖啡']]);
    expect(counter.segment('你好')).toEqual([['你好']]);
  });
});

describe('BigramCounter.segment context', () => {
  const counter = new BigramCounter(CEDICT, FREQUENCY);

  it('prefers the more probable split over a rare longer word', () => {
    // 祥和 is a headword the frequency list does not list, so 想 和 is the likelier split.
    expect(counter.segment('我想和你')).toEqual([['我', '想', '和', '你']]);
  });

  it('breaks the context at punctuation and non-Hanzi text', () => {
    expect(counter.segment('你好，我想喝咖啡。')).toEqual([['你好'], ['我', '想', '喝', '咖啡']]);
    // T恤 is a headword, but only Hanzi are segmented, and 恤 alone is no headword here.
    expect(counter.segment('你好 T恤 我')).toEqual([['你好'], ['我']]);
  });

  it('breaks the context at a Hanzi that is no headword', () => {
    expect(counter.segment('我想吃咖啡')).toEqual([['我', '想'], ['咖啡']]);
  });

  it('finds a headword whose first character is no headword alone', () => {
    expect(counter.segment('我想一起')).toEqual([['我', '想', '一起']]);
    expect(counter.segment('一我')).toEqual([['我']]);
  });

  it('counts a simplified form shared by several headwords as one word', () => {
    const shared = new BigramCounter(CEDICT, FREQUENCY);
    for (let i = 0; i < 5; i++) shared.addLine('我后');
    expect(shared.pairs()).toHaveLength(1);
  });

  it('never segments a word longer than eight characters as one', () => {
    expect(counter.segment('中华人民共和国国歌').flat()).not.toContain('中华人民共和国国歌');
  });

  it('returns no runs for a line without Hanzi', () => {
    expect(counter.segment('-- ok!')).toEqual([]);
  });
});

describe('BigramCounter.pairs', () => {
  /** Six 我想, two 我喝 and five 想喝. */
  function counted(): BigramCounter {
    const counter = new BigramCounter(CEDICT, FREQUENCY);
    for (let i = 0; i < 6; i++) counter.addLine('我想');
    for (let i = 0; i < 2; i++) counter.addLine('我喝');
    for (let i = 0; i < 5; i++) counter.addLine('想喝！');
    return counter;
  }

  it('scales scores like the dictionary frequency: SCALE * ln P(b | a) + SCALE * ln(total)', () => {
    const counter = counted();
    // SCALE = 100000 / ln(1001) = 14474.39, total = 3390, OFFSET = round(SCALE * ln 3390).
    expect(counter.scoreOffset).toBe(117656);
    const pairs = new Map(counter.pairs().map((pair) => [`${pair.first} ${pair.second}`, pair.score]));
    // P(想 | 我) = 6 / 8: the pruned 我喝 pairs still count toward count(我).
    expect(pairs.get('我 想')).toBe(113492);
    // P(喝 | 想) = 5 / 5.
    expect(pairs.get('想 喝')).toBe(117656);
  });

  it('drops pairs seen fewer than five times', () => {
    const counter = counted();
    expect(counter.distinctPairs).toBe(3);
    expect(counter.pairs().map((pair) => `${pair.first} ${pair.second}`).sort()).toEqual(['想 喝', '我 想']);
    expect(counter.pairs(1)).toHaveLength(3);
  });

  it('does not count across a context break', () => {
    const counter = new BigramCounter(CEDICT, FREQUENCY);
    for (let i = 0; i < 5; i++) counter.addLine('我。想');
    expect(counter.distinctPairs).toBe(0);
  });

  it('clamps a score that would fall below zero', () => {
    // One 我想 among 4001 pairs after 我: SCALE * ln(1 / 4001) is about -120,000, below -OFFSET.
    const counter = new BigramCounter(CEDICT, FREQUENCY);
    counter.addLine('我想');
    for (let i = 0; i < 4000; i++) counter.addLine('我你好');
    const score = counter.pairs(1).find((pair) => pair.first === '我' && pair.second === '想')!.score;
    expect(score).toBe(0);
  });
});

describe('BigramCounter limits', () => {
  it('refuses more headwords than a pair key can hold', () => {
    // 2^17 distinct two-character words from the CJK Unified Ideographs block.
    const lines: string[] = [];
    for (let i = 0; i < 1 << 17; i++) {
      const word = String.fromCodePoint(0x4e00 + (i >> 9), 0x4e00 + (i & 511));
      lines.push(`${word} ${word} [x1 x1] /x/`);
    }
    expect(() => new BigramCounter(lines.join('\n'), FREQUENCY)).toThrow('Too many headwords');
  });
});
