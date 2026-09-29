/**
 * Pins the dictionary format the Windows input method depends on.
 *
 * These assertions are about a file format this repository does not control and cannot
 * run end to end here: librime reads the body as TSV, resolves columns by name, and
 * stable-sorts each menu by weight. A change to the weight formula, the column order or
 * the row ordering still produces a file Weasel happily compiles, and silently changes
 * what a learner sees, so each of those is pinned against what librime actually does.
 */

import { describe, it, expect } from 'vitest';
import { BTreeDictionary } from '../../core/src/data/btree-dictionary.js';
import { MemoryPageSource } from '../../core/src/data/page-source.js';
import { buildBTree } from '../../core/src/data/btree-builder.js';
import type { StoredEntry } from '../../core/src/data/btree-codec.js';
import { scoreEntry } from '../../core/src/index/ranking.js';
import { storedEntryToScorable } from '../../core/src/index/lazy-search.js';
import {
  RIME_COLUMNS,
  RIME_FIELD_SEPARATOR,
  RimeDictWriter,
  compareEntriesForMenu,
  formatRow,
  hskBonus,
  renderDictHeader,
  rimeComment,
  rimeToneMarks,
  rimeWeight,
  rowsForCode,
  sanitizeField,
  type RimeRow,
} from './rime-dict';

/** Builds a stored entry, defaulting the fields a case does not care about. */
function entry(overrides: Partial<StoredEntry> = {}): StoredEntry {
  return {
    key: 'nihao',
    simplified: '你好',
    traditional: '你好',
    pinyinNumbers: 'ni3 hao3',
    shortGloss: 'hello / how are you',
    frequency: 0,
    hskLevel: 0,
    ...overrides,
  };
}

/** Collects every row a writer emits. */
function collect(
  entries: StoredEntry[],
  script: 'simplified' | 'traditional' = 'simplified'
): { rows: RimeRow[]; writer: RimeDictWriter } {
  const rows: RimeRow[] = [];
  const writer = new RimeDictWriter(
    { name: 'pinyinduck', version: '0.1.0', entryCount: entries.length },
    script,
    (row) => rows.push(row)
  );
  for (const item of entries) writer.add(item);
  writer.finish();
  return { rows, writer };
}

describe('sanitizeField', () => {
  it('collapses whitespace and trims, so a field can never split a TSV row', () => {
    expect(sanitizeField('hello /  how\tare you\n')).toBe('hello / how are you');
  });

  it('keeps the single spaces a pinyin code is separated by', () => {
    expect(sanitizeField("ni3  hao3")).toBe('ni3 hao3');
  });
});

describe('rimeWeight', () => {
  it('scales popularity the same way scoreEntry does', () => {
    expect(rimeWeight(entry({ frequency: 100000 }))).toBe(20000);
    expect(rimeWeight(entry({ frequency: 7 }))).toBe(1);
  });

  it('rewards easier HSK words, matching scoreEntry', () => {
    expect(hskBonus(1)).toBe(30000);
    expect(hskBonus(6)).toBe(5000);
    // CC-CEDICT words outside the HSK list carry level 0, which must not outrank HSK 6.
    expect(hskBonus(0)).toBe(0);
  });

  it('orders a code the same way scoreEntry orders it', () => {
    // Every entry here shares a code, so the two constant terms in scoreEntry (match
    // tier, word length) are identical and cannot reorder the menu.
    const rare = entry({ simplified: '坱', frequency: 0, hskLevel: 0, pinyinNumbers: 'wu3' });
    const common = entry({ simplified: '五', frequency: 90000, hskLevel: 1, pinyinNumbers: 'wu3' });
    const learner = entry({ simplified: '午', frequency: 0, hskLevel: 6, pinyinNumbers: 'wu3' });

    const byWeight = [rare, common, learner].sort(compareEntriesForMenu).map((e) => e.simplified);
    const byScore = [rare, common, learner]
      .sort(
        (a, b) =>
          scoreEntry(storedEntryToScorable(b), 'wu', []) -
          scoreEntry(storedEntryToScorable(a), 'wu', [])
      )
      .map((e) => e.simplified);

    expect(byWeight).toEqual(['五', '午', '坱']);
    expect(byWeight).toEqual(byScore);
  });

  it('breaks ties the way the web engine does, since librime keeps file order', () => {
    // Same weight and frequency, so the remaining comparisons decide. Rime's
    // SortHomophones is a stable sort, which makes the emitted order the tiebreak.
    const a = entry({ simplified: '你', traditional: '你', frequency: 0 });
    const b = entry({ simplified: '妳', traditional: '妳', frequency: 0 });
    expect(compareEntriesForMenu(a, b)).toBeLessThan(0);
    expect(compareEntriesForMenu(b, a)).toBeGreaterThan(0);
    expect(compareEntriesForMenu(a, entry({ ...a, traditional: '妳' }))).toBeLessThan(0);
    expect(compareEntriesForMenu(entry({ ...a, traditional: '妳' }), a)).toBeGreaterThan(0);
    expect(compareEntriesForMenu(a, entry({ ...a }))).toBe(0);
  });

  it('falls back to frequency when two entries land on the same weight', () => {
    // The HSK bonus steps in 5000s and popularity in finer increments, so weights
    // collide: here a HSK 3 word with no corpus frequency outweighs a HSK 6 word only
    // after its 75000 occurrences are compressed. The more frequent one still wins, as
    // it does in the web engine.
    const frequent = entry({ simplified: '他', frequency: 75000, hskLevel: 6, pinyinNumbers: 'ta1' });
    const learner = entry({ simplified: '佗', frequency: 0, hskLevel: 3, pinyinNumbers: 'ta1' });
    expect(rimeWeight(frequent)).toBe(rimeWeight(learner));
    expect(compareEntriesForMenu(frequent, learner)).toBeLessThan(0);
    expect(compareEntriesForMenu(learner, frequent)).toBeGreaterThan(0);
  });

  it('returns a stable zero only for entries the menu cannot tell apart', () => {
    const a = entry({ simplified: '他', traditional: '他', frequency: 50000, hskLevel: 0, pinyinNumbers: 'ta1' });
    expect(compareEntriesForMenu(a, entry({ ...a }))).toBe(0);
  });
});

describe('rimeToneMarks and rimeComment', () => {
  it('derives tone marks from the code so they can never drift from the pinyin', () => {
    expect(rimeToneMarks(entry())).toBe('nǐ hǎo');
    expect(rimeToneMarks(entry({ pinyinNumbers: 'lv4' }))).toBe('lǜ');
    expect(rimeToneMarks(entry({ pinyinNumbers: 'shi2', key: 'shi' }))).toBe('shí');
  });

  it('shows the marks and the definition together, which is the point of the IME', () => {
    expect(rimeComment(entry())).toBe('nǐ hǎo · hello / how are you');
  });

  it('falls back to the gloss alone when the code is not typeable pinyin', () => {
    // CC-CEDICT transliterations such as 百科 [Bai3 ke4] reach us as one syllable.
    const transcribed = entry({ pinyinNumbers: 'bai3ke4', shortGloss: 'encyclopedia' });
    expect(rimeToneMarks(transcribed)).toBe('');
    expect(rimeComment(transcribed)).toBe('encyclopedia');
  });

  it('emits an empty comment rather than a bare separator when there is no gloss', () => {
    expect(rimeComment(entry({ shortGloss: '' }))).toBe('');
  });
});

describe('renderDictHeader', () => {
  const header = renderDictHeader({ name: 'pinyinduck', version: '0.1.0', entryCount: 122746 });

  it('names the dictionary, which is how librime links it to a schema', () => {
    expect(header).toContain('name: pinyinduck');
  });

  it('quotes the version, since YAML would read 0.1.0 as a string anyway', () => {
    expect(header).toContain('version: "0.1.0"');
  });

  it('ends the YAML document with the line librime reads until', () => {
    // LoadDictHeader consumes lines up to and including a lone "..."; without it the
    // first dictionary row would be parsed as part of the header.
    expect(header.split('\n').at(-2)).toBe('...');
  });

  it('declares the columns, because the default layout has no comment column', () => {
    // DictSettings::GetColumnIndex falls back to text/code/weight, and "comment" is not
    // part of that default, so an undeclared gloss column would be dropped silently.
    const columns = header
      .split('\n')
      .filter((line) => line.startsWith('  - '))
      .map((line) => line.trim().slice(2));
    expect(columns).toEqual([...RIME_COLUMNS]);
  });

  it('sorts by weight and does not pull in the essay vocabulary', () => {
    // Without this the weights would be scaled against a corpus PinyinDuck does not use.
    expect(header).toContain('sort: by_weight');
    expect(header).toContain('use_preset_vocabulary: false');
  });

  it('records the corpus size so a truncated build is visible in the file', () => {
    expect(header).toContain('122746');
  });
});

describe('formatRow', () => {
  it('writes one tab-separated line in the declared column order', () => {
    const line = formatRow({ text: '你好', code: 'ni3 hao3', comment: 'nǐ hǎo · hello', weight: 21000 });
    expect(line.split(RIME_FIELD_SEPARATOR)).toEqual(['你好', 'ni3 hao3', 'nǐ hǎo · hello', '21000']);
  });

  it('keeps the weight an integer, since nothing sorts on its scale', () => {
    // Rime stores log(weight) and only ever compares it, but a fractional weight would
    // reintroduce ties the entry ordering above exists to remove.
    const line = formatRow({ text: '坱', code: 'wu3', comment: '', weight: rimeWeight(entry({ key: 'wu', pinyinNumbers: 'wu3' })) });
    expect(line.endsWith('\t0')).toBe(true);
  });
});

describe('rowsForCode', () => {
  it('drops a duplicate that two simplified words collapse into, keeping the better one', () => {
    // 干 gān and 乾 gān are different words that CC-CEDICT gives the same traditional
    // form; librime would drop the second itself, with a warning.
    const gan = entry({ key: 'gan', simplified: '干', traditional: '乾', pinyinNumbers: 'gan1', frequency: 1000 });
    const qian = entry({ key: 'gan', simplified: '乾', traditional: '乾', pinyinNumbers: 'gan1', frequency: 500 });
    const { rows, duplicates } = rowsForCode([qian, gan], 'traditional');

    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('乾');
    expect(duplicates).toBe(1);
  });

  it('skips entries with no text or no code', () => {
    const { rows } = rowsForCode(
      [entry({ simplified: '', pinyinNumbers: 'ni3' }), entry({ pinyinNumbers: '' })],
      'simplified'
    );
    expect(rows).toEqual([]);
  });
});

describe('RimeDictWriter', () => {
  it('groups by code and flushes a group when the code changes', () => {
    const { rows } = collect([
      entry({ key: 'ni', simplified: '你', pinyinNumbers: 'ni3', frequency: 100000 }),
      entry({ key: 'hao', simplified: '好', pinyinNumbers: 'hao3', frequency: 100000 }),
    ]);
    expect(rows.map((row) => row.code)).toEqual(['ni3', 'hao3']);
  });

  it('orders each code when one key block interleaves its tones', () => {
    // The tree sorts a key by frequency, not by reading, so the tones of one key arrive
    // interleaved. A Rime menu is per code, so each has to be sorted on its own or the
    // rare homophones would keep the scan order Rime then preserves.
    const { rows } = collect([
      entry({ key: 'shi', simplified: '市', pinyinNumbers: 'shi4', frequency: 98290 }),
      entry({ key: 'shi', simplified: '史', pinyinNumbers: 'shi3', frequency: 90000 }),
      entry({ key: 'shi', simplified: '试', pinyinNumbers: 'shi4', frequency: 124845 }),
      entry({ key: 'shi', simplified: '师', pinyinNumbers: 'shi1', frequency: 90000 }),
      entry({ key: 'shi', simplified: '是', pinyinNumbers: 'shi4', frequency: 244325 }),
    ]);

    // Codes are emitted in ascending order inside the block; each is weight-sorted.
    expect(rows.map((row) => row.code)).toEqual(['shi1', 'shi3', 'shi4', 'shi4', 'shi4']);
    expect(rows.filter((row) => row.code === 'shi4').map((row) => row.text)).toEqual([
      '是',
      '试',
      '市',
    ]);
  });

  it('emits the highest weighted entry first within a code', () => {
    const { rows } = collect([
      entry({ simplified: '坱', frequency: 0, pinyinNumbers: 'wu3' }),
      entry({ simplified: '五', frequency: 90000, pinyinNumbers: 'wu3' }),
    ]);
    expect(rows.map((row) => row.text)).toEqual(['五', '坱']);
  });

  it('writes the traditional form when asked for it', () => {
    const { rows } = collect(
      [entry({ simplified: '中国', traditional: '中國', key: 'zhongguo', pinyinNumbers: 'zhong1 guo2' })],
      'traditional'
    );
    expect(rows[0].text).toBe('中國');
  });

  it('counts unusable entries without dropping the group they interrupted', () => {
    const { rows, writer } = collect([
      entry({ key: 'ni', simplified: '你', pinyinNumbers: 'ni3', frequency: 90000 }),
      entry({ key: 'ni', simplified: '', pinyinNumbers: 'ni3' }),
      entry({ key: 'ni', simplified: '妳', pinyinNumbers: 'ni3', frequency: 500 }),
    ]);
    expect(writer.skippedCount).toBe(1);
    expect(rows.map((row) => row.text)).toEqual(['你', '妳']);
  });

  it('is safe to finish twice, so a caller cannot double the last group', () => {
    const rows: RimeRow[] = [];
    const writer = new RimeDictWriter(
      { name: 'pinyinduck', version: '0.1.0', entryCount: 1 },
      'simplified',
      (row) => rows.push(row)
    );
    writer.add(entry({ simplified: '你', pinyinNumbers: 'ni3' }));
    writer.finish();
    writer.finish();
    expect(rows).toHaveLength(1);
    expect(writer.rowCount).toBe(1);
  });

  it('writes nothing for an empty dictionary', () => {
    const { rows, writer } = collect([]);
    expect(rows).toEqual([]);
    expect(writer.rowCount).toBe(0);
    expect(writer.skippedCount).toBe(0);
    expect(writer.duplicateCount).toBe(0);
  });
});

describe('a whole dictionary', () => {
  /** Builds an asset from rows and reads it back, so the tests exercise real bytes. */
  async function emitFromAsset(
    rows: [string, string, string, string, number, number][],
    script: 'simplified' | 'traditional' = 'simplified'
  ) {
    const encoded = buildBTree(rows.map((row) => [...row] as never));
    const dictionary = await BTreeDictionary.open(new MemoryPageSource(encoded));
    const emitted: RimeRow[] = [];
    const writer = new RimeDictWriter(
      { name: 'pinyinduck', version: '0.1.0', entryCount: dictionary.entryCount },
      script,
      (row) => emitted.push(row)
    );
    await dictionary.scanPrefix('', (stored) => {
      writer.add(stored);
      return true;
    });
    writer.finish();
    return { rows: emitted, writer, entryCount: dictionary.entryCount };
  }

  const CORPUS: [string, string, string, string, number, number][] = [
    ['你好', '你好', 'ni3 hao3', 'hello / how are you', 50000, 1],
    ['你', '你', 'ni3', 'you (singular)', 90000, 1],
    ['拟好', '擬好', 'ni3 hao3', 'to draft', 0, 0],
  ];

  it('emits one row per entry when read back out of a real B+ tree', async () => {
    const { rows, writer, entryCount } = await emitFromAsset(CORPUS);

    expect(entryCount).toBe(3);
    expect(writer.rowCount).toBe(3);
    // Every row must be parseable as TSV with exactly the declared columns.
    for (const row of rows) {
      expect(formatRow(row).split(RIME_FIELD_SEPARATOR)).toHaveLength(RIME_COLUMNS.length);
    }
  });

  it('carries the gloss that makes the choice between homophones possible', async () => {
    const { rows } = await emitFromAsset(CORPUS);
    const labelled = rows.map((row) => `${row.text}:${row.comment}`);
    expect(labelled).toContain('你好:nǐ hǎo · hello / how are you');
    expect(labelled).toContain('拟好:nǐ hǎo · to draft');
  });

  it('orders one reading by popularity, the way the web app does', async () => {
    const { rows } = await emitFromAsset(CORPUS);
    // 你好 outranks the rarer 拟好 on the same reading, while 你 sits in its own menu
    // because it is a different (shorter) code.
    expect(rows.filter((row) => row.code === 'ni3 hao3').map((row) => row.text)).toEqual([
      '你好',
      '拟好',
    ]);
  });

  it('emits the traditional forms when building the traditional dictionary', async () => {
    const { rows } = await emitFromAsset(CORPUS, 'traditional');
    expect(rows.map((row) => row.text).sort()).toEqual(['你', '你好', '擬好']);
  });
});
