/**
 * Lazy B-tree reader for the generated CC-CEDICT asset.
 *
 * Opening the dictionary reads only the fixed header and the small page directory.
 * Every later operation descends the tree and fetches just the pages it needs, via a
 * `PageSource`, so memory stays bounded by an LRU page cache instead of a full
 * 122k-entry object graph.
 *
 * This is the runtime an Android keyboard should use: point it at a `PageSource`
 * backed by a positioned file read (or an mmap) and the same lookup code works with
 * no whole-file allocation.
 */

import {
  HEADER_SIZE,
  NO_PAGE,
  decodeDirectory,
  decodeHeader,
  decodeInternalPage,
  decodeLeafPage,
  type BTreeHeader,
  type BTreeNodePage,
  type InternalPage,
  type LeafPage,
  type PageLocation,
  type StoredEntry,
} from './btree-codec.js';
import { createHttpPageSource, type HttpPageSourceOptions, type PageSource } from './page-source.js';

/** Where the web app serves the generated B-tree asset from. */
export const DEFAULT_BTREE_URL = '/dictionary.btree';

/** Default resident page-cache budget. Roughly a hundred pages. */
export const DEFAULT_PAGE_CACHE_BYTES = 256 * 1024;

export interface BTreeDictionaryOptions {
  /** Maximum bytes of decoded pages kept in memory. */
  pageCacheBytes?: number;
}

interface CacheSlot {
  page: BTreeNodePage;
  bytes: number;
}

function malformed(reason: string): Error {
  return new Error(
    `The dictionary payload is malformed or truncated (${reason}). ` +
      `Run "npm run build:dict" to regenerate it.`
  );
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A read-only B+ tree over dictionary entries keyed on toneless pinyin.
 *
 * Instances are safe to share: page reads are deduplicated in flight and the cache
 * is bounded, so concurrent searches cannot grow it without limit.
 */
export class BTreeDictionary {
  private readonly cache = new Map<number, CacheSlot>();
  private readonly inflight = new Map<number, Promise<BTreeNodePage>>();
  private cacheBytes = 0;
  private readonly pageCacheBytes: number;

  private constructor(
    private readonly source: PageSource,
    private readonly header: BTreeHeader,
    private readonly directory: PageLocation[],
    options: BTreeDictionaryOptions
  ) {
    this.pageCacheBytes = options.pageCacheBytes ?? DEFAULT_PAGE_CACHE_BYTES;
  }

  /** Reads the header and directory, leaving the pages on disk. */
  static async open(
    source: PageSource,
    options: BTreeDictionaryOptions = {}
  ): Promise<BTreeDictionary> {
    // A source failure (HTTP status, network) propagates untouched, so callers can
    // surface the original message. Only a decode failure is rewritten, because that
    // is where a broken asset is distinguishable from a broken connection.
    const headerBytes = await source.read(0, HEADER_SIZE);
    let header: BTreeHeader;
    try {
      header = decodeHeader(headerBytes);
    } catch (error) {
      throw malformed(errorReason(error));
    }

    const directoryBytes = await source.read(header.directoryOffset, header.pageCount * 8);
    let directory: PageLocation[];
    try {
      directory = decodeDirectory(directoryBytes, header.pageCount);
    } catch (error) {
      throw malformed(errorReason(error));
    }

    return new BTreeDictionary(source, header, directory, options);
  }

  /** Number of entries the asset holds, known without reading a single page. */
  get entryCount(): number {
    return this.header.entryCount;
  }

  /** Number of pages the asset is split into. */
  get pageCount(): number {
    return this.header.pageCount;
  }

  /**
   * Returns every entry whose key is exactly `key`.
   *
   * One key can occupy more than one leaf (the tree is packed by bytes, not by key
   * runs), so this follows the leaf chain for as long as the key keeps going. It
   * normally stops after the first leaf.
   */
  async lookupExact(key: string): Promise<StoredEntry[]> {
    let leaf: LeafPage = await this.findLeaf(key);
    const matches: StoredEntry[] = [];
    for (;;) {
      for (const entry of leaf.entries) {
        if (entry.key === key) matches.push(entry);
      }
      const last = leaf.entries[leaf.entries.length - 1];
      // Only keep walking while the key is still running; `nextLeaf` is ordered, so a
      // leaf whose last key is past `key` means there is nothing left to find.
      if (!last || last.key !== key || leaf.nextLeaf === NO_PAGE) return matches;
      leaf = await this.readLeaf(leaf.nextLeaf);
    }
  }

  /**
   * Visits every entry whose key starts with `prefix`, in key order.
   *
   * The visitor may return `false` to stop early, which the search engine uses to
   * enforce its scan budget.
   */
  async scanPrefix(prefix: string, visit: (entry: StoredEntry) => boolean | void): Promise<void> {
    let leaf: LeafPage = await this.findLeaf(prefix);
    for (;;) {
      for (const entry of leaf.entries) {
        if (entry.key.startsWith(prefix)) {
          if (visit(entry) === false) return;
        } else if (entry.key > prefix) {
          // Keys are sorted, so once a non-matching key sorts after the prefix every
          // later key does too. Everything before the range was skipped above.
          return;
        }
      }
      if (leaf.nextLeaf === NO_PAGE) return;
      leaf = await this.readLeaf(leaf.nextLeaf);
    }
  }

  /** Drops every cached page. The dictionary stays open and readable. */
  clearCache(): void {
    this.cache.clear();
    this.cacheBytes = 0;
  }

  private async findLeaf(key: string): Promise<LeafPage> {
    let page = await this.readPage(this.header.rootPageId);
    while (page.kind === 'internal') {
      page = await this.readPage(this.childFor(page, key));
    }
    return page;
  }

  private childFor(page: InternalPage, key: string): number {
    if (page.children.length === 1) return page.children[0];
    // First child whose high key is >= `key` (the last child is unbounded).
    //
    // High keys (not low keys) are what a duplicate-heavy key space needs, and picking
    // the *first* match is what makes a key spanning several leaves resolve correctly:
    // a low-key separator, or a rightmost-match search, would skip the earlier leaves
    // and silently drop their entries.
    let low = 0;
    let high = page.highKeys.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (key > page.highKeys[mid]) low = mid + 1;
      else high = mid;
    }
    return page.children[low];
  }

  private async readLeaf(id: number): Promise<LeafPage> {
    const page = await this.readPage(id);
    if (page.kind !== 'leaf') throw malformed(`page ${id} is not a leaf`);
    return page;
  }

  private async readPage(id: number): Promise<BTreeNodePage> {
    const cached = this.cache.get(id);
    if (cached) {
      // Refresh LRU position.
      this.cache.delete(id);
      this.cache.set(id, cached);
      return cached.page;
    }

    const pending = this.inflight.get(id);
    if (pending) return pending;

    const promise = this.loadPage(id).finally(() => this.inflight.delete(id));
    this.inflight.set(id, promise);
    return promise;
  }

  private async loadPage(id: number): Promise<BTreeNodePage> {
    const location = this.directory[id];
    if (!location) throw malformed(`page ${id} is outside the directory`);

    // As in `open`, a read failure is the source's to report, not a decode problem.
    const bytes = await this.source.read(location.offset, location.length);
    let page: BTreeNodePage;
    try {
      const kind = bytes.byteLength > 0 ? bytes[0] : -1;
      if (kind === 0) page = decodeInternalPage(bytes);
      else if (kind === 1) page = decodeLeafPage(bytes);
      else throw new Error(`unknown page kind ${kind}`);
    } catch (error) {
      throw malformed(errorReason(error));
    }

    this.remember(id, page, bytes.byteLength);
    return page;
  }

  private remember(id: number, page: BTreeNodePage, bytes: number): void {
    this.cache.set(id, { page, bytes });
    this.cacheBytes += bytes;
    // The root and the most recently visited pages are at the back of the Map, so
    // eviction from the front drops the coldest pages first.
    while (this.cacheBytes > this.pageCacheBytes && this.cache.size > 1) {
      const oldest = this.cache.keys().next().value as number;
      const slot = this.cache.get(oldest)!;
      this.cache.delete(oldest);
      this.cacheBytes -= slot.bytes;
    }
  }
}

export interface OpenBTreeDictionaryOptions extends BTreeDictionaryOptions, HttpPageSourceOptions {}

/** Opens the dictionary served at `url` over HTTP, using range requests when supported. */
export async function openBTreeDictionary(
  url: string = DEFAULT_BTREE_URL,
  options: OpenBTreeDictionaryOptions = {}
): Promise<BTreeDictionary> {
  const { fetchImpl, signal, ...dictionaryOptions } = options;
  const source = createHttpPageSource(url, { fetchImpl, signal });
  return BTreeDictionary.open(source, dictionaryOptions);
}

/** Opens a dictionary from an already constructed source (files, mmaps, tests). */
export async function openBTreeDictionaryFromSource(
  source: PageSource,
  options: BTreeDictionaryOptions = {}
): Promise<BTreeDictionary> {
  return BTreeDictionary.open(source, options);
}
