/**
 * B-tree reader for the generated CC-CEDICT asset.
 *
 * The reader works over the asset's bytes in memory, so every operation is synchronous.
 * Opening it parses only the fixed header and the small page directory; each lookup then
 * decodes just the pages it descends through, and an LRU cache keeps the decoded pages
 * that were used most recently. Decoding all 122k entries up front is never needed.
 *
 * The Android keyboard has its own Kotlin port of this reader over an mmapped file.
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
/** Default budget for decoded pages, counted in their encoded bytes. About a hundred pages. */
export const DEFAULT_PAGE_CACHE_BYTES = 256 * 1024;

export interface BTreeDictionaryOptions {
  /** Maximum bytes of decoded pages kept in memory. */
  pageCacheBytes?: number;
}

interface CacheSlot {
  page: BTreeNodePage;
  bytes: number;
}

/** The error for an asset that cannot be decoded, which a rebuild fixes. */
export function malformedDictionary(reason: string): Error {
  return new Error(
    `The dictionary payload is malformed or truncated (${reason}). ` +
      `Run "npm run build:dict" to regenerate it.`
  );
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A read-only B+ tree over dictionary entries keyed on toneless pinyin. */
export class BTreeDictionary {
  private readonly cache = new Map<number, CacheSlot>();
  private cacheBytes = 0;
  private readonly pageCacheBytes: number;

  private constructor(
    private readonly bytes: Uint8Array,
    private readonly header: BTreeHeader,
    private readonly directory: PageLocation[],
    options: BTreeDictionaryOptions
  ) {
    this.pageCacheBytes = options.pageCacheBytes ?? DEFAULT_PAGE_CACHE_BYTES;
  }

  /** Parses the header and directory of `bytes`, leaving the pages to be decoded on use. */
  static open(bytes: Uint8Array, options: BTreeDictionaryOptions = {}): BTreeDictionary {
    const headerBytes = slice(bytes, 0, HEADER_SIZE);
    let header: BTreeHeader;
    try {
      header = decodeHeader(headerBytes);
    } catch (error) {
      throw malformedDictionary(errorReason(error));
    }

    const directoryBytes = slice(bytes, header.directoryOffset, header.pageCount * 8);
    let directory: PageLocation[];
    try {
      directory = decodeDirectory(directoryBytes, header.pageCount);
    } catch (error) {
      throw malformedDictionary(errorReason(error));
    }

    return new BTreeDictionary(bytes, header, directory, options);
  }

  /** Number of entries the asset holds, known without decoding a single page. */
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
  lookupExact(key: string): StoredEntry[] {
    let leaf: LeafPage = this.findLeaf(key);
    const matches: StoredEntry[] = [];
    for (;;) {
      for (const entry of leaf.entries) {
        if (entry.key === key) matches.push(entry);
      }
      const last = leaf.entries[leaf.entries.length - 1];
      // Only keep walking while the key is still running; `nextLeaf` is ordered, so a
      // leaf whose last key is past `key` means there is nothing left to find.
      if (!last || last.key !== key || leaf.nextLeaf === NO_PAGE) return matches;
      leaf = this.readLeaf(leaf.nextLeaf);
    }
  }

  /**
   * Visits every entry whose key starts with `prefix`, in key order.
   *
   * The visitor may return `false` to stop early, which the search engine uses to
   * enforce its scan budget.
   */
  scanPrefix(prefix: string, visit: (entry: StoredEntry) => boolean | void): void {
    let leaf: LeafPage = this.findLeaf(prefix);
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
      leaf = this.readLeaf(leaf.nextLeaf);
    }
  }

  /** Drops every cached page. The dictionary stays open and readable. */
  clearCache(): void {
    this.cache.clear();
    this.cacheBytes = 0;
  }

  private findLeaf(key: string): LeafPage {
    let page = this.readPage(this.header.rootPageId);
    while (page.kind === 'internal') {
      page = this.readPage(this.childFor(page, key));
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

  private readLeaf(id: number): LeafPage {
    const page = this.readPage(id);
    if (page.kind !== 'leaf') throw malformedDictionary(`page ${id} is not a leaf`);
    return page;
  }

  private readPage(id: number): BTreeNodePage {
    const cached = this.cache.get(id);
    if (cached) {
      // Refresh LRU position.
      this.cache.delete(id);
      this.cache.set(id, cached);
      return cached.page;
    }

    const location = this.directory[id];
    if (!location) throw malformedDictionary(`page ${id} is outside the directory`);

    const bytes = slice(this.bytes, location.offset, location.length);
    let page: BTreeNodePage;
    try {
      const kind = bytes.byteLength > 0 ? bytes[0] : -1;
      if (kind === 0) page = decodeInternalPage(bytes);
      else if (kind === 1) page = decodeLeafPage(bytes);
      else throw new Error(`unknown page kind ${kind}`);
    } catch (error) {
      throw malformedDictionary(errorReason(error));
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

/** Up to `length` bytes of `bytes` from `offset`, without copying. */
function slice(bytes: Uint8Array, offset: number, length: number): Uint8Array {
  return bytes.subarray(offset, Math.min(offset + length, bytes.byteLength));
}
