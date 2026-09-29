/**
 * Builds the on-disk B+ tree from decoded dictionary rows.
 *
 * Entries are sorted by toneless pinyin, then by descending frequency, so a bounded
 * forward scan over a prefix range meets the most useful readings first. Leaves are
 * packed up to a byte budget, which keeps every page small enough to fetch in one
 * range request, and each level is grouped into a fixed fan-out until a single root
 * remains.
 */

import { cleanPinyin } from '../parser/pinyin.js';
import type { DictionaryRow } from './dictionary-codec.js';
import {
  ByteWriter,
  HEADER_SIZE,
  NO_PAGE,
  encodeDirectory,
  encodeHeader,
  encodeInternalPage,
  encodeLeafPage,
  type BTreeHeader,
  type PageLocation,
  type StoredEntry,
} from './btree-codec.js';

export interface BuildBTreeOptions {
  /** Hard cap on entries per leaf, independent of the byte budget. */
  maxLeafEntries?: number;
  /** Soft cap on the encoded byte size of a leaf. */
  maxLeafBytes?: number;
  /** Children per internal page. */
  maxFanout?: number;
}

const DEFAULTS = {
  maxLeafEntries: 128,
  maxLeafBytes: 8192,
  maxFanout: 64,
} as const;

/** Converts a wire row into the leaf record the B-tree stores. */
export function storedEntryFromRow(row: DictionaryRow): StoredEntry {
  const [simplified, traditional, pinyinNumbers, shortGloss, frequency, hskLevel] = row;
  return {
    key: cleanPinyin(pinyinNumbers),
    simplified,
    traditional: traditional || simplified,
    pinyinNumbers,
    shortGloss,
    frequency,
    hskLevel,
  };
}

/**
 * Orders entries for storage:
 *   1. key ascending, so the tree is a plain prefix range
 *   2. frequency descending, so a truncated scan still sees the common words first
 *   3. HSK level ascending, then simplified form, purely to make builds reproducible
 */
export function sortStoredEntries(entries: StoredEntry[]): StoredEntry[] {
  return [...entries].sort((a, b) => {
    if (a.key !== b.key) return a.key < b.key ? -1 : 1;
    if (a.frequency !== b.frequency) return b.frequency - a.frequency;
    if (a.hskLevel !== b.hskLevel) return a.hskLevel - b.hskLevel;
    if (a.simplified !== b.simplified) return a.simplified < b.simplified ? -1 : 1;
    if (a.pinyinNumbers !== b.pinyinNumbers) return a.pinyinNumbers < b.pinyinNumbers ? -1 : 1;
    return 0;
  });
}

function encodedEntrySize(entry: StoredEntry): number {
  const writer = new ByteWriter();
  writer.string(entry.key);
  writer.string(entry.simplified);
  writer.string(entry.traditional);
  writer.string(entry.pinyinNumbers);
  writer.string(entry.shortGloss);
  writer.varint(entry.frequency);
  writer.u8(entry.hskLevel);
  return writer.size;
}

interface PageRef {
  id: number;
  firstKey: string;
  /** Last key held by the page, used as the high-key separator of its parent. */
  lastKey: string;
}

interface PendingInternalPage {
  id: number;
  children: number[];
  highKeys: string[];
}

/**
 * Serializes a dictionary into the PinyinDuck B-tree format.
 *
 * The returned buffer is a complete file: header, directory, then pages in page-id
 * order. The caller writes it verbatim.
 */
export function buildBTree(rows: DictionaryRow[], options: BuildBTreeOptions = {}): Uint8Array {
  const maxLeafEntries = options.maxLeafEntries ?? DEFAULTS.maxLeafEntries;
  const maxLeafBytes = options.maxLeafBytes ?? DEFAULTS.maxLeafBytes;
  const maxFanout = options.maxFanout ?? DEFAULTS.maxFanout;

  const entries = sortStoredEntries(rows.map(storedEntryFromRow));

  // Pack leaves within both budgets. The 7-byte header costs are accounted for so a
  // full leaf still serializes within `maxLeafBytes`.
  const leaves: StoredEntry[][] = [];
  let current: StoredEntry[] = [];
  let currentBytes = 7;
  for (const entry of entries) {
    const size = encodedEntrySize(entry);
    if (
      current.length > 0 &&
      (current.length >= maxLeafEntries || currentBytes + size > maxLeafBytes)
    ) {
      leaves.push(current);
      current = [];
      currentBytes = 7;
    }
    current.push(entry);
    currentBytes += size;
  }
  leaves.push(current);

  let nextPageId = leaves.length;
  const internalPages: PendingInternalPage[] = [];

  // Leaves are page ids 0..L-1 in order; the root grows on top of them.
  let level: PageRef[] = leaves.map((leaf, id) => ({
    id,
    firstKey: leaf[0]?.key ?? '',
    lastKey: leaf[leaf.length - 1]?.key ?? '',
  }));
  while (level.length > 1) {
    const parents: PageRef[] = [];
    for (let i = 0; i < level.length; i += maxFanout) {
      const chunk = level.slice(i, i + maxFanout);
      const id = nextPageId++;
      internalPages.push({
        id,
        children: chunk.map((ref) => ref.id),
        highKeys: chunk.slice(0, -1).map((ref) => ref.lastKey),
      });
      parents.push({
        id,
        firstKey: chunk[0].firstKey,
        lastKey: chunk[chunk.length - 1].lastKey,
      });
    }
    level = parents;
  }

  const pageCount = nextPageId;
  const rootPageId = level[0].id;

  const pages: Uint8Array[] = new Array(pageCount);
  for (let id = 0; id < leaves.length; id++) {
    pages[id] = encodeLeafPage(leaves[id], id + 1 < leaves.length ? id + 1 : NO_PAGE);
  }
  for (const page of internalPages) {
    pages[page.id] = encodeInternalPage(page.children, page.highKeys);
  }

  const directoryOffset = HEADER_SIZE;
  const directorySize = pageCount * 8;
  const locations: PageLocation[] = new Array(pageCount);
  let cursor = directoryOffset + directorySize;
  for (let id = 0; id < pageCount; id++) {
    locations[id] = { offset: cursor, length: pages[id].byteLength };
    cursor += pages[id].byteLength;
  }
  if (cursor > 0xffffffff) {
    throw new Error('The dictionary exceeds the 4GB offset limit of B-tree format 1');
  }

  const header: BTreeHeader = {
    entryCount: entries.length,
    pageCount,
    rootPageId,
    directoryOffset,
  };

  const output = new Uint8Array(cursor);
  output.set(encodeHeader(header), 0);
  output.set(encodeDirectory(locations), directoryOffset);
  for (let id = 0; id < pageCount; id++) output.set(pages[id], locations[id].offset);
  return output;
}
