/// <reference types="vite/client" />

/**
 * Where the gzipped dictionary is served from.
 *
 * `npm run build:dict` writes the file into `src/generated/`, and importing it here
 * (rather than serving it from `public/`) makes Vite fingerprint it: a production build
 * emits `assets/dictionary.btree-<hash>.gz`. The URL changes exactly when the content
 * does, so a host can cache it for good and a repeat visit does not download it again.
 */
// Far above Vite's 4KB inline limit, so this is always a URL, never a data: URI.
import dictionaryUrl from './generated/dictionary.btree.gz?url';

export const DICTIONARY_URL: string = dictionaryUrl;
