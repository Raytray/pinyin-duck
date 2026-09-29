/**
 * Byte-range sources for the B-tree reader.
 *
 * The reader asks for exact byte ranges and never needs the whole asset in memory.
 * `MemoryPageSource` backs tests and any client that already holds the file (an
 * Android `mmap`, for example), while `HttpPageSource` fetches ranges over the
 * network and transparently degrades to a one-shot full read when the server ignores
 * `Range` headers.
 */

export interface PageSource {
  /** Returns up to `length` bytes starting at `offset`. */
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** A page source over an in-memory buffer. */
export class MemoryPageSource implements PageSource {
  constructor(private readonly bytes: Uint8Array) {}

  async read(offset: number, length: number): Promise<Uint8Array> {
    return this.bytes.subarray(offset, Math.min(offset + length, this.bytes.byteLength));
  }
}

export interface HttpPageSourceOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Fetches pages with HTTP range requests.
 *
 * The first read probes range support. If the server answers `206 Partial Content`,
 * subsequent reads stay lazy. If it answers `200` with the full body (a proxy, a
 * simple static server, or a test route), the body is kept and every later read is
 * sliced from it, so the reader's cost model never changes under it.
 */
export class HttpPageSource implements PageSource {
  private wholeFile: Uint8Array | null = null;

  constructor(
    private readonly url: string,
    private readonly options: HttpPageSourceOptions = {}
  ) {}

  async read(offset: number, length: number): Promise<Uint8Array> {
    if (this.wholeFile) {
      return this.wholeFile.subarray(offset, Math.min(offset + length, this.wholeFile.byteLength));
    }

    const { fetchImpl = fetch, signal } = this.options;
    const end = offset + length - 1;
    const response = await fetchImpl(this.url, {
      headers: { Range: `bytes=${offset}-${end}` },
      ...(signal ? { signal } : {}),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to load the dictionary from ${this.url} (${response.status} ${response.statusText}). ` +
          `Run "npm run build:dict" to generate it.`
      );
    }

    const body = new Uint8Array(await response.arrayBuffer());
    if (response.status === 206) {
      return body;
    }

    // The server ignored the range and sent the whole asset. Keeping it turns every
    // later read into a slice instead of a repeated download.
    this.wholeFile = body;
    return body.subarray(offset, Math.min(offset + length, body.byteLength));
  }
}

/** Builds an HTTP range source. Kept separate so callers can inject a fetcher. */
export function createHttpPageSource(
  url: string,
  options: HttpPageSourceOptions = {}
): HttpPageSource {
  return new HttpPageSource(url, options);
}
