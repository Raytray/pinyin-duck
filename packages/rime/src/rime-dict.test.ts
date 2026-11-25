/**
 * Pins the dictionary format the Windows and macOS input methods depend on.
 *
 * These assertions are about a file format this repository does not control and cannot
 * run end to end here: librime reads the body as TSV, resolves columns by name, and
 * stable-sorts each menu by weight. A change to the weight formula, the column order or
 * the row ordering still produces a file Weasel happily compiles, and silently changes
 * what a learner sees, so each of those is pinned against what librime actually does.
 */

import { describe, it, expect } from 'vitest';
import {
  BTreeDictionary,
  buildBTree,
  scoreEntry,
  storedEntryToScorable,
  type StoredEntry,
} from '@pinyinduck/core';
import {
  RIME_COLUMNS,
  RIME_FIELD_SEPARATOR,
  RimeDictWriter,
  compareEntriesForMenu,
  formatRow,
  hskBonus,
  renderDictHeader,
  DATA_CREDIT_LINES,
  rimeCodes,
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
    entryIds: [],
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

describe('rimeCodes', () => {
  it('strips the tone digits, so a code is reachable by its plain spelling', () => {
    // A tone digit in the code would make the digit a *spelling* key, so `shi2` would be the
    // only way to reach 是 and a learner pressing `2` to pick the second candidate would be
    // spelling a tone. Stripping them makes every code reachable by its plain spelling and
    // turns the digit keys into candidate selectors.
    expect(rimeCodes('ni3 hao3')).toEqual(['ni hao']);
    expect(rimeCodes('shi4')).toEqual(['shi']);
  });

  it('accepts ü, which the dictionary spells and the schema rewrites back to v', () => {
    expect(rimeCodes('lü4')).toEqual(['lü']);
    expect(rimeCodes('nüe4')).toEqual(['nüe']);
  });

  it('accepts the neutral tone, so 儿化 words stay reachable', () => {
    // `r5` → `r`: the web's cleanPinyin keeps it, so rejecting it here would make Windows
    // less capable than the web for the same corpus.
    expect(rimeCodes('zi3 r5')).toEqual(['zi r']);
    expect(rimeCodes('ai1 bian1 r5')).toEqual(['ai bian r']);
  });

  it('splits an entry that carries two alternative readings', () => {
    // Both of these come out of the corpus verbatim. Passed through as one code, librime
    // reports `Encode failure` and the word is unreachable under either reading.
    expect(rimeCodes('ai1 de2 hua2 · da2 la1 di4')).toEqual(['ai de hua', 'da la di']);
    expect(rimeCodes('bei1 zhi1 , wu2 shen4')).toEqual(['bei zhi', 'wu shen']);
  });

  it('tolerates the spacing around a separator', () => {
    expect(rimeCodes('ni3  ,  hao3')).toEqual(['ni', 'hao']);
    expect(rimeCodes('ni3,hao3')).toEqual(['ni', 'hao']);
  });

  it('collapses repeated separators instead of emitting an empty reading', () => {
    expect(rimeCodes('ni3,,,hao3')).toEqual(['ni', 'hao']);
    expect(rimeCodes(',ni3,')).toEqual(['ni']);
  });

  it('accepts a bare initial that is letters-only, matching the web', () => {
    // `a b zhi4` and `a` are how entries with bare initials ended up. The web's cleanPinyin
    // keeps any run of letters, so rejecting them here would break parity.
    expect(rimeCodes('a b zhi4')).toEqual(['a b zhi']);
    expect(rimeCodes('a')).toEqual(['a']);
  });

  it('accepts romanised readings that are letters-only, since the web reaches them too', () => {
    // These were `Encode failure` under the toned rule because they carried no tone digit.
    // Toneless, they are ordinary letters-only codes, and the web indexes them the same way.
    expect(rimeCodes('coser')).toEqual(['coser']);
    expect(rimeCodes('t o n y')).toEqual(['t o n y']);
    expect(rimeCodes('w o r d jie3')).toEqual(['w o r d jie']);
    expect(rimeCodes('pua')).toEqual(['pua']);
  });

  it('rejects a syllable with a tone digit but no letter', () => {
    expect(rimeCodes('11 qu1')).toEqual([]);
    expect(rimeCodes('shuang1 11')).toEqual([]);
  });

  it('rejects an empty or punctuation-only reading', () => {
    expect(rimeCodes('')).toEqual([]);
    expect(rimeCodes('   ')).toEqual([]);
    expect(rimeCodes(', ·')).toEqual([]);
  });

  it('rejects a code with more than one tone digit in a syllable', () => {
    // `shi44` → `shi4`: the trailing digit strips, the internal one does not, and a digit
    // is not a letter.
    expect(rimeCodes('shi44')).toEqual([]);
  });

  it('rejects a squashed code with an internal digit', () => {
    // `bai3ke4` is two syllables fused with no space; stripping the trailing digit leaves
    // `bai3ke`, which is not letters. The web reaches it as the key `baike`, but a Rime code
    // has to be syllable-aligned, and this one is not.
    expect(rimeCodes('bai3ke4')).toEqual([]);
  });

  it('deduplicates identical readings, so a repeated variant is not a duplicate row', () => {
    expect(rimeCodes('ni3, ni3 ,ni3')).toEqual(['ni']);
  });

  it('returns nothing rather than a partial code when one syllable is bad', () => {
    // Half a code is worse than none: it would look reachable in the corpus sweep while
    // failing to encode at deploy time.
    expect(rimeCodes('ni3 bai3ke4 hao3')).toEqual([]);
  });

  it('keeps the good readings and drops the bad one', () => {
    expect(rimeCodes('ai1 de2 hua2 · bai3ke4')).toEqual(['ai de hua']);
  });
});

describe('rimeWeight', () => {
  it('scales popularity the same way scoreEntry does', () => {
    expect(rimeWeight(entry({ frequency: 100000 }))).toBe(20000);
    expect(rimeWeight(entry({ frequency: 7 }))).toBe(1);
  });

  it('rewards easier HSK words on the front-loaded curve, matching scoreEntry', () => {
    // Level 7 is the 7-9 band. CC-CEDICT words outside the HSK list carry level 0.
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(hskBonus)).toEqual([
      0, 30000, 22000, 16000, 11000, 7000, 4000, 2000,
    ]);
  });

  it('gives the same bonus as scoreEntry for every stored level', () => {
    const word = { simplified: '字', pinyinClean: 'zi', pinyinNumbers: 'zi4', frequency: 0 };
    for (let level = 0; level <= 255; level++) {
      const added = scoreEntry({ ...word, hskLevel: level }, 'zi', []) - scoreEntry(word, 'zi', []);
      expect(hskBonus(level)).toBe(added);
    }
  });

  it('weights the 7-9 band above a word with no level at equal frequency', () => {
    const band = entry({ simplified: '共识', key: 'gongshi', pinyinNumbers: 'gong4 shi2', frequency: 0, hskLevel: 7 });
    const unlevelled = entry({ simplified: '公室', key: 'gongshi', pinyinNumbers: 'gong1 shi4', frequency: 0, hskLevel: 0 });
    expect(rimeWeight(band)).toBeGreaterThan(rimeWeight(unlevelled));
    expect(compareEntriesForMenu(band, unlevelled)).toBeLessThan(0);
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

  it('is a total order, so the emitted order never depends on the input order', () => {
    // Every field this compares is derived from the entry, and two entries that agree on
    // all of them are the same entry. But `Array.prototype.sort` is only stable by spec
    // from ES2019 onward, and the tree hands entries over in key order, which interleaves
    // readings. A comparator that returned 0 for genuinely different entries would let
    // the input order decide the menu — the one thing the emitted order exists to fix.
    // So the last field is compared even though, within a single menu, the code is
    // shared and this is unreachable in practice. It is the guarantee, not a case.
    const a = entry({ simplified: '你', traditional: '你', pinyinNumbers: 'ni2' });
    const b = entry({ simplified: '你', traditional: '你', pinyinNumbers: 'ni3' });
    expect(compareEntriesForMenu(a, b)).toBeLessThan(0);
    expect(compareEntriesForMenu(b, a)).toBeGreaterThan(0);
    // And the reverse of a negative is positive, for the pair that decides it.
    expect(Math.sign(compareEntriesForMenu(b, a))).toBe(-Math.sign(compareEntriesForMenu(a, b)));
  });

  it('falls back to frequency when two entries land on the same weight', () => {
    // The HSK bonus steps in thousands and popularity in finer increments, so weights
    // collide: here a HSK 3 word with no corpus frequency weighs the same as a HSK 6 word
    // once its 60000 occurrences are compressed. The more frequent one still wins, as it
    // does in the web engine.
    const frequent = entry({ simplified: '他', frequency: 60000, hskLevel: 6, pinyinNumbers: 'ta1' });
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

  it('credits the data sources and states the CC BY-SA license', () => {
    // The file is copied into a Rime folder on its own, so its header is the only notice
    // its holder sees. CC BY-SA requires the credit and the license to travel with it.
    for (const line of DATA_CREDIT_LINES) expect(header).toContain(`# ${line}`);
    expect(header).toContain('CC BY-SA 4.0');
    expect(header).toMatch(/CC-CEDICT, by MDBG/);
    expect(header).toMatch(/Hermit Dave/);
    expect(header).toContain(
      '#   HSK 3.0 syllabus (2025), by Center for Language Education and Cooperation (中外语言交流合作中心), no license, levels only:\n#     https://www.chinesetest.cn/\n'
    );
    // Still ahead of the YAML document, where librime ignores it.
    expect(header.indexOf('License:')).toBeLessThan(header.indexOf('---'));
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
    const line = formatRow({ text: '你好', code: 'ni hao', comment: 'nǐ hǎo · hello', weight: 21000 });
    expect(line.split(RIME_FIELD_SEPARATOR)).toEqual(['你好', 'ni hao', 'nǐ hǎo · hello', '21000']);
  });

  it('keeps the weight an integer, since nothing sorts on its scale', () => {
    // Rime stores log(weight) and only ever compares it, but a fractional weight would
    // reintroduce ties the entry ordering above exists to remove.
    const line = formatRow({ text: '坱', code: 'wu', comment: '', weight: rimeWeight(entry({ key: 'wu', pinyinNumbers: 'wu3' })) });
    expect(line.endsWith('\t0')).toBe(true);
  });

  it('gives a level the asset should not hold no bonus, rather than a negative one', () => {
    // `hskLevel` is a `u8` in the asset and the field is documented as levels 1-7, but
    // nothing enforces that at the byte level. A bonus that went negative for such a level
    // would drag the weight to zero, and librime turns a non-positive weight into
    // log(DBL_EPSILON): a permanent last place, reported nowhere. An unknown level is
    // weighted by its frequency alone.
    expect(hskBonus(8)).toBe(0);
    expect(hskBonus(9)).toBe(0);
    expect(hskBonus(255)).toBe(0);
    expect(rimeWeight(entry({ key: 'wu', frequency: 100, hskLevel: 9 }))).toBe(20);
    expect(rimeWeight(entry({ key: 'wu', frequency: 100, hskLevel: 255 }))).toBe(20);
  });

  it('still rewards a real HSK level, so the clamp costs nothing in practice', () => {
    // The clamp must not be a blanket discount: an HSK 1 word is the most frequent one for
    // a learner, and that ordering is the product.
    const easy = rimeWeight(entry({ key: 'a', frequency: 0, hskLevel: 1 }));
    const hard = rimeWeight(entry({ key: 'a', frequency: 0, hskLevel: 6 }));
    expect(easy).toBeGreaterThan(hard);
    expect(hard).toBe(4000);
  });
});

describe('rowsForCode', () => {
  it('drops a duplicate that two simplified words collapse into, keeping the better one', () => {
    // 干 gān and 乾 gān are different words that CC-CEDICT gives the same traditional
    // form; librime would drop the second itself, with a warning.
    const gan = entry({ key: 'gan', simplified: '干', traditional: '乾', pinyinNumbers: 'gan1', frequency: 1000 });
    const qian = entry({ key: 'gan', simplified: '乾', traditional: '乾', pinyinNumbers: 'gan1', frequency: 500 });
    const { rows, duplicates } = rowsForCode(
      [
        { entry: qian, code: 'gan' },
        { entry: gan, code: 'gan' },
      ],
      'traditional'
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('乾');
    expect(duplicates).toBe(1);
  });

  it('skips an entry with no text for the script', () => {
    const { rows } = rowsForCode(
      [{ entry: entry({ simplified: '', pinyinNumbers: 'ni3' }), code: 'ni' }],
      'simplified'
    );
    expect(rows).toEqual([]);
  });

  it('counts an entry repeated under the same code as a duplicate', () => {
    // The same word and reading arriving twice is what the traditional script produces, and
    // dropping it is the whole reason this function exists.
    const ni = entry({ simplified: '你', pinyinNumbers: 'ni3' });
    const { rows, duplicates } = rowsForCode(
      [
        { entry: ni, code: 'ni' },
        { entry: ni, code: 'ni' },
      ],
      'simplified'
    );
    expect(rows).toHaveLength(1);
    expect(duplicates).toBe(1);
  });
});

describe('RimeDictWriter', () => {
  it('groups by code and flushes a group when the code changes', () => {
    const { rows } = collect([
      entry({ key: 'ni', simplified: '你', pinyinNumbers: 'ni3', frequency: 100000 }),
      entry({ key: 'hao', simplified: '好', pinyinNumbers: 'hao3', frequency: 100000 }),
    ]);
    expect(rows.map((row) => row.code)).toEqual(['ni', 'hao']);
  });

  it('merges every tone of one spelling into a single menu, weight-ordered', () => {
    // The tree sorts a key by frequency, not by reading, so the tones of one key arrive
    // interleaved. Toneless, they are all one code — one menu — so the whole block has to be
    // weight-sorted together or the rare homophones would keep the scan order Rime preserves.
    const { rows } = collect([
      entry({ key: 'shi', simplified: '市', pinyinNumbers: 'shi4', frequency: 98290 }),
      entry({ key: 'shi', simplified: '史', pinyinNumbers: 'shi3', frequency: 90000 }),
      entry({ key: 'shi', simplified: '试', pinyinNumbers: 'shi4', frequency: 124845 }),
      entry({ key: 'shi', simplified: '师', pinyinNumbers: 'shi1', frequency: 90000 }),
      entry({ key: 'shi', simplified: '是', pinyinNumbers: 'shi4', frequency: 244325 }),
    ]);

    // One code, five candidates, most frequent first — the digit keys now select among them.
    expect(rows.map((row) => row.code)).toEqual(['shi', 'shi', 'shi', 'shi', 'shi']);
    expect(rows.map((row) => row.text)).toEqual(['是', '试', '市', '史', '师']);
  });

  it('emits the highest weighted entry first within a code', () => {
    const { rows } = collect([
      entry({ simplified: '坱', frequency: 0, pinyinNumbers: 'wu3' }),
      entry({ simplified: '五', frequency: 90000, pinyinNumbers: 'wu3' }),
    ]);
    expect(rows.map((row) => row.text)).toEqual(['五', '坱']);
  });

  it('writes only the rows meant for its script, so 後 hòu reaches the traditional dictionary', () => {
    // What the core build writes for 後 hòu and 后 hòu: one simplified-only row standing for
    // both, and one traditional-only row each.
    const hou = { key: 'hou', simplified: '后', pinyinNumbers: 'hou4', frequency: 70000 };
    const entries = [
      entry({ ...hou, traditional: '後', shortGloss: 'back / empress', onlyIn: 'simplified' }),
      entry({ ...hou, traditional: '后', shortGloss: 'empress / queen', onlyIn: 'traditional' }),
      entry({ ...hou, traditional: '後', shortGloss: 'back / behind / rear', onlyIn: 'traditional' }),
    ];

    const simplified = collect(entries, 'simplified');
    expect(simplified.rows.map((row) => [row.text, row.comment])).toEqual([['后', 'hòu · back / empress']]);
    expect(simplified.writer.duplicateCount).toBe(0);

    const traditional = collect(entries, 'traditional');
    expect(traditional.rows.map((row) => [row.text, row.comment])).toEqual([
      ['后', 'hòu · empress / queen'],
      ['後', 'hòu · back / behind / rear'],
    ]);
  });

  it('writes the traditional form when asked for it', () => {
    const { rows } = collect(
      [entry({ simplified: '中国', traditional: '中國', key: 'zhongguo', pinyinNumbers: 'zhong1 guo2' })],
      'traditional'
    );
    expect(rows[0].text).toBe('中國');
  });

  it('counts entries with no text without dropping the group they interrupted', () => {
    const { rows, writer } = collect([
      entry({ key: 'ni', simplified: '你', pinyinNumbers: 'ni3', frequency: 90000 }),
      entry({ key: 'ni', simplified: '', pinyinNumbers: 'ni3' }),
      entry({ key: 'ni', simplified: '妳', pinyinNumbers: 'ni3', frequency: 500 }),
    ]);
    expect(writer.skippedCount).toBe(1);
    expect(rows.map((row) => row.text)).toEqual(['你', '妳']);
  });

  it('writes one row per reading when a source entry carries two', () => {
    // The word is one word; the readings are two. Emitting the pair as a single code would
    // give librime something it cannot encode, and it would drop the entry entirely.
    const { rows } = collect([
      entry({
        key: 'aidehua',
        simplified: '爱',
        pinyinNumbers: 'ai1 de2 hua2 · da2 la1 di4',
      }),
    ]);
    expect(rows.map((row) => row.code)).toEqual(['ai de hua', 'da la di']);
    expect(rows.map((row) => row.text)).toEqual(['爱', '爱']);
  });

  it('keeps a two-reading entry in the right group when a key changes after it', () => {
    // Both readings have to survive the flush, and the next key's rows must not join them.
    const { rows } = collect([
      entry({ key: 'aidehua', simplified: '爱', pinyinNumbers: 'ai1 de2 · da2 la1' }),
      entry({ key: 'ni', simplified: '你', pinyinNumbers: 'ni3' }),
    ]);
    expect(rows.map((row) => row.code).sort()).toEqual(['ai de', 'da la', 'ni']);
  });

  it('counts an unreadable reading separately from a missing text', () => {
    // They are different failures: one is a data problem in the source, the other is an
    // entry that simply has no form in this script. Merging them would hide which.
    const { rows, writer } = collect([
      entry({ key: 'ni', simplified: '你', pinyinNumbers: 'ni3' }),
      entry({ key: 'baike', simplified: '兡', pinyinNumbers: 'bai3ke4' }),
      entry({ key: 'ni', simplified: '', pinyinNumbers: 'ni3' }),
    ]);
    expect(writer.unencodableCount).toBe(1);
    expect(writer.skippedCount).toBe(1);
    expect(rows.map((row) => row.text)).toEqual(['你']);
  });

  it('keeps a multi-reading entry whose second reading is unreadable', () => {
    // Dropping the whole entry would lose a good reading over a bad neighbour. Only the
    // reading that cannot be encoded is dropped.
    const { rows, writer } = collect([
      entry({ key: 'aidehua', simplified: '爱', pinyinNumbers: 'ai1 de2 hua2 · bai3ke4' }),
    ]);
    expect(writer.unencodableCount).toBe(0);
    expect(rows.map((row) => row.code)).toEqual(['ai de hua']);
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
    const dictionary = BTreeDictionary.open(encoded);
    const emitted: RimeRow[] = [];
    const writer = new RimeDictWriter(
      { name: 'pinyinduck', version: '0.1.0', entryCount: dictionary.entryCount },
      script,
      (row) => emitted.push(row)
    );
    dictionary.scanPrefix('', (stored) => {
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
    expect(rows.filter((row) => row.code === 'ni hao').map((row) => row.text)).toEqual([
      '你好',
      '拟好',
    ]);
  });

  it('emits the traditional forms when building the traditional dictionary', async () => {
    const { rows } = await emitFromAsset(CORPUS, 'traditional');
    expect(rows.map((row) => row.text).sort()).toEqual(['你', '你好', '擬好']);
  });
});
