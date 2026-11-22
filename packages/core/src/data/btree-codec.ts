/**
 * Low-level wire format for the on-disk PinyinDuck B-tree.
 *
 * The web asset and the future Android/desktop clients both read this file. It is a
 * B+ tree keyed on the toneless pinyin of a dictionary row (`pinyinClean`), split into
 * variable-length pages. A reader only ever decodes the header, the small page
 * directory, and the O(log n) pages a single lookup touches, so decoded entries are
 * bounded by a page cache rather than the whole 122k-entry corpus.
 *
 * Layout:
 *
 *   header (28 bytes) | page directory (pageCount * 8 bytes) | pages
 *
 * Header:
 *   0  4 bytes  magic "PDBT"
 *   4  u8       format version
 *   5  u8, u16  reserved (0)
 *   8  u32      entryCount
 *  12  u32      pageCount
 *  16  u32      rootPageId
 *  20  u32      directoryOffset
 *  24  u32      buildId, which the Candidate detail file built alongside must match
 *
 * Each directory entry is a byte offset and length, so a page can be sliced out of the
 * asset in memory (the web app) or read from a mapped file (Android). Pages are stored in ascending page id
 * order; leaves are allocated first, then each internal level bottom-up, with the root
 * last. Leaf pages are chained through `nextLeaf` so a prefix search is a single
 * descent followed by a forward scan.
 *
 * Leaf page:
 *   0  u8   kind (1)
 *   1  u16  entryCount
 *   3  u32  nextLeaf (NO_PAGE when last)
 *   7  ...  records
 *
 * Leaf record:
 *   string key, string simplified, string traditional, string pinyinNumbers,
 *   string shortGloss, varint frequency, u8 hskLevel,
 *   varint entryIdCount, entryIdCount * varint entryIdDelta,
 *   u8 script (0 both, 1 simplified only, 2 traditional only)
 *
 * Each entry id is stored as the zigzag-encoded difference from the id before it in the
 * same leaf (0 before the first). Ids are numbered in storage order, so neighbouring rows
 * have neighbouring ids and almost every delta is one byte, where whole ids would take
 * three and add about 0.4 MB to the gzipped web download.
 *
 * Strings are a varint byte length followed by UTF-8.
 *
 * Internal page:
 *   0  u8   kind (0)
 *   1  u16  childCount
 *   3  ...  child0(u32), highKey0(string), child1(u32), highKey1(string), ..., childN-1(u32)
 *
 * `highKeyI` is the *last* key held by `childI`, so `childI` holds keys in
 * `(highKeyI-1, highKeyI]` and the last child is unbounded. High keys (rather than the
 * more common low keys) are what a duplicate-heavy key space needs: a key can occupy
 * several leaves, and a low-key separator would send a lookup for it to the child
 * *after* the first one, silently dropping the higher-ranked entries.
 */

import type { ScriptType } from '../types.js';

export const BTREE_MAGIC = 'PDBT';
/**
 * Format 2 keys entries by headword and caseless reading (ADR 0001), so rows gained the
 * entry ids they stand for, a script marker and the header's build id (ADR 0002).
 */
export const BTREE_FORMAT_VERSION = 2;
export const HEADER_SIZE = 28;
/** Where the header holds the build id. */
export const BUILD_ID_OFFSET = 24;

export const INTERNAL_KIND = 0;
export const LEAF_KIND = 1;

/** Sentinel page id meaning "no page" (used by the last leaf's `nextLeaf`). */
export const NO_PAGE = 0xffffffff;

/** The script marker of a leaf record. */
const SCRIPT_BOTH = 0;
const SCRIPT_SIMPLIFIED = 1;
const SCRIPT_TRADITIONAL = 2;

/** A dictionary row as stored in a leaf, before tone marks are derived. */
export interface StoredEntry {
  /** Toneless, lowercased, space-free pinyin. The B-tree key. */
  key: string;
  simplified: string;
  traditional: string;
  pinyinNumbers: string;
  shortGloss: string;
  frequency: number;
  hskLevel: number;
  /**
   * The entries this row stands for, in headword order. One for most rows; a simplified
   * candidate standing for several headwords (后 hòu for 後 and 后) lists each of them.
   */
  entryIds: number[];
  /** The only script this row is a candidate in, or absent when it is one in both. */
  onlyIn?: ScriptType;
}

export interface LeafPage {
  kind: 'leaf';
  nextLeaf: number;
  entries: StoredEntry[];
}

export interface InternalPage {
  kind: 'internal';
  /** Child page ids, ascending by key range. */
  children: number[];
  /** `highKeys[i]` is the last key of `children[i]`; the last child is unbounded. */
  highKeys: string[];
}

export type BTreeNodePage = LeafPage | InternalPage;

export interface BTreeHeader {
  entryCount: number;
  pageCount: number;
  rootPageId: number;
  directoryOffset: number;
  /** Identifies the build, so a Candidate detail file from another build is refused. */
  buildId: number;
}

export interface PageLocation {
  offset: number;
  length: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Growable little-endian byte writer with LEB128 varints. */
export class ByteWriter {
  private buffer: Uint8Array;
  private length = 0;

  constructor(initialCapacity = 256) {
    this.buffer = new Uint8Array(Math.max(16, initialCapacity));
  }

  private ensure(extra: number): void {
    const needed = this.length + extra;
    if (needed <= this.buffer.length) return;
    let capacity = this.buffer.length * 2;
    while (capacity < needed) capacity *= 2;
    const grown = new Uint8Array(capacity);
    grown.set(this.buffer.subarray(0, this.length));
    this.buffer = grown;
  }

  u8(value: number): void {
    this.ensure(1);
    this.buffer[this.length++] = value & 0xff;
  }

  u16(value: number): void {
    this.ensure(2);
    this.buffer[this.length++] = value & 0xff;
    this.buffer[this.length++] = (value >>> 8) & 0xff;
  }

  u32(value: number): void {
    this.ensure(4);
    this.buffer[this.length++] = value & 0xff;
    this.buffer[this.length++] = (value >>> 8) & 0xff;
    this.buffer[this.length++] = (value >>> 16) & 0xff;
    this.buffer[this.length++] = (value >>> 24) & 0xff;
  }

  varint(value: number): void {
    let remaining = value >>> 0;
    while (remaining >= 0x80) {
      this.u8((remaining & 0x7f) | 0x80);
      remaining >>>= 7;
    }
    this.u8(remaining);
  }

  string(value: string): void {
    const bytes = encoder.encode(value);
    this.varint(bytes.length);
    this.ensure(bytes.length);
    this.buffer.set(bytes, this.length);
    this.length += bytes.length;
  }

  raw(bytes: Uint8Array): void {
    this.ensure(bytes.length);
    this.buffer.set(bytes, this.length);
    this.length += bytes.length;
  }

  get size(): number {
    return this.length;
  }

  toUint8Array(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

/** Little-endian byte reader with LEB128 varints. */
export class ByteReader {
  private readonly buffer: Uint8Array;
  private readonly view: DataView;
  private position = 0;

  constructor(buffer: Uint8Array) {
    this.buffer = buffer;
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  get offset(): number {
    return this.position;
  }

  get remaining(): number {
    return this.buffer.byteLength - this.position;
  }

  u8(): number {
    return this.view.getUint8(this.position++);
  }

  u16(): number {
    const value = this.view.getUint16(this.position, true);
    this.position += 2;
    return value;
  }

  u32(): number {
    const value = this.view.getUint32(this.position, true);
    this.position += 4;
    return value;
  }

  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = this.u8();
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
      // Frequencies and lengths never approach 2^32, so five groups is already a
      // corrupt stream rather than a value this format can represent.
      if (shift > 35) throw new Error('B-tree varint is longer than the format allows');
    }
    return result >>> 0;
  }

  /** The bytes up to the next zero byte, which is consumed too. */
  bytesUntilZero(): Uint8Array {
    const end = this.buffer.indexOf(0, this.position);
    if (end < 0) throw new Error('B-tree page is truncated');
    const bytes = this.buffer.subarray(this.position, end);
    this.position = end + 1;
    return bytes;
  }

  string(): string {
    const length = this.varint();
    this.ensure(length);
    const value = decoder.decode(this.buffer.subarray(this.position, this.position + length));
    this.position += length;
    return value;
  }

  private ensure(length: number): void {
    if (this.position + length > this.buffer.byteLength) {
      throw new Error('B-tree page is truncated');
    }
  }
}

/** Maps a signed delta onto an unsigned varint: 0, -1, 1, -2, 2 become 0, 1, 2, 3, 4. */
function zigzag(value: number): number {
  return value >= 0 ? value * 2 : -value * 2 - 1;
}

function unzigzag(value: number): number {
  return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
}

/**
 * Serializes one leaf record onto the writer.
 *
 * `previousId` is the last entry id written earlier in the same leaf (0 for the first
 * record); the record's ids are stored as deltas from it.
 */
export function writeStoredEntry(writer: ByteWriter, entry: StoredEntry, previousId = 0): void {
  writer.string(entry.key);
  writer.string(entry.simplified);
  writer.string(entry.traditional);
  writer.string(entry.pinyinNumbers);
  writer.string(entry.shortGloss);
  writer.varint(entry.frequency);
  writer.u8(entry.hskLevel);
  writer.varint(entry.entryIds.length);
  let previous = previousId;
  for (const id of entry.entryIds) {
    writer.varint(zigzag(id - previous));
    previous = id;
  }
  writer.u8(
    entry.onlyIn === 'simplified'
      ? SCRIPT_SIMPLIFIED
      : entry.onlyIn === 'traditional'
        ? SCRIPT_TRADITIONAL
        : SCRIPT_BOTH
  );
}

/** The id a record's successor in the leaf takes its first delta from. */
export function lastEntryId(entry: StoredEntry, previousId: number): number {
  return entry.entryIds.length > 0 ? entry.entryIds[entry.entryIds.length - 1] : previousId;
}

/** Reads one leaf record from the reader; `previousId` is as for `writeStoredEntry`. */
export function readStoredEntry(reader: ByteReader, previousId = 0): StoredEntry {
  const entry: StoredEntry = {
    key: reader.string(),
    simplified: reader.string(),
    traditional: reader.string(),
    pinyinNumbers: reader.string(),
    shortGloss: reader.string(),
    frequency: reader.varint(),
    hskLevel: reader.u8(),
    entryIds: [],
  };
  const idCount = reader.varint();
  let previous = previousId;
  for (let i = 0; i < idCount; i++) {
    previous += unzigzag(reader.varint());
    entry.entryIds.push(previous);
  }
  const script = reader.u8();
  if (script === SCRIPT_SIMPLIFIED) entry.onlyIn = 'simplified';
  else if (script === SCRIPT_TRADITIONAL) entry.onlyIn = 'traditional';
  else if (script !== SCRIPT_BOTH) throw new Error(`Unknown script marker ${script} on a B-tree record`);
  return entry;
}

export function encodeLeafPage(entries: StoredEntry[], nextLeaf: number): Uint8Array {
  const writer = new ByteWriter(entries.length * 32 + 8);
  writer.u8(LEAF_KIND);
  writer.u16(entries.length);
  writer.u32(nextLeaf);
  let previousId = 0;
  for (const entry of entries) {
    writeStoredEntry(writer, entry, previousId);
    previousId = lastEntryId(entry, previousId);
  }
  return writer.toUint8Array();
}

export function decodeLeafPage(bytes: Uint8Array): LeafPage {
  const reader = new ByteReader(bytes);
  const kind = reader.u8();
  if (kind !== LEAF_KIND) throw new Error(`Expected a leaf page, found kind ${kind}`);
  const entryCount = reader.u16();
  const nextLeaf = reader.u32();
  const entries: StoredEntry[] = new Array(entryCount);
  let previousId = 0;
  for (let i = 0; i < entryCount; i++) {
    entries[i] = readStoredEntry(reader, previousId);
    previousId = lastEntryId(entries[i], previousId);
  }
  return { kind: 'leaf', nextLeaf, entries };
}

export function encodeInternalPage(children: number[], highKeys: string[]): Uint8Array {
  if (children.length === 0) throw new Error('An internal page needs at least one child');
  if (highKeys.length !== children.length - 1) {
    throw new Error('An internal page needs exactly one high key per child but the last');
  }
  const writer = new ByteWriter(children.length * 16 + 8);
  writer.u8(INTERNAL_KIND);
  writer.u16(children.length);
  for (let i = 0; i < children.length; i++) {
    writer.u32(children[i]);
    if (i < highKeys.length) writer.string(highKeys[i]);
  }
  return writer.toUint8Array();
}

export function decodeInternalPage(bytes: Uint8Array): InternalPage {
  const reader = new ByteReader(bytes);
  const kind = reader.u8();
  if (kind !== INTERNAL_KIND) throw new Error(`Expected an internal page, found kind ${kind}`);
  const childCount = reader.u16();
  if (childCount === 0) throw new Error('An internal page needs at least one child');
  const children: number[] = new Array(childCount);
  const highKeys: string[] = new Array(Math.max(0, childCount - 1));
  for (let i = 0; i < childCount; i++) {
    children[i] = reader.u32();
    if (i < childCount - 1) highKeys[i] = reader.string();
  }
  return { kind: 'internal', children, highKeys };
}

export function encodeHeader(header: BTreeHeader): Uint8Array {
  const writer = new ByteWriter(HEADER_SIZE);
  for (const char of BTREE_MAGIC) writer.u8(char.charCodeAt(0));
  writer.u8(BTREE_FORMAT_VERSION);
  writer.u8(0);
  writer.u16(0);
  writer.u32(header.entryCount);
  writer.u32(header.pageCount);
  writer.u32(header.rootPageId);
  writer.u32(header.directoryOffset);
  writer.u32(header.buildId);
  return writer.toUint8Array();
}

export function decodeHeader(bytes: Uint8Array): BTreeHeader {
  if (bytes.byteLength < HEADER_SIZE) {
    throw new Error('The dictionary header is truncated');
  }
  const reader = new ByteReader(bytes);
  let magic = '';
  for (let i = 0; i < BTREE_MAGIC.length; i++) magic += String.fromCharCode(reader.u8());
  if (magic !== BTREE_MAGIC) {
    throw new Error('The dictionary payload is not a PinyinDuck B-tree asset');
  }
  const version = reader.u8();
  if (version !== BTREE_FORMAT_VERSION) {
    throw new Error(
      `The dictionary was built with B-tree format ${version}, but this reader expects ${BTREE_FORMAT_VERSION}`
    );
  }
  reader.u8();
  reader.u16();
  return {
    entryCount: reader.u32(),
    pageCount: reader.u32(),
    rootPageId: reader.u32(),
    directoryOffset: reader.u32(),
    buildId: reader.u32(),
  };
}

export function encodeDirectory(locations: PageLocation[]): Uint8Array {
  const writer = new ByteWriter(locations.length * 8);
  for (const location of locations) {
    writer.u32(location.offset);
    writer.u32(location.length);
  }
  return writer.toUint8Array();
}

export function decodeDirectory(bytes: Uint8Array, pageCount: number): PageLocation[] {
  const reader = new ByteReader(bytes);
  const locations: PageLocation[] = new Array(pageCount);
  for (let i = 0; i < pageCount; i++) {
    locations[i] = { offset: reader.u32(), length: reader.u32() };
  }
  return locations;
}
