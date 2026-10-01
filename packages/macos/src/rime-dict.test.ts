/**
 * Tests for the re-exported Rime dictionary emitter.
 *
 * This package does not own the emitter -- it is re-exported from @pinyinduck/windows,
 * where the formatting decisions and their tests live. What is pinned here is that the
 * re-export resolves and that the few helpers the macOS build script depends on behave,
 * so a broken barrel cannot quietly pass by importing nothing.
 *
 * The emitter itself is tested in packages/windows; duplicating those assertions here
 * would only let the two copies drift.
 */
import { describe, it, expect } from 'vitest';
import {
  RIME_SCRIPTS,
  RIME_COLUMNS,
  RIME_FIELD_SEPARATOR,
  RimeDictWriter,
  formatRow,
  renderDictHeader,
  sanitizeField,
  rimeCodes,
  rimeText,
  hskBonus,
  rimeWeight,
  rimeToneMarks,
  rimeComment,
  compareEntriesForMenu,
  rowsForCode,
  type RimeRow,
} from './rime-dict.js';

describe('constants', () => {
  it('exports RIME_SCRIPTS with both scripts', () => {
    expect(RIME_SCRIPTS).toEqual(['simplified', 'traditional']);
  });

  it('exports RIME_COLUMNS with four columns', () => {
    expect(RIME_COLUMNS).toEqual(['text', 'code', 'comment', 'weight']);
  });

  it('exports RIME_FIELD_SEPARATOR as tab', () => {
    expect(RIME_FIELD_SEPARATOR).toBe('\t');
  });
});

describe('sanitizeField', () => {
  it('trims whitespace', () => {
    expect(sanitizeField('  hello  ')).toBe('hello');
  });

  it('collapses multiple spaces', () => {
    expect(sanitizeField('hello   world')).toBe('hello world');
  });

  it('normalizes newlines to spaces', () => {
    expect(sanitizeField('hello\nworld')).toBe('hello world');
  });
});

describe('rimeCodes', () => {
  it('strips tone digits from a single syllable', () => {
    expect(rimeCodes('shi4')).toEqual(['shi']);
  });

  it('strips tone digits from multiple syllables', () => {
    expect(rimeCodes('ni3 hao3')).toEqual(['ni hao']);
  });

  it('handles v for ü', () => {
    expect(rimeCodes('lü4')).toEqual(['lü']);
  });

  it('splits alternative readings', () => {
    expect(rimeCodes('ai1 de2 hua2, da2 la1 di4')).toEqual(['ai de hua', 'da la di']);
  });

  it('rejects unencodable readings', () => {
    expect(rimeCodes('bai3ke4')).toEqual([]);
  });

  it('rejects bare numbers', () => {
    expect(rimeCodes('11')).toEqual([]);
  });
});

describe('rimeText', () => {
  it('returns simplified text by default', () => {
    const entry = { simplified: '中国', traditional: '中國' } as any;
    expect(rimeText(entry, 'simplified')).toBe('中国');
  });

  it('returns traditional text when requested', () => {
    const entry = { simplified: '中国', traditional: '中國' } as any;
    expect(rimeText(entry, 'traditional')).toBe('中國');
  });
});

describe('hskBonus', () => {
  it('returns 0 for no HSK level', () => {
    expect(hskBonus(0)).toBe(0);
  });

  it('returns a bonus for HSK 1', () => {
    expect(hskBonus(1)).toBe(30000);
  });

  it('returns a smaller bonus for higher HSK levels', () => {
    expect(hskBonus(6)).toBe(5000);
  });
});

describe('rimeWeight', () => {
  it('combines frequency and HSK bonus', () => {
    const entry = { frequency: 10000, hskLevel: 1 } as any;
    expect(rimeWeight(entry)).toBe(2000 + 30000);
  });

  it('clamps negative weights to zero', () => {
    const entry = { frequency: 0, hskLevel: 255 } as any;
    expect(rimeWeight(entry)).toBe(0);
  });
});

describe('formatRow', () => {
  it('formats a row as TSV', () => {
    const row: RimeRow = {
      text: '你好',
      code: 'nihao',
      comment: 'nǐ hǎo · hello',
      weight: 21000,
    };
    expect(formatRow(row)).toBe('你好\tnihao\tnǐ hǎo · hello\t21000');
  });
});

describe('renderDictHeader', () => {
  it('renders a valid YAML header', () => {
    const header = renderDictHeader({
      name: 'pinyinduck',
      version: '0.2.0',
      entryCount: 122746,
    });
    expect(header).toContain('name: pinyinduck');
    expect(header).toContain('version: "0.2.0"');
    expect(header).toContain('sort: by_weight');
    expect(header).toContain('columns:');
  });
});

describe('rimeToneMarks and rimeComment', () => {
  it('derives tone marks from the numbered reading', () => {
    expect(rimeToneMarks({ pinyinNumbers: 'ni3 hao3' } as never)).toBe('nǐ hǎo');
  });

  it('drops marks for a reading that is not typeable pinyin', () => {
    expect(rimeToneMarks({ pinyinNumbers: 'bai3ke4' } as never)).toBe('');
  });

  it('pairs the marks with the definition', () => {
    expect(rimeComment({ pinyinNumbers: 'ni3 hao3', shortGloss: 'hello' } as never)).toBe(
      'nǐ hǎo · hello'
    );
  });

  it('falls back to the bare definition when there is no usable gloss', () => {
    expect(rimeComment({ pinyinNumbers: 'ni3 hao3', shortGloss: '' } as never)).toBe('');
  });
});

describe('compareEntriesForMenu and rowsForCode', () => {
  const entry = (frequency: number, hskLevel: number, simplified = '你') => ({
    key: 'ni',
    simplified,
    traditional: simplified,
    pinyinNumbers: 'ni3',
    shortGloss: '',
    frequency,
    hskLevel,
  });

  it('orders a menu by weight first', () => {
    const heavy = entry(90000, 0);
    const light = entry(100, 0);
    const order = [heavy, light].sort(compareEntriesForMenu);

    expect(order[0]).toBe(heavy);
  });

  it('lets a higher HSK level win a frequency tie', () => {
    const hsk1 = entry(50000, 1);
    const none = entry(50000, 0);
    const order = [none, hsk1].sort(compareEntriesForMenu);

    expect(order[0]).toBe(hsk1);
  });

  it('breaks a remaining tie by text so the file is reproducible', () => {
    const first = entry(50000, 1, '你');
    const second = entry(50000, 1, '尼');
    const order = [second, first].sort(compareEntriesForMenu);

    expect(order.map((e) => e.simplified)).toEqual(['你', '尼']);
  });

  it('drops duplicate (text, code) rows within one code', () => {
    const { rows, duplicates } = rowsForCode(
      [
        { entry: entry(50000, 1), code: 'ni' },
        { entry: entry(50000, 1), code: 'ni' },
      ],
      'simplified'
    );

    expect(rows).toHaveLength(1);
    expect(duplicates).toBe(1);
    expect(rows[0].text).toBe('你');
    expect(rows[0].code).toBe('ni');
  });
});

describe('RimeDictWriter', () => {
  it('writes rows for a single entry', () => {
    const rows: RimeRow[] = [];
    const writer = new RimeDictWriter(
      { name: 'test', version: '0.1.0', entryCount: 1 },
      'simplified',
      (row) => rows.push(row)
    );

    writer.add({
      key: 'nihao',
      simplified: '你好',
      traditional: '你好',
      pinyinNumbers: 'ni3 hao3',
      shortGloss: 'hello',
      frequency: 21000,
      hskLevel: 1,
    });
    writer.finish();

    expect(rows.length).toBe(1);
    expect(rows[0].text).toBe('你好');
    expect(rows[0].code).toBe('ni hao');
    // Tone marks are derived from `pinyinNumbers`, not carried on the stored entry, so
    // the comment has to be rebuilt from the tone digits rather than read off the entry.
    expect(rows[0].comment).toBe('nǐ hǎo · hello');
  });

  it('counts duplicates', () => {
    const rows: RimeRow[] = [];
    const writer = new RimeDictWriter(
      { name: 'test', version: '0.1.0', entryCount: 1 },
      'simplified',
      (row) => rows.push(row)
    );

    const entry = {
      key: 'nihao',
      simplified: '你好',
      traditional: '你好',
      pinyinNumbers: 'ni3 hao3',
      shortGloss: 'hello',
      frequency: 21000,
      hskLevel: 1,
    };

    writer.add(entry);
    writer.add(entry);
    writer.finish();

    expect(rows.length).toBe(1);
    expect(writer.duplicateCount).toBe(1);
  });
});
