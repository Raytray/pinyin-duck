/**
 * Wire format for the generated dictionary asset.
 *
 * The asset is far too large to bundle as a TypeScript module, so it is emitted as a
 * static JSON file and fetched at runtime. Rows are tuples rather than objects because
 * repeating nine JSON keys across ~125k entries would more than double the payload.
 *
 * Columns:
 *   0  simplified   Simplified Chinese (also the frequency and HSK join key)
 *   1  traditional  Traditional Chinese form
 *   2  pinyin       Tone-numbered pinyin, e.g. "ni3 hao3"
 *   3  gloss        Concise English gloss shown on the candidate card
 *   4  frequency    Normalized 0-100000 usage score (0 = unseen in the corpus)
 *   5  hskLevel     HSK 1-6, or 0 when the word is not on the HSK list
 *
 * Tone marks, clean pinyin and syllables are derived on load rather than stored,
 * which keeps the asset small and guarantees they always match the pinyin column.
 */
export type DictionaryRow = [string, string, string, string, number, number];

/** Bumped when the column layout changes in a way that needs a loader update. */
export const DICTIONARY_FORMAT_VERSION = 1;
