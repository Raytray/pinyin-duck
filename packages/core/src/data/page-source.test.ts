import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  DictionaryChangedError,
  HttpPageSource,
  MemoryPageSource,
  createHttpPageSource,
} from './page-source';

const bytes = Uint8Array.from({ length: 40 }, (_, i) => i);

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Builds a `Response`-alike whose status and body a test controls. */
function stubResponse(
  body: Uint8Array,
  init: { status?: number; statusText?: string; headers?: Record<string, string> } = {}
) {
  const buffer = body.buffer.slice(
    body.byteOffset,
    body.byteOffset + body.byteLength
  ) as ArrayBuffer;
  return {
    ok: (init.status ?? 206) >= 200 && (init.status ?? 206) < 300,
    status: init.status ?? 206,
    statusText: init.statusText ?? 'Partial Content',
    arrayBuffer: async () => buffer,
    ...(init.headers ? { headers: new Headers(init.headers) } : {}),
  };
}

/** A server that honours Range over `bytes`, tagging each response with `etag()`. */
function rangeServer(etag: () => Record<string, string>) {
  return vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
    const [, from, to] = init.headers.Range.match(/bytes=(\d+)-(\d+)/)!.map(Number);
    return stubResponse(bytes.subarray(from, to + 1), {
      headers: { ...etag(), 'Content-Range': `bytes ${from}-${to}/${bytes.length}` },
    });
  });
}

describe('MemoryPageSource', () => {
  it('returns the requested slice', async () => {
    const source = new MemoryPageSource(bytes);
    expect(Array.from(await source.read(8, 4))).toEqual([8, 9, 10, 11]);
  });

  it('clamps a read that runs past the end instead of throwing', async () => {
    // Truncation has to be visible to the decoder as a short page, not as a crash.
    const source = new MemoryPageSource(bytes);
    expect(Array.from(await source.read(36, 10))).toEqual([36, 37, 38, 39]);
  });
});

describe('HttpPageSource', () => {
  it('requests exactly the range it is given', async () => {
    const fetchMock = vi.fn(async () => stubResponse(bytes.subarray(4, 8)));
    const source = new HttpPageSource('/dictionary.btree', { fetchImpl: fetchMock as never });

    expect(Array.from(await source.read(4, 4))).toEqual([4, 5, 6, 7]);
    expect(fetchMock).toHaveBeenCalledWith('/dictionary.btree', {
      headers: { Range: 'bytes=4-7' },
    });
  });

  it('passes an abort signal through when one is given', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => stubResponse(bytes.subarray(0, 2)));
    const source = new HttpPageSource('/d.btree', {
      fetchImpl: fetchMock as never,
      signal: controller.signal,
    });

    await source.read(0, 2);
    expect(fetchMock).toHaveBeenCalledWith('/d.btree', {
      headers: { Range: 'bytes=0-1' },
      signal: controller.signal,
    });
  });

  it('falls back to slicing the whole body when the server ignores Range', async () => {
    // A static server or proxy that answers 200 sends the entire asset. Keeping it
    // means later reads cost no further requests.
    const fetchMock = vi.fn(async () => stubResponse(bytes, { status: 200, statusText: 'OK' }));
    const source = new HttpPageSource('/d.btree', { fetchImpl: fetchMock as never });

    expect(Array.from(await source.read(10, 3))).toEqual([10, 11, 12]);
    expect(Array.from(await source.read(30, 5))).toEqual([30, 31, 32, 33, 34]);
    // The second read was served from memory, not the network.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a non-OK response with a recovery hint', async () => {
    const fetchMock = vi.fn(async () =>
      stubResponse(new Uint8Array(0), { status: 404, statusText: 'Not Found' })
    );
    const source = new HttpPageSource('/d.btree', { fetchImpl: fetchMock as never });

    await expect(source.read(0, 8)).rejects.toThrow(/404 Not Found/);
    await expect(source.read(0, 8)).rejects.toThrow(/build:dict/);
  });

  it('clamps a fallback read that runs past the end of the body', async () => {
    const fetchMock = vi.fn(async () => stubResponse(bytes, { status: 200 }));
    const source = new HttpPageSource('/d.btree', { fetchImpl: fetchMock as never });

    expect(Array.from(await source.read(36, 10))).toEqual([36, 37, 38, 39]);
  });

  it('rethrows a fetch rejection unchanged', async () => {
    // A rejected fetch is a transport failure the caller reports as-is, so the
    // original rejection value has to survive.
    const fetchMock = vi.fn(async () => {
      throw new Error('offline');
    });
    const source = new HttpPageSource('/d.btree', { fetchImpl: fetchMock as never });

    await expect(source.read(0, 8)).rejects.toThrow('offline');
  });
});

describe('HttpPageSource build consistency', () => {
  it('sends the first strong ETag back in If-Range', async () => {
    const fetchMock = rangeServer(() => ({ ETag: '"v1"' }));
    const source = new HttpPageSource('/d.btree', { fetchImpl: fetchMock as never });

    await source.read(0, 4);
    await source.read(8, 4);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Range: 'bytes=0-3' });
    expect(fetchMock.mock.calls[1][1].headers).toEqual({ Range: 'bytes=8-11', 'If-Range': '"v1"' });
  });

  it('does not send a weak ETag in If-Range, which the header does not allow', async () => {
    const fetchMock = rangeServer(() => ({ ETag: 'W/"v1"' }));
    const source = new HttpPageSource('/d.btree', { fetchImpl: fetchMock as never });

    await source.read(0, 4);
    await source.read(8, 4);
    expect(fetchMock.mock.calls[1][1].headers).toEqual({ Range: 'bytes=8-11' });
  });

  it('fails a range read that comes from a different build', async () => {
    let version = 'W/"v1"';
    const fetchMock = rangeServer(() => ({ ETag: version }));
    const source = new HttpPageSource('/d.btree', { fetchImpl: fetchMock as never });

    await source.read(0, 4);
    version = 'W/"v2"';
    const read = source.read(8, 4);
    await expect(read).rejects.toBeInstanceOf(DictionaryChangedError);
    await expect(source.read(8, 4)).rejects.toThrow(/changed while it was open/);
  });

  it('fails when If-Range makes the server send the whole new build', async () => {
    // A server that sees a stale If-Range answers 200 with the full, new asset. Keeping
    // it as the fallback body would decode new pages against the old directory.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(stubResponse(bytes.subarray(0, 4), { headers: { ETag: '"v1"' } }))
      .mockResolvedValueOnce(stubResponse(bytes, { status: 200, headers: { ETag: '"v2"' } }));
    const source = new HttpPageSource('/d.btree', { fetchImpl: fetchMock as never });

    await source.read(0, 4);
    await expect(source.read(8, 4)).rejects.toBeInstanceOf(DictionaryChangedError);
  });

  it('falls back to Last-Modified when there is no ETag', async () => {
    let modified = 'Tue, 03 Nov 2026 10:00:00 GMT';
    const fetchMock = rangeServer(() => ({ 'Last-Modified': modified }));
    const source = new HttpPageSource('/d.btree', { fetchImpl: fetchMock as never });

    await source.read(0, 4);
    await source.read(4, 4);
    modified = 'Wed, 04 Nov 2026 10:00:00 GMT';
    await expect(source.read(8, 4)).rejects.toBeInstanceOf(DictionaryChangedError);
  });

  it('keeps working against a server that sends no validator at all', async () => {
    const fetchMock = rangeServer(() => ({}));
    const source = new HttpPageSource('/d.btree', { fetchImpl: fetchMock as never });

    expect(Array.from(await source.read(0, 2))).toEqual([0, 1]);
    expect(Array.from(await source.read(20, 2))).toEqual([20, 21]);
  });

  it('rejects a partial response that starts somewhere other than requested', async () => {
    const fetchMock = vi.fn(async () =>
      stubResponse(bytes.subarray(0, 4), { headers: { 'Content-Range': 'bytes 0-3/40' } })
    );
    const source = new HttpPageSource('/d.btree', { fetchImpl: fetchMock as never });

    await expect(source.read(8, 4)).rejects.toThrow(/for byte 8 .* with byte 0/);
  });

  it('downloads the whole asset once when concurrent reads hit a server that ignores Range', async () => {
    const fetchMock = vi.fn(async () => stubResponse(bytes, { status: 200 }));
    const source = new HttpPageSource('/d.btree', { fetchImpl: fetchMock as never });

    const reads = await Promise.all([source.read(0, 2), source.read(10, 2), source.read(30, 2)]);
    expect(reads.map((r) => Array.from(r))).toEqual([[0, 1], [10, 11], [30, 31]]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('probes again after a first read that failed', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(stubResponse(bytes.subarray(0, 4), { headers: { ETag: '"v1"' } }))
      .mockResolvedValueOnce(stubResponse(bytes.subarray(4, 8), { headers: { ETag: '"v1"' } }));
    const source = new HttpPageSource('/d.btree', { fetchImpl: fetchMock as never });

    await expect(source.read(0, 4)).rejects.toThrow('offline');
    expect(Array.from(await source.read(0, 4))).toEqual([0, 1, 2, 3]);
    expect(Array.from(await source.read(4, 4))).toEqual([4, 5, 6, 7]);
  });
});

describe('createHttpPageSource', () => {
  it('builds a range-backed source for the URL', async () => {
    const fetchMock = vi.fn(async () => stubResponse(bytes.subarray(0, 3)));
    const source = createHttpPageSource('/asset.btree', { fetchImpl: fetchMock as never });

    expect(source).toBeInstanceOf(HttpPageSource);
    await source.read(0, 3);
    expect(fetchMock).toHaveBeenCalledWith('/asset.btree', { headers: { Range: 'bytes=0-2' } });
  });
});
