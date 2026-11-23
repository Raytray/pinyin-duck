/**
 * The query set `generate-android-parity.ts` pins.
 *
 * Hand-picked queries let the Kotlin `scoreEntry` keep an older tone rule than the
 * TypeScript one without the parity test noticing (issue #28): `shi4`, `ta4`, `lv4` and
 * `ni3hao3` all put a tone on every syllable or on a single-syllable word, so a rule that
 * only went wrong for a partly-toned query was never exercised. The cases below are
 * generated instead, so every word is queried with a tone in each position, a wrong tone in
 * each position, apostrophes and spaces between syllables, and in both scripts.
 */

import type { FixedWord, ScriptType } from '../src/types.js';

export interface ParityCase {
  readonly query: string;
  readonly script: ScriptType;
}

/**
 * A word to build queries from: its syllables in numbered pinyin, as CC-CEDICT spells them.
 */
export interface SeedWord {
  readonly syllables: readonly string[];
  /** Why the word is here, for whoever reads the list. */
  readonly covers: string;
}

export const SEED_WORDS: readonly SeedWord[] = [
  { syllables: ['ni3', 'hao3'], covers: 'two third tones (the tone-sandhi pair)' },
  { syllables: ['zhong1', 'guo2'], covers: 'different tones per syllable; 中國 differs in traditional' },
  { syllables: ['xi1', 'an1'], covers: 'a syllable boundary that needs an apostrophe' },
  { syllables: ['lv4', 'se4'], covers: 'ü typed as v' },
  { syllables: ['xian1', 'sheng5'], covers: 'neutral tone written as 5' },
  { syllables: ['tu3', 'tuo1', 'yu2'], covers: 'three syllables; 𱇏 is outside the BMP' },
  { syllables: ['liang3', 'song4', 'fan4'], covers: '𩠌 is outside the BMP in simplified only' },
];

/**
 * Queries kept from the hand-picked list: single syllables, partial input and phrases that
 * no seed word reaches. Each is pinned in simplified only.
 */
export const EXTRA_QUERIES: readonly string[] = [
  'shi4',
  'ta',
  'ta4',
  'shi',
  'lv4',
  'lu:4',
  'lve',
  'niha',
  'j',
  's',
  'womenshi',
  'xiexie',
  'gongzuo',
  'xuexi',
  'mingtian',
  'guojia',
  'zhongwen',
  'suanfa',
  'suoyou',
  'gongsi',
  'bian3',
  'hang',
  'jianguo',
  'fanguo',
  // 書 Shū and 書 shū are one entry, glossed from the common line.
  'shu1',
];

/**
 * The Sentence candidate acceptance cases (issues #29, #30 and #50), pinned in simplified
 * script with the bigram table loaded. `first` is the first candidate's Hanzi; `words` is
 * how a Sentence candidate there breaks down, absent when the first candidate is a word.
 * `remaining` is the pinyin a partial sentence leaves to compose; `below` lists candidates
 * that must be offered and rank under the first one, and `belowIfOffered` ones that must
 * rank under it when offered at all.
 */
export interface SentenceCase {
  readonly query: string;
  readonly first: string;
  readonly words?: readonly string[];
  readonly remaining?: string;
  readonly below?: readonly string[];
  readonly belowIfOffered?: readonly string[];
  /** Why the case is here. */
  readonly pins: string;
}

export const SENTENCE_CASES: readonly SentenceCase[] = [
  { query: 'nihao', first: '你好', pins: 'the bias toward one word keeps a common word first' },
  { query: 'zhongwen', first: '中文', pins: 'same' },
  {
    query: 'woshi',
    first: '我是',
    words: ['我', '是'],
    below: ['卧室', '卧式'],
    pins: 'a sentence beats a rarer word that covers the whole query',
  },
  {
    query: 'nishi',
    first: '你是',
    words: ['你', '是'],
    below: ['睨视'],
    pins: 'a sentence beats a very rare word',
  },
  {
    query: 'woxianghekafei',
    first: '我想喝咖啡',
    words: ['我', '想', '喝', '咖啡'],
    remaining: '',
    pins: 'full sentence first; the bigrams pick 喝 over 和 (#50)',
  },
  {
    query: 'xiexieni',
    first: '谢谢你',
    words: ['谢谢', '你'],
    // 谢谢 covers two of the three syllables, and prefix words are only ever the first
    // syllable's, so the engine does not offer it here today.
    belowIfOffered: ['谢谢'],
    pins: 'a sentence beats a prefix word (谢谢你 is not an entry)',
  },
  { query: 'zhongguoren', first: '中国人', pins: 'dedupe: the entry wins, no 中国 + 人' },
  {
    query: 'woxianghekafe',
    first: '我想喝咖啡',
    words: ['我', '想', '喝', '咖啡'],
    remaining: '',
    pins: 'the last word is completed, so the sentence is full',
  },
  {
    query: 'woxianghekafeiqqq',
    first: '我想喝咖啡',
    words: ['我', '想', '喝', '咖啡'],
    remaining: 'qqq',
    pins: 'a partial sentence leaves the rest composing',
  },
  {
    query: "xi'anhenmei",
    first: '西安很美',
    words: ['西安', '很', '美'],
    remaining: '',
    pins: 'an apostrophe forces a boundary: 先 cannot run across it (#40)',
  },
  {
    query: 'xi an hen mei',
    first: '西安很美',
    words: ['西安', '很', '美'],
    remaining: '',
    pins: 'so do spaces (#40)',
  },
];

/** A fixed word on `[start, end)` of the toneless query, by its forms and numbered reading. */
function fixed(start: number, end: number, simplified: string, pinyinNumbers: string, traditional = simplified): FixedWord {
  return { start, end, word: { simplified, traditional, pinyinNumbers } };
}

/**
 * The Fixed word acceptance cases (issues #37 and #42), pinned in simplified script with the
 * bigram table loaded. The edited sentence must be the first candidate, built from `words`,
 * leaving `remaining` to compose. `generate-android-parity.ts` writes them, with the span
 * alternatives cases below, to `fixed-word-parity.tsv`.
 */
export interface FixedWordCase {
  readonly query: string;
  readonly fixedWords: readonly FixedWord[];
  readonly words: readonly string[];
  readonly remaining: string;
  /** Why the case is here. */
  readonly pins: string;
}

export const FIXED_WORD_CASES: readonly FixedWordCase[] = [
  {
    query: 'woxianghekafei',
    fixedWords: [fixed(7, 9, '喝', 'he1')],
    words: ['我', '想', '喝', '咖啡'],
    remaining: '',
    pins: 'a fixed word on its span',
  },
  {
    query: 'woxianghekafei',
    fixedWords: [fixed(7, 9, '河', 'he2')],
    words: ['我', '向', '河', '咖啡'],
    remaining: '',
    pins: 'the neighbours of a fixed word may change: 向 → 河 beats 想 → 河',
  },
  {
    query: 'woxianghekafei',
    fixedWords: [fixed(7, 9, '河', 'he2'), fixed(2, 7, '像', 'xiang4')],
    words: ['我', '像', '河', '咖啡'],
    remaining: '',
    pins: 'two fixed words held at once, listed out of order',
  },
  {
    query: 'woxianghekafeiqqq',
    fixedWords: [fixed(7, 9, '和', 'he2')],
    words: ['我', '想', '和', '咖啡'],
    remaining: 'qqq',
    pins: 'a fixed word inside a partial sentence',
  },
  {
    query: 'woxianghekafei',
    fixedWords: [fixed(7, 9, '涸', 'he2')],
    words: ['我', '想', '涸', '咖啡'],
    remaining: '',
    pins: 'a fixed word with no frequency skips minSentenceWordFrequency',
  },
  {
    query: 'woshi',
    fixedWords: [fixed(0, 2, '卧', 'wo4', '臥')],
    words: ['卧', '是'],
    remaining: '',
    pins: 'the edited sentence comes first, ahead of the word 卧室 that covers the query',
  },
];

/**
 * The span alternatives cases: what a word menu offers for `span` of `query`. `tone`, when
 * set, is the only tone every alternative may carry; `includes` must be offered and
 * `excludes` must not.
 */
export interface AlternativesCase {
  readonly query: string;
  readonly span: { readonly start: number; readonly end: number };
  readonly tone?: number;
  readonly includes: readonly string[];
  readonly excludes?: readonly string[];
  readonly pins: string;
}

export const ALTERNATIVES_CASES: readonly AlternativesCase[] = [
  {
    query: 'woxiang he4 kafei',
    span: { start: 7, end: 9 },
    tone: 4,
    includes: ['和', '喝', '贺'],
    excludes: ['河', '合'],
    pins: 'a tone typed in the span keeps only the hè readings',
  },
  {
    query: 'woxianghekafei',
    span: { start: 7, end: 9 },
    includes: ['和', '喝', '河', '涸'],
    pins: 'every entry for the span, rare words included',
  },
  {
    query: "xi'anhenmei",
    span: { start: 0, end: 4 },
    includes: ['西安'],
    excludes: ['先'],
    pins: 'no alternative runs across an apostrophe typed inside the span',
  },
];

/**
 * Single queries pinned in both scripts, because the scripts are meant to differ on them.
 */
export const BOTH_SCRIPT_QUERIES: readonly string[] = [
  // 後 and 后 share 后 hòu: one candidate in simplified script, one each in traditional.
  'hou4',
];

const SCRIPTS: readonly ScriptType[] = ['simplified', 'traditional'];

function splitTone(syllable: string): { base: string; tone: number } {
  const match = /^([a-zü:]+)([1-5])$/.exec(syllable);
  if (!match) throw new Error(`Seed syllable "${syllable}" needs a tone digit`);
  return { base: match[1], tone: Number(match[2]) };
}

/** A tone that is not `tone`, so the query should filter the seed word out. */
function wrongTone(tone: number): number {
  return (tone % 4) + 1;
}

/**
 * Every query shape built from one word: no tones, all tones, apostrophes, spaces, a
 * capitalised form, and for each syllable in turn a tone only there, a wrong tone only
 * there, every tone but that one, and every tone right but that one.
 */
export function queriesForWord(word: SeedWord): string[] {
  const parts = word.syllables.map(splitTone);
  const spell = (toneAt: ReadonlyArray<number | null>, separator: string): string =>
    parts.map((part, i) => part.base + (toneAt[i] === null ? '' : String(toneAt[i]))).join(separator);

  const none = parts.map(() => null);
  const all = parts.map((part) => part.tone);

  // `toneAt[i]` is the tone written after syllable `i`, or `null` for none.
  const plain = spell(none, '');
  const queries = [
    plain,
    spell(all, ''),
    spell(none, "'"),
    spell(all, "'"),
    spell(all, ' '),
    plain.charAt(0).toUpperCase() + plain.slice(1),
  ];
  parts.forEach((part, i) => {
    const onlyHere = parts.map((_, j) => (j === i ? part.tone : null));
    const wrongHere = parts.map((_, j) => (j === i ? wrongTone(part.tone) : null));
    const allButWrongHere = parts.map((other, j) => (j === i ? wrongTone(other.tone) : other.tone));
    const allButHere = parts.map((other, j) => (j === i ? null : other.tone));
    queries.push(spell(onlyHere, ''), spell(wrongHere, ''), spell(allButHere, ''), spell(allButWrongHere, ''));
  });
  // For a two-syllable word, "every tone but this one" is "a tone only on the other one".
  return [...new Set(queries)];
}

export function buildParityCases(
  seeds: readonly SeedWord[] = SEED_WORDS,
  extras: readonly string[] = EXTRA_QUERIES
): ParityCase[] {
  const cases: ParityCase[] = [];
  const seen = new Set<string>();
  const add = (query: string, script: ScriptType): void => {
    const key = `${query}\t${script}`;
    if (seen.has(key)) return;
    seen.add(key);
    cases.push({ query, script });
  };

  for (const seed of seeds) {
    for (const query of queriesForWord(seed)) {
      for (const script of SCRIPTS) add(query, script);
    }
  }
  for (const query of extras) add(query, 'simplified');
  for (const { query } of SENTENCE_CASES) add(query, 'simplified');
  for (const query of BOTH_SCRIPT_QUERIES) {
    for (const script of SCRIPTS) add(query, script);
  }
  return cases;
}
