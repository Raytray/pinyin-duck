import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  loadDictionary,
  decodeDictionary,
  DEFAULT_DICTIONARY_URL,
} from './load-dictionary';
import { DICTIONARY_FORMAT_VERSION, type DictionaryRow } from './dictionary-codec';

const rows: DictionaryRow[] = [
  ['中国', '中國', 'zhong1 guo2', 'China', 58468, 1],
  ['你好', '你好', 'ni3 hao3', 'hello; hi', 71309, 0],
];

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl);
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('decodeDictionary', () => {
  it('derives tone marks, clean pinyin and syllables from the pinyin column', () => {
    const entries = decodeDictionary([rows[0]]);
    expect(entries[0]).toEqual({
      simplified: '中国',
      traditional: '中國',
      pinyinNumbers: 'zhong1 guo2',
      pinyinMarks: 'zhōng guó',
      pinyinClean: 'zhongguo',
      pinyinSyllables: ['zhong1', 'guo2'],
      shortGloss: 'China',
      frequency: 58468,
      hskLevel: 1,
    });
  });

  it('omits definitions because the generated asset does not carry them', () => {
    const [entry] = decodeDictionary([rows[0]]);
    expect(entry.definitions).toBeUndefined();
  });

  it('treats hskLevel 0 as unknown rather than HSK zero', () => {
    const [entry] = decodeDictionary([rows[1]]);
    expect(entry.hskLevel).toBeUndefined();
  });

  it('falls back to the simplified form when no traditional form is stored', () => {
    const [entry] = decodeDictionary([['台', '', 'tai2', 'platform; Taiwan', 100, 0]]);
    expect(entry.traditional).toBe('台');
  });

  it('handles a single-tone pinyin without a trailing space', () => {
    const [entry] = decodeDictionary([['五', '五', 'wu3', 'five', 200, 1]]);
    expect(entry.pinyinSyllables).toEqual(['wu3']);
    expect(entry.pinyinClean).toBe('wu');
  });

  it('returns an empty list for empty input', () => {
    expect(decodeDictionary([])).toEqual([]);
  });

  it('preserves row order', () => {
    expect(decodeDictionary(rows).map((e) => e.simplified)).toEqual(['中国', '你好']);
  });
});

describe('loadDictionary', () => {
  it('defaults to the public asset path', async () => {
    const fetchSpy = mockFetch(async () => new Response(JSON.stringify(rows)));
    await loadDictionary();
    expect(fetchSpy.mock.calls[0][0]).toBe(DEFAULT_DICTIONARY_URL);
  });

  it('requests the given url and returns decoded entries', async () => {
    const fetchSpy = mockFetch(async () => new Response(JSON.stringify(rows)));
    const entries = await loadDictionary('/custom.json');
    expect(fetchSpy.mock.calls[0][0]).toBe('/custom.json');
    expect(entries).toHaveLength(2);
    expect(entries[0].pinyinMarks).toBe('zhōng guó');
    expect(entries[1].shortGloss).toBe('hello; hi');
  });

  it('forwards the abort signal when one is supplied', async () => {
    const controller = new AbortController();
    const fetchSpy = mockFetch(async () => new Response(JSON.stringify(rows)));
    await loadDictionary('/dictionary.json', { signal: controller.signal });
    expect(fetchSpy.mock.calls[0][1]).toEqual({ signal: controller.signal });
  });

  it('reports how to recover from a failed request', async () => {
    mockFetch(async () => new Response('missing', { status: 404 }));
    await expect(loadDictionary()).rejects.toThrow(/build:dict/);
  });

  it('rejects an empty payload', async () => {
    mockFetch(async () => new Response('[]'));
    await expect(loadDictionary()).rejects.toThrow(/build:dict/);
  });

  it('rejects a payload that is not an array', async () => {
    mockFetch(async () => new Response(JSON.stringify({ entries: [] })));
    await expect(loadDictionary()).rejects.toThrow(/build:dict/);
  });

  it('propagates an abort instead of masking it as a load failure', async () => {
    const controller = new AbortController();
    mockFetch(async () => {
      controller.abort();
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });
    await expect(
      loadDictionary('/dictionary.json', { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('DICTIONARY_FORMAT_VERSION', () => {
  it('is pinned to the current column layout', () => {
    expect(DICTIONARY_FORMAT_VERSION).toBe(1);
  });
});
