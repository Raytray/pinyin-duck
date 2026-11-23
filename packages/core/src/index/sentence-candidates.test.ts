import { describe, it, expect } from 'vitest';
import { LazyPinyinSearchEngine } from './lazy-search';
import { BTreeDictionary } from '../data/btree-dictionary';
import { buildBTree } from '../data/btree-builder';
import { BigramTable, encodeBigramFile, type BigramPair } from '../bigram/bigram-codec';
import type { DictionaryRow } from '../data/dictionary-codec';
import type { Candidate, FixedWord, SearchOptions } from '../types';

/** The shipped corpus's base word cost, so the toy scores behave like the real ones. */
const WORD_COST = 119936;

// Frequencies are the shipped dictionary's, so the arithmetic in each test is the real one.
const rows: DictionaryRow[] = [
  ['我', '我', 'wo3', 'I; me', 99503, 1, [1]],
  ['卧', '臥', 'wo4', 'to lie down', 30000, 0, [2]],
  ['是', '是', 'shi4', 'to be', 94324, 1, [3]],
  ['卧室', '臥室', 'wo4 shi4', 'bedroom', 50182, 0, [4]],
  ['卧式', '臥式', 'wo4 shi4', 'horizontal', 0, 0, [5]],
  ['你', '你', 'ni3', 'you', 98770, 1, [6]],
  ['好', '好', 'hao3', 'good', 87105, 1, [7]],
  ['你好', '你好', 'ni3 hao3', 'hello', 71309, 1, [8]],
  ['想', '想', 'xiang3', 'to want', 83385, 1, [9]],
  ['和', '和', 'he2', 'and', 83526, 1, [10]],
  ['喝', '喝', 'he1', 'to drink', 65923, 1, [11]],
  ['咖啡', '咖啡', 'ka1 fei1', 'coffee', 59813, 1, [12]],
  ['反', '反', 'fan3', 'reverse', 60000, 0, [13]],
  ['感', '感', 'gan3', 'to feel', 60000, 0, [14]],
  ['西', '西', 'xi1', 'west', 53376, 1, [15]],
  ['安', '安', 'an1', 'calm', 54888, 0, [16]],
  ['先', '先', 'xian1', 'first', 68327, 1, [17]],
  ['中国', '中國', 'zhong1 guo2', 'China', 58468, 1, [18]],
  ['人', '人', 'ren2', 'person', 83359, 1, [19]],
  ['中国人', '中國人', 'zhong1 guo2 ren2', 'Chinese person', 0, 0, [20]],
  ['霓虹灯', '霓虹燈', 'ni2 hong2 deng1', 'neon light', 200, 0, [21]],
  // More words on `he`, for Fixed words and span alternatives.
  ['和', '和', 'he4', 'to reply in verse', 83526, 0, [22]],
  ['喝', '喝', 'he4', 'to shout', 65923, 0, [23]],
  ['河', '河', 'he2', 'river', 47964, 0, [24]],
  ['贺', '賀', 'he4', 'to congratulate', 44917, 0, [25]],
  ['涸', '涸', 'he2', 'to dry up', 0, 0, [26]],
  ['像', '像', 'xiang4', 'to resemble', 75964, 0, [27]],
  // Rarer than 先, so only a forced boundary picks it on `xian`.
  ['西安', '西安', 'xi1 an1', "Xi'an", 20000, 0, [28]],
];

/** The pairs a bigram table holds, scored as `build-bigrams.ts` would. */
const pairs: BigramPair[] = [
  { first: '我', second: '想', score: 97088 },
  { first: '想', second: '喝', score: 85440 },
  { first: '想', second: '和', score: 93632 },
  { first: '喝', second: '咖啡', score: 98368 },
  { first: '和', second: '咖啡', score: 67968 },
  { first: '我', second: '是', score: 98048 },
  // Only a path through a fixed 河 can use this, so it shows a neighbour changing.
  { first: '像', second: '河', score: 99008 },
];

function engineWith(withBigrams: boolean) {
  const dictionary = BTreeDictionary.open(buildBTree(rows, { baseWordCost: WORD_COST }));
  const bigrams = withBigrams
    ? BigramTable.open(encodeBigramFile(pairs, { scoreOffset: WORD_COST, scoreStep: 64 }))
    : undefined;
  return new LazyPinyinSearchEngine(dictionary, { bigrams });
}

const search = (query: string, options: SearchOptions = {}, withBigrams = true) =>
  engineWith(withBigrams).search(query, { limit: 50, ...options }).candidates;
const sentenceOf = (candidates: Candidate[]) => candidates.find((candidate) => candidate.words);
const wordsOf = (candidate: Candidate | undefined) => candidate?.words?.map((word) => word.hanzi);

describe('Sentence candidates', () => {
  it('builds the sentence a bigram table prefers over the more frequent word', () => {
    // Unigram alone takes 和 (83,526) over 喝 (65,923); the pairs 想→喝→咖啡 outscore 想→和→咖啡.
    expect(wordsOf(search('woxianghekafei')[0])).toEqual(['我', '想', '喝', '咖啡']);
  });

  it('works with no bigram table, scoring every pair as a unigram miss with no penalty', () => {
    expect(wordsOf(search('woxianghekafei', {}, false)[0])).toEqual(['我', '想', '和', '咖啡']);
    expect(search('woshi', {}, false)[0].hanzi).toBe('我是');
  });

  it('puts a sentence above a rarer word that covers the whole query', () => {
    const hanzi = search('woshi').map((candidate) => candidate.hanzi);
    expect(hanzi[0]).toBe('我是');
    expect(hanzi.indexOf('卧室')).toBeGreaterThan(0);
    // A word with no frequency still ranks as a word, but is never inside a sentence.
    expect(hanzi).toContain('卧式');
  });

  it('keeps a common word first and puts the sentence right after the words covering the query', () => {
    // 你好 (71,309 − W) beats 你 + 好 (98,770 + 87,105 − 2W), and 你 + 好 would repeat it anyway.
    const candidates = search('nihao');
    expect(candidates[0].hanzi).toBe('你好');
    expect(sentenceOf(candidates)).toBeUndefined();

    const xian = search('xianhao');
    // 先 + 好 covers the query and no word does, so the sentence is first.
    expect(wordsOf(xian[0])).toEqual(['先', '好']);
  });

  it('finds words on a split other than the one segmentPinyin picks', () => {
    // segmentPinyin reads fangan as fang + an; 反 + 感 sits on fan + gan.
    expect(wordsOf(search('fangan')[0])).toEqual(['反', '感']);
  });

  it('never lets a word run across an apostrophe, space or tone digit', () => {
    // 先 (68,327) beats 西安 (20,000) on xianhao, but xian is one syllable and cannot hold the break.
    expect(wordsOf(search('xianhao')[0])).toEqual(['先', '好']);
    expect(wordsOf(search("xi'anhao")[0])).toEqual(['西安', '好']);
    expect(wordsOf(search('xi an hao')[0])).toEqual(['西安', '好']);
    expect(wordsOf(search('xi1anhao')[0])).toEqual(['西安', '好']);
  });

  it('filters edges on typed tones, and offers no sentence when none survives', () => {
    // 我 is third tone, so the sentence takes 卧; 卧室 fits both tones and still ranks first.
    const toned = search('wo4shi');
    expect(toned[0].hanzi).toBe('卧室');
    expect(wordsOf(sentenceOf(toned))).toEqual(['卧', '是']);
    expect(sentenceOf(search('wo2shi'))).toBeUndefined();
  });

  it('completes the last word, unless the search is exact only', () => {
    const [first] = search('woxianghekaf');
    expect(wordsOf(first)).toEqual(['我', '想', '喝', '咖啡']);
    expect(first.remainingPinyin).toBe('');

    const exact = sentenceOf(search('woxianghekaf', { exactOnly: true }));
    // Without 咖啡 to follow, 想→和 outscores 想→喝.
    expect(wordsOf(exact)).toEqual(['我', '想', '和']);
    expect(exact?.remainingPinyin).toBe('kaf');
  });

  it('does not complete a last word that is only a consonant initial so far', () => {
    // "h" could start 和 or 喝, but a bare initial says too little, so it is left to compose.
    const sentence = sentenceOf(search('woxiangh'));
    expect(wordsOf(sentence)).toEqual(['我', '想']);
    expect(sentence?.remainingPinyin).toBe('h');
    // Once the tail holds a vowel, completion starts: "kaf" still gives 咖啡.
    expect(wordsOf(search('woxianghekaf')[0])).toEqual(['我', '想', '喝', '咖啡']);
  });

  it('offers the best path to the furthest node as a partial sentence above shorter prefix words', () => {
    const candidates = search('woxianghekafeiqqq');
    expect(wordsOf(candidates[0])).toEqual(['我', '想', '喝', '咖啡']);
    expect(candidates[0].matchedPinyin).toBe('woxianghekafei');
    expect(candidates[0].remainingPinyin).toBe('qqq');
    expect(candidates.map((candidate) => candidate.hanzi)).toContain('我');
  });

  it('offers no partial sentence of a single word', () => {
    expect(sentenceOf(search('woqqq'))).toBeUndefined();
  });

  it('drops a sentence that shows the same Hanzi as a word candidate', () => {
    const candidates = search('zhongguoren');
    expect(candidates[0].hanzi).toBe('中国人');
    expect(candidates[0].words).toBeUndefined();
    expect(sentenceOf(candidates)).toBeUndefined();
  });

  it('carries each word with its own reading, gloss and entry ids, and joins them outside', () => {
    const [sentence] = search('woshi');
    expect(sentence).toMatchObject({
      hanzi: '我是',
      simplified: '我是',
      pinyinMarks: 'wǒ shì',
      pinyinNumbers: 'wo3 shi4',
      matchedPinyin: 'woshi',
      remainingPinyin: '',
      entryIds: [],
    });
    expect(sentence.words?.map(({ hanzi, pinyinMarks, shortGloss, entryIds }) => ({ hanzi, pinyinMarks, shortGloss, entryIds }))).toEqual([
      { hanzi: '我', pinyinMarks: 'wǒ', shortGloss: 'I; me', entryIds: [1] },
      { hanzi: '是', pinyinMarks: 'shì', shortGloss: 'to be', entryIds: [3] },
    ]);
    expect(search('wo').every((candidate) => candidate.words === undefined)).toBe(true);
  });

  it('shows the words in the active script', () => {
    const [sentence] = search('woshi', { script: 'traditional' });
    expect(sentence.hanzi).toBe('我是');
    expect(sentenceOf(search('wo4shi', { script: 'traditional' }))?.hanzi).toBe('臥是');
  });

  it('counts the sentence in the total and pages over it', () => {
    const engine = engineWith(true);
    const all = engine.search('woshi', { limit: 50 });
    expect(all.total).toBe(all.candidates.length);
    expect(engine.search('woshi', { limit: 1, offset: 1 }).candidates[0].hanzi).toBe(all.candidates[1].hanzi);
  });
});

describe('Coverage first', () => {
  it('ranks a word that completes the query above one that leaves pinyin over', () => {
    // 你 is far more frequent and HSK 1, so it outscores 霓虹灯 (frequency 200), but it leaves
    // "hong" to compose while 霓虹灯 completes "nihong".
    const hanzi = search('nihong').map((candidate) => candidate.hanzi);
    expect(hanzi.indexOf('霓虹灯')).toBeGreaterThanOrEqual(0);
    expect(hanzi.indexOf('霓虹灯')).toBeLessThan(hanzi.indexOf('你'));
  });
});

/** The fixed word for `candidate` (as `alternativesForSpan` returns it) on the span [start, end). */
const fix = (start: number, end: number, simplified: string, pinyinNumbers: string, traditional = simplified): FixedWord => ({
  start,
  end,
  word: { simplified, traditional, pinyinNumbers },
});

describe('Fixed words', () => {
  it('rebuilds the sentence around a fixed word and puts it first', () => {
    // 贺 never wins on its own (和 and 喝 both outscore it), but the learner chose it.
    const candidates = search('woxianghekafei', { fixedWords: [fix(7, 9, '贺', 'he4', '賀')] });
    expect(wordsOf(candidates[0])).toEqual(['我', '想', '贺', '咖啡']);
    expect(candidates[0].remainingPinyin).toBe('');
  });

  it('lets the neighbours of a fixed word change', () => {
    // With 河 fixed, 像 → 河 is a bigram hit, so 像 takes the place of 想.
    expect(wordsOf(search('woxianghekafei', { fixedWords: [fix(7, 9, '河', 'he2')] })[0])).toEqual(['我', '像', '河', '咖啡']);
  });

  it('holds several fixed words at once', () => {
    const fixedWords = [fix(7, 9, '贺', 'he4', '賀'), fix(2, 7, '想', 'xiang3')];
    expect(wordsOf(search('woxianghekafei', { fixedWords })[0])).toEqual(['我', '想', '贺', '咖啡']);
    expect(search('woxianghekafei', { fixedWords, script: 'traditional' })[0].hanzi).toBe('我想賀咖啡');
  });

  it('uses a fixed word rarer than minSentenceWordFrequency', () => {
    // 涸 has no frequency, so it is never inside a sentence on its own.
    expect(wordsOf(search('woxianghekafei')[0])).not.toContain('涸');
    expect(wordsOf(search('woxianghekafei', { fixedWords: [fix(7, 9, '涸', 'he2')] })[0])).toEqual(['我', '想', '涸', '咖啡']);
  });

  it('holds a fixed word inside a partial sentence', () => {
    const [first] = search('woxianghekafeiqqq', { fixedWords: [fix(7, 9, '河', 'he2')] });
    expect(wordsOf(first)).toEqual(['我', '像', '河', '咖啡']);
    expect(first.remainingPinyin).toBe('qqq');
  });

  it('puts the edited sentence ahead of the words that cover the query', () => {
    // 卧 + 是 scores below the word 卧室, but the learner chose 卧.
    const hanzi = search('woshi', { fixedWords: [fix(0, 2, '卧', 'wo4', '臥')] }).map((candidate) => candidate.hanzi);
    expect(hanzi[0]).toBe('卧是');
    expect(hanzi).toContain('卧室');
  });

  it('drops the word, not the edited sentence, when both show the same Hanzi', () => {
    const candidates = search('zhongguoren', { fixedWords: [fix(0, 8, '中国', 'zhong1 guo2', '中國')] });
    expect(wordsOf(candidates[0])).toEqual(['中国', '人']);
    expect(candidates.filter((candidate) => candidate.hanzi === '中国人')).toHaveLength(1);
  });

  it('ignores a fixed word the query cannot hold', () => {
    const plain = wordsOf(search('woxianghekafei')[0]);
    for (const fixed of [
      fix(6, 9, '河', 'he2'), // not the word's span
      fix(7, 9, '想', 'xiang3'), // not an entry under the span
      fix(7, 9, '河', 'he4'), // not this entry's reading
      fix(7, 30, '河', 'he2'), // past the end of the query
    ]) {
      expect(wordsOf(search('woxianghekafei', { fixedWords: [fixed] })[0])).toEqual(plain);
    }
    // A typed tone rules 河 (hé) out on "he4".
    expect(wordsOf(search('woxianghe4kafei', { fixedWords: [fix(7, 9, '河', 'he2')] })[0])).not.toContain('河');
    // A typed apostrophe inside the span that is not one of the word's syllable ends.
    expect(wordsOf(search("xi'anhao", { fixedWords: [fix(0, 4, '先', 'xian1')] })[0])).toEqual(['西安', '好']);
    // An overlapping one: the first in the list wins.
    const overlapping = [fix(7, 9, '河', 'he2'), fix(2, 9, '想', 'xiang3')];
    expect(wordsOf(search('woxianghekafei', { fixedWords: overlapping })[0])).toEqual(['我', '像', '河', '咖啡']);
  });

  it('fixes a completed last word while its span ends the query', () => {
    const fixedWords = [fix(9, 13, '咖啡', 'ka1 fei1'), fix(7, 9, '河', 'he2')];
    expect(wordsOf(search('woxianghekafe', { fixedWords })[0])).toEqual(['我', '像', '河', '咖啡']);
    expect(sentenceOf(search('woxianghekafe', { fixedWords, exactOnly: true }))?.words?.map((word) => word.hanzi)).toEqual([
      '我',
      '像',
      '河',
    ]);
  });

  it('gives each word its own span and matched pinyin, so the UI can commit through one word', () => {
    const [sentence] = search('woxianghekafe');
    expect(sentence.words?.map(({ hanzi, matchedPinyin, span }) => ({ hanzi, matchedPinyin, span }))).toEqual([
      { hanzi: '我', matchedPinyin: 'wo', span: { start: 0, end: 2 } },
      { hanzi: '想', matchedPinyin: 'xiang', span: { start: 2, end: 7 } },
      { hanzi: '喝', matchedPinyin: 'he', span: { start: 7, end: 9 } },
      // A completed last word matches its whole key; its span stops at the end of the query.
      { hanzi: '咖啡', matchedPinyin: 'kafei', span: { start: 9, end: 13 } },
    ]);
  });
});

describe('Span alternatives', () => {
  const alternatives = (query: string, start: number, end: number, options: SearchOptions = {}) =>
    engineWith(true)
      .alternativesForSpan(query, { start, end }, options)
      .map((candidate) => `${candidate.hanzi} ${candidate.pinyinNumbers}`);

  it('lists every entry for the span, one per Hanzi, rare words included, in word-candidate order', () => {
    expect(alternatives('woxianghekafei', 7, 9)).toEqual(['和 he2', '喝 he1', '河 he2', '贺 he4', '涸 he2']);
  });

  it('keeps only the readings a tone typed in the span allows', () => {
    expect(alternatives('woxiang he4 kafei', 7, 9)).toEqual(['和 he4', '喝 he4', '贺 he4']);
    // A tone typed on the next word says nothing about this one.
    expect(alternatives('woxianghe kafei1', 7, 9)).toEqual(['和 he2', '喝 he1', '河 he2', '贺 he4', '涸 he2']);
  });

  it('never changes word boundaries', () => {
    // No entry is keyed "xianghe", so there is nothing to offer: 想 + 喝 stay two words.
    expect(alternatives('woxianghekafei', 2, 9)).toEqual([]);
    // Nor runs a word across a typed apostrophe or space inside the span.
    expect(alternatives('xianhao', 0, 4)).toEqual(['先 xian1', '西安 xi1 an1']);
    expect(alternatives("xi'anhao", 0, 4)).toEqual(['西安 xi1 an1']);
    expect(alternatives('xi an hao', 0, 4)).toEqual(['西安 xi1 an1']);
  });

  it('offers completions for a last word that runs past the end of the query', () => {
    expect(alternatives('woxianghekafe', 9, 13)).toEqual(['咖啡 ka1 fei1']);
    expect(alternatives('woxianghekafe', 9, 13, { exactOnly: true })).toEqual([]);
  });

  it('shows the active script and carries the span, ready to become a fixed word', () => {
    const engine = engineWith(true);
    const [first, ...rest] = engine.alternativesForSpan('woxianghekafei', { start: 7, end: 9 }, { script: 'traditional' });
    expect(rest.map((candidate) => candidate.hanzi)).toContain('賀');
    expect(first.span).toEqual({ start: 7, end: 9 });
    const he = rest.find((candidate) => candidate.hanzi === '賀')!;
    const fixedWords = [{ ...he.span!, word: he }];
    expect(engine.search('woxianghekafei', { script: 'traditional', fixedWords }).candidates[0].hanzi).toBe('我想賀咖啡');
  });
});
