import { describe, expect, it } from 'vitest';
import type { FixedWord } from '@pinyinduck/core';
import { carryFixedWords, composingAfter } from './fixed-words';

describe('composingAfter: what stays composing after committing through a word', () => {
  it('keeps the raw text after the toneless offset', () => {
    expect(composingAfter('woxianghekafei', 7)).toBe('hekafei');
  });

  it('commits a separator that follows the word with it', () => {
    expect(composingAfter("xi'an'ren", 4)).toBe('ren');
  });

  it('commits a tone digit typed after the word with it', () => {
    expect(composingAfter('wo3xiang3he1', 2)).toBe('xiang3he1');
    expect(composingAfter('wo3xiang3he1', 7)).toBe('he1');
  });

  it('counts u: as the one letter ü, as the toneless query does', () => {
    expect(composingAfter('nu:ren', 2)).toBe('ren');
  });

  it('leaves nothing when the word ends the query', () => {
    expect(composingAfter('woxiang3', 7)).toBe('');
  });
});

const he: FixedWord = { span: { start: 7, end: 9 }, word: { simplified: '喝', traditional: '喝', pinyinNumbers: 'he1' } };
const xiang: FixedWord = { span: { start: 2, end: 7 }, word: { simplified: '向', traditional: '向', pinyinNumbers: 'xiang4' } };
/** 咖啡 fixed on `ka`, a completion: its key `kafei` runs past the span. */
const kafeiOnKa: FixedWord = {
  span: { start: 9, end: 11 },
  word: { simplified: '咖啡', traditional: '咖啡', pinyinNumbers: 'ka1 fei1' },
};

/** `kafeiOnKa` with its span stretched or re-anchored to end at `end`. */
const endAt = (end: number): FixedWord => ({ ...kafeiOnKa, span: { start: 9, end } });

describe('carryFixedWords: the Fixed words that last after the composition changes', () => {
  it('keeps them while the learner types on', () => {
    expect(carryFixedWords([xiang, he], 'woxianghekafei')).toEqual([xiang, he]);
  });

  it('drops one when a Backspace reaches into its span, keeping those before it', () => {
    expect(carryFixedWords([xiang, he], 'woxiangh')).toEqual([xiang]);
    expect(carryFixedWords([xiang, he], 'woxianghe')).toEqual([xiang, he]);
  });

  it('stretches a fixed completion as the learner types more of its key', () => {
    expect(carryFixedWords([kafeiOnKa], 'woxianghekaf')).toEqual([endAt(12)]);
  });

  it('turns a fixed completion into an exact word once its key is typed, which then lasts', () => {
    expect(carryFixedWords([kafeiOnKa], 'woxianghekafei')).toEqual([endAt(14)]);
    expect(carryFixedWords([endAt(14)], 'woxianghekafeiranhou')).toEqual([
      endAt(14),
    ]);
  });

  it('re-anchors a fixed completion to its key when the learner types past it at once', () => {
    expect(carryFixedWords([kafeiOnKa], 'woxianghekafeir')).toEqual([endAt(14)]);
  });

  it('drops a fixed completion once the typing leaves its key', () => {
    expect(carryFixedWords([kafeiOnKa], 'woxianghekan')).toEqual([]);
  });

  it('reads offsets in the toneless query, past tone digits and separators', () => {
    expect(carryFixedWords([kafeiOnKa], "wo3xiang3he1ka'fe")).toEqual([endAt(13)]);
  });
});
