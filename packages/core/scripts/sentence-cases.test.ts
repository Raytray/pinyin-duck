/**
 * The Sentence candidate acceptance cases, run on the real dictionary and bigram table.
 *
 * The constants in `src/sentence/sentence-search.ts` were chosen against these, so this is
 * what fails if a rebuilt corpus or a retuned constant breaks one. CI builds both assets
 * before the core tests; locally, run `npm run build:dict` and `npm run build:bigrams`.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { BTreeDictionary } from '../src/data/btree-dictionary.js';
import { BigramTable } from '../src/bigram/bigram-codec.js';
import { LazyPinyinSearchEngine } from '../src/index/lazy-search.js';
import { ALTERNATIVES_CASES, FIXED_WORD_CASES, SENTENCE_CASES } from './parity-cases.js';
import { syllableToneEnds } from '../src/parser/pinyin.js';

const PUBLIC = path.resolve(__dirname, '../../web/public');
const DICTIONARY_PATH = path.join(PUBLIC, 'dictionary.btree');
const BIGRAMS_PATH = path.join(PUBLIC, 'bigrams.bin');

function open<T>(file: string, command: string, opener: (bytes: Uint8Array) => T): T {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}. Run "${command}" at the repository root first.`);
  return opener(new Uint8Array(fs.readFileSync(file)));
}

describe('Sentence candidate acceptance cases (real dictionary, bigrams loaded)', () => {
  let engine: LazyPinyinSearchEngine;

  beforeAll(() => {
    const dictionary = open(DICTIONARY_PATH, 'npm run build:dict', (bytes) => BTreeDictionary.open(bytes));
    const bigrams = open(BIGRAMS_PATH, 'npm run build:bigrams', (bytes) => BigramTable.open(bytes));
    engine = new LazyPinyinSearchEngine(dictionary, { bigrams });
  });

  for (const testCase of SENTENCE_CASES) {
    it(`${testCase.query}: ${testCase.first} first (${testCase.pins})`, () => {
      const { candidates } = engine.search(testCase.query, { limit: 50 });
      const [first] = candidates;
      expect(first.hanzi).toBe(testCase.first);

      if (testCase.words) {
        expect(first.words?.map((word) => word.hanzi)).toEqual(testCase.words);
        expect(first.entryIds).toEqual([]);
      } else {
        expect(first.words).toBeUndefined();
      }
      if (testCase.remaining !== undefined) expect(first.remainingPinyin).toBe(testCase.remaining);

      const hanzi = candidates.map((candidate) => candidate.hanzi);
      for (const lower of testCase.below ?? []) {
        expect(hanzi).toContain(lower);
        expect(hanzi.indexOf(lower)).toBeGreaterThan(0);
      }
      for (const lower of testCase.belowIfOffered ?? []) expect(hanzi.indexOf(lower)).not.toBe(0);
      // At most one Sentence candidate, and never one repeating a word candidate's Hanzi.
      const sentences = candidates.filter((candidate) => candidate.words);
      expect(sentences.length).toBeLessThanOrEqual(1);
      for (const sentence of sentences) {
        expect(candidates.filter((candidate) => candidate.hanzi === sentence.hanzi)).toHaveLength(1);
      }
    });
  }
});

describe('Fixed word acceptance cases (real dictionary, bigrams loaded)', () => {
  let engine: LazyPinyinSearchEngine;

  beforeAll(() => {
    const dictionary = open(DICTIONARY_PATH, 'npm run build:dict', (bytes) => BTreeDictionary.open(bytes));
    const bigrams = open(BIGRAMS_PATH, 'npm run build:bigrams', (bytes) => BigramTable.open(bytes));
    engine = new LazyPinyinSearchEngine(dictionary, { bigrams });
  });

  for (const testCase of FIXED_WORD_CASES) {
    const fixedNames = testCase.fixedWords.map(({ word }) => word.simplified).join(', ');
    it(`${testCase.query} with ${fixedNames} fixed: ${testCase.words.join('')} first (${testCase.pins})`, () => {
      const { candidates } = engine.search(testCase.query, { limit: 50, fixedWords: testCase.fixedWords });
      const [first] = candidates;
      expect(first.words?.map((word) => word.hanzi)).toEqual(testCase.words);
      expect(first.remainingPinyin).toBe(testCase.remaining);
      for (const { span: { start, end }, word } of testCase.fixedWords) {
        expect(first.words?.find((each) => each.span?.start === start && each.span?.end === end)?.pinyinNumbers).toBe(
          word.pinyinNumbers
        );
      }
      expect(candidates.filter((candidate) => candidate.hanzi === first.hanzi)).toHaveLength(1);
    });
  }

  for (const testCase of ALTERNATIVES_CASES) {
    it(`alternatives for [${testCase.span.start}, ${testCase.span.end}) of ${testCase.query} (${testCase.pins})`, () => {
      const alternatives = engine.alternativesForSpan(testCase.query, testCase.span);
      const hanzi = alternatives.map((candidate) => candidate.hanzi);
      expect(new Set(hanzi).size).toBe(hanzi.length);
      for (const word of testCase.includes) expect(hanzi).toContain(word);
      for (const word of testCase.excludes ?? []) expect(hanzi).not.toContain(word);
      if (testCase.tone !== undefined) {
        for (const candidate of alternatives) {
          expect(syllableToneEnds(candidate.pinyinNumbers).map(({ tone }) => tone)).toEqual([testCase.tone]);
        }
      }
    });
  }
});
