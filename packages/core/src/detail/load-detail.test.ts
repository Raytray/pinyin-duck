import { describe, it, expect } from 'vitest';
import { gzipSync } from 'zlib';
import { loadDetailFile } from './load-detail';
import { encodeDetailFile, type DetailRecord } from './detail-codec';

const record: DetailRecord = {
  heading: '',
  senses: [{ proper: false, text: ['book'] }],
  tags: [],
  measureWords: [],
  partsOfSpeech: [],
};
const BUILD_ID = 0xcafe;
const file = new Uint8Array(encodeDetailFile([record], BUILD_ID));
const compressed = new Uint8Array(gzipSync(file));

const fetchReturning = (response: () => Response) => (async () => response()) as typeof fetch;

describe('loadDetailFile', () => {
  it('opens a gzip-compressed detail file from the same build', async () => {
    const detail = await loadDetailFile('/detail.bin.gz', BUILD_ID, {
      fetchImpl: fetchReturning(() => new Response(compressed)),
    });

    expect(detail.record(0)).toEqual(record);
  });

  it('accepts a detail file the host has already decompressed', async () => {
    const detail = await loadDetailFile('/detail.bin.gz', BUILD_ID, {
      fetchImpl: fetchReturning(() => new Response(file)),
    });

    expect(detail.entryCount).toBe(1);
  });

  it('fails to load a detail file from another build', async () => {
    const failure = loadDetailFile('/detail.bin.gz', BUILD_ID + 1, {
      fetchImpl: fetchReturning(() => new Response(compressed)),
    });

    await expect(failure).rejects.toThrow(/comes from build 0000cafe, but the dictionary from build 0000caff/);
  });

  it('names the status when the request fails', async () => {
    const failure = loadDetailFile('/detail.bin.gz', BUILD_ID, {
      fetchImpl: fetchReturning(() => new Response('Not Found', { status: 404, statusText: 'Not Found' })),
    });

    await expect(failure).rejects.toThrow('/detail.bin.gz (404 Not Found)');
  });

  it('calls a truncated download a malformed detail file', async () => {
    const failure = loadDetailFile('/detail.bin.gz', BUILD_ID, {
      fetchImpl: fetchReturning(() => new Response(compressed.subarray(0, 20))),
    });

    await expect(failure).rejects.toThrow(/Candidate detail file is malformed or truncated/);
  });

  it('passes the abort signal to the request', async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    await loadDetailFile('/detail.bin.gz', BUILD_ID, {
      signal: controller.signal,
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        seen = init?.signal ?? undefined;
        return new Response(compressed);
      }) as typeof fetch,
    });

    expect(seen).toBe(controller.signal);
  });
});
