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
 * Thrown when the asset on the server changes while a dictionary is open.
 *
 * The reader parses the header and page directory once and then trusts their offsets,
 * so pages from a newer build would decode against the old directory and return
 * garbage. Reloading the page reopens the dictionary against the new build.
 */
export class DictionaryChangedError extends Error {
  constructor(url: string) {
    super(`The dictionary at ${url} changed while it was open. Reload the page to use the new version.`);
    this.name = 'DictionaryChangedError';
  }
}

/** A strong ETag, the only validator `If-Range` accepts. */
function isStrongEtag(value: string): boolean {
  return value.startsWith('"');
}

/** The start offset of a `Content-Range: bytes start-end/total` header, if present. */
function contentRangeStart(header: string | null | undefined): number | null {
  const match = header?.match(/^bytes\s+(\d+)-\d+\/(?:\d+|\*)$/i);
  return match ? Number(match[1]) : null;
}

/**
 * Fetches pages with HTTP range requests.
 *
 * The first read probes range support. If the server answers `206 Partial Content`,
 * subsequent reads stay lazy. If it answers `200` with the full body (a proxy, a
 * simple static server, or a test route), the body is kept and every later read is
 * sliced from it, so the reader's cost model never changes under it.
 *
 * Every read must come from the same build of the asset. The first response's
 * validator (its ETag, else its Last-Modified) is remembered; later requests carry it
 * in `If-Range` when it is a strong ETag, and any response that carries a different
 * validator fails with `DictionaryChangedError` instead of mixing two builds.
 */
export class HttpPageSource implements PageSource {
  private wholeFile: Uint8Array | null = null;
  private probed = false;
  private validator: string | null = null;
  private probe: Promise<void> | null = null;

  constructor(
    private readonly url: string,
    private readonly options: HttpPageSourceOptions = {}
  ) {}

  async read(offset: number, length: number): Promise<Uint8Array> {
    // Until the first response says whether ranges work and which build this is, later
    // reads wait for it. Against a server that ignores Range, a burst of concurrent
    // reads then downloads the asset once rather than once per read.
    while (this.probe) await this.probe;

    if (this.wholeFile) {
      return this.wholeFile.subarray(offset, Math.min(offset + length, this.wholeFile.byteLength));
    }

    if (this.probed) return this.fetchRange(offset, length);

    let settle!: () => void;
    this.probe = new Promise<void>((resolve) => {
      settle = resolve;
    });
    try {
      return await this.fetchRange(offset, length);
    } finally {
      this.probe = null;
      settle();
    }
  }

  private async fetchRange(offset: number, length: number): Promise<Uint8Array> {
    const { fetchImpl = fetch, signal } = this.options;
    const end = offset + length - 1;
    const headers: Record<string, string> = { Range: `bytes=${offset}-${end}` };
    if (this.validator !== null && isStrongEtag(this.validator)) {
      headers['If-Range'] = this.validator;
    }
    const response = await fetchImpl(this.url, {
      headers,
      ...(signal ? { signal } : {}),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to load the dictionary from ${this.url} (${response.status} ${response.statusText}). ` +
          `Run "npm run build:dict" to generate it.`
      );
    }

    // `headers` is optional so a minimal Response-alike (as in tests) still works.
    const responseHeaders = response.headers as Headers | undefined;
    const validator =
      responseHeaders?.get('etag') ?? responseHeaders?.get('last-modified') ?? null;
    if (!this.probed) {
      this.validator = validator;
      this.probed = true;
    } else if (this.validator !== null && validator !== null && validator !== this.validator) {
      throw new DictionaryChangedError(this.url);
    }

    const body = new Uint8Array(await response.arrayBuffer());
    if (response.status === 206) {
      const start = contentRangeStart(responseHeaders?.get('content-range'));
      if (start !== null && start !== offset) {
        throw new Error(
          `The server answered a range request for byte ${offset} of ${this.url} with byte ${start}.`
        );
      }
      return body;
    }

    // The server ignored the range and sent the whole asset. Keeping it turns every
    // later read into a slice instead of a repeated download.
    this.wholeFile = body;
    return body.subarray(offset, Math.min(offset + length, body.byteLength));
  }
}
