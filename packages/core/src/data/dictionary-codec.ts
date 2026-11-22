/**
 * The row the dictionary builder joins from its sources, and that `buildBTree` turns
 * into B-tree leaf entries.
 *
 * Columns:
 *   0  simplified   Simplified Chinese (also the frequency and HSK join key)
 *   1  traditional  Traditional Chinese form
 *   2  pinyin       Tone-numbered pinyin, e.g. "ni3 hao3"
 *   3  gloss        Concise English gloss shown on the candidate card
 *   4  frequency    Normalized 0-100000 usage score (0 = unseen in the corpus)
 *   5  hskLevel     HSK 1-6, or 0 when the word is not on the HSK list
 *   6  entryIds     The ids of the entries the row stands for (后 hòu stands for 後 and 后);
 *                   empty when omitted
 *   7  onlyIn       The one script the row is a candidate in, or omitted for both
 *
 * Clean pinyin (the B-tree key) and tone marks are derived from the pinyin column
 * rather than stored, so they always match it.
 */
import type { ScriptType } from '../types.js';

export type DictionaryRow = [
  simplified: string,
  traditional: string,
  pinyin: string,
  gloss: string,
  frequency: number,
  hskLevel: number,
  entryIds?: number[],
  onlyIn?: ScriptType,
];
