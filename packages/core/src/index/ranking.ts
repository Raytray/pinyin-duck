/**
 * Shared candidate scoring and projection.
 *
 * The search engine and the parity cases the Android port is checked against both rank
 * through these functions. Keeping the formula in one place means a change to the
 * ranking rules lands everywhere the TypeScript engine is used.
 */

import { Candidate, ScriptType } from '../types.js';
import { syllableToneEnds, type ToneConstraint } from '../parser/pinyin.js';

/**
 * How many prefix entries one query may consider before the scan stops.
 *
 * A one-letter query such as `n` prefixes more than ten thousand dictionary entries, so
 * the scan needs a ceiling to stay bounded on a corpus that grows. It is set above the
 * widest prefix in the shipped CC-CEDICT corpus (10,266 entries, for `s`) so that the
 * default path never truncates and `total` counts every match; a caller that wants a
 * hard latency bound can pass a smaller `maxMatches` and accept the truncated result.
 */
export const DEFAULT_MAX_MATCHES = 16384;

/** The fields that participate in scoring. */
export interface ScorableEntry {
  simplified: string;
  pinyinClean: string;
  pinyinNumbers: string;
  frequency: number;
  hskLevel?: number;
  /**
   * Breaks the last tie, between headwords that share a simplified form and reading (後
   * and 后, both hòu), which are separate candidates in traditional script.
   */
  traditional?: string;
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
  /** The entries the candidate stands for; see `Candidate.entryIds`. */
  entryIds?: number[];
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
  toneFilter: readonly ToneConstraint[]
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

  if (toneFilter.length > 0) {
    // Each typed tone constrains the syllable that ends where it was typed: in
    // "nihao4" the 4 belongs to hao, and in "ni3hao" the 3 belongs to ni. Matching
    // digits to syllables by order instead read "nihao4" as "ni is fourth tone".
    //
    // Anchoring on the toneless offset also checks the syllable boundary. "bian3" asks
    // for one syllable "bian"; 彼岸 (bi3 an4) shares the letters but has no syllable
    // ending at offset 4 with tone 3, so it cannot take the bonus 扁 (biǎn) earns.
    //
    // A tone typed beyond the end of the entry says nothing about it: in "nihao3", 你
    // is a prefix candidate whose own syllable was left untoned, so it is neither
    // rewarded nor penalized and stays below the word that matches the tone.
    const ends = syllableToneEnds(entry.pinyinNumbers);
    let matched = 0;
    let mismatched = false;
    for (const constraint of toneFilter) {
      if (constraint.offset <= 0 || constraint.offset > entry.pinyinClean.length) continue;
      const syllable = ends.find((end) => end.offset === constraint.offset);
      if (syllable && syllable.tone === constraint.tone) {
        matched++;
      } else {
        mismatched = true;
      }
    }
    if (mismatched) {
      score -= 500000; // Penalize mismatch if tone was explicitly typed
    } else {
      score += matched * 200000; // Heavily favor exact tone match!
    }
  }

  return score;
}

/** An entry together with its score against the current query. */
export interface ScoredEntry<E extends ScorableEntry = ScorableEntry> {
  entry: E;
  score: number;
}

/**
 * The one ordering every engine ranks by: score, then frequency, then key, form,
 * reading and traditional form.
 *
 * The TypeScript engine and the Android port sort with this exact chain, and use it to
 * pick which reading represents a hanzi that appears under several, so the same query
 * yields the same list in the same order on every client. Insertion or scan order must
 * never decide a tie, because page scan order is a storage detail.
 */
export function compareScored(a: ScoredEntry, b: ScoredEntry): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.entry.frequency !== b.entry.frequency) return b.entry.frequency - a.entry.frequency;
  if (a.entry.pinyinClean !== b.entry.pinyinClean) {
    return a.entry.pinyinClean < b.entry.pinyinClean ? -1 : 1;
  }
  if (a.entry.simplified !== b.entry.simplified) {
    return a.entry.simplified < b.entry.simplified ? -1 : 1;
  }
  if (a.entry.pinyinNumbers !== b.entry.pinyinNumbers) {
    return a.entry.pinyinNumbers < b.entry.pinyinNumbers ? -1 : 1;
  }
  const traditionalA = a.entry.traditional ?? '';
  const traditionalB = b.entry.traditional ?? '';
  if (traditionalA !== traditionalB) return traditionalA < traditionalB ? -1 : 1;
  return 0;
}

/** An entry's Hanzi as `script` displays it. */
export function hanziIn(entry: { simplified: string; traditional: string }, script: ScriptType): string {
  return script === 'traditional' ? entry.traditional : entry.simplified;
}

/** Projects a ranked entry into the candidate shape the UI renders. */
export function entryToCandidate(
  entry: CandidateSource,
  script: ScriptType,
  tonelessQuery: string
): Candidate {
  const hanzi = hanziIn(entry, script);
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
    frequency: entry.frequency,
    matchedPinyin: entry.pinyinClean,
    remainingPinyin,
    hskLevel: entry.hskLevel,
    entryIds: entry.entryIds ?? [],
  };
}
