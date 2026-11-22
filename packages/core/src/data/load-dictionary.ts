/**
 * Downloads the whole dictionary asset and opens it in memory.
 *
 * The web app holds the full asset (about 9.6MB) so that every search is synchronous
 * and a commit always lands when its key is pressed. The build ships the asset gzipped
 * (`dictionary.btree.gz`, about 4.3MB) and the browser decompresses it here, so the
 * download size does not depend on whether the host compresses binary files.
 */

import { BTreeDictionary, malformedDictionary } from './btree-dictionary.js';

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

  return BTreeDictionary.open(await readBody(response, onProgress, malformedDictionary));
}

/**
 * Reads the body, decompressing it on the way when it is gzip, into one buffer. A body that
 * will not decompress is reported through `malformed`. Shared with the Candidate detail file.
 *
 * A host that serves `.gz` files with `Content-Encoding: gzip` has the browser decompress
 * the body before it reaches the app. Checking the gzip magic number on the first bytes
 * covers that host and every other without asking which one this is. The body streams
 * straight into the decompressor, so the download is never held twice.
 */
export async function readBody(
  response: Response,
  onProgress: LoadDictionaryOptions['onProgress'],
  malformed: (reason: string) => Error
): Promise<Uint8Array> {
  // A response the host encoded has a `Content-Length` in encoded bytes, but the body
  // yields decoded ones, so the length is only a total when nothing was encoded.
  const length = Number(response.headers.get('content-length'));
  const encoded = response.headers.has('content-encoding');
  const total = !encoded && Number.isFinite(length) && length > 0 ? length : null;

  if (!response.body) throw malformed('empty response');
  const reader = response.body.getReader();
  let loaded = 0;
  // A failure reading the body (an abort, a dropped connection) is passed on as it is,
  // so only a failure to decompress is reported as a malformed asset.
  let readError: unknown;
  const read = async () => {
    try {
      const result = await reader.read();
      if (!result.done) {
        loaded += result.value.byteLength;
        onProgress?.({ loaded, total });
      }
      return result;
    } catch (error) {
      readError = error;
      throw error;
    }
  };

  // Enough of the body to see the two magic bytes, which a tiny first chunk may not hold.
  const head: Uint8Array[] = [];
  while (loaded < 2) {
    const { done, value } = await read();
    if (done) break;
    head.push(value);
  }
  const magic = head.flatMap((chunk) => Array.from(chunk.subarray(0, 2))).slice(0, 2);
  const gzipped = magic[0] === 0x1f && magic[1] === 0x8b;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of head) controller.enqueue(chunk);
    },
    async pull(controller) {
      const { done, value } = await read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  try {
    // The DOM types declare the decompressor's input as `BufferSource`, which a
    // `Uint8Array` over any buffer is at runtime but not to the type checker.
    const bytes = gzipped
      ? body.pipeThrough(
          new DecompressionStream('gzip') as ReadableWritablePair<Uint8Array, Uint8Array>
        )
      : body;
    return new Uint8Array(await new Response(bytes).arrayBuffer());
  } catch (error) {
    if (readError !== undefined && error === readError) throw error;
    throw malformed(error instanceof Error ? error.message : String(error));
  }
}
