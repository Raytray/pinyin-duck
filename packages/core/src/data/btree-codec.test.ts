import { describe, it, expect } from 'vitest';
import {
  ByteReader,
  ByteWriter,
  BTREE_MAGIC,
  BTREE_FORMAT_VERSION,
  HEADER_SIZE,
  INTERNAL_KIND,
  LEAF_KIND,
  NO_PAGE,
  compareKeys,
  decodeDirectory,
  decodeHeader,
  decodeInternalPage,
  decodeLeafPage,
  encodeDirectory,
  encodeHeader,
  encodeInternalPage,
  encodeLeafPage,
  readStoredEntry,
  writeStoredEntry,
  type BTreeHeader,
  type PageLocation,
  type StoredEntry,
} from './btree-codec';

const entry: StoredEntry = {
  key: 'ni3',
  simplified: '你',
  traditional: '你',
  pinyinNumbers: 'ni3',
  shortGloss: 'you',
  frequency: 71309,
  hskLevel: 1,
};

const header: BTreeHeader = {
  entryCount: 122746,
  pageCount: 1196,
  rootPageId: 1195,
  directoryOffset: HEADER_SIZE,
};

describe('ByteWriter and ByteReader', () => {
  it('round-trips every fixed-width width in little-endian order', () => {
    const writer = new ByteWriter();
    writer.u8(0xab);
    writer.u16(0x1234);
    writer.u32(0x89abcdef);

    const bytes = writer.toUint8Array();
    expect(bytes).toHaveLength(7);
    // Little-endian: the least significant byte of each field comes first.
    expect(Array.from(bytes)).toEqual([0xab, 0x34, 0x12, 0xef, 0xcd, 0xab, 0x89]);

    const reader = new ByteReader(bytes);
    expect(reader.u8()).toBe(0xab);
    expect(reader.u16()).toBe(0x1234);
    expect(reader.u32()).toBe(0x89abcdef);
  });

  it('truncates the buffer to what was actually written', () => {
    const writer = new ByteWriter(1024);
    writer.u8(1);
    expect(writer.toUint8Array()).toHaveLength(1);
    expect(writer.size).toBe(1);
  });

  it('grows past its initial capacity without losing data', () => {
    // The default capacity is 256 bytes; a long string plus a record header must
    // reallocate and copy rather than truncate.
    const writer = new ByteWriter();
    const long = 'a'.repeat(500);
    writer.string(long);
    writer.string(long);
    const reader = new ByteReader(writer.toUint8Array());
    expect(reader.string()).toBe(long);
    expect(reader.string()).toBe(long);
  });

  it('encodes varints across group boundaries', () => {
    for (const value of [0, 1, 127, 128, 300, 16383, 16384, 100000, 0xffffffff]) {
      const writer = new ByteWriter();
      writer.varint(value);
      expect(new ByteReader(writer.toUint8Array()).varint()).toBe(value);
    }
  });

  it('rejects a varint longer than the format can represent', () => {
    // A corrupt stream of continuation bytes must not spin into a huge shift.
    const bytes = new Uint8Array(8).fill(0x80);
    expect(() => new ByteReader(bytes).varint()).toThrow(/longer than the format/);
  });

  it('round-trips multi-byte UTF-8 strings', () => {
    const writer = new ByteWriter();
    writer.string('𫚕');
    expect(new ByteReader(writer.toUint8Array()).string()).toBe('𫚕');
  });

  it('rejects a string that runs past the end of the buffer', () => {
    const writer = new ByteWriter();
    writer.string('hello');
    const truncated = writer.toUint8Array().subarray(0, 3);
    expect(() => new ByteReader(truncated).string()).toThrow(/truncated/);
  });

  it('reports the reader position and remaining bytes', () => {
    const writer = new ByteWriter();
    writer.u32(7);
    writer.u8(9);
    const reader = new ByteReader(writer.toUint8Array());
    expect(reader.remaining).toBe(5);
    expect(reader.offset).toBe(0);
    reader.u32();
    expect(reader.offset).toBe(4);
    expect(reader.remaining).toBe(1);
  });
});

describe('compareKeys', () => {
  it('orders keys by code unit', () => {
    expect(compareKeys('a', 'b')).toBe(-1);
    expect(compareKeys('b', 'a')).toBe(1);
    expect(compareKeys('a', 'a')).toBe(0);
  });

  it('sorts a prefix before the longer keys that extend it', () => {
    expect(compareKeys('ni', 'nihao')).toBe(-1);
  });
});

describe('leaf pages', () => {
  it('round-trips its entries and next-leaf link', () => {
    const bytes = encodeLeafPage([entry, { ...entry, key: 'ni4', simplified: '尼' }], 7);

    expect(bytes[0]).toBe(LEAF_KIND);
    const page = decodeLeafPage(bytes);
    expect(page).toEqual({
      kind: 'leaf',
      nextLeaf: 7,
      entries: [entry, { ...entry, key: 'ni4', simplified: '尼' }],
    });
  });

  it('preserves the no-page sentinel for the last leaf', () => {
    expect(decodeLeafPage(encodeLeafPage([entry], NO_PAGE)).nextLeaf).toBe(NO_PAGE);
  });

  it('encodes an empty leaf', () => {
    expect(decodeLeafPage(encodeLeafPage([], NO_PAGE)).entries).toEqual([]);
  });

  it('rejects a page that is not a leaf', () => {
    expect(() => decodeLeafPage(new Uint8Array([INTERNAL_KIND, 0, 0, 0, 0, 0, 0]))).toThrow(
      /Expected a leaf page/
    );
  });

  it('rejects a truncated record', () => {
    const bytes = encodeLeafPage([entry], NO_PAGE);
    expect(() => decodeLeafPage(bytes.subarray(0, bytes.length - 4))).toThrow();
  });

  it('round-trips a single record through the standalone helpers', () => {
    const writer = new ByteWriter();
    writeStoredEntry(writer, entry);
    expect(readStoredEntry(new ByteReader(writer.toUint8Array()))).toEqual(entry);
  });
});

describe('internal pages', () => {
  it('round-trips children with their high keys', () => {
    const bytes = encodeInternalPage([4, 5, 6], ['ni', 'hao']);
    expect(bytes[0]).toBe(INTERNAL_KIND);
    expect(decodeInternalPage(bytes)).toEqual({
      kind: 'internal',
      children: [4, 5, 6],
      highKeys: ['ni', 'hao'],
    });
  });

  it('encodes a single-child page with no high keys', () => {
    expect(decodeInternalPage(encodeInternalPage([9], []))).toEqual({
      kind: 'internal',
      children: [9],
      highKeys: [],
    });
  });

  it('refuses a page with no children', () => {
    expect(() => encodeInternalPage([], [])).toThrow(/at least one child/);
  });

  it('refuses a high-key count that does not match the children', () => {
    // One high key per child but the last; anything else would desynchronize the
    // reader's variable-length parse.
    expect(() => encodeInternalPage([1, 2], [])).toThrow(/high key/);
    expect(() => encodeInternalPage([1, 2, 3], ['a'])).toThrow(/high key/);
  });

  it('rejects a page that is not internal', () => {
    expect(() => decodeInternalPage(new Uint8Array([LEAF_KIND, 0, 0, 0, 0, 0, 0]))).toThrow(
      /Expected an internal page/
    );
  });

  it('rejects a decoded page that claims zero children', () => {
    expect(() => decodeInternalPage(new Uint8Array([INTERNAL_KIND, 0, 0]))).toThrow(
      /at least one child/
    );
  });
});

describe('header', () => {
  it('round-trips the counts the reader trusts', () => {
    expect(decodeHeader(encodeHeader(header))).toEqual(header);
  });

  it('starts with the format magic and version', () => {
    const bytes = encodeHeader(header);
    expect(bytes.length).toBe(HEADER_SIZE);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe(BTREE_MAGIC);
    expect(bytes[4]).toBe(BTREE_FORMAT_VERSION);
  });

  it('rejects a payload that is not a PinyinDuck asset', () => {
    const bytes = encodeHeader(header);
    bytes[0] = 'X'.charCodeAt(0);
    expect(() => decodeHeader(bytes)).toThrow(/not a PinyinDuck B-tree asset/);
  });

  it('rejects an asset built by a different format version', () => {
    const bytes = encodeHeader(header);
    bytes[4] = BTREE_FORMAT_VERSION + 1;
    expect(() => decodeHeader(bytes)).toThrow(/B-tree format/);
  });

  it('rejects a header that is shorter than the fixed header', () => {
    expect(() => decodeHeader(new Uint8Array(HEADER_SIZE - 1))).toThrow(/header is truncated/);
  });
});

describe('page directory', () => {
  it('round-trips one offset and length per page', () => {
    const locations: PageLocation[] = [
      { offset: 24, length: 8000 },
      { offset: 8024, length: 4096 },
    ];

    expect(decodeDirectory(encodeDirectory(locations), locations.length)).toEqual(locations);
  });

  it('encodes nothing for an empty directory', () => {
    expect(encodeDirectory([])).toHaveLength(0);
  });
});
