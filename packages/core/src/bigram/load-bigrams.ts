/**
 * Downloads the bigram table Sentence candidates score with and opens it in memory.
 *
 * The web app fetches it after the dictionary, through the same gzip-sniffing body reader,
 * and hands it to the search engine once it arrives. Search works without it (unigram
 * only), so a failed load costs sentence quality, not input.
 */

import { readBody, type LoadDictionaryOptions } from '../data/load-dictionary.js';
import { BigramTable, malformedBigramFile } from './bigram-codec.js';

export type LoadBigramTableOptions = LoadDictionaryOptions;

/** Fetches, decompresses and opens the bigram file at `url`. */
export async function loadBigramTable(url: string, options: LoadBigramTableOptions = {}): Promise<BigramTable> {
  const { fetchImpl = fetch, signal, onProgress } = options;
  const response = await fetchImpl(url, signal ? { signal } : {});
  if (!response.ok) {
    throw new Error(`Failed to load the bigram file from ${url} (${response.status} ${response.statusText}).`);
  }
  return BigramTable.open(await readBody(response, onProgress, malformedBigramFile));
}
