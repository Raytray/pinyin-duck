/**
 * CC-CEDICT + Frequency + HSK Dictionary Builder
 *
 * Downloads CC-CEDICT, the OpenSubtitles Chinese frequency list, and the HSK 2012
 * word list; joins them on the simplified form; and emits the B-tree asset that
 * `@pinyinduck/core` loads lazily at runtime.
 *
 * The default output is a paged B+ tree (`dictionary.btree`) keyed on toneless
 * pinyin. A client opens it by reading only its header and page directory, then
 * fetches the handful of pages a query touches, so a low-memory Android keyboard can
 * search the full corpus without materializing it. The legacy JSON tuple asset
 * (`--format json`) is still emitted for callers that want the whole dictionary in a
 * single parse.
 *
 * Usage:
 *   npm run build:dict                 # download (cached) and emit the B-tree asset
 *   npm run build:dict -- --no-cache   # ignore the local download cache
 *   npm run build:dict -- --out <path> # write the asset somewhere else
 *   npm run build:dict -- --format json # emit the whole-dictionary JSON instead
 *
 * Sources:
 *   CC-CEDICT   https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz
 *   Frequency   https://github.com/hermitdave/FrequencyWords (2018, zh_cn, 50k)
 *   HSK 2012    https://github.com/gigacool/hanyu-shuiping-kaoshi
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { pinyinNumbersToMarks, cleanPinyin, normalizePinyin } from '../src/parser/pinyin.js';
import { formatGloss } from '../src/dictionary/gloss.js';
import { DictionaryRow } from '../src/data/dictionary-codec.js';
import { buildBTree } from '../src/data/btree-builder.js';

const CEDICT_URL =
  'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz';
const FREQUENCY_URL =
  'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/zh_cn/zh_cn_50k.txt';
const HSK_URL = 'https://raw.githubusercontent.com/gigacool/hanyu-shuiping-kaoshi/master/hsk.csv';

const CACHE_DIR = path.resolve(__dirname, '../.cache');
const OUT_DIR = path.resolve(__dirname, '../../web/public');
const DEFAULT_OUT = path.join(OUT_DIR, 'dictionary.btree');
const DEFAULT_JSON_OUT = path.join(OUT_DIR, 'dictionary.json');

/** Asset layouts the builder can emit. */
export type DictionaryFormat = 'btree' | 'json';

/** The three sources a build downloads, in the order they are logged. */
export const SOURCE_URLS = {
  cedict: CEDICT_URL,
  frequency: FREQUENCY_URL,
  hsk: HSK_URL,
} as const;

export interface RawCedictLine {
  traditional: string;
  simplified: string;
  pinyin: string;
  definitions: string[];
}

/**
 * Parses a single line from CC-CEDICT:
 * Format: 傳統 传统 [chuan2 tong3] /tradition/traditional/convention/
 */
export function parseCedictLine(line: string): RawCedictLine | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const match = trimmed.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/\s*$/);
  if (!match) return null;

  const [, traditional, simplified, pinyin, rawDefs] = match;
  const definitions = rawDefs
    .split('/')
    .map((d) => d.trim())
    .filter(Boolean);

  return { traditional, simplified, pinyin, definitions };
}

/**
 * Maps an OpenSubtitles occurrence count onto the 0-100000 scale the ranker expects.
 *
 * Log scaling is required: raw counts span four orders of magnitude, so a linear map
 * would leave every mid-frequency word indistinguishable from zero. Log scaling is
 * monotonic, so relative popularity is preserved, and clamping to the corpus maximum
 * keeps the result inside the documented range.
 */
export function normalizeFrequency(count: number, corpusMax: number): number {
  if (count <= 0 || corpusMax <= 0) return 0;
  const ratio = Math.log1p(count) / Math.log1p(corpusMax);
  return Math.min(100000, Math.max(0, Math.round(100000 * ratio)));
}

/**
 * Builds a compact wire row from a parsed CC-CEDICT line.
 * Derived fields (tone marks, clean pinyin, syllables) are recomputed by the loader
 * so the asset only ever stores the source data.
 */
export function buildDictRow(
  raw: RawCedictLine,
  frequency: number = 0,
  hskLevel: number = 0
): DictionaryRow {
  const pinyinNumbers = normalizePinyin(raw.pinyin);
  const shortGloss = formatGloss(raw.definitions);

  return [
    raw.simplified,
    raw.traditional,
    pinyinNumbers,
    shortGloss,
    frequency,
    hskLevel,
  ];
}

/** Parses the "word count" frequency list into a lookup map. */
export function parseFrequencyList(content: string): Map<string, number> {
  const frequencies = new Map<string, number>();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const space = trimmed.lastIndexOf(' ');
    if (space <= 0) continue;
    const word = trimmed.slice(0, space);
    const count = Number(trimmed.slice(space + 1));
    if (word && Number.isFinite(count)) {
      frequencies.set(word, count);
    }
  }
  return frequencies;
}

/** Parses the tab-separated HSK list (level, id, hanzi, pinyin, translations). */
export function parseHskList(content: string): Map<string, number> {
  const levels = new Map<string, number>();
  for (const line of content.split('\n')) {
    const columns = line.split('\t');
    if (columns.length < 3) continue;
    const level = Number(columns[0]);
    const hanzi = columns[2].trim();
    if (!hanzi || !Number.isInteger(level) || level < 1 || level > 6) continue;
    // Keep the lowest (easiest) level when a word appears more than once.
    const existing = levels.get(hanzi);
    if (existing === undefined || level < existing) {
      levels.set(hanzi, level);
    }
  }
  return levels;
}

/** Fetches a URL, transparently reading through the on-disk cache. */
async function fetchWithCache(
  url: string,
  cacheName: string,
  useCache: boolean
): Promise<string> {
  const cachePath = path.join(CACHE_DIR, cacheName);

  if (useCache && fs.existsSync(cachePath)) {
    console.log(`  cached  ${cacheName}`);
    return fs.readFileSync(cachePath, 'utf8');
  }

  console.log(`  fetch   ${cacheName}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const isGzip = url.endsWith('.gz');
  const body = isGzip
    ? zlib.gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8')
    : await response.text();

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath, body);
  return body;
}

export interface BuildStats {
  cedictLines: number;
  emitted: number;
  withFrequency: number;
  withHsk: number;
  singleChar: number;
  dropped: number;
}

/**
 * Joins the three corpora into wire rows.
 *
 * Split out from `build` so the dedup, join and validation logic can be tested
 * without touching the network or the filesystem.
 */
export function joinCorpora(
  cedictContent: string,
  frequencyContent: string,
  hskContent: string
): { rows: DictionaryRow[]; stats: BuildStats } {
  const frequencies = parseFrequencyList(frequencyContent);
  const hskLevels = parseHskList(hskContent);

  const rows: DictionaryRow[] = [];
  const seen = new Map<string, number>();
  let cedictLines = 0;
  let withFrequency = 0;
  let withHsk = 0;
  let singleChar = 0;
  let dropped = 0;

  // Normalize against the busiest word in the corpus, not a hardcoded constant, so
  // the top of the scale is actually reached regardless of corpus size.
  let corpusMax = 0;
  for (const count of frequencies.values()) {
    if (count > corpusMax) corpusMax = count;
  }

  for (const line of cedictContent.split('\n')) {
    const parsed = parseCedictLine(line);
    if (!parsed) continue;
    cedictLines++;

    // The same word can appear with several readings; each reading is a distinct
    // candidate, but an identical (word, reading) pair must not be repeated.
    const pinyinNumbers = normalizePinyin(parsed.pinyin);
    const key = `${parsed.simplified}|${pinyinNumbers}`;

    const frequency = normalizeFrequency(frequencies.get(parsed.simplified) ?? 0, corpusMax);
    const hskLevel = hskLevels.get(parsed.simplified) ?? 0;

    // Detect surname entries (definitions starting with "surname ") and reduce
    // their frequency so they don't dominate prefix searches. Surnames are extremely
    // frequent in subtitle corpora due to person names, but in an IME context users
    // typing partial pinyin usually want regular vocabulary words first.
    const isSurname = parsed.definitions.some((def) => /^surname\s/i.test(def.trim()));
    const adjustedFrequency = isSurname ? Math.round(frequency * 0.1) : frequency;

    const existingIndex = seen.get(key);
    if (existingIndex !== undefined) {
      // Duplicate reading: prefer the non-surname entry, or the one with higher frequency.
      const existingRow = rows[existingIndex];
      const existingIsSurname = existingRow[3] === 'surname Neng' || existingRow[3]?.startsWith('surname ');
      // Row format: [simplified, traditional, pinyinNumbers, shortGloss, frequency, hskLevel]
      const existingFrequency = existingRow[4];

      if (isSurname && !existingIsSurname) {
        // New entry is surname, existing is not: keep existing, drop new
        dropped++;
        continue;
      } else if (!isSurname && existingIsSurname) {
        // New entry is not surname, existing is: replace existing with new
        rows[existingIndex] = buildDictRow(parsed, adjustedFrequency, hskLevel);
        continue;
      } else if (adjustedFrequency > existingFrequency) {
        // Neither or both are surnames: keep the higher frequency one
        rows[existingIndex] = buildDictRow(parsed, adjustedFrequency, hskLevel);
        continue;
      } else {
        // Keep existing, drop new
        dropped++;
        continue;
      }
    }

    // First time seeing this key
    seen.set(key, rows.length);
    if (frequency > 0) withFrequency++;
    if (hskLevel > 0) withHsk++;
    if ([...parsed.simplified].length === 1) singleChar++;

    rows.push(buildDictRow(parsed, adjustedFrequency, hskLevel));
  }

  // Sanity check: the loader derives tone marks and clean pinyin from these columns,
  // so a bad pinyin column here would silently corrupt every downstream candidate.
  for (const row of rows) {
    if (!pinyinNumbersToMarks(row[2]) || !cleanPinyin(row[2])) {
      throw new Error(`Refusing to emit an unparsable pinyin column: ${row[2]}`);
    }
  }

  return {
    rows,
    stats: { cedictLines, emitted: rows.length, withFrequency, withHsk, singleChar, dropped },
  };
}

async function build(
  outPath: string,
  useCache: boolean,
  format: DictionaryFormat = 'btree'
): Promise<BuildStats> {
  const started = Date.now();
  console.log('Building the PinyinDuck dictionary from CC-CEDICT...\n');

  const [cedictContent, frequencyContent, hskContent] = await Promise.all([
    fetchWithCache(CEDICT_URL, 'cedict.txt', useCache),
    fetchWithCache(FREQUENCY_URL, 'zh_cn_50k.txt', useCache),
    fetchWithCache(HSK_URL, 'hsk.csv', useCache),
  ]);

  const { rows, stats } = joinCorpora(cedictContent, frequencyContent, hskContent);

  console.log(
    `\n  corpus  ${parseFrequencyList(frequencyContent).size} frequency entries, ` +
      `${parseHskList(hskContent).size} HSK words`
  );

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const payload =
    format === 'btree'
      ? Buffer.from(buildBTree(rows))
      : Buffer.from(JSON.stringify(rows), 'utf8');
  fs.writeFileSync(outPath, payload);

  console.log(`\n  parsed  ${stats.cedictLines} CC-CEDICT lines`);
  console.log(`  emitted ${stats.emitted} rows (${stats.dropped} duplicate readings dropped)`);
  console.log(`  coverage ${stats.withFrequency} with frequency, ${stats.withHsk} on the HSK list`);
  console.log(`  coverage ${stats.singleChar} single characters`);
  console.log(
    `  wrote   ${outPath} (${(payload.length / 1048576).toFixed(2)}MB, ${(
      zlib.gzipSync(payload).length /
      1048576
    ).toFixed(2)}MB gzipped)`
  );
  if (format === 'btree') {
    console.log('         B+ tree: a client reads only the header and the pages it needs');
  } else {
    console.log('         JSON: the whole dictionary is parsed into memory at once');
  }
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s.`);

  return stats;
}

export interface BuildOptions {
  outPath: string;
  useCache: boolean;
  format: DictionaryFormat;
}

/**
 * Resolves the CLI flags into build options.
 *
 * Split out from `main` so the flag handling can be tested without running a build.
 */
export function parseArgs(args: string[]): BuildOptions {
  const outIndex = args.indexOf('--out');
  const formatIndex = args.indexOf('--format');
  const format: DictionaryFormat = args[formatIndex + 1] === 'json' ? 'json' : 'btree';
  return {
    useCache: !args.includes('--no-cache'),
    format,
    outPath:
      outIndex >= 0 && args[outIndex + 1]
        ? args[outIndex + 1]
        : format === 'btree'
          ? DEFAULT_OUT
          : DEFAULT_JSON_OUT,
  };
}

async function main() {
  const { outPath, useCache, format } = parseArgs(process.argv.slice(2));
  await build(outPath, useCache, format);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

export { build };
