import { describe, it, expect } from 'vitest';
import { gzipSync } from 'zlib';
import { loadBigramTable } from './load-bigrams';
import { encodeBigramFile } from './bigram-codec';

const file = new Uint8Array(
  encodeBigramFile([{ first: '想', second: '喝', score: 85440 }], { scoreOffset: 119936, scoreStep: 64 })
);
const compressed = new Uint8Array(gzipSync(file));
const fetchReturning = (response: () => Response) => (async () => response()) as typeof fetch;

describe('loadBigramTable', () => {
  it('opens a gzip-compressed bigram file', async () => {
    const table = await loadBigramTable('/bigrams.bin.gz', { fetchImpl: fetchReturning(() => new Response(compressed)) });
    expect(table.score('想', '喝')).toBe(85440);
  });

  it('accepts a file the host has already decompressed', async () => {
    const table = await loadBigramTable('/bigrams.bin.gz', { fetchImpl: fetchReturning(() => new Response(file)) });
    expect(table.pairCount).toBe(1);
  });

  it('names the status when the request fails', async () => {
    const failure = loadBigramTable('/bigrams.bin.gz', {
      fetchImpl: fetchReturning(() => new Response('Not Found', { status: 404, statusText: 'Not Found' })),
    });
    await expect(failure).rejects.toThrow('/bigrams.bin.gz (404 Not Found)');
  });

  it('calls a truncated download a malformed bigram file', async () => {
    const failure = loadBigramTable('/bigrams.bin.gz', {
      fetchImpl: fetchReturning(() => new Response(compressed.subarray(0, 20))),
    });
    await expect(failure).rejects.toThrow(/bigram file/);
  });
});
