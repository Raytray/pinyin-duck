import { describe, it, expect } from 'vitest';
import {
  pinyinNumbersToMarks,
  segmentPinyin,
  cleanPinyin,
  toneNumberToMark,
} from './pinyin.js';

describe('Pinyin Tone Mark Conversion', () => {
  it('converts single syllables with tone numbers', () => {
    expect(toneNumberToMark('ni3')).toBe('nǐ');
    expect(toneNumberToMark('hao3')).toBe('hǎo');
    expect(toneNumberToMark('zhong1')).toBe('zhōng');
    expect(toneNumberToMark('guo2')).toBe('guó');
    expect(toneNumberToMark('de5')).toBe('de');
    expect(toneNumberToMark('lü4')).toBe('lǜ');
    expect(toneNumberToMark('lv4')).toBe('lǜ');
    expect(toneNumberToMark('liu4')).toBe('liù');
    expect(toneNumberToMark('tui4')).toBe('tuì');
  });

  it('converts multi-syllable phrases with spaces and punctuation', () => {
    expect(pinyinNumbersToMarks('ni3 hao3')).toBe('nǐ hǎo');
    expect(pinyinNumbersToMarks('zhong1 guo2')).toBe('zhōng guó');
    expect(pinyinNumbersToMarks("tian1'an1'men2")).toBe("tiān'ān'mén");
    expect(pinyinNumbersToMarks('lü3 xing2')).toBe('lǚ xíng');
  });
});

describe('Pinyin Syllable Segmentation', () => {
  it('segments continuous toneless pinyin', () => {
    expect(segmentPinyin('nihao')).toEqual(['ni', 'hao']);
    expect(segmentPinyin('beijing')).toEqual(['bei', 'jing']);
    expect(segmentPinyin('zhongguo')).toEqual(['zhong', 'guo']);
    expect(segmentPinyin('xian')).toEqual(['xian']);
  });

  it('handles apostrophe disambiguation', () => {
    expect(segmentPinyin("xi'an")).toEqual(['xi', 'an']);
    expect(segmentPinyin("tian'an'men")).toEqual(['tian', 'an', 'men']);
  });

  it('segments syllables with tone numbers', () => {
    expect(segmentPinyin('ni3hao3')).toEqual(['ni3', 'hao3']);
    expect(segmentPinyin('ni3 hao3')).toEqual(['ni3', 'hao3']);
    expect(segmentPinyin('zhong1guo2')).toEqual(['zhong1', 'guo2']);
  });

  it('handles partial / prefix input', () => {
    expect(segmentPinyin('niha')).toEqual(['ni', 'ha']);
  });
});

describe('Clean Pinyin', () => {
  it('strips tones, spaces, and special characters', () => {
    expect(cleanPinyin('ni3 hao3')).toBe('nihao');
    expect(cleanPinyin("tian1'an1'men2")).toBe('tiananmen');
    expect(cleanPinyin('lǜ4 se4')).toBe('lüse');
  });

  it('is a no-op for already-clean input', () => {
    expect(cleanPinyin('nihao')).toBe('nihao');
  });
});

describe('Pinyin Edge Cases', () => {
  it('segments an empty or blank input to nothing', () => {
    expect(segmentPinyin('')).toEqual([]);
    expect(segmentPinyin('   ')).toEqual([]);
  });

  it('leaves unsegmentable text as a single opaque chunk', () => {
    // "zhuang4" is a real syllable, but "qqq" is not valid pinyin at all and must
    // not be silently dropped, otherwise the search loses the user's input.
    expect(segmentPinyin('qqq')).toEqual(['qqq']);
    expect(segmentPinyin('xyz')).toEqual(['xyz']);
  });

  it('keeps a valid syllable when the rest of the input is garbage', () => {
    // The first pass accepts "ni", then fails to segment "hqqq" and emits it verbatim
    // rather than discarding the user's keystrokes.
    expect(segmentPinyin('nihqqq')).toEqual(['ni', 'hqqq']);
  });

  it('backtracks when the longest first syllable strands the rest', () => {
    // Greedy longest-match took "jiang"/"fang"/"zhun" and left a non-syllable behind.
    expect(segmentPinyin('jianguo')).toEqual(['jian', 'guo']);
    expect(segmentPinyin('fanguo')).toEqual(['fan', 'guo']);
    expect(segmentPinyin('zhunian')).toEqual(['zhu', 'nian']);
    expect(segmentPinyin('xianguo3')).toEqual(['xian', 'guo3']);
  });

  it('keeps the longest-first split whenever it is already valid', () => {
    // Ambiguous strings resolve exactly as the greedy pass did.
    expect(segmentPinyin('xian')).toEqual(['xian']);
    expect(segmentPinyin('lianai')).toEqual(['lian', 'ai']);
    expect(segmentPinyin('xianggang')).toEqual(['xiang', 'gang']);
    expect(segmentPinyin('henan')).toEqual(['hen', 'an']);
  });

  it('splits the longest valid prefix and keeps the rest verbatim', () => {
    expect(segmentPinyin('jianguoqqq')).toEqual(['jian', 'guo', 'qqq']);
    expect(segmentPinyin('zhongg')).toEqual(['zhong', 'g']);
  });

  it('stays fast on long inputs that need backtracking', () => {
    const input = 'jianguo'.repeat(200) + 'q';
    const segments = segmentPinyin(input);
    expect(segments).toHaveLength(401);
    expect(segments.at(-1)).toBe('q');
  });

  it('splits on hyphens as well as spaces and apostrophes', () => {
    expect(segmentPinyin('zhong-guo')).toEqual(['zhong', 'guo']);
  });

  it('normalizes u: and v umlaut variants before segmenting', () => {
    expect(segmentPinyin('lü')).toEqual(['lü']);
    expect(segmentPinyin('lv')).toEqual(['lü']);
    expect(segmentPinyin('lu:')).toEqual(['lü']);
  });

  it('handles the longest valid syllables', () => {
    expect(segmentPinyin('zhuang')).toEqual(['zhuang']);
    expect(segmentPinyin('zhuang1')).toEqual(['zhuang1']);
    expect(segmentPinyin('shuang')).toEqual(['shuang']);
  });

  it('lowercases input before segmenting', () => {
    expect(segmentPinyin('NiHao')).toEqual(['ni', 'hao']);
  });

  it('leaves an unmarked syllable without a tone mark intact', () => {
    // Tone 5 is neutral, which has no written diacritic.
    expect(toneNumberToMark('ma5')).toBe('ma');
    expect(pinyinNumbersToMarks('ma5')).toBe('ma');
  });

  it('returns a syllable unchanged when there is no tone digit', () => {
    expect(toneNumberToMark('ni')).toBe('ni');
    expect(toneNumberToMark('')).toBe('');
  });

  it('ignores an out-of-range tone digit', () => {
    expect(toneNumberToMark('ni9')).toBe('ni9');
  });

  it('leaves a vowel-less syllable without a tone mark', () => {
    // Interjections have no vowel to carry a diacritic, so the mark is skipped
    // rather than appended to the wrong letter.
    expect(toneNumberToMark('n3')).toBe('n');
    expect(toneNumberToMark('hm3')).toBe('hm');
    expect(toneNumberToMark('ng3')).toBe('ng');
  });

  it('applies the tone mark to the correct vowel', () => {
    // Placement rules: "a" wins, then "ou", then the last vowel.
    expect(toneNumberToMark('hao3')).toBe('hǎo');
    expect(toneNumberToMark('gou1')).toBe('gōu');
    expect(toneNumberToMark('xue2')).toBe('xué');
    expect(toneNumberToMark('dui4')).toBe('duì');
  });

  it('marks the final syllable of a hyphenated word', () => {
    expect(pinyinNumbersToMarks('xi1-an4')).toBe('xī-àn');
  });
});
