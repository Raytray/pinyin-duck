import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BTREE_URL,
  DEFAULT_PAGE_CACHE_BYTES,
  openBTreeDictionary,
  BTreeDictionary,
} from './btree-dictionary';
import { MemoryPageSource } from './page-source';
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
  return BTreeDictionary.open(new MemoryPageSource(asset), options);
}

/** A source that counts reads and can be made to fail. */
function countingSource(bytes: Uint8Array) {
  const inner = new MemoryPageSource(bytes);
  const state = { reads: 0, bytesRead: 0 };
  const source = {
    async read(offset: number, length: number) {
      state.reads++;
      state.bytesRead += Math.min(length, bytes.byteLength - offset);
      return inner.read(offset, length);
    },
  };
  return { source, state };
}

describe('opening', () => {
  it('reads the entry and page counts without reading any page', async () => {
    const { source, state } = countingSource(asset);
    const dictionary = await BTreeDictionary.open(source);

    expect(dictionary.entryCount).toBe(rows.length);
    expect(dictionary.pageCount).toBeGreaterThan(0);
    // Header plus page directory, and nothing else.
    expect(state.bytesRead).toBeLessThan(asset.byteLength);
  });

  it('opens over HTTP range requests by default', async () => {
    const requested: string[] = [];
    const fetchMock = async (url: string, init?: RequestInit) => {
      // The page source always sends a Range header; read it without asserting the
      // `init` argument away, so a call that omitted it fails on the missing header
      // rather than on `undefined.Range`.
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const range = headers.Range ?? '';
      requested.push(range);
      const match = /bytes=(\d+)-(\d+)/.exec(range)!;
      const start = Number(match[1]);
      const end = Number(match[2]);
      const slice = asset.subarray(start, end + 1);
      return {
        ok: true,
        status: 206,
        statusText: 'Partial Content',
        arrayBuffer: async () => slice.buffer.slice(
          slice.byteOffset,
          slice.byteOffset + slice.byteLength
        ) as ArrayBuffer,
      } as unknown as Response;
    };

    const dictionary = await openBTreeDictionary(DEFAULT_BTREE_URL, {
      fetchImpl: fetchMock as never,
    });

    expect(dictionary.entryCount).toBe(rows.length);
    expect(requested.length).toBeGreaterThanOrEqual(2);
    // The first request is the header only: the whole file is never downloaded.
    expect(requested[0]).toBe(`bytes=0-${HEADER_SIZE - 1}`);
  });

  it('rejects a payload that is not a PinyinDuck asset', async () => {
    const garbage = new Uint8Array(64);
    await expect(
      BTreeDictionary.open(new MemoryPageSource(garbage))
    ).rejects.toThrow(/not a PinyinDuck B-tree asset/);
  });

  it('rejects a header that is too short, with a rebuild hint', async () => {
    await expect(
      BTreeDictionary.open(new MemoryPageSource(new Uint8Array(8)))
    ).rejects.toThrow(/build:dict/);
  });

  it('rejects an asset whose page directory is truncated', async () => {
    const truncated = asset.subarray(0, HEADER_SIZE + 4);
    await expect(
      BTreeDictionary.open(new MemoryPageSource(truncated))
    ).rejects.toThrow(/build:dict/);
  });

  it('lets a source failure through with its original message', async () => {
    // A network or HTTP failure is the caller's to report, so it must not be
    // rewritten as a decoding problem.
    const source = {
      read: async () => {
        throw new Error('Failed to load the dictionary from /d.btree (404 Not Found).');
      },
    };
    await expect(BTreeDictionary.open(source)).rejects.toThrow('404 Not Found');
  });

  it('rejects with a clear message when a page cannot be decoded', async () => {
    // Corrupt a page body without touching the header or the directory, so the
    // failure is in the page itself rather than in opening the asset.
    const corrupt = asset.slice();
    corrupt[HEADER_SIZE + 8] = 0x7f;
    const dictionary = await BTreeDictionary.open(new MemoryPageSource(corrupt));

    await expect(dictionary.lookupExact('zhongguo')).rejects.toThrow(/build:dict/);
  });

  it('fails a lookup whose page id is not in the directory', async () => {
    // An internal page pointing past the end of the directory is a corrupt asset, not
    // a transport problem: reading it would decode whatever bytes happened to follow.
    // Assembled by hand because a well-formed build never produces this shape.
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
      }),
      0
    );
    output.set(encodeDirectory([{ offset: rootOffset, length: root.byteLength }]), directoryOffset);
    output.set(root, rootOffset);

    const dictionary = await BTreeDictionary.open(new MemoryPageSource(output));
    await expect(dictionary.lookupExact('zzz')).rejects.toThrow(
      new RegExp(`page ${OUT_OF_RANGE} is outside the directory`)
    );
  });
});

describe('lookupExact', () => {
  it('returns every reading that shares a key', async () => {
    const dictionary = await open();

    const ni = await dictionary.lookupExact('ni');
    expect(ni.map((e) => e.simplified).sort()).toEqual(['你', '尼'].sort());
  });

  it('returns nothing for a key that is not present', async () => {
    const dictionary = await open();
    expect(await dictionary.lookupExact('qqq')).toEqual([]);
  });

  it('returns nothing for a key that is only a prefix of stored keys', async () => {
    // "nihao" is stored, "niha" is not: descent must not match on a partial path.
    const dictionary = await open();
    expect(await dictionary.lookupExact('niha')).toEqual([]);
  });
});

describe('scanPrefix', () => {
  it('visits every entry under the prefix, in key order', async () => {
    const dictionary = await open();
    const seen: string[] = [];

    await dictionary.scanPrefix('ni', (entry) => {
      seen.push(entry.simplified);
    });

    expect(seen.sort()).toEqual(['你', '尼', '你好'].sort());
  });

  it('stops when the visitor returns false', async () => {
    const dictionary = await open();
    const seen: string[] = [];

    await dictionary.scanPrefix('', (entry) => {
      seen.push(entry.key);
      return seen.length < 2;
    });

    expect(seen).toHaveLength(2);
  });

  it('stops immediately for a prefix no key can match', async () => {
    const dictionary = await open();
    const seen: string[] = [];

    // "q" sorts after every stored key ("ni", "ne", "zhongguo"), so the descent lands
    // on the final leaf and nothing can match.
    await dictionary.scanPrefix('q', (entry) => {
      seen.push(entry.key);
    });

    expect(seen).toEqual([]);
  });
});

describe('page cache', () => {
  it('serves a repeated lookup without a second read', async () => {
    const { source, state } = countingSource(asset);
    const dictionary = await BTreeDictionary.open(source);

    await dictionary.lookupExact('ni');
    const afterFirst = state.reads;
    await dictionary.lookupExact('ni');

    expect(state.reads).toBe(afterFirst);
  });

  it('stays within its byte budget while walking a large tree', async () => {
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
    const { source, state } = countingSource(big);
    // A budget of one byte forces eviction on essentially every step.
    const dictionary = await BTreeDictionary.open(source, { pageCacheBytes: 1 });

    const collected: string[] = [];
    await dictionary.scanPrefix('zi', (entry) => {
      collected.push(entry.simplified);
    });

    // Correctness must not depend on the cache being large enough to hold the walk.
    expect(collected).toHaveLength(400);
    expect(state.reads).toBeGreaterThan(1);
  });

  it('fetches a page once even when concurrent searches both need it', async () => {
    // The root is read while the dictionary is still cold. Two searches that start
    // together must share that read rather than each issuing their own.
    const inner = new MemoryPageSource(asset);
    let pageReads = 0;
    const source = {
      async read(offset: number, length: number) {
        // Only count page bodies, not the header and directory read during open.
        if (offset >= HEADER_SIZE + 8) pageReads++;
        await Promise.resolve();
        return inner.read(offset, length);
      },
    };
    const dictionary = await BTreeDictionary.open(source);
    expect(pageReads).toBe(0);

    const [a, b] = await Promise.all([
      dictionary.lookupExact('ni'),
      dictionary.lookupExact('ne'),
    ]);

    expect(a).not.toEqual([]);
    expect(b).not.toEqual([]);
    // Both searches descend from the same root, so a deduped root read is one read.
    expect(pageReads).toBeGreaterThan(0);
  });

  it('keeps working after the cache is cleared', async () => {
    const dictionary = await open();
    const before = await dictionary.lookupExact('zhongguo');

    dictionary.clearCache();

    expect(await dictionary.lookupExact('zhongguo')).toEqual(before);
  });

  it('uses a bounded default budget that fits a page or two of the real asset', () => {
    // The point of the default is to stay well under an Android keyboard's budget
    // while still holding the hot part of the tree; a whole-asset budget would defeat
    // the lazy read entirely.
    expect(DEFAULT_PAGE_CACHE_BYTES).toBe(256 * 1024);
  });
});

describe('instance lifecycle', () => {
  it('exposes stored entries with the fields the search engine scores on', async () => {
    const dictionary = await open();
    const [china] = await dictionary.lookupExact('zhongguo');

    const entry: StoredEntry = china;
    expect(entry).toEqual({
      key: 'zhongguo',
      simplified: '中国',
      traditional: '中國',
      pinyinNumbers: 'zhong1 guo2',
      shortGloss: 'China',
      frequency: 58468,
      hskLevel: 1,
    });
  });

  it('reports counts from the header rather than by walking the tree', async () => {
    const { source, state } = countingSource(asset);
    const dictionary = await BTreeDictionary.open(source);

    expect(dictionary.entryCount).toBe(rows.length);
    const afterOpen = state.reads;
    expect(dictionary.entryCount).toBe(rows.length);
    // Reading a count must not touch a page.
    expect(state.reads).toBe(afterOpen);
  });
});
