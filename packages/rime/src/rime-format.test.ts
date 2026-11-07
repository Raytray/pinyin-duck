/**
 * Pins the independent reader against the format librime actually implements.
 *
 * The reader exists so the corpus sweep can check the generated file rather than the
 * emitter's own output, which means its rules have to be right. These cases are taken
 * from librime's own sources — `DictSettings::LoadDictHeader`, `GetColumnIndex`,
 * `use_preset_vocabulary` and `EntryCollector::Collect` — and each one names the function
 * it mirrors, because a reader that quietly disagrees with the engine is worse than no
 * reader at all.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RIME_COLUMNS,
  REQUIRED_RIME_COLUMNS,
  RimeFormatError,
  getColumnIndex,
  iterateRimeRows,
  parseDictHeader,
  parseRimeRow,
  splitRimeRow,
} from './rime-format';
import { RIME_COLUMNS, renderDictHeader } from './rime-dict';

/** A header as `renderDictHeader` writes it, with the body supplied. */
function dict(body = '', overrides: { entryCount?: number; name?: string } = {}): string {
  return (
    renderDictHeader({
      name: overrides.name ?? 'pinyinduck',
      version: '0.1.0',
      entryCount: overrides.entryCount ?? 122746,
    }) + body
  );
}

/**
 * The 1-based line the first body row lands on: the one after the header's closing `...`.
 * Derived rather than hard-coded, so a change to the header's comments moves it too.
 */
const BODY_LINE = dict().split('\n').length;

/** The rows a dictionary of `count` identical entries would produce. */
function rows(count: number): string {
  return Array.from(
    { length: count },
    (_, i) => `你好\tni3 hao3\tnǐ hǎo · hello; hi\t${14262 + i}`
  ).join('\n');
}

describe('parseDictHeader', () => {
  it('reads the header renderDictHeader writes', () => {
    const file = parseDictHeader(dict(rows(2)));
    expect(file.header.name).toBe('pinyinduck');
    expect(file.header.version).toBe('0.1.0');
    expect(file.header.sort).toBe('by_weight');
    expect(file.header.usePresetVocabulary).toBe(false);
    expect(file.header.columns).toEqual([...RIME_COLUMNS]);
    expect(file.header.entryCount).toBe(122746);
  });

  it('resolves every column this package depends on', () => {
    const { columns } = parseDictHeader(dict());
    expect(columns).toEqual({ text: 0, code: 1, comment: 2, weight: 3 });
    // The order has to match what the emitter writes, or every row means something else.
    expect(REQUIRED_RIME_COLUMNS).toEqual(RIME_COLUMNS);
  });

  it('points the body at the first row after the closing `...`', () => {
    const file = parseDictHeader(dict(rows(1)));
    const [first] = [...iterateRimeRows(dict(rows(1)), file)];
    expect(file.bodyStartLine).toBe(BODY_LINE);
    expect(first.line).toBe(BODY_LINE);
    expect(dict(rows(1)).split('\n')[BODY_LINE - 1]).toBe(rows(1));
  });

  it('keeps the preamble above the header', () => {
    const file = parseDictHeader(dict());
    expect(file.header.preamble[0]).toMatch(/^# PinyinDuck dictionary/);
    expect(file.header.preamble.at(-1)).toBe('---');
  });

  it('reports no entry count when the preamble has none', () => {
    const bare = ['# hand written', '', '---', 'name: x', 'version: "1"', '...', ''].join('\n');
    expect(parseDictHeader(bare).header.entryCount).toBeNull();
  });

  it('rejects a file with no `---` line', () => {
    expect(() => parseDictHeader('name: x\nversion: "1"\n')).toThrow(/no `---` line/);
  });

  it('rejects a header the YAML block never closes', () => {
    const open = ['---', 'name: x', 'version: "1"', '你好\tni3 hao3\t\t1'].join('\n');
    expect(() => parseDictHeader(open)).toThrow(/never closed/);
    // Reported at the line the block opened, which is the line to go and look at.
    expect(() => parseDictHeader(open)).toThrow(/line 1/);
  });

  it('requires name and version, as LoadDictHeader does', () => {
    expect(() => parseDictHeader(['---', 'name: x', '...'].join('\n'))).toThrow(/no `version`/);
    expect(() => parseDictHeader(['---', 'version: "1"', '...'].join('\n'))).toThrow(/no `name`/);
  });

  it('rejects a header that declares no text column', () => {
    const noText = ['---', 'name: x', 'version: "1"', 'columns:', '  - code', '...'].join('\n');
    expect(() => parseDictHeader(noText)).toThrow(/no `text` column/);
  });

  it('rejects a header line it cannot read', () => {
    const broken = ['---', 'name: x', 'version: "1"', 'sort by_weight', '...'].join('\n');
    expect(() => parseDictHeader(broken)).toThrow(/Unreadable header line/);
  });

  it('rejects a list item outside any key', () => {
    const orphan = ['---', 'name: x', 'version: "1"', '  - text', '...'].join('\n');
    expect(() => parseDictHeader(orphan)).toThrow(/List item outside any key/);
  });

  it('rejects a use_preset_vocabulary that is neither true nor false', () => {
    const bad = ['---', 'name: x', 'version: "1"', 'use_preset_vocabulary: maybe', '...'].join('\n');
    expect(() => parseDictHeader(bad)).toThrow(/must be true or false/);
  });

  it('reads a declared vocabulary as implying the preset, like use_preset_vocabulary()', () => {
    // DictSettings ORs the two, so a header cannot set use_preset_vocabulary: false and
    // still pull in the essay by naming a vocabulary.
    const withVocab = [
      '---',
      'name: x',
      'version: "1"',
      'use_preset_vocabulary: false',
      'vocabulary: essay',
      '...',
    ].join('\n');
    expect(parseDictHeader(withVocab).header.usePresetVocabulary).toBe(true);
  });

  it('reads a bare name as an unquoted scalar', () => {
    const bare = ['---', 'name: pinyinduck', 'version: 0.1.0', '...'].join('\n');
    const { header } = parseDictHeader(bare);
    expect(header.name).toBe('pinyinduck');
    expect(header.version).toBe('0.1.0');
  });

  it('tolerates comments and blank lines inside the header', () => {
    const annotated = [
      '---',
      '# a note',
      '',
      'name: x',
      'version: "1"  # trailing',
      '...',
    ].join('\n');
    expect(parseDictHeader(annotated).header.name).toBe('x');
  });

  it('keeps the quote of a value the writer was interrupted in the middle of', () => {
    // A header cut off mid-scalar, which is what a killed `build:rime` leaves. The reader
    // strips the quote only when there is one on both ends, so the half-written value comes
    // back as it stands rather than silently losing its first character. The emitter is
    // the thing that must not produce this; the reader's job is to show what is there.
    const cut = ['---', 'name: pinyinduck', "version: '0.", '...'].join('\n');
    expect(parseDictHeader(cut).header.version).toBe("'0.");
    expect(parseDictHeader(['---', 'name: "pin', 'version: "1"', '...'].join('\n')).header.name).toBe(
      '"pin'
    );
  });
});

describe('getColumnIndex', () => {
  it('falls back to text/code/weight when the header declares no columns', () => {
    const bare = ['---', 'name: x', 'version: "1"', '...'].join('\n');
    const { columns } = parseDictHeader(bare);
    expect(columns).toEqual({ text: 0, code: 1, comment: -1, weight: 2 });
    expect([...DEFAULT_RIME_COLUMNS]).toEqual(['text', 'code', 'weight']);
  });

  it('returns -1 for a column the header does not declare', () => {
    expect(getColumnIndex(['text', 'code'], 'comment')).toBe(-1);
    expect(getColumnIndex(['text', 'code'], 'code')).toBe(1);
  });
});

describe('a header that declares fewer columns than rows carry', () => {
  // librime's own `columns:` list is honoured literally, so a dictionary can declare two
  // columns and still be written with three. `GetColumnIndex` returns -1 for the third,
  // and the reader has to behave the way the engine does rather than reaching past the
  // end of the list — otherwise the sweep would validate a file librime reads differently.
  const header = ['---', 'name: x', 'version: "1"', 'columns:', '  - text', '  - code', '...'].join(
    '\n'
  );
  const file = parseDictHeader(header);

  it('reads only the declared columns, and reports the rest as absent', () => {
    const row = parseRimeRow('你好\tni3 hao3\tnǐ hǎo · hello\t14262', file, 7);
    expect(row).toMatchObject({ text: '你好', code: 'ni3 hao3' });
    expect(row.comment).toBe('');
    // Weight defaults to 0 rather than being read out of the gloss field. A reader that
    // guessed here would report an order librime never computes.
    expect(row.weight).toBe(0);
  });

  it('reads a header that declares a text column and nothing else', () => {
    // The degenerate case, and the one a hand-edited header produces: a one-column list
    // is accepted, so a row has a text and no code, no gloss and no weight. Reporting that
    // is more useful than refusing the file, because the sweep's job is to say which of
    // the two it is rather than to stop at the first surprise.
    const one = ['---', 'name: x', 'version: "1"', 'columns:', '  - text', '...'].join('\n');
    const row = parseRimeRow('你好', parseDictHeader(one), 9);
    expect(row).toMatchObject({ text: '你好', code: '', comment: '', weight: 0 });
  });
});

describe('splitRimeRow', () => {
  it('keeps empty fields, which is what keeps an unglossed entry in its column', () => {
    // SplitBehavior::KeepToken is the default, so a missing gloss is an empty third field
    // rather than a shift that lands the weight where the comment belongs.
    expect(splitRimeRow('你\tshi4\t\t48865')).toEqual(['你', 'shi4', '', '48865']);
  });

  it('does not treat a tab as a run of separators', () => {
    expect(splitRimeRow('a\t\tb')).toEqual(['a', '', 'b']);
  });
});

describe('parseRimeRow', () => {
  const file = parseDictHeader(dict());

  it('resolves a row through the declared columns', () => {
    const row = parseRimeRow('你好\tni3 hao3\tnǐ hǎo · hello; hi\t14262', file, 20);
    expect(row).toMatchObject({
      line: 20,
      text: '你好',
      code: 'ni3 hao3',
      comment: 'nǐ hǎo · hello; hi',
      weight: 14262,
    });
  });

  it('accepts an empty comment, which is how an entry with no gloss is stored', () => {
    const row = parseRimeRow('你\tshi4\t\t48865', file, 21);
    expect(row.comment).toBe('');
    expect(row.weight).toBe(48865);
  });

  it('rejects a row with fewer fields than the header declares columns', () => {
    expect(() => parseRimeRow('你\tshi4', file, 22)).toThrow(/2 field\(s\) but the header declares 4/);
    expect(() => parseRimeRow('你\tshi4', file, 22)).toThrow(/line 22/);
  });

  it('rejects a row with no text, which librime drops as a warning', () => {
    expect(() => parseRimeRow('\tshi4\tshì\t1', file, 23)).toThrow(/no text/);
  });

  it('rejects a row with no code, which would be run through the encoder instead', () => {
    expect(() => parseRimeRow('你\t\tshì\t1', file, 24)).toThrow(/no code/);
  });

  it('rejects a weight that is not a number, which librime turns into 0', () => {
    expect(() => parseRimeRow('你\tshi4\tshì\thigh', file, 25)).toThrow(/not a number/);
  });

  it('rejects an empty weight, which demotes an entry to the bottom of its menu', () => {
    expect(() => parseRimeRow('你\tshi4\tshì\t', file, 26)).toThrow(/weight column is empty/);
  });

  it('accepts a weight of zero, because std::stod does', () => {
    // 205 CC-CEDICT characters have no corpus frequency and are emitted with weight 0, so
    // rejecting zero here would reject a third of a real dictionary's rarest entries. The
    // consequence is only that they sort last, which is the intent.
    expect(parseRimeRow('𩽾\tan1\tān\t0', file, 27).weight).toBe(0);
  });

  it('accepts a negative weight, leaving the judgement to the sweep', () => {
    // Not something the emitter can produce, but librime would accept it, and this reader's
    // job is to describe the engine rather than to enforce policy.
    expect(parseRimeRow('你\tshi4\tshì\t-5', file, 27).weight).toBe(-5);
  });

  it('reads a dictionary that declares no comment column, which is the trap', () => {
    // This is the header librime falls back to when `columns` is missing. The row parses
    // fine and the weight lands correctly — which is exactly why a lost `columns:` line
    // costs every gloss on Windows without failing anything.
    const bare = parseDictHeader(['---', 'name: x', 'version: "1"', '...'].join('\n'));
    const row = parseRimeRow('你\tshi4\t48865', bare, 20);
    expect(row.code).toBe('shi4');
    expect(row.comment).toBe('');
    expect(row.weight).toBe(48865);
  });

  it('still rejects a bad weight when the header declares the default columns', () => {
    const bare = parseDictHeader(['---', 'name: x', 'version: "1"', '...'].join('\n'));
    // The third field is the weight here, not a gloss, so "hello" is unparseable.
    expect(() => parseRimeRow('你\tshi4\thello', bare, 20)).toThrow(/not a number/);
  });
});

describe('iterateRimeRows', () => {
  it('walks every row with its real line number', () => {
    const text = dict(rows(3));
    const seen = [...iterateRimeRows(text, parseDictHeader(text))].map((row) => row.line);
    expect(seen).toEqual([BODY_LINE, BODY_LINE + 1, BODY_LINE + 2]);
  });

  it('skips blank lines and `#` comments the way Collect does', () => {
    const body = ['你好\tni3 hao3\tnǐ hǎo\t14262', '', '# a note', '你\tshi4\tshì\t48865'].join('\n');
    const text = dict(body);
    const parsed = [...iterateRimeRows(text, parseDictHeader(text))];
    expect(parsed.map((row) => row.text)).toEqual(['你好', '你']);
  });

  it('honours the `# no comment` line that turns comment handling off', () => {
    // Once that line appears librime stops skipping `#` lines, so a body line beginning
    // with `#` is data. This dictionary has no such rows; the reader still has to agree.
    const body = ['你\tshi4\tshì\t1', '# no comment', '# 不是注释\tshi4\tshì\t2'].join('\n');
    const text = dict(body);
    const parsed = [...iterateRimeRows(text, parseDictHeader(text))];
    expect(parsed.map((row) => row.weight)).toEqual([1, 2]);
  });

  it('tolerates a final row with no trailing newline', () => {
    const text = dict('你好\tni3 hao3\tnǐ hǎo\t14262');
    expect([...iterateRimeRows(text, parseDictHeader(text))]).toHaveLength(1);
  });

  it('strips the trailing whitespace Collect trims', () => {
    const text = dict('你好\tni3 hao3\tnǐ hǎo\t14262   ');
    const [row] = [...iterateRimeRows(text, parseDictHeader(text))];
    expect(row.weight).toBe(14262);
  });

  it('yields nothing for a dictionary with an empty body', () => {
    expect([...iterateRimeRows(dict(), parseDictHeader(dict()))]).toEqual([]);
  });

  it('propagates a row error with the line it happened on', () => {
    const text = dict(['你\tshi4\tshì\t1', '坏行\tshi4', '安\tan1\tān\t2'].join('\n'));
    const walk = () => [...iterateRimeRows(text, parseDictHeader(text))];
    expect(walk).toThrow(RimeFormatError);
    expect(walk).toThrow(new RegExp(`line ${BODY_LINE + 1}\\b`));
  });
});
