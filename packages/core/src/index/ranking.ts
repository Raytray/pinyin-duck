/**
 * Shared candidate scoring and projection.
 *
 * Both the in-memory trie engine and the lazy B-tree engine rank the same way. Keeping
 * the formula in one place means a change to the ranking rules cannot drift between the
 * web client, the native clients and the on-disk scan.
 */

import { Candidate, ScriptType } from '../types.js';

/**
 * How many prefix entries one query may consider before the scan stops.
 *
 * A one-letter query such as `n` prefixes more than ten thousand dictionary entries, so
 * the scan needs a ceiling to stay bounded on a corpus that grows. It is set above the
 * widest prefix in the shipped CC-CEDICT corpus (10,266 entries, for `s`) so that the
 * default path never truncates and both engines report the same `total` for the same
 * query; a caller that wants a hard latency bound can pass a smaller `maxMatches` and
 * accept the truncated result.
 */
export const DEFAULT_MAX_MATCHES = 16384;

/** The fields that participate in scoring. */
export interface ScorableEntry {
  simplified: string;
  pinyinClean: string;
  pinyinNumbers: string;
  frequency: number;
  hskLevel?: number;
}

/**
 * Counts characters rather than UTF-16 units.
 *
 * Exported because the multi-character rule in `scoreEntry` depends on it, and a
 * caller reimplementing that rule needs the same notion of "how long is this word".
 */
export function countCharacters(text: string): number {
  return [...text].length;
}

/** The fields needed to build a displayed candidate. */
export interface CandidateSource extends ScorableEntry {
  traditional: string;
  pinyinMarks: string;
  shortGloss: string;
  definitions?: string[];
}

/**
 * Scores an entry against a toneless query.
 *
 * Match quality dominates. The tiers are spaced 50000 apart, and the largest
 * popularity contribution below is 30000, so a common character can never outrank a
 * better match: typing "nihao" must offer 你好, not the far more frequent 你.
 */
export function scoreEntry(
  entry: ScorableEntry,
  tonelessQuery: string,
  toneFilterNumbers: number[]
): number {
  let score = 0;
  const isExactPinyin = entry.pinyinClean === tonelessQuery;
  const startsWithPinyin = entry.pinyinClean.startsWith(tonelessQuery);
  const isPrefixQuery = tonelessQuery.startsWith(entry.pinyinClean);

  if (isExactPinyin) {
    score += 100000;
  } else if (startsWithPinyin) {
    score += 50000;
  } else if (isPrefixQuery) {
    // e.g. entry is "ni" when query is "nihao"
    score += 20000;
  }

  // Prefer multi-character words over single characters for the same reading.
  // The boost is capped rather than scaled by length: against a full dictionary
  // an 8-character exact match (e.g. 中国中央电视台) would otherwise bury the
  // common 2-character word it contains.
  //
  // Length is counted in code points. `String.length` counts UTF-16 units, and 205
  // CC-CEDICT entries are single characters outside the BMP (CJK extension B and
  // later), so the naive length calls every one of them a multi-character word and
  // hands a rare 𩽾 the word boost that should go to 你好 — which is enough to put
  // it above a common character with the same reading.
  if (isExactPinyin && countCharacters(entry.simplified) > 1) {
    score += 20000;
  }

  // Popularity and difficulty are tiebreakers within a tier. Frequency is
  // compressed to at most 20000 so it orders candidates but cannot promote a
  // weaker match above a stronger one.
  score += Math.round(entry.frequency / 5);

  // HSK bonus (HSK 1 words are most frequent for learners)
  if (entry.hskLevel) {
    score += (7 - entry.hskLevel) * 5000;
  }

  if (toneFilterNumbers.length > 0) {
    const entryTones = entry.pinyinNumbers.match(/\d/g)?.map(Number) || [];
    // A tone filter only constrains as many syllables as the query has tones, so it
    // discriminates between readings of the same length. Scoring a partial overlap let
    // one typed digit award the full bonus to any longer word: typing "bian3" promoted
    // 彼岸 (biàn, two syllables) above 扁 (biǎn), because 彼岸's *first* syllable
    // matched while the character the learner actually asked for did not.
    //
    // An entry that is shorter than the query has no tone to offer for the syllables
    // that were typed, so it cannot satisfy the filter and is penalized. An entry that is
    // longer is left alone: the query says nothing about its extra syllables, and the
    // match tier and frequency already place a longer word below an exact reading.
    if (entryTones.length <= toneFilterNumbers.length) {
      const matches = entryTones.length > 0 &&
        entryTones.every((tone, index) => tone === toneFilterNumbers[index]);
      if (matches) {
        score += toneFilterNumbers.length * 200000; // Heavily favor exact tone match!
      } else {
        score -= 500000; // Penalize mismatch if tone was explicitly typed
      }
    }
  }

  return score;
}

/** Projects a ranked entry into the candidate shape the UI renders. */
export function entryToCandidate(
  entry: CandidateSource,
  script: ScriptType,
  tonelessQuery: string
): Candidate {
  const hanzi = script === 'traditional' ? entry.traditional : entry.simplified;
  const remainingPinyin = tonelessQuery.startsWith(entry.pinyinClean)
    ? tonelessQuery.slice(entry.pinyinClean.length)
    : '';

  return {
    id: `${entry.simplified}-${entry.pinyinNumbers}`,
    hanzi,
    simplified: entry.simplified,
    traditional: entry.traditional,
    pinyinMarks: entry.pinyinMarks,
    pinyinNumbers: entry.pinyinNumbers,
    shortGloss: entry.shortGloss,
    definitions: entry.definitions,
    frequency: entry.frequency,
    matchedPinyin: entry.pinyinClean,
    remainingPinyin,
    hskLevel: entry.hskLevel,
  };
}
