/**
 * Downloads the Candidate detail file and opens it in memory (ADR 0002).
 *
 * The web app fetches it in full the first time a Candidate detail opens, through the same
 * gzip-sniffing body reader as the dictionary, and holds it decompressed. A file from another build than the
 * dictionary is a failed load, like an HTTP error or a truncated download.
 */

import { readBody, type LoadDictionaryOptions } from '../data/load-dictionary.js';
import { DetailFile, malformedDetailFile } from './detail-codec.js';

export type LoadDetailFileOptions = LoadDictionaryOptions;

/** Fetches, decompresses and opens the detail file at `url`, built with `buildId`. */
export async function loadDetailFile(
  url: string,
  buildId: number,
  options: LoadDetailFileOptions = {}
): Promise<DetailFile> {
  const { fetchImpl = fetch, signal, onProgress } = options;
  const response = await fetchImpl(url, signal ? { signal } : {});
  if (!response.ok) {
    throw new Error(
      `Failed to load the Candidate detail file from ${url} (${response.status} ${response.statusText}).`
    );
  }
  return DetailFile.open(await readBody(response, onProgress, malformedDetailFile), buildId);
}
