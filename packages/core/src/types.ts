export type ScriptType = 'simplified' | 'traditional';

export interface Candidate {
  id: string;
  hanzi: string;         // displayed characters according to active ScriptType
  simplified: string;
  traditional: string;
  pinyinMarks: string;
  pinyinNumbers: string;
  shortGloss: string;
  frequency: number;
  matchedPinyin: string;
  remainingPinyin: string;
  hskLevel?: number;
  /**
   * The dictionary entries this candidate stands for, which key its Candidate detail. One
   * for most candidates; several when a simplified candidate stands for headwords sharing
   * its form (后 hòu for 後 and 后), in the order the detail groups them.
   */
  entryIds: number[];
  /**
   * Set only on a Sentence candidate: its words in order, each a candidate with its own
   * Hanzi, reading, gloss and `entryIds`. The sentence's own `entryIds` is empty, and its
   * Hanzi and reading are the words' joined.
   */
  words?: Candidate[];
  /**
   * Set only on a word inside a Sentence candidate's `words`: the span `[start, end)` of the
   * toneless query it covers. `matchedPinyin` is the word's own key, which for a completed
   * last word runs past the query, so the span is what to pass to `alternativesForSpan` or
   * a `FixedWord`. Committing through word k commits `words[0..k]` and leaves the toneless
   * query from `words[k].span.end` composing.
   */
  span?: { start: number; end: number };
}

export interface SearchOptions {
  script?: ScriptType;
  limit?: number;
  offset?: number;
  exactOnly?: boolean;
  /**
   * Caps how many prefix matches a query considers. Defaults to `DEFAULT_MAX_MATCHES`,
   * which is wide enough that the default path never truncates.
   */
  maxMatches?: number;
  /**
   * Fixed words: words the learner chose in place of others inside the Sentence candidate
   * (see `FixedWord`). The sentence is rebuilt so each one sits on its span, with the best
   * path before and after it, and while any is honored that edited sentence is the first
   * candidate.
   *
   * The engine keeps no state between searches: the UI holds this list and passes it with
   * every keystroke while the learner keeps composing. Dropping fixed words is the UI's job:
   * clear the whole list when the sentence (or part of it) is committed and on Esc, and drop
   * a fixed word as soon as a Backspace deletes into its span (`end` > the new toneless
   * query length). Typing more pinyin after them keeps them.
   *
   * A fixed word the current query cannot hold is ignored, not an error: its span is not a
   * word boundary on both ends, its entry is not under that span, a typed tone rules it out,
   * or it overlaps an earlier one in the list.
   */
  fixedWords?: readonly FixedWord[];
}

/**
 * A word the learner chose in place of another inside a Sentence candidate, pinned to the
 * span of the query it covers. Build one from a candidate `alternativesForSpan` returned and
 * the span it was asked for.
 */
export interface FixedWord {
  /** The span `[start, end)` in the toneless query (`cleanPinyin(query)` offsets). */
  start: number;
  end: number;
  /**
   * The entry, by its forms and reading. A word or alternative candidate can be passed as
   * is. Its key is normally exactly the span; for the last word it may instead be a longer
   * key that completes the query (`kafe` → 咖啡), honored only while the span ends the query.
   */
  word: Pick<Candidate, 'simplified' | 'traditional' | 'pinyinNumbers'>;
}

export interface SearchResult {
  query: string;
  segments: string[];
  candidates: Candidate[];
  total: number;
}
