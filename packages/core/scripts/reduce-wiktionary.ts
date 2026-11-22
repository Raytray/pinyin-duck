/**
 * Reduces the English Wiktionary wiktextract dump to the part-of-speech rows the dictionary
 * build reads: one (traditional, simplified, reading, part of speech) row per Chinese POS
 * section and Standard Mandarin reading.
 *
 * kaikki.org only serves its latest extraction, so the result is committed as
 * `packages/core/data/wiktionary-pos.tsv` with the dump's date and SHA-256 in its header, and
 * pinned in `sources.ts` like CC-CEDICT. To move to a newer dump:
 *
 *   curl -LO https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz   # about 3 GB
 *   npm run reduce:wiktionary -w @pinyinduck/core -- <path>/raw-wiktextract-data.jsonl.gz \
 *     --dump-date <YYYY-MM-DD> --extracted <YYYY-MM-DD>
 *
 * The two dates are on https://kaikki.org/dictionary/rawdata.html. Then update the file's
 * `sha256` in `sources.ts`, rebuild the dictionary and the parity goldens, and update the dump
 * date in the credits (DATA_LICENSES.md, the web Credits dialog, the Android settings screen).
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Transform } from 'stream';
import { pathToFileURL } from 'url';
import * as zlib from 'zlib';

/** The fields of a wiktextract record this reads. */
export interface WiktextractRecord {
  word?: string;
  pos?: string;
  lang_code?: string;
  forms?: Array<{ form?: string; tags?: string[] }> | null;
  sounds?: Array<{ zh_pron?: string; tags?: string[] }> | null;
}

export interface WiktionaryRow {
  traditional: string;
  simplified: string;
  /** As Wiktionary writes it, in tone-marked pinyin: `xǐhuan`. */
  reading: string;
  /** Wiktionary's part-of-speech header, as wiktextract names it: `noun`, `classifier`. */
  pos: string;
}

/**
 * Headers that are not a word class: a pointer to another page, the per-character
 * "Definitions" section, proper names (a Proper noun sense covers them, #8) and symbols.
 * Leaving them out keeps the committed file about a quarter smaller.
 */
const NOT_A_WORD_CLASS: ReadonlySet<string> = new Set([
  'soft-redirect',
  'character',
  'name',
  'symbol',
  'punct',
  'romanization',
]);

/** A Standard Mandarin pinyin reading, not a dialect's or another romanisation. */
function isStandardPinyin(tags: readonly string[]): boolean {
  return (
    tags.includes('Mandarin') &&
    tags.includes('Pinyin') &&
    (tags.includes('Standard-Chinese') || tags.includes('Standard')) &&
    !tags.includes('dialectal')
  );
}

/** The rows one wiktextract record gives. */
export function wiktionaryRows(record: WiktextractRecord): WiktionaryRow[] {
  const { word, pos } = record;
  if (record.lang_code !== 'zh' || !word || !pos || NOT_A_WORD_CLASS.has(pos)) return [];
  const simplified = (record.forms ?? [])
    .filter((form) => form.form && form.tags?.includes('Simplified-Chinese'))
    .map((form) => form.form!);
  const readings: string[] = [];
  for (const sound of record.sounds ?? []) {
    if (!sound.zh_pron || !isStandardPinyin(sound.tags ?? [])) continue;
    // `mǎ (ma³)`: the head template adds the numbered form in brackets; `língdiǎnwǔ
    // [Phonetic: língdiánwǔ]` notes the tone sandhi. The citation reading comes first.
    const reading = sound.zh_pron.replace(/\s*[([].*$/, '').trim();
    if (reading && !readings.includes(reading)) readings.push(reading);
  }
  return readings.flatMap((reading) =>
    (simplified.length > 0 ? simplified : [word]).map((simp) => ({ traditional: word, simplified: simp, reading, pos }))
  );
}

/** Which dump a reduction came from, written into its header. */
export interface WiktionaryDump {
  url: string;
  /** The date of the enwiktionary dump wiktextract read. */
  dumpDate: string;
  /** The date wiktextract extracted it on. */
  extractedDate: string;
  /** SHA-256 of the downloaded file, lowercase hex. */
  sha256: string;
}

/** A quick test that skips most of the dump's non-Chinese lines before parsing them. */
const MAYBE_CHINESE = /"lang_code":\s*"zh"/;

/**
 * The `traditional, simplified, reading, pos` rows of a wiktextract dump, given as its JSON
 * lines: without duplicates, sorted by headword, each headword's rows in its page's order.
 */
export async function collectWiktionaryRows(lines: Iterable<string> | AsyncIterable<string>): Promise<string[]> {
  const rows = new Map<string, WiktionaryRow>();
  for await (const line of lines) {
    if (!MAYBE_CHINESE.test(line)) continue;
    for (const row of wiktionaryRows(JSON.parse(line) as WiktextractRecord)) {
      const text = [row.traditional, row.simplified, row.reading, row.pos].join('\t');
      if (!rows.has(text)) rows.set(text, row);
    }
  }
  const byHeadword = (a: WiktionaryRow, b: WiktionaryRow) =>
    compare(a.traditional, b.traditional) || compare(a.simplified, b.simplified);
  return [...rows.entries()].sort(([, a], [, b]) => byHeadword(a, b)).map(([text]) => text);
}

/** The reduced file: a header naming the dump, then the rows. */
export function formatWiktionaryTsv(rows: string[], dump: WiktionaryDump): string {
  return [...header(dump), ...rows, ''].join('\n');
}

/** The reduced file of a dump given as its JSON lines. */
export async function reduceWiktionary(
  lines: Iterable<string> | AsyncIterable<string>,
  dump: WiktionaryDump
): Promise<string> {
  return formatWiktionaryTsv(await collectWiktionaryRows(lines), dump);
}

/** Code point order, the same on every machine and locale. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function header(dump: WiktionaryDump): string[] {
  return [
    '# Part of speech of Chinese entries in the English Wiktionary, reduced from the',
    '# wiktextract dump by packages/core/scripts/reduce-wiktionary.ts. Do not edit by hand.',
    '#',
    `# source ${dump.url}`,
    `# dump ${dump.dumpDate} (enwiktionary), extracted ${dump.extractedDate}`,
    `# sha256 ${dump.sha256}`,
    '#',
    '# English Wiktionary contributors, https://en.wiktionary.org/, under CC BY-SA 4.0',
    '# (https://creativecommons.org/licenses/by-sa/4.0/). Extracted with wiktextract',
    '# (Tatu Ylonen, https://github.com/tatuylonen/wiktextract) and published by kaikki.org.',
    '# Changed: only the headword, Standard Mandarin pinyin and part-of-speech header kept.',
    '#',
    '# traditional, simplified, reading (tone-marked pinyin as Wiktionary writes it) and',
    "# wiktextract's part-of-speech name, tab-separated.",
  ];
}

export const RAW_DUMP_URL = 'https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz';
const DEFAULT_OUT = path.resolve(__dirname, '../data/wiktionary-pos.tsv');

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/**
 * The command line: reduces the dump at `args[0]` (gzipped if it ends in `.gz`) and writes
 * the result, by default to `data/wiktionary-pos.tsv`.
 */
export async function reduceDumpFile(
  args: string[]
): Promise<{ rows: number; dumpSha256: string; fileSha256: string }> {
  const input = args[0];
  const dumpDate = flag(args, '--dump-date');
  const extractedDate = flag(args, '--extracted');
  if (!input || input.startsWith('--') || !dumpDate || !extractedDate) {
    throw new Error(
      'Usage: reduce-wiktionary <dump.jsonl[.gz]> --dump-date <YYYY-MM-DD> --extracted <YYYY-MM-DD> ' +
        '[--url <where it was downloaded from>] [--out <tsv>]'
    );
  }
  const out = flag(args, '--out') ?? DEFAULT_OUT;

  // Hash the file as downloaded while it streams through gunzip, so it is read once.
  const hash = createHash('sha256');
  const hashing = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      done(null, chunk);
    },
  });
  let stream: NodeJS.ReadableStream = fs.createReadStream(input).pipe(hashing);
  if (input.endsWith('.gz')) stream = stream.pipe(zlib.createGunzip());
  const rows = await collectWiktionaryRows(readline.createInterface({ input: stream, crlfDelay: Infinity }));

  const dumpSha256 = hash.digest('hex');
  const url = flag(args, '--url') ?? RAW_DUMP_URL;
  const tsv = formatWiktionaryTsv(rows, { url, dumpDate, extractedDate, sha256: dumpSha256 });
  fs.writeFileSync(out, tsv);
  const fileSha256 = createHash('sha256').update(tsv).digest('hex');
  console.log(`Wrote ${rows.length} rows to ${out}`);
  console.log(`  dump sha256 ${dumpSha256}`);
  console.log(`  file sha256 ${fileSha256} (pin this in sources.ts)`);
  return { rows: rows.length, dumpSha256, fileSha256 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reduceDumpFile(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
