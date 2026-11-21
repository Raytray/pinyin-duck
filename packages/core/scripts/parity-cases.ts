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

import type { ScriptType } from '../src/types.js';

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
  for (const query of BOTH_SCRIPT_QUERIES) {
    for (const script of SCRIPTS) add(query, script);
  }
  return cases;
}
