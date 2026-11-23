/// <reference types="vite/client" />

/**
 * Where the gzipped bigram table is served from, or undefined when it was not built.
 *
 * Sentence candidates score word pairs with it, but search works without it, and building
 * it means downloading a 173MB corpus (`npm run build:bigrams`). So unlike the dictionary
 * it is imported through a glob, which matches nothing when the file is absent rather than
 * failing the build: a checkout or CI job that skipped it still runs, unigram only. When
 * present, Vite fingerprints it like the dictionary (`assets/bigrams.bin-<hash>.gz`).
 */
const found = import.meta.glob<string>('./generated/bigrams.bin.gz', {
  query: '?url',
  import: 'default',
  eager: true,
});

export const BIGRAMS_URL: string | undefined = found['./generated/bigrams.bin.gz'];
