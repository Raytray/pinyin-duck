/**
 * CC-CEDICT + Frequency + HSK Dictionary Builder
 *
 * Reads CC-CEDICT (committed under packages/core/data/) and downloads the OpenSubtitles
 * Chinese frequency list and the HSK 2012 word list; joins them on the simplified form; and emits the B-tree asset that
 * `@pinyinduck/core` loads lazily at runtime.
 *
 * The output is a paged B+ tree (`dictionary.btree`) keyed on toneless pinyin. A
 * client opens it by reading only its header and page directory and decodes just the
 * pages a query touches, so a low-memory Android keyboard can search the full corpus
 * without materializing it.
 *
 * The build also writes a gzip copy (`dictionary.btree.gz`) for the web app, which
 * downloads the whole asset and decompresses it in the browser. Shipping it compressed
 * keeps the download small on hosts that do not compress binary files themselves.
 *
 * Usage:
 *   npm run build:dict                 # download (cached) and emit the B-tree asset
 *   npm run build:dict -- --no-cache   # ignore the local download cache
 *   npm run build:dict -- --out <path> # write the asset (and <path>.gz) somewhere else
 *
 * Sources (each pinned by SHA-256 in ./sources.ts):
 *   CC-CEDICT   https://www.mdbg.net/chinese/export/cedict/ (a dated copy in packages/core/data/)
 *   Frequency   https://github.com/hermitdave/FrequencyWords (2018, zh_cn, 50k)
 *   HSK 2012    https://github.com/gigacool/hanyu-shuiping-kaoshi
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import * as zlib from 'zlib';
import { pinyinNumbersToMarks, cleanPinyin, normalizePinyin } from '../src/parser/pinyin.js';
import { formatGloss } from '../src/dictionary/gloss.js';
import { DictionaryRow } from '../src/data/dictionary-codec.js';
import { buildBTree } from '../src/data/btree-builder.js';
import { SOURCES, type PinnedSource, type VendoredSource } from './sources.js';

const PACKAGE_DIR = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(PACKAGE_DIR, '.cache');
const OUT_DIR = path.resolve(__dirname, '../../web/public');
const DEFAULT_OUT = path.join(OUT_DIR, 'dictionary.btree');
/**
 * The web app imports the compressed copy from here, so Vite gives its production URL
 * a content hash and a browser can cache it for good. Rime, the Android build and the
 * parity generator read the uncompressed asset at `DEFAULT_OUT`.
 */
const DEFAULT_COMPRESSED_OUT = path.resolve(__dirname, '../../web/src/generated/dictionary.btree.gz');

/** The two sources a build downloads. CC-CEDICT is committed rather than downloaded. */
export const SOURCE_URLS = {
  frequency: SOURCES.frequency.url,
  hsk: SOURCES.hsk.url,
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
 * Derived fields (clean pinyin as the B-tree key, tone marks at search time) are
 * recomputed from the pinyin column, so the asset only ever stores the source data.
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

/** SHA-256 of a source's text, as lowercase hex. */
export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Reads a pinned source: a committed file from the repository, a downloaded one from the
 * on-disk cache when it holds the pinned bytes, and otherwise from the network.
 *
 * Every read is checked against the pin. A cache written by an older, unpinned build holds
 * whatever edition was current then, and trusting it would make two checkouts of the same
 * commit build different assets; so a cached copy that does not match is downloaded again
 * rather than used.
 *
 * A committed file or a download that does not match is an error, not a warning: it means
 * the bytes are no longer what this commit was built and tested against.
 */
async function readPinned(source: PinnedSource, useCache: boolean): Promise<string> {
  if ('file' in source) return readVendored(source);

  const { url, cacheName } = source;
  const cachePath = path.join(CACHE_DIR, cacheName);

  if (useCache && fs.existsSync(cachePath)) {
    const cached = fs.readFileSync(cachePath, 'utf8');
    if (sha256(cached) === source.sha256) {
      console.log(`  cached  ${cacheName}`);
      return cached;
    }
    console.log(`  stale   ${cacheName} does not match its pinned SHA-256; downloading it again`);
  }

  console.log(`  fetch   ${cacheName}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const body = await response.text();
  const actual = sha256(body);
  if (actual !== source.sha256) {
    throw new Error(
      `${url} does not match its pinned SHA-256.\n` +
        `  expected ${source.sha256}\n` +
        `  got      ${actual}\n` +
        'The source changed upstream. To move to it on purpose, follow the steps in ' +
        'packages/core/scripts/sources.ts.'
    );
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath, body);
  return body;
}

/** Reads a source committed under `packages/core/`, checked against its pin. */
function readVendored(source: VendoredSource): string {
  const filePath = path.join(PACKAGE_DIR, source.file);
  console.log(`  local   ${source.file}`);
  const text = fs.readFileSync(filePath, 'utf8');
  const actual = sha256(text);
  if (actual !== source.sha256) {
    throw new Error(
      `packages/core/${source.file} does not match its pinned SHA-256.\n` +
        `  expected ${source.sha256}\n` +
        `  got      ${actual}\n` +
        'It must stay byte-for-byte as published; a changed line ending is enough to break ' +
        'it (see .gitattributes). To move to a new edition on purpose, follow the steps in ' +
        'packages/core/scripts/sources.ts.'
    );
  }
  return text;
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
  // Whether each emitted row came from a surname entry, judged on its full definition
  // list. A row only keeps the shortened gloss, so this cannot be recovered from the row.
  const rowIsSurname: boolean[] = [];
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
      // The existing entry is judged by the same rule as the new one (any definition
      // starting "surname "), not by its shortened gloss, which may not start with it.
      const existingIsSurname = rowIsSurname[existingIndex];
      // Row format: [simplified, traditional, pinyinNumbers, shortGloss, frequency, hskLevel]
      const existingFrequency = rows[existingIndex][4];

      if (isSurname && !existingIsSurname) {
        // New entry is surname, existing is not: keep existing, drop new
        dropped++;
        continue;
      } else if (!isSurname && existingIsSurname) {
        // New entry is not surname, existing is: replace existing with new
        rows[existingIndex] = buildDictRow(parsed, adjustedFrequency, hskLevel);
        rowIsSurname[existingIndex] = false;
        dropped++;
        continue;
      } else if (adjustedFrequency > existingFrequency) {
        // Neither or both are surnames: keep the higher frequency one
        rows[existingIndex] = buildDictRow(parsed, adjustedFrequency, hskLevel);
        dropped++;
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
    rowIsSurname.push(isSurname);
  }

  // Sanity check: the B-tree key and the displayed tone marks derive from these columns,
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
  compressedOutPath: string = `${outPath}.gz`
): Promise<BuildStats> {
  const started = Date.now();
  console.log('Building the PinyinDuck dictionary from CC-CEDICT...\n');

  const [cedictContent, frequencyContent, hskContent] = await Promise.all([
    readPinned(SOURCES.cedict, useCache),
    readPinned(SOURCES.frequency, useCache),
    readPinned(SOURCES.hsk, useCache),
  ]);

  const { rows, stats } = joinCorpora(cedictContent, frequencyContent, hskContent);

  console.log(
    `\n  corpus  ${parseFrequencyList(frequencyContent).size} frequency entries, ` +
      `${parseHskList(hskContent).size} HSK words`
  );

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const payload = Buffer.from(buildBTree(rows));
  fs.writeFileSync(outPath, payload);
  // Node writes a zero mtime into the gzip header, so the same rows give the same bytes.
  const compressed = zlib.gzipSync(payload, { level: 9 });
  fs.mkdirSync(path.dirname(compressedOutPath), { recursive: true });
  fs.writeFileSync(compressedOutPath, compressed);

  console.log(`\n  parsed  ${stats.cedictLines} CC-CEDICT lines`);
  console.log(`  emitted ${stats.emitted} rows (${stats.dropped} duplicate readings dropped)`);
  console.log(`  coverage ${stats.withFrequency} with frequency, ${stats.withHsk} on the HSK list`);
  console.log(`  coverage ${stats.singleChar} single characters`);
  console.log(`  wrote   ${outPath} (${(payload.length / 1048576).toFixed(2)}MB)`);
  console.log(`  wrote   ${compressedOutPath} (${(compressed.length / 1048576).toFixed(2)}MB)`);
  console.log('         B+ tree: a client reads only the header and the pages it needs');
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s.`);

  return stats;
}

export interface BuildOptions {
  outPath: string;
  compressedOutPath: string;
  useCache: boolean;
}

/**
 * Resolves the CLI flags into build options.
 *
 * Split out from `main` so the flag handling can be tested without running a build.
 */
export function parseArgs(args: string[]): BuildOptions {
  const outIndex = args.indexOf('--out');
  const customOut = outIndex >= 0 && args[outIndex + 1] ? args[outIndex + 1] : null;
  return {
    outPath: customOut ?? DEFAULT_OUT,
    // A custom asset gets its compressed copy beside it, so a build to a scratch path
    // never overwrites the copy the web app serves.
    compressedOutPath: customOut ? `${customOut}.gz` : DEFAULT_COMPRESSED_OUT,
    useCache: !args.includes('--no-cache'),
  };
}

async function main() {
  const { outPath, compressedOutPath, useCache } = parseArgs(process.argv.slice(2));
  await build(outPath, useCache, compressedOutPath);
}

// pathToFileURL rather than a `file://` template, which never matches a Windows path
// (`C:\...`) or one with a space in it (%20 in the URL).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

export { build };
