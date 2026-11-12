import { describe, it, expect } from 'vitest';
import { gzipSync } from 'zlib';
import { loadDictionary, type DownloadProgress } from './load-dictionary';
import { buildBTree } from './btree-builder';
import type { DictionaryRow } from './dictionary-codec';

const rows: DictionaryRow[] = [
  ['中国', '中國', 'zhong1 guo2', 'China', 58468, 1],
  ['你好', '你好', 'ni3 hao3', 'hello; hi', 71309, 0],
  ['你', '你', 'ni3', 'you', 98000, 1],
];

// Copied into a plain ArrayBuffer so it type-checks as a `Response` body.
const asset = new Uint8Array(buildBTree(rows));
const compressed = new Uint8Array(gzipSync(asset));

/** A response that streams `body` in `chunks` pieces, as a slow network would. */
function streamed(body: Uint8Array, chunks: number, headers: Record<string, string> = {}) {
  const size = Math.ceil(body.byteLength / chunks);
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= body.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(body.slice(sent, sent + size));
      sent += size;
    },
  });
  return new Response(stream, { status: 200, headers });
}

const fetchReturning = (response: () => Response) => (async () => response()) as typeof fetch;

describe('loadDictionary', () => {
  it('opens a gzip-compressed asset', async () => {
    const dictionary = await loadDictionary('/d.btree.gz', {
      fetchImpl: fetchReturning(() => new Response(compressed)),
    });

    expect(dictionary.entryCount).toBe(rows.length);
    expect((await dictionary.lookupExact('zhongguo'))[0].simplified).toBe('中国');
  });

  it('reports download progress against the compressed size', async () => {
    const progress: DownloadProgress[] = [];
    await loadDictionary('/d.btree.gz', {
      fetchImpl: fetchReturning(() =>
        streamed(compressed, 4, { 'content-length': String(compressed.byteLength) })
      ),
      onProgress: (update) => progress.push(update),
    });

    expect(progress.length).toBeGreaterThanOrEqual(4);
    expect(progress.every((p) => p.total === compressed.byteLength)).toBe(true);
    const loaded = progress.map((p) => p.loaded);
    expect(loaded).toEqual([...loaded].sort((a, b) => a - b));
    expect(loaded[loaded.length - 1]).toBe(compressed.byteLength);
  });

  it('reports progress with no total when the size is unknown', async () => {
    const progress: DownloadProgress[] = [];
    await loadDictionary('/d.btree.gz', {
      fetchImpl: fetchReturning(() => streamed(compressed, 2)),
      onProgress: (update) => progress.push(update),
    });

    expect(progress.length).toBeGreaterThan(0);
    expect(progress.every((p) => p.total === null)).toBe(true);
    expect(progress[progress.length - 1].loaded).toBe(compressed.byteLength);
  });

  it('accepts an asset the host has already decompressed', async () => {
    // A host that serves .gz files with `Content-Encoding: gzip` makes the browser
    // decompress the body before the app sees it.
    const dictionary = await loadDictionary('/d.btree.gz', {
      fetchImpl: fetchReturning(() => new Response(asset)),
    });

    expect(dictionary.entryCount).toBe(rows.length);
  });

  it('reports no total when the host compressed the response itself', async () => {
    // With `Content-Encoding`, `Content-Length` counts the encoded bytes while the body
    // yields decoded ones, so a percentage against it would be wrong.
    const progress: DownloadProgress[] = [];
    await loadDictionary('/d.btree.gz', {
      fetchImpl: fetchReturning(() =>
        streamed(asset, 3, {
          'content-encoding': 'gzip',
          'content-length': String(compressed.byteLength),
        })
      ),
      onProgress: (update) => progress.push(update),
    });

    expect(progress.length).toBeGreaterThan(0);
    expect(progress.every((p) => p.total === null)).toBe(true);
  });

  it('passes the abort signal to the request', async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    await loadDictionary('/d.btree.gz', {
      signal: controller.signal,
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        seen = init?.signal ?? undefined;
        return new Response(compressed);
      }) as typeof fetch,
    });

    expect(seen).toBe(controller.signal);
  });

  it('names the status and the rebuild command when the request fails', async () => {
    const failure = loadDictionary('/d.btree.gz', {
      fetchImpl: fetchReturning(
        () => new Response('Not Found', { status: 404, statusText: 'Not Found' })
      ),
    });

    await expect(failure).rejects.toThrow('/d.btree.gz (404 Not Found)');
    await expect(failure).rejects.toThrow(/build:dict/);
  });

  it('rejects a payload that is not a dictionary, with a rebuild hint', async () => {
    const failure = loadDictionary('/d.btree.gz', {
      fetchImpl: fetchReturning(() => new Response('<html>oops</html>')),
    });

    await expect(failure).rejects.toThrow(/build:dict/);
  });

  it('rejects a truncated gzip stream, with a rebuild hint', async () => {
    const failure = loadDictionary('/d.btree.gz', {
      fetchImpl: fetchReturning(() => new Response(compressed.subarray(0, 40))),
    });

    await expect(failure).rejects.toThrow(/malformed or truncated.*build:dict/);
  });
});
