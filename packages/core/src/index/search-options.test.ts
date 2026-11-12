import { describe, it, expect } from 'vitest';
import { LazyPinyinSearchEngine } from './lazy-search';
import { buildBTree } from '../data/btree-builder';
import { MemoryPageSource } from '../data/page-source';
import { openBTreeDictionaryFromSource } from '../data/btree-dictionary';
import type { DictionaryRow } from '../data/dictionary-codec';

/**
 * A dictionary row written by field. Clean pinyin and tone marks are derived from
 * `pinyinNumbers`, exactly as the engine derives them from the shipped asset.
 */
interface Fixture {
  simplified?: string;
  traditional?: string;
  pinyinNumbers?: string;
  shortGloss?: string;
  frequency?: number;
  hskLevel?: number;
}

function row(fixture: Fixture = {}): DictionaryRow {
  const simplified = fixture.simplified ?? '字';
  return [
    simplified,
    fixture.traditional ?? simplified,
    fixture.pinyinNumbers ?? 'zi4',
    fixture.shortGloss ?? 'character',
    fixture.frequency ?? 0,
    fixture.hskLevel ?? 0,
  ];
}

/** A lazy engine over an in-memory B-tree built from `rows`. */
async function engineOf(rows: DictionaryRow[]): Promise<LazyPinyinSearchEngine> {
  return new LazyPinyinSearchEngine(
    await openBTreeDictionaryFromSource(new MemoryPageSource(buildBTree(rows)))
  );
}

const manyRows = () =>
  Array.from({ length: 25 }, (_, i) => row({ simplified: `字${i}`, pinyinNumbers: 'zi4' }));

describe('option defaults', () => {
  it('returns an empty result for a blank query', async () => {
    const engine = await engineOf([row()]);
    for (const query of ['', '   ']) {
      const result = await engine.search(query);
      expect(result).toEqual({ query: '', segments: [], candidates: [], total: 0 });
    }
  });

  it('normalizes case and surrounding whitespace on the query', async () => {
    const engine = await engineOf([row()]);
    const result = await engine.search('  ZI  ');
    expect(result.query).toBe('zi');
  });

  it('defaults to simplified script', async () => {
    const mixed = await engineOf([row({ simplified: '发', traditional: '發', pinyinNumbers: 'fa1' })]);

    expect((await mixed.search('fa')).candidates[0].hanzi).toBe('发');
    expect((await mixed.search('fa', { script: 'simplified' })).candidates[0].hanzi).toBe('发');
    expect((await mixed.search('fa', { script: 'traditional' })).candidates[0].hanzi).toBe('發');
  });

  it('applies a default result limit of 10', async () => {
    const many = await engineOf(manyRows());

    const result = await many.search('zi');
    expect(result.candidates).toHaveLength(10);
    // total reports the full match count, not the truncated page.
    expect(result.total).toBe(25);
  });

  it('honors an explicit limit', async () => {
    const many = await engineOf(manyRows());

    expect((await many.search('zi', { limit: 3 })).candidates).toHaveLength(3);
  });

  it('skips prefix candidates when exactOnly is set', async () => {
    const engine = await engineOf([
      row({ simplified: '字', pinyinNumbers: 'zi4' }),
      row({ simplified: '紫', pinyinNumbers: 'zi3 se4' }),
    ]);

    expect((await engine.search('zi')).candidates.map((c) => c.hanzi)).toEqual(['字', '紫']);
    expect((await engine.search('zi', { exactOnly: true })).candidates.map((c) => c.hanzi)).toEqual(['字']);
  });

  it('reports segments for the query', async () => {
    const engine = await engineOf([row()]);
    const result = await engine.search('nihao');
    expect(result.segments).toEqual(['ni', 'hao']);
  });

  it('searches on the cleaned query when the input has no segmentable syllables', async () => {
    // A query made only of separators cleans to an empty prefix, so there is no
    // first syllable to fall back on. The search must still run rather than throw.
    const engine = await engineOf([row({ simplified: '啊', pinyinNumbers: 'a5' })]);

    const result = await engine.search("'");
    expect(result.segments).toEqual([]);
    expect(result.query).toBe("'");
    expect(result.candidates.map((c) => c.hanzi)).toEqual(['啊']);
  });
});

describe('tone filtering edge cases', () => {
  it('drops an entry with no tone number when a tone is typed', async () => {
    // A hand-authored entry can carry a toneless reading. There is no tone to match,
    // so it cannot satisfy a tone filter and must not be offered.
    const engine = await engineOf([row({ simplified: '塔', pinyinNumbers: 'ta' })]);

    expect((await engine.search('ta4')).candidates).toEqual([]);
  });

  it('keeps a toneless entry when no tone is typed', async () => {
    const engine = await engineOf([row({ simplified: '塔', pinyinNumbers: 'ta' })]);

    expect((await engine.search('ta')).candidates.map((c) => c.hanzi)).toEqual(['塔']);
  });

  it('shows only one candidate when two readings share the same hanzi', async () => {
    // CC-CEDICT lists 行 under both hang2 and xing2. They are distinct entries, but
    // the candidate list is keyed on displayed text, so the second is deduplicated.
    const engine = await engineOf([
      row({ simplified: '行', pinyinNumbers: 'hang2', frequency: 50000 }),
      row({ simplified: '行', pinyinNumbers: 'hang5', frequency: 40000 }),
    ]);

    const result = await engine.search('hang');
    expect(result.total).toBe(1);
    expect(result.candidates.map((c) => c.hanzi)).toEqual(['行']);
    // The more frequent reading is the one that survives deduplication.
    expect(result.candidates[0].pinyinNumbers).toBe('hang2');
  });
});
