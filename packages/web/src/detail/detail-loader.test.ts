import { describe, expect, it } from 'vitest';
import { encodeDetailFile, type DetailRecord } from '@pinyinduck/core';
import { createDetailLoader } from './detail-loader';

const BUILD_ID = 0xdb58b1dc;

const CAT: DetailRecord = {
  heading: '',
  senses: [{ proper: false, text: ['cat'] }],
  tags: [],
  measureWords: [{ traditional: '隻', simplified: '只', pinyinNumbers: 'zhi1' }],
  partsOfSpeech: [],
};

/** The detail file gzipped, as the web app serves it. */
const gzippedDetail = (buildId = BUILD_ID) =>
  new Blob([encodeDetailFile([CAT], buildId) as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));

/** A fetch that answers every request with `respond()` and counts the requests. */
function countingFetch(respond: () => Response | Promise<Response>) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    return respond();
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const ok = (buildId = BUILD_ID) => new Response(gzippedDetail(buildId));

describe('createDetailLoader', () => {
  it('is idle until something asks for the detail file', () => {
    const { calls, fetchImpl } = countingFetch(() => ok());
    const loader = createDetailLoader({ url: '/detail.gz', buildId: BUILD_ID, fetchImpl });
    expect(loader.state).toEqual({ status: 'idle' });
    expect(calls).toEqual([]);
  });

  it('fetches the file on request and holds it once loaded', async () => {
    const { calls, fetchImpl } = countingFetch(() => ok());
    const loader = createDetailLoader({ url: '/detail.gz', buildId: BUILD_ID, fetchImpl });

    loader.request();
    expect(loader.state).toEqual({ status: 'loading' });
    await loader.settled();

    const state = loader.state;
    expect(state.status).toBe('ready');
    if (state.status !== 'ready') return;
    expect(state.file.record(0).senses[0].text).toEqual(['cat']);
    expect(calls).toEqual(['/detail.gz']);
  });

  it('makes requests during the fetch, and after it, wait on that one fetch', async () => {
    const { calls, fetchImpl } = countingFetch(() => ok());
    const loader = createDetailLoader({ url: '/detail.gz', buildId: BUILD_ID, fetchImpl });

    loader.request();
    loader.request();
    loader.request();
    await loader.settled();
    loader.request();
    await loader.settled();

    expect(loader.state.status).toBe('ready');
    expect(calls).toHaveLength(1);
  });

  it('tells subscribers when the state changes', async () => {
    const { fetchImpl } = countingFetch(() => ok());
    const loader = createDetailLoader({ url: '/detail.gz', buildId: BUILD_ID, fetchImpl });
    const seen: string[] = [];
    const unsubscribe = loader.subscribe(() => seen.push(loader.state.status));

    loader.request();
    await loader.settled();
    unsubscribe();
    loader.request();

    expect(seen).toEqual(['loading', 'ready']);
  });

  it.each([
    ['an HTTP error', () => new Response('Not Found', { status: 404, statusText: 'Not Found' }), /404/],
    ['a file from another build', () => ok(0x12345678), /build/],
    ['a network failure', () => Promise.reject(new TypeError('Failed to fetch')), /Failed to fetch/],
  ])('fails on %s, and the next request tries again', async (_name, failure, message) => {
    let fail = true;
    const { calls, fetchImpl } = countingFetch(() => (fail ? failure() : ok()));
    const loader = createDetailLoader({ url: '/detail.gz', buildId: BUILD_ID, fetchImpl });

    loader.request();
    await loader.settled();
    const failed = loader.state;
    expect(failed.status).toBe('failed');
    if (failed.status === 'failed') expect(failed.error).toMatch(message);

    fail = false;
    loader.request();
    expect(loader.state).toEqual({ status: 'loading' });
    await loader.settled();
    expect(loader.state.status).toBe('ready');
    expect(calls).toHaveLength(2);
  });
});
