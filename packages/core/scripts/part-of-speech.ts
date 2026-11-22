/**
 * Part of speech for Candidate detail records, from English Wiktionary and HanDeDict (#8).
 *
 * Both sources are joined to dictionary entries on headword (traditional and simplified) and
 * reading, ignoring capitals (ADR 0001). Each source's part-of-speech names map to the learner
 * labels in `PARTS_OF_SPEECH`; a name with no clear label, and every proper-name one, is dropped.
 */

import type { PartOfSpeech } from '../src/detail/detail-codec.js';

/** What the lookup needs to know about an entry. */
export interface PartOfSpeechSubject {
  traditional: string;
  simplified: string;
  /** Tone-numbered, as CC-CEDICT writes it. */
  pinyinNumbers: string;
}

/**
 * HanDeDict's part-of-speech abbreviations (German, undocumented upstream). `P` and `A` are left
 * out because they are ambiguous, `Eig` (Eigenname) because a proper name is a Proper noun
 * sense already.
 */
export const HANDEDICT_LABELS: Readonly<Record<string, PartOfSpeech>> = {
  S: 'noun',
  V: 'verb',
  Adj: 'adjective',
  Adv: 'adverb',
  Pron: 'pronoun',
  Num: 'numeral',
  Zähl: 'measure word',
  Präp: 'preposition',
  Konj: 'conjunction',
  Partikel: 'particle',
  Int: 'interjection',
  Sprichw: 'idiom',
  Redew: 'idiom',
  Phrase: 'idiom',
};

/**
 * wiktextract's names for Wiktionary's part-of-speech headers. `name` (proper noun) is left out
 * like HanDeDict's `Eig`, and so are headers with no learner label (`det`, `postp`, `suffix`).
 */
export const WIKTIONARY_LABELS: Readonly<Record<string, PartOfSpeech>> = {
  noun: 'noun',
  verb: 'verb',
  adj: 'adjective',
  adv: 'adverb',
  pron: 'pronoun',
  num: 'numeral',
  classifier: 'measure word',
  prep: 'preposition',
  conj: 'conjunction',
  particle: 'particle',
  intj: 'interjection',
  idiom: 'idiom',
  proverb: 'idiom',
  phrase: 'idiom',
};

/** A CC-CEDICT-format line: `傳統 传统 [chuan2 tong3] /tradition/`. */
const CEDICT_LINE = /^(\S+) (\S+) \[([^\]]*)\] \/(.*)\/\s*$/;

/** A parenthesised annotation, whose first item is where HanDeDict writes the part of speech. */
const ANNOTATION_GROUP = /\(([^()]{1,30})\)/g;

/** Combining tone marks, as `normalize('NFD')` splits them off a vowel. */
const TONE_MARKS: Readonly<Record<string, string>> = { '̄': '1', '́': '2', '̌': '3', '̀': '4' };
const DIAERESIS = '̈';

/**
 * A reading in a form both sources and CC-CEDICT agree on: its letters, then its tones 1 to 4.
 * `xi3 huan5`, `xǐhuan` and `Xi3huan5` are all `xihuan|3`; `lu:4`, `lv4` and `lǜ` are `lv|4`.
 */
export function readingKey(pinyin: string): string {
  let letters = '';
  let tones = '';
  let afterLetter = false;
  for (const ch of pinyin.normalize('NFD').toLowerCase().replace(/u:|ü/g, 'v')) {
    if (TONE_MARKS[ch]) {
      tones += TONE_MARKS[ch];
      continue;
    }
    if (ch === DIAERESIS) {
      letters = letters.replace(/u$/, 'v');
      continue;
    }
    const isLetter = ch >= 'a' && ch <= 'z';
    if (isLetter) letters += ch;
    // A tone number follows its syllable; a digit anywhere else is written out (2019 guānzhuàng).
    else if (afterLetter && ch >= '1' && ch <= '4') tones += ch;
    afterLetter = isLetter;
  }
  return `${letters}|${tones}`;
}

function subjectKey(traditional: string, simplified: string, pinyin: string): string {
  return `${traditional}|${simplified}|${readingKey(pinyin)}`;
}

function addLabel(index: Map<string, PartOfSpeech[]>, key: string, label: PartOfSpeech): void {
  const labels = index.get(key);
  if (!labels) index.set(key, [label]);
  else if (!labels.includes(label)) labels.push(label);
}

/** The labels HanDeDict gives each headword and reading, in file order. */
function handeDictIndex(content: string): Map<string, PartOfSpeech[]> {
  const index = new Map<string, PartOfSpeech[]>();
  for (const line of content.replace(/^﻿/, '').split('\n')) {
    if (line.startsWith('#')) continue;
    const match = CEDICT_LINE.exec(line);
    if (!match) continue;
    const [, traditional, simplified, pinyin, body] = match;
    const key = subjectKey(traditional, simplified, pinyin);
    for (const sense of body.split('/')) {
      // Examples (`; Bsp.: ...`) carry their own glosses, not the sense's part of speech.
      const main = sense.split('; Bsp.:')[0];
      for (const [, group] of main.matchAll(ANNOTATION_GROUP)) {
        const label = HANDEDICT_LABELS[group.split(',')[0].trim()];
        if (label) addLabel(index, key, label);
      }
    }
  }
  return index;
}

/** The labels the reduced Wiktionary rows (`reduce-wiktionary.ts`) give each headword and reading. */
function wiktionaryIndex(content: string): Map<string, PartOfSpeech[]> {
  const index = new Map<string, PartOfSpeech[]>();
  for (const line of content.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [traditional, simplified, reading, header] = line.split('\t');
    const label = WIKTIONARY_LABELS[header];
    if (label) addLabel(index, subjectKey(traditional, simplified, reading), label);
  }
  return index;
}

/** An entry's labels and the one source they came from. */
export interface SourcedPartsOfSpeech {
  source: 'Wiktionary' | 'HanDeDict';
  labels: PartOfSpeech[];
}

/**
 * The part-of-speech labels of an entry and their source: Wiktionary's if it gives the entry
 * any, else HanDeDict's, never merged (#8); undefined when neither does. Each source's labels
 * are in its own order, without duplicates.
 *
 * `wiktionary` is the reduced file `data/wiktionary-pos.tsv`, `handeDict` the HanDeDict
 * export, which is in CC-CEDICT's format.
 */
export function partOfSpeechSources(
  wiktionary: string,
  handeDict: string
): (entry: PartOfSpeechSubject) => SourcedPartsOfSpeech | undefined {
  const fromWiktionary = wiktionaryIndex(wiktionary);
  const fromHandeDict = handeDictIndex(handeDict);
  return (entry) => {
    const key = subjectKey(entry.traditional, entry.simplified, entry.pinyinNumbers);
    const wiktionaryLabels = fromWiktionary.get(key);
    if (wiktionaryLabels) return { source: 'Wiktionary', labels: wiktionaryLabels };
    const handeDictLabels = fromHandeDict.get(key);
    return handeDictLabels && { source: 'HanDeDict', labels: handeDictLabels };
  };
}
