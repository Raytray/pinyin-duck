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
}

export interface SearchResult {
  query: string;
  segments: string[];
  candidates: Candidate[];
  total: number;
}
