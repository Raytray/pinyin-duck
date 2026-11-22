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
import { SENTENCE_CASES } from './parity-cases.js';

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
