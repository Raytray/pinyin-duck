/**
 * Downloads the whole dictionary asset and opens it in memory.
 *
 * The web app holds the full asset (about 9.6MB) so that every search is synchronous
 * and a commit always lands when its key is pressed. The build ships the asset gzipped
 * (`dictionary.btree.gz`, about 4.3MB) and the browser decompresses it here, so the
 * download size does not depend on whether the host compresses binary files.
 */

import { BTreeDictionary, malformedDictionary } from './btree-dictionary.js';
import { MemoryPageSource } from './page-source.js';

export interface DownloadProgress {
  /** Bytes of the body received so far. */
  loaded: number;
  /** The body's size, or null when the server did not say or encoded the response. */
  total: number | null;
}

export interface LoadDictionaryOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Called after each chunk of the download arrives. */
  onProgress?: (progress: DownloadProgress) => void;
}

/** Fetches, decompresses and opens the dictionary served at `url`. */
export async function loadDictionary(
  url: string,
  options: LoadDictionaryOptions = {}
): Promise<BTreeDictionary> {
  const { fetchImpl = fetch, signal, onProgress } = options;
  const response = await fetchImpl(url, signal ? { signal } : {});
  if (!response.ok) {
    throw new Error(
      `Failed to load the dictionary from ${url} (${response.status} ${response.statusText}). ` +
        `Run "npm run build:dict" to generate it.`
    );
  }

  const downloaded = await readBody(response, onProgress);
  return BTreeDictionary.open(new MemoryPageSource(await gunzip(downloaded)));
}

async function readBody(
  response: Response,
  onProgress: LoadDictionaryOptions['onProgress']
): Promise<Uint8Array> {
  // A response the host encoded has a `Content-Length` in encoded bytes, but the body
  // yields decoded ones, so the length is only a total when nothing was encoded.
  const length = Number(response.headers.get('content-length'));
  const encoded = response.headers.has('content-encoding');
  const total = !encoded && Number.isFinite(length) && length > 0 ? length : null;

  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.({ loaded, total });
  }

  const body = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * Decompresses a gzip payload, or returns it untouched when it is not gzip.
 *
 * A host that serves `.gz` files with `Content-Encoding: gzip` has the browser decompress
 * the body before it reaches the app. Checking the gzip magic number covers that host
 * and every other without asking which one this is.
 */
async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.byteLength < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (error) {
    throw malformedDictionary(error instanceof Error ? error.message : String(error));
  }
}
