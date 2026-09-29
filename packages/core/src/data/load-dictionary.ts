/**
 * Lazy loader for the generated CC-CEDICT dictionary asset.
 *
 * The asset is several megabytes, so it is served as a static file and fetched at
 * runtime rather than bundled. Decoding turns the compact wire tuples into full
 * `DictEntry` objects, deriving tone marks, clean pinyin and syllables from the
 * stored pinyin column.
 */

import { DictEntry } from '../types.js';
import { pinyinNumbersToMarks, cleanPinyin } from '../parser/pinyin.js';
import { DictionaryRow } from './dictionary-codec.js';

/** Where the web app serves the generated asset from. */
export const DEFAULT_DICTIONARY_URL = '/dictionary.json';

export interface LoadDictionaryOptions {
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Lets a React effect cancel an in-flight load on unmount. */
  signal?: AbortSignal;
}

/**
 * Expands wire tuples into dictionary entries.
 *
 * Tone marks and clean pinyin are memoized because the same pinyin reading is shared
 * by many words; without the cache this costs ~370ms for a full dictionary, with it
 * a small fraction of that.
 */
export function decodeDictionary(rows: DictionaryRow[]): DictEntry[] {
  const markCache = new Map<string, string>();
  const cleanCache = new Map<string, string>();

  const marksFor = (pinyinNumbers: string): string => {
    let marks = markCache.get(pinyinNumbers);
    if (marks === undefined) {
      marks = pinyinNumbersToMarks(pinyinNumbers);
      markCache.set(pinyinNumbers, marks);
    }
    return marks;
  };

  const cleanFor = (pinyinNumbers: string): string => {
    let clean = cleanCache.get(pinyinNumbers);
    if (clean === undefined) {
      clean = cleanPinyin(pinyinNumbers);
      cleanCache.set(pinyinNumbers, clean);
    }
    return clean;
  };

  const entries: DictEntry[] = new Array(rows.length);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const [simplified, traditional, pinyinNumbers, shortGloss, frequency, hskLevel] = row;

    entries[i] = {
      simplified,
      traditional: traditional || simplified,
      pinyinNumbers,
      pinyinMarks: marksFor(pinyinNumbers),
      pinyinClean: cleanFor(pinyinNumbers),
      pinyinSyllables: pinyinNumbers.split(/\s+/).filter(Boolean),
      shortGloss,
      frequency,
      hskLevel: hskLevel || undefined,
    };
  }

  return entries;
}

/**
 * Fetches and decodes the dictionary asset.
 *
 * Rejects when the request fails or the payload is not a dictionary, so callers can
 * surface a real error instead of silently searching an empty dictionary.
 */
export async function loadDictionary(
  url: string = DEFAULT_DICTIONARY_URL,
  options: LoadDictionaryOptions = {}
): Promise<DictEntry[]> {
  const { fetchImpl = fetch, signal } = options;

  const response = await fetchImpl(url, signal ? { signal } : undefined);
  if (!response.ok) {
    throw new Error(
      `Failed to load the dictionary from ${url} (${response.status} ${response.statusText}). ` +
        `Run "npm run build:dict" to generate it.`
    );
  }

  const rows = (await response.json()) as DictionaryRow[];
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(
      `The dictionary at ${url} is empty or malformed. Run "npm run build:dict" to regenerate it.`
    );
  }

  return decodeDictionary(rows);
}
