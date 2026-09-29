import { describe, it, expect, afterEach, vi } from 'vitest';
import { HttpPageSource, MemoryPageSource, createHttpPageSource } from './page-source';

const bytes = Uint8Array.from({ length: 40 }, (_, i) => i);

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Builds a `Response`-alike whose status and body a test controls. */
function stubResponse(
  body: Uint8Array,
  init: { status?: number; statusText?: string } = {}
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
  };
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

describe('createHttpPageSource', () => {
  it('builds a range-backed source for the URL', async () => {
    const fetchMock = vi.fn(async () => stubResponse(bytes.subarray(0, 3)));
    const source = createHttpPageSource('/asset.btree', { fetchImpl: fetchMock as never });

    expect(source).toBeInstanceOf(HttpPageSource);
    await source.read(0, 3);
    expect(fetchMock).toHaveBeenCalledWith('/asset.btree', { headers: { Range: 'bytes=0-2' } });
  });
});
