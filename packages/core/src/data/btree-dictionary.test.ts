import { describe, it, expect } from 'vitest';
import { DEFAULT_PAGE_CACHE_BYTES, BTreeDictionary } from './btree-dictionary';
import { buildBTree } from './btree-builder';
import {
  HEADER_SIZE,
  encodeDirectory,
  encodeHeader,
  encodeInternalPage,
  type StoredEntry,
} from './btree-codec';
import type { DictionaryRow } from './dictionary-codec';

const rows: DictionaryRow[] = [
  ['中国', '中國', 'zhong1 guo2', 'China', 58468, 1],
  ['你好', '你好', 'ni3 hao3', 'hello; hi', 71309, 0],
  ['你', '你', 'ni3', 'you', 98000, 1],
  ['呢', '呢', 'ne5', 'question particle', 40000, 0],
  ['尼', '尼', 'ni2', 'nun', 30000, 0],
];

const asset = buildBTree(rows);

function open(options = {}) {
  return BTreeDictionary.open(asset, options);
}

describe('opening', () => {
  it('reads the entry and page counts from the header', () => {
    const dictionary = open();

    expect(dictionary.entryCount).toBe(rows.length);
    expect(dictionary.pageCount).toBeGreaterThan(0);
  });

  it('rejects a payload that is not a PinyinDuck asset', () => {
    expect(() => BTreeDictionary.open(new Uint8Array(64))).toThrow(
      /not a PinyinDuck B-tree asset/
    );
  });

  it('rejects a header that is too short, with a rebuild hint', () => {
    expect(() => BTreeDictionary.open(new Uint8Array(8))).toThrow(/build:dict/);
  });

  it('rejects an asset whose page directory is truncated', () => {
    expect(() => BTreeDictionary.open(asset.subarray(0, HEADER_SIZE + 4))).toThrow(/build:dict/);
  });

  it('rejects an asset whose last page is cut short, before any lookup', () => {
    // The header and directory are intact, so only the directory's page bounds show
    // the asset is truncated. Opening checks them so a lookup never decodes a stub.
    expect(() => BTreeDictionary.open(asset.subarray(0, asset.byteLength - 1))).toThrow(
      /malformed or truncated \(page \d+ ends past the end of the asset\).*build:dict/
    );
  });

  it('throws a clear message when a page cannot be decoded', () => {
    // Corrupt a page body without touching the header or the directory, so the
    // failure is in the page itself rather than in opening the asset.
    const corrupt = asset.slice();
    corrupt[HEADER_SIZE + 8] = 0x7f;
    const dictionary = BTreeDictionary.open(corrupt);

    expect(() => dictionary.lookupExact('zhongguo')).toThrow(/build:dict/);
  });

  it('fails a lookup whose page id is not in the directory', () => {
    // An internal page pointing past the end of the directory is a corrupt asset:
    // reading it would decode whatever bytes happened to follow. Assembled by hand
    // because a well-formed build never produces this shape.
    const PAGE_COUNT = 1;
    const OUT_OF_RANGE = 1;
    // The only high key sorts before the query, so the descent takes the right child.
    const root = encodeInternalPage([0, OUT_OF_RANGE], ['a']);

    const directoryOffset = HEADER_SIZE;
    const rootOffset = directoryOffset + PAGE_COUNT * 8;
    const output = new Uint8Array(rootOffset + root.byteLength);
    output.set(
      encodeHeader({
        entryCount: 1,
        pageCount: PAGE_COUNT,
        rootPageId: 0,
        directoryOffset,
        buildId: 0,
        baseWordCost: 0,
      }),
      0
    );
    output.set(encodeDirectory([{ offset: rootOffset, length: root.byteLength }]), directoryOffset);
    output.set(root, rootOffset);

    const dictionary = BTreeDictionary.open(output);
    expect(() => dictionary.lookupExact('zzz')).toThrow(
      new RegExp(`page ${OUT_OF_RANGE} is outside the directory`)
    );
  });
});

describe('lookupExact', () => {
  it('returns every reading that shares a key', () => {
    const ni = open().lookupExact('ni');
    expect(ni.map((e) => e.simplified).sort()).toEqual(['你', '尼'].sort());
  });

  it('returns nothing for a key that is not present', () => {
    expect(open().lookupExact('qqq')).toEqual([]);
  });

  it('returns nothing for a key that is only a prefix of stored keys', () => {
    // "nihao" is stored, "niha" is not: descent must not match on a partial path.
    expect(open().lookupExact('niha')).toEqual([]);
  });
});

describe('scanPrefix', () => {
  it('visits every entry under the prefix, in key order', () => {
    const seen: string[] = [];

    open().scanPrefix('ni', (entry) => {
      seen.push(entry.simplified);
    });

    expect(seen.sort()).toEqual(['你', '尼', '你好'].sort());
  });

  it('stops when the visitor returns false', () => {
    const seen: string[] = [];

    open().scanPrefix('', (entry) => {
      seen.push(entry.key);
      return seen.length < 2;
    });

    expect(seen).toHaveLength(2);
  });

  it('stops immediately for a prefix no key can match', () => {
    const seen: string[] = [];

    // "q" sorts after every stored key ("ni", "ne", "zhongguo"), so the descent lands
    // on the final leaf and nothing can match.
    open().scanPrefix('q', (entry) => {
      seen.push(entry.key);
    });

    expect(seen).toEqual([]);
  });
});

describe('page cache', () => {
  it('stays correct when its byte budget cannot hold the walk', () => {
    const big = buildBTree(
      Array.from({ length: 400 }, (_, i): DictionaryRow => [
        `字${i}`,
        `字${i}`,
        'zi3',
        'gloss',
        i,
        0,
      ])
    );
    // A budget of one byte forces eviction on essentially every step.
    const dictionary = BTreeDictionary.open(big, { pageCacheBytes: 1 });

    const collected: string[] = [];
    dictionary.scanPrefix('zi', (entry) => {
      collected.push(entry.simplified);
    });

    expect(collected).toHaveLength(400);
  });

  it('keeps working after the cache is cleared', () => {
    const dictionary = open();
    const before = dictionary.lookupExact('zhongguo');

    dictionary.clearCache();

    expect(dictionary.lookupExact('zhongguo')).toEqual(before);
  });

  it('serves a repeated wide prefix scan from the cache', () => {
    // A one-letter prefix of the real asset covers close to a megabyte of pages, and the
    // web app scans it again on every keystroke. Here 8000 "shi" rows stand in for it.
    const wide = buildBTree(
      Array.from({ length: 8000 }, (_, i): DictionaryRow => [
        `字${i}`,
        `字${i}`,
        'shi4',
        `a gloss long enough to fill the page like a real definition ${i}`,
        i,
        0,
      ])
    );
    expect(wide.byteLength).toBeGreaterThan(512 * 1024);
    const bytes = wide.slice();
    const dictionary = BTreeDictionary.open(bytes);
    const scan = () => {
      let count = 0;
      dictionary.scanPrefix('s', () => {
        count++;
      });
      return count;
    };
    expect(scan()).toBe(8000);

    // Wreck every page in place. Only pages still in the cache can answer now.
    bytes.fill(0x7f, HEADER_SIZE);

    expect(scan()).toBe(8000);
  });

  it('uses a bounded default budget for decoded pages', () => {
    expect(DEFAULT_PAGE_CACHE_BYTES).toBe(4 * 1024 * 1024);
  });
});

describe('stored entries', () => {
  it('carry the fields the search engine scores on', () => {
    const [china] = open().lookupExact('zhongguo');

    const entry: StoredEntry = china;
    expect(entry).toEqual({
      key: 'zhongguo',
      simplified: '中国',
      traditional: '中國',
      pinyinNumbers: 'zhong1 guo2',
      shortGloss: 'China',
      frequency: 58468,
      hskLevel: 1,
      entryIds: [],
    });
  });
});
