/**
 * CC-CEDICT + Frequency + HSK Dictionary Builder
 *
 * Reads CC-CEDICT (committed under packages/core/data/) and downloads the OpenSubtitles
 * Chinese frequency list and the HSK 2012 word list; joins them on the simplified form; and emits the B-tree asset that
 * `@pinyinduck/core` reads at runtime.
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
import { buildBTree, sortStoredEntries, storedEntryFromRow } from '../src/data/btree-builder.js';
import { BUILD_ID_OFFSET } from '../src/data/btree-codec.js';
import { encodeDetailFile } from '../src/detail/detail-codec.js';
import { SOURCES, type PinnedSource, type VendoredSource } from './sources.js';
import { classifyDefinition, detailRecords, isCommonLine } from './build-detail.js';

const PACKAGE_DIR = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(PACKAGE_DIR, '.cache');
const OUT_DIR = path.resolve(__dirname, '../../web/public');
const DEFAULT_OUT = path.join(OUT_DIR, 'dictionary.btree');
/**
 * The web app imports the compressed copy from here, so Vite gives its production URL
 * a content hash and a browser can cache it for good. Rime, the Android build and the
 * parity generator read the uncompressed asset at `DEFAULT_OUT`.
 */
/**
 * The Candidate detail file, written beside the asset and beside its gzip copy (ADR 0002).
 * The web app fetches the gzip copy on first expand; Android bundles the uncompressed one.
 */
export const DETAIL_FILE_NAME = 'detail.bin';
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
  /** Valid CC-CEDICT lines read. */
  cedictLines: number;
  /** Entries those lines formed, one per (traditional, simplified, caseless reading). */
  entries: number;
  /** Lines folded into an entry an earlier line had already started. */
  merged: number;
  /** B-tree rows written. */
  emitted: number;
  withFrequency: number;
  withHsk: number;
  singleChar: number;
}

/**
 * One headword with one reading: every CC-CEDICT line with the same traditional form,
 * simplified form and pinyin ignoring case (ADR 0001). 書 [Shu1] and 書 [shu1] are one
 * entry; 後 [hou4] and 后 [hou4] are two.
 */
export interface DictionaryEntry {
  /**
   * The entry id: `collectEntries` numbers entries in the file order of their first line,
   * and `joinCorpora` renumbers them in the order the B+ tree stores their rows, which is
   * the id the asset and the Candidate detail file use. The same sources always give the
   * same ids; ids mean nothing across builds (ADR 0002).
   */
  id: number;
  /** Where the entry's first line falls among the entries in CC-CEDICT, from 0. */
  fileOrder: number;
  traditional: string;
  simplified: string;
  /** Lowercased, tone-numbered pinyin shared by every line of the entry. */
  pinyinNumbers: string;
  /** The entry's lines, in file order. */
  lines: RawCedictLine[];
}

/** The key of the entry a line belongs to. */
function entryKey(line: RawCedictLine): string {
  return `${line.traditional}|${line.simplified}|${normalizePinyin(line.pinyin)}`;
}

/**
 * Groups CC-CEDICT lines into entries, numbering them in the file order of their first line.
 */
export function collectEntries(cedictContent: string): DictionaryEntry[] {
  const entries: DictionaryEntry[] = [];
  const byKey = new Map<string, DictionaryEntry>();
  for (const text of cedictContent.split('\n')) {
    const line = parseCedictLine(text);
    if (!line) continue;
    const key = entryKey(line);
    const existing = byKey.get(key);
    if (existing) {
      existing.lines.push(line);
      continue;
    }
    const entry: DictionaryEntry = {
      id: entries.length,
      fileOrder: entries.length,
      traditional: line.traditional,
      simplified: line.simplified,
      pinyinNumbers: normalizePinyin(line.pinyin),
      lines: [line],
    };
    byKey.set(key, entry);
    entries.push(entry);
  }
  return entries;
}

/** A line whose senses include a surname ("surname Zhang"). */
function isSurnameLine(line: RawCedictLine): boolean {
  return line.definitions.some((def) => /^surname\s/i.test(def.trim()));
}

/**
 * The line an entry's short gloss comes from: the first common line that is not a
 * surname, then the first common line, then the first that is not a surname, then the
 * first. 书 [shu1] "book" therefore wins over 书 [Shu1] "abbr. for 书经".
 */
export function glossLine(entry: DictionaryEntry): RawCedictLine {
  const { lines } = entry;
  return (
    lines.find((line) => isCommonLine(line) && !isSurnameLine(line)) ??
    lines.find(isCommonLine) ??
    lines.find((line) => !isSurnameLine(line)) ??
    lines[0]
  );
}

/**
 * Whether an entry ranks as a surname: only when every one of its lines is a surname line.
 *
 * Surnames are very frequent in subtitle corpora because of person names, but someone
 * typing pinyin usually wants the common word, so a surname-only entry has its frequency
 * cut tenfold. An entry with any other sense keeps its full frequency, as the line-by-line
 * dedup this replaced did by keeping the non-surname line.
 */
function isSurnameEntry(entry: DictionaryEntry): boolean {
  return entry.lines.every(isSurnameLine);
}

/**
 * An entry's senses, as its Candidate detail lists them: definitions from its common lines
 * first, then from its proper-noun lines, each in file order, with exact duplicates, tags
 * and measure words left out (see `build-detail.ts`).
 */
export function entrySenses(entry: DictionaryEntry): string[] {
  const ordered = [...entry.lines.filter(isCommonLine), ...entry.lines.filter((l) => !isCommonLine(l))];
  const senses: string[] = [];
  for (const line of ordered) {
    for (const raw of line.definitions) {
      const definition = raw.trim();
      if (!definition || senses.includes(definition)) continue;
      if (classifyDefinition(definition).type === 'sense') senses.push(definition);
    }
  }
  return senses;
}

/** The short gloss of a single entry, from its gloss line. */
export function entryGloss(entry: DictionaryEntry): string {
  return formatGloss(glossLine(entry).definitions);
}

/**
 * Orders the headwords one simplified candidate stands for: most senses first, ties in
 * file order. The candidate's short gloss and its Candidate detail groups both use this.
 */
export function orderHeadwords(entries: DictionaryEntry[]): DictionaryEntry[] {
  const counts = new Map(entries.map((entry) => [entry, entrySenses(entry).length]));
  return [...entries].sort((a, b) => counts.get(b)! - counts.get(a)! || a.fileOrder - b.fileOrder);
}

/**
 * The short gloss of a candidate standing for several headwords: the first sense of each,
 * in headword order, within the usual length limit ("back / empress").
 *
 * A headword with no sense of its own (a variant-only one, say) has no first sense to give,
 * so it is left out: 是 shì is not glossed "to be / variant of 是" because of 昰. When only
 * one headword is left, the candidate takes that headword's own short gloss, as it would if
 * it stood alone; when none is, the first headword's.
 */
export function joinedGloss(ordered: DictionaryEntry[]): string {
  const withSenses = ordered
    .map((entry) => ({ entry, first: entrySenses(entry)[0] }))
    .filter((item): item is { entry: DictionaryEntry; first: string } => item.first !== undefined);
  if (withSenses.length === 0) return entryGloss(ordered[0]);
  if (withSenses.length === 1) return entryGloss(withSenses[0].entry);
  return formatGloss([withSenses.map((item) => formatGloss([item.first], Infinity)).join(' / ')]);
}

/**
 * Joins the three corpora into wire rows.
 *
 * Every entry with a simplified form of its own gets one row for both scripts. When
 * several headwords share a simplified form and reading (後 and 后, both hòu), simplified
 * script shows them as one candidate and traditional script as one each, so the group gets
 * a simplified-only row standing for all of them plus a traditional-only row per headword.
 * Every row lists the entry ids it stands for.
 *
 * Split out from `build` so the merging, join and validation logic can be tested
 * without touching the network or the filesystem.
 */
export function joinCorpora(
  cedictContent: string,
  frequencyContent: string,
  hskContent: string
): { rows: DictionaryRow[]; entries: DictionaryEntry[]; stats: BuildStats } {
  const frequencies = parseFrequencyList(frequencyContent);
  const hskLevels = parseHskList(hskContent);
  const entries = collectEntries(cedictContent);

  // Normalize against the busiest word in the corpus, not a hardcoded constant, so
  // the top of the scale is actually reached regardless of corpus size.
  let corpusMax = 0;
  for (const count of frequencies.values()) {
    if (count > corpusMax) corpusMax = count;
  }

  // Headwords that one simplified candidate stands for, in the file order of their first entry.
  const groups = new Map<string, DictionaryEntry[]>();
  for (const entry of entries) {
    const key = `${entry.simplified}|${entry.pinyinNumbers}`;
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }

  const rows: DictionaryRow[] = [];
  let withFrequency = 0;
  let withHsk = 0;
  let singleChar = 0;

  for (const group of groups.values()) {
    const { simplified, pinyinNumbers } = group[0];
    // Frequency and HSK level are keyed by simplified form, so a group shares them.
    const frequency = normalizeFrequency(frequencies.get(simplified) ?? 0, corpusMax);
    const hskLevel = hskLevels.get(simplified) ?? 0;
    const ranked = (members: DictionaryEntry[]) =>
      members.every(isSurnameEntry) ? Math.round(frequency * 0.1) : frequency;

    if (frequency > 0) withFrequency++;
    if (hskLevel > 0) withHsk++;
    if ([...simplified].length === 1) singleChar++;

    if (group.length === 1) {
      const [entry] = group;
      rows.push([simplified, entry.traditional, pinyinNumbers, entryGloss(entry), ranked(group), hskLevel, [entry.id]]);
      continue;
    }

    const ordered = orderHeadwords(group);
    rows.push([
      simplified,
      ordered[0].traditional,
      pinyinNumbers,
      joinedGloss(ordered),
      ranked(group),
      hskLevel,
      ordered.map((entry) => entry.id),
      'simplified',
    ]);
    for (const entry of group) {
      rows.push([
        simplified,
        entry.traditional,
        pinyinNumbers,
        entryGloss(entry),
        ranked([entry]),
        hskLevel,
        [entry.id],
        'traditional',
      ]);
    }
  }

  renumberInStorageOrder(rows, entries);

  // Sanity check: the B-tree key and the displayed tone marks derive from these columns,
  // so a bad pinyin column here would silently corrupt every downstream candidate.
  for (const row of rows) {
    if (!pinyinNumbersToMarks(row[2]) || !cleanPinyin(row[2])) {
      throw new Error(`Refusing to emit an unparsable pinyin column: ${row[2]}`);
    }
  }

  const cedictLines = entries.reduce((total, entry) => total + entry.lines.length, 0);
  return {
    rows,
    entries,
    stats: {
      cedictLines,
      entries: entries.length,
      merged: cedictLines - entries.length,
      emitted: rows.length,
      withFrequency,
      withHsk,
      singleChar,
    },
  };
}

/**
 * Renumbers entries in the order the B+ tree stores the rows that stand for them, and sorts
 * `entries` by the new id.
 *
 * The tree stores each id as a delta from the one before it in the same leaf, so ids that
 * follow storage order are almost all one byte. Numbered in file order they would be random
 * from row to row and cost about 0.3 MB more in the gzipped web download.
 */
function renumberInStorageOrder(rows: DictionaryRow[], entries: DictionaryEntry[]): void {
  const renumbered = new Map<number, number>();
  for (const stored of sortStoredEntries(rows.map(storedEntryFromRow))) {
    for (const id of stored.entryIds) {
      if (!renumbered.has(id)) renumbered.set(id, renumbered.size);
    }
  }
  for (const row of rows) row[6] = row[6]!.map((id) => renumbered.get(id)!);
  for (const entry of entries) entry.id = renumbered.get(entry.id)!;
  entries.sort((a, b) => a.id - b.id);
}

/**
 * Encodes the rows as the B+ tree asset, stamped with a build id.
 *
 * The id is a hash of the asset written with a zero id, so it changes whenever any row or
 * entry id does and stays the same when nothing did. The Candidate detail file built from
 * the same entries carries the same id, and a reader refuses a pair that differ (ADR 0002).
 */
export function encodeDictionary(rows: DictionaryRow[]): { bytes: Uint8Array; buildId: number } {
  const bytes = buildBTree(rows, { buildId: 0 });
  const digest = createHash('sha256').update(bytes).digest();
  // Zero is what an unstamped tree carries, so it is never a real build's id.
  const buildId = digest.readUInt32LE(0) || 1;
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
    BUILD_ID_OFFSET,
    buildId,
    true
  );
  return { bytes, buildId };
}

/**
 * Writes `bytes` to `outPath` and a gzip copy to `compressedOutPath`, returning each path
 * with its size.
 */
function writeWithGzip(bytes: Uint8Array, outPath: string, compressedOutPath: string): [string, number][] {
  const payload = Buffer.from(bytes);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, payload);
  // The web asset URL is a hash of these bytes, so the same rows must give the same bytes
  // on every machine. Node writes a zero mtime into the gzip header, but zlib stamps the
  // build OS into byte 9 (3 on Unix, 10 on Windows), so that is set to 255, "unknown".
  // The header has no checksum of its own, so nothing else needs to change.
  const compressed = zlib.gzipSync(payload, { level: 9 });
  compressed[9] = 255;
  fs.mkdirSync(path.dirname(compressedOutPath), { recursive: true });
  fs.writeFileSync(compressedOutPath, compressed);
  return [
    [outPath, payload.length],
    [compressedOutPath, compressed.length],
  ];
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

  const { rows, entries, stats } = joinCorpora(cedictContent, frequencyContent, hskContent);

  console.log(
    `\n  corpus  ${parseFrequencyList(frequencyContent).size} frequency entries, ` +
      `${parseHskList(hskContent).size} HSK words`
  );

  const { bytes, buildId } = encodeDictionary(rows);
  const detail = encodeDetailFile(detailRecords(entries, entryGloss), buildId);
  const detailOutPath = path.join(path.dirname(outPath), DETAIL_FILE_NAME);
  const detailCompressedOutPath = path.join(path.dirname(compressedOutPath), `${DETAIL_FILE_NAME}.gz`);
  const written = [
    ...writeWithGzip(bytes, outPath, compressedOutPath),
    ...writeWithGzip(detail, detailOutPath, detailCompressedOutPath),
  ];

  console.log(`\n  parsed  ${stats.cedictLines} CC-CEDICT lines`);
  console.log(`  merged  ${stats.cedictLines} lines into ${stats.entries} entries`);
  console.log(`  emitted ${stats.emitted} rows`);
  console.log(`  coverage ${stats.withFrequency} with frequency, ${stats.withHsk} on the HSK list`);
  console.log(`  coverage ${stats.singleChar} single characters`);
  console.log(`  build   id ${buildId.toString(16).padStart(8, '0')}`);
  for (const [file, size] of written) {
    console.log(`  wrote   ${file} (${(size / 1048576).toFixed(2)}MB)`);
  }
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
