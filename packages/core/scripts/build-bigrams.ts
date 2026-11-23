/**
 * Bigram table builder for Sentence candidates (#51).
 *
 * Counts word pairs in the OpenSubtitles 2018 zh_cn text, segmented against CC-CEDICT
 * simplified headwords, and writes the bigram table (`bigrams.bin`, with a gzip copy
 * `bigrams.bin.gz` for the web app) beside the dictionary asset. The wire format and the
 * score formula are documented in `src/bigram/bigram-codec.ts`.
 *
 * The table is optional at runtime, so it has its own command rather than riding on
 * `build:dict`: its corpus is a 173 MB download and reading it takes a few minutes.
 *
 * Usage:
 *   npm run build:bigrams                 # download (cached) and emit the bigram table
 *   npm run build:bigrams -- --no-cache   # ignore the local download cache
 *   npm run build:bigrams -- --out <path> # write the table (and <path>.gz) somewhere else
 *
 * Sources (each pinned by SHA-256 in ./sources.ts):
 *   CC-CEDICT       the committed edition, for the headwords
 *   Frequency       hermitdave/FrequencyWords zh_cn_50k, for segmentation and the score scale
 *   OpenSubtitles   OPUS OpenSubtitles v2018 mono zh_cn, the text pairs are counted in
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Readable } from 'stream';
import { pathToFileURL } from 'url';
import * as zlib from 'zlib';
import {
  CACHE_DIR,
  OUT_DIR,
  parseCedictLine,
  parseFrequencyList,
  readPinned,
  sha256,
  writeWithGzip,
} from './build-dictionary.js';
import { SOURCES, type DownloadedArchive } from './sources.js';
import { encodeBigramFile, type BigramPair } from '../src/bigram/bigram-codec.js';

/** The bigram table's file name, beside `dictionary.btree` and beside its gzip copy. */
export const BIGRAM_FILE_NAME = 'bigrams.bin';
const DEFAULT_OUT = path.join(OUT_DIR, BIGRAM_FILE_NAME);
/** Beside `dictionary.btree.gz`, where the web app imports its generated assets from. */
const DEFAULT_COMPRESSED_OUT = path.resolve(__dirname, '../../web/src/generated', `${BIGRAM_FILE_NAME}.gz`);

/** The longest headword, in characters, the segmenter considers. */
export const MAX_WORD_LENGTH = 8;

/** Pairs seen fewer times than this are dropped (#26: about 0.93 M pairs at 5). */
export const MIN_PAIR_COUNT = 5;

/**
 * STEP: the file stores scores to this resolution. 64 is about 0.01 nat on the unigram
 * scale, and it brings the gzip copy from 3.4 MB at full resolution to about 2.2 MB.
 */
export const SCORE_STEP = 64;

/**
 * The count a headword missing from the frequency list is segmented with: below every
 * listed word, so a listed split beats an unlisted word only when it is much more likely.
 */
const UNLISTED_COUNT = 1;

/**
 * The count a character that is no headword at all is segmented with, well below any
 * headword, so the segmenter only falls back to it when nothing covers the character.
 */
const NO_HEADWORD_COUNT = 0.01;

/** Word ids are packed two to a pair key, so they must stay below this. */
const ID_LIMIT = 1 << 17;

interface TrieNode {
  children: Map<number, TrieNode>;
  /** Set when the path to this node spells a headword. */
  word?: { id: number; logProbability: number };
}

const HAN_RUN = /\p{Script=Han}+/gu;
const ALL_HAN = /^\p{Script=Han}+$/u;

/**
 * Segments subtitle lines over CC-CEDICT simplified headwords and counts adjacent pairs.
 *
 * Segmentation is the most probable split of each run of Hanzi, where a word's probability
 * is its count in the frequency list (the one the dictionary ranks with) over the list's
 * total. Pairs are counted only between neighbouring headwords in one run, so punctuation,
 * Latin text and a character that is no headword all break the context.
 */
export class BigramCounter {
  private readonly root: TrieNode = { children: new Map() };
  private readonly words: string[] = [];
  private readonly noHeadwordLogProbability: number;
  /** count(a, b), keyed by a * ID_LIMIT + b. */
  private readonly pairCounts = new Map<number, number>();
  /** count(a): how many pairs start with a. */
  private leftCounts = new Float64Array(0);
  /** SCALE in the score formula: the dictionary's unigram scale. */
  readonly scale: number;
  /** OFFSET in the score formula: SCALE * ln(total count of the frequency list). */
  readonly scoreOffset: number;

  constructor(cedictContent: string, frequencyContent: string) {
    const frequencies = parseFrequencyList(frequencyContent);
    let total = 0;
    let max = 0;
    for (const count of frequencies.values()) {
      total += count;
      if (count > max) max = count;
    }
    this.scale = 100000 / Math.log1p(max);
    this.scoreOffset = Math.round(this.scale * Math.log(total));
    const logTotal = Math.log(total);
    this.noHeadwordLogProbability = Math.log(NO_HEADWORD_COUNT) - logTotal;

    for (const text of cedictContent.split('\n')) {
      const line = parseCedictLine(text);
      if (!line) continue;
      const word = line.simplified;
      const chars = [...word];
      if (chars.length > MAX_WORD_LENGTH || !ALL_HAN.test(word)) continue;
      let node = this.root;
      for (const char of chars) {
        const code = char.codePointAt(0)!;
        let child = node.children.get(code);
        if (!child) {
          child = { children: new Map() };
          node.children.set(code, child);
        }
        node = child;
      }
      if (node.word) continue;
      const count = frequencies.get(word) ?? UNLISTED_COUNT;
      node.word = { id: this.words.length, logProbability: Math.log(count) - logTotal };
      this.words.push(word);
    }
    if (this.words.length >= ID_LIMIT) throw new Error(`Too many headwords to count pairs of: ${this.words.length}`);
    this.leftCounts = new Float64Array(this.words.length);
  }

  /**
   * The runs of consecutive headwords in `line`, in order. A run ends at anything that is
   * not a Hanzi and at a Hanzi that is no headword.
   */
  segment(line: string): string[][] {
    return this.segmentIds(line).map((run) => run.map((id) => this.words[id]));
  }

  private segmentIds(line: string): number[][] {
    const runs: number[][] = [];
    for (const match of line.matchAll(HAN_RUN)) {
      const codes = Array.from(match[0], (char) => char.codePointAt(0)!);
      const n = codes.length;
      const best = new Float64Array(n + 1).fill(-Infinity);
      // The start of the word ending at each position, and its id (-1 for no headword).
      const from = new Int32Array(n + 1);
      const ids = new Int32Array(n + 1);
      best[0] = 0;
      for (let i = 0; i < n; i++) {
        const base = best[i];
        const fallback = base + this.noHeadwordLogProbability;
        if (fallback > best[i + 1]) {
          best[i + 1] = fallback;
          from[i + 1] = i;
          ids[i + 1] = -1;
        }
        let node: TrieNode | undefined = this.root;
        for (let j = i; j < n && j - i < MAX_WORD_LENGTH; j++) {
          node = node.children.get(codes[j]);
          if (!node) break;
          if (node.word) {
            const score = base + node.word.logProbability;
            if (score > best[j + 1]) {
              best[j + 1] = score;
              from[j + 1] = i;
              ids[j + 1] = node.word.id;
            }
          }
        }
      }
      const reversed: number[][] = [[]];
      for (let end = n; end > 0; end = from[end]) {
        if (ids[end] < 0) reversed.push([]);
        else reversed[reversed.length - 1].push(ids[end]);
      }
      for (let r = reversed.length - 1; r >= 0; r--) {
        if (reversed[r].length > 0) runs.push(reversed[r].reverse());
      }
    }
    return runs;
  }

  /** Counts the pairs in one line of text. */
  addLine(line: string): void {
    for (const run of this.segmentIds(line)) {
      for (let i = 1; i < run.length; i++) {
        const key = run[i - 1] * ID_LIMIT + run[i];
        this.pairCounts.set(key, (this.pairCounts.get(key) ?? 0) + 1);
        this.leftCounts[run[i - 1]]++;
      }
    }
  }

  /** How many distinct pairs have been seen, before pruning. */
  get distinctPairs(): number {
    return this.pairCounts.size;
  }

  /**
   * The pairs seen at least `minCount` times, each with its score:
   * round(SCALE * ln(count(a, b) / count(a)) + OFFSET), clamped to 0. It is never above
   * OFFSET, since count(a, b) is at most count(a).
   * count(a) counts every pair seen, pruned or not, so pruning never inflates a score.
   */
  pairs(minCount: number = MIN_PAIR_COUNT): BigramPair[] {
    const pairs: BigramPair[] = [];
    for (const [key, count] of this.pairCounts) {
      if (count < minCount) continue;
      const a = Math.floor(key / ID_LIMIT);
      const b = key % ID_LIMIT;
      const raw = Math.round(this.scale * Math.log(count / this.leftCounts[a]) + this.scoreOffset);
      pairs.push({ first: this.words[a], second: this.words[b], score: Math.max(0, raw) });
    }
    return pairs;
  }
}

/**
 * Reads a pinned gzip download as bytes: from the cache when it holds the pinned bytes,
 * otherwise from the network, checked against the pin either way (see `readPinned`).
 */
async function readPinnedArchive(source: DownloadedArchive, useCache: boolean): Promise<Uint8Array> {
  const cachePath = path.join(CACHE_DIR, source.cacheName);
  if (useCache && fs.existsSync(cachePath)) {
    const cached = new Uint8Array(fs.readFileSync(cachePath));
    if (sha256(cached) === source.sha256) {
      console.log(`  cached  ${source.cacheName}`);
      return cached;
    }
    console.log(`  stale   ${source.cacheName} does not match its pinned SHA-256; downloading it again`);
  }

  console.log(`  fetch   ${source.cacheName} (about 173 MB)`);
  const response = await fetch(source.url);
  if (!response.ok) {
    throw new Error(`Failed to download ${source.url}: ${response.status} ${response.statusText}`);
  }
  const body = new Uint8Array(await response.arrayBuffer());
  const actual = sha256(body);
  if (actual !== source.sha256) {
    throw new Error(
      `${source.url} does not match its pinned SHA-256.\n` +
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

export interface BigramBuildStats {
  /** Corpus lines read. */
  lines: number;
  /** Distinct pairs counted, before pruning. */
  distinctPairs: number;
  /** Pairs written, seen at least `MIN_PAIR_COUNT` times. */
  keptPairs: number;
}

export interface BigramBuildOptions {
  outPath: string;
  compressedOutPath: string;
  useCache: boolean;
}

/** Counts the corpus and writes the bigram table and its gzip copy. */
export async function build({ outPath, compressedOutPath, useCache }: BigramBuildOptions): Promise<BigramBuildStats> {
  const started = Date.now();
  console.log('Building the PinyinDuck bigram table from OpenSubtitles...\n');

  const [cedictContent, frequencyContent] = await Promise.all([
    readPinned(SOURCES.cedict, useCache),
    readPinned(SOURCES.frequency, useCache),
  ]);
  const corpus = await readPinnedArchive(SOURCES.opensubtitles, useCache);

  const counter = new BigramCounter(cedictContent, frequencyContent);
  const lines = readline.createInterface({
    input: Readable.from([corpus]).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  let lineCount = 0;
  for await (const line of lines) {
    counter.addLine(line);
    lineCount++;
  }

  const pairs = counter.pairs(MIN_PAIR_COUNT);
  const bytes = encodeBigramFile(pairs, { scoreOffset: counter.scoreOffset, scoreStep: SCORE_STEP });
  const written = writeWithGzip(bytes, outPath, compressedOutPath);

  console.log(`\n  counted ${counter.distinctPairs} distinct pairs in ${lineCount} lines`);
  console.log(`  kept    ${pairs.length} pairs seen at least ${MIN_PAIR_COUNT} times`);
  console.log(`  score   offset ${counter.scoreOffset}, step ${SCORE_STEP}, scale ${counter.scale.toFixed(3)} per nat`);
  for (const [file, size] of written) {
    console.log(`  wrote   ${file} (${(size / 1048576).toFixed(2)}MB)`);
  }
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  return { lines: lineCount, distinctPairs: counter.distinctPairs, keptPairs: pairs.length };
}

/** Resolves the CLI flags into build options, as `build-dictionary.ts` does. */
export function parseArgs(args: string[]): BigramBuildOptions {
  const outIndex = args.indexOf('--out');
  const customOut = outIndex >= 0 && args[outIndex + 1] ? args[outIndex + 1] : null;
  return {
    outPath: customOut ?? DEFAULT_OUT,
    compressedOutPath: customOut ? `${customOut}.gz` : DEFAULT_COMPRESSED_OUT,
    useCache: !args.includes('--no-cache'),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  build(parseArgs(process.argv.slice(2))).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
