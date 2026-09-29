export type ScriptType = 'simplified' | 'traditional';

export interface DictEntry {
  simplified: string;
  traditional: string;
  pinyinNumbers: string; // e.g. "ni3 hao3"
  pinyinMarks: string;   // e.g. "nǐ hǎo"
  pinyinClean: string;   // toneless, lowercased without spaces e.g. "nihao"
  pinyinSyllables: string[]; // e.g. ["ni3", "hao3"] or ["ni", "hao"]
  shortGloss: string;    // concise gloss for candidate cards
  frequency: number;     // 0 - 100000 (higher = more frequent)
  hskLevel?: number;     // 1 to 6 (if known)
  /**
   * Only present on hand-authored entries. The generated asset ships a trimmed gloss
   * rather than the full CC-CEDICT definition list, so this is usually undefined.
   */
  definitions?: string[];
}

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
  definitions?: string[];
}

export interface SearchOptions {
  script?: ScriptType;
  limit?: number;
  offset?: number;
  exactOnly?: boolean;
}

export interface SearchResult {
  query: string;
  segments: string[];
  candidates: Candidate[];
  total: number;
}
