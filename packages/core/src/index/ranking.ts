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
  if (isExactPinyin && entry.simplified.length > 1) {
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
    let toneMatches = 0;
    for (let i = 0; i < Math.min(toneFilterNumbers.length, entryTones.length); i++) {
      if (toneFilterNumbers[i] === entryTones[i]) {
        toneMatches++;
      }
    }
    if (toneMatches > 0) {
      score += toneMatches * 200000; // Heavily favor exact tone match!
    } else {
      score -= 500000; // Penalize mismatch if tone was explicitly typed
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
