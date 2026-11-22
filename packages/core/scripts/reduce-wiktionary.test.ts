import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { gzipSync } from 'zlib';
import { reduceDumpFile, reduceWiktionary, wiktionaryRows } from './reduce-wiktionary';

describe('reduceWiktionary', () => {
  const dump = {
    url: 'https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz',
    dumpDate: '2026-10-01',
    extractedDate: '2026-10-30',
    sha256: 'ab'.repeat(32),
  };

  it('writes the dump it came from, then one row per headword, reading and part of speech', async () => {
    const lines = [
      JSON.stringify(record('書', 'noun', ['shū'], [['书', ['Simplified-Chinese']]])),
      '{"word": "book", "pos": "noun", "lang_code": "en"}',
      JSON.stringify(record('中國', 'adj', ['Zhōngguó'], [['中国', ['Simplified-Chinese']]])),
      JSON.stringify(record('中國', 'noun', ['Zhōngguó'], [['中国', ['Simplified-Chinese']]])),
      JSON.stringify(record('中國', 'adj', ['Zhōngguó'], [['中国', ['Simplified-Chinese']]])),
      '',
      JSON.stringify(record('書', 'verb', ['shū'], [['书', ['Simplified-Chinese']]])),
    ];

    const tsv = await reduceWiktionary(lines, dump);

    expect(tsv.split('\n').filter((line) => line.startsWith('# ') && /^# (source|dump|sha256) /.test(line))).toEqual([
      '# source https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz',
      '# dump 2026-10-01 (enwiktionary), extracted 2026-10-30',
      `# sha256 ${'ab'.repeat(32)}`,
    ]);
    // Sorted by headword so a new dump diffs by word; each word's rows stay in page order.
    expect(tsv.split('\n').filter((line) => line && !line.startsWith('#'))).toEqual([
      '中國\t中国\tZhōngguó\tadj',
      '中國\t中国\tZhōngguó\tnoun',
      '書\t书\tshū\tnoun',
      '書\t书\tshū\tverb',
    ]);
    expect(tsv.endsWith('\n')).toBe(true);
  });
});

/** A Chinese wiktextract record with Standard Mandarin readings. */
function record(word: string, pos: string, readings: string[], forms: Array<[string, string[]]> = []) {
  return {
    word,
    pos,
    lang_code: 'zh',
    forms: forms.map(([form, tags]) => ({ form, tags })),
    sounds: readings.map((zh_pron) => ({ zh_pron, tags: ['Mandarin', 'Standard-Chinese', 'Pinyin'] })),
  };
}

describe('wiktionaryRows', () => {
  it('gives the traditional headword, its simplified form, each reading and the part of speech', () => {
    expect(wiktionaryRows(record('喜歡', 'verb', ['xǐhuan'], [['喜欢', ['Simplified-Chinese']]]))).toEqual([
      { traditional: '喜歡', simplified: '喜欢', reading: 'xǐhuan', pos: 'verb' },
    ]);
  });

  it('keeps only Standard Mandarin pinyin, without its numbered gloss, once per reading', () => {
    const rows = wiktionaryRows({
      word: '馬',
      pos: 'noun',
      lang_code: 'zh',
      forms: [{ form: '马', tags: ['Simplified-Chinese'] }],
      sounds: [
        { zh_pron: 'mǎ (ma³)', tags: ['Mandarin', 'Standard', 'Pinyin'] },
        { zh_pron: 'mǎ', tags: ['Mandarin', 'Standard-Chinese', 'Pinyin'] },
        { zh_pron: 'ㄇㄚˇ', tags: ['Mandarin', 'Standard-Chinese', 'Bopomofo'] },
        { zh_pron: 'ma³', tags: ['Mandarin', 'Chengdu', 'Sichuanese', 'Pinyin'] },
        { zh_pron: 'mà', tags: ['Mandarin', 'Beijing', 'dialectal', 'Pinyin'] },
        { zh_pron: 'mā', tags: ['Mandarin', 'Standard-Chinese', 'Taiwan', 'Pinyin'] },
        { zh_pron: 'maa5', tags: ['Cantonese', 'Jyutping'] },
      ],
    });

    expect(rows.map((row) => row.reading)).toEqual(['mǎ', 'mā']);
  });

  it('uses the headword for both scripts when Wiktionary gives no simplified form', () => {
    expect(wiktionaryRows(record('我', 'pron', ['wǒ']))).toEqual([
      { traditional: '我', simplified: '我', reading: 'wǒ', pos: 'pron' },
    ]);
  });

  it('skips other languages, soft redirects and entries without a Mandarin reading', () => {
    expect(wiktionaryRows({ ...record('書', 'noun', ['shū']), lang_code: 'ja' })).toEqual([]);
    expect(wiktionaryRows(record('书', 'soft-redirect', ['shū']))).toEqual([]);
    expect(wiktionaryRows(record('書', 'noun', []))).toEqual([]);
  });

  it('skips headers that carry no word class: characters, proper names and symbols', () => {
    for (const pos of ['character', 'name', 'symbol', 'punct', 'romanization']) {
      expect(wiktionaryRows(record('書', pos, ['shū']))).toEqual([]);
    }
  });

  it('keeps the citation reading, not the tone-sandhi note after it', () => {
    expect(wiktionaryRows(record('+1', 'verb', ["jiāyī'áisi [Phonetic: jiāyì'áisi]"]))[0].reading).toBe("jiāyī'áisi");
  });
});

describe('reduceDumpFile', () => {
  const lines = [
    JSON.stringify(record('書', 'noun', ['shū'], [['书', ['Simplified-Chinese']]])),
    JSON.stringify(record('書', 'verb', ['shū'], [['书', ['Simplified-Chinese']]])),
  ].join('\n');

  function tempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'reduce-wiktionary-'));
  }

  it('reads a gzipped dump and names its SHA-256 as downloaded in the header', async () => {
    const dir = tempDir();
    const dumpPath = path.join(dir, 'raw.jsonl.gz');
    const gz = gzipSync(lines);
    fs.writeFileSync(dumpPath, gz);
    const out = path.join(dir, 'out.tsv');
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await reduceDumpFile([dumpPath, '--dump-date', '2026-10-01', '--extracted', '2026-10-30', '--out', out]);

    const tsv = fs.readFileSync(out, 'utf8');
    const dumpHash = createHash('sha256').update(gz).digest('hex');
    expect(tsv).toContain(`# sha256 ${dumpHash}\n`);
    expect(tsv).toContain('# source https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz\n');
    expect(tsv.split('\n').filter((line) => line && !line.startsWith('#'))).toEqual(['書\t书\tshū\tnoun', '書\t书\tshū\tverb']);
    expect(result).toEqual({ rows: 2, dumpSha256: dumpHash, fileSha256: createHash('sha256').update(tsv).digest('hex') });
  });

  it('reads an uncompressed dump from the URL it is given', async () => {
    const dir = tempDir();
    const dumpPath = path.join(dir, 'zh.jsonl');
    fs.writeFileSync(dumpPath, lines);
    const out = path.join(dir, 'out.tsv');
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await reduceDumpFile([dumpPath, '--dump-date', 'd', '--extracted', 'e', '--url', 'https://example.test/zh.jsonl', '--out', out]);

    expect(fs.readFileSync(out, 'utf8')).toContain('# source https://example.test/zh.jsonl\n');
  });

  it('refuses to run without the dump and its dates', async () => {
    await expect(reduceDumpFile(['--dump-date', '2026-10-01'])).rejects.toThrow(/Usage: reduce-wiktionary/);
    await expect(reduceDumpFile(['dump.jsonl.gz', '--extracted', '2026-10-30'])).rejects.toThrow(/--dump-date/);
  });
});
