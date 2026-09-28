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
});
