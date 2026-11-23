/**
 * Wire format and reader for the bigram table that scores Sentence candidates (#51).
 *
 * The table is an optional sibling of `dictionary.btree`: an engine without it ranks
 * Sentence candidates on unigram frequencies alone. It is built from OpenSubtitles 2018
 * zh_cn, segmented against CC-CEDICT simplified headwords (`scripts/build-bigrams.ts`), and
 * is byte-identical on web and Android.
 *
 * Words are keyed by their **simplified form**, as the B+ tree's `simplified` column spells
 * them, never by entry id: one form covers every reading and headword that shares it (了 le
 * and liǎo, 後 and 后), and the corpus cannot tell them apart. A traditional-script
 * candidate is looked up by its row's simplified form.
 *
 * ## Score
 *
 * Each pair (a, b) stores one integer, computed at build time so neither engine ever calls
 * a floating-point `log`:
 *
 *   score(a, b) = round(SCALE * ln(count(a, b) / count(a)) + OFFSET), clamped to 0
 *
 *   count(a, b)  times b directly follows a in one CJK run of the segmented corpus
 *   count(a)     times a is followed by any dictionary word, the sum of count(a, ·)
 *   SCALE        100000 / ln(1 + max count in the frequency list), the unigram scale
 *   OFFSET       SCALE * ln(total count of the frequency list), header field
 *
 * The dictionary stores a word's frequency as round(SCALE * ln(1 + count(b))), which is
 * about SCALE * ln P(b) + OFFSET. So a pair's score is on the same scale as the unigram
 * frequency of its second word: it is the frequency b would have if it were always as
 * likely as it is after a. A pair that makes b more likely than usual scores above b's
 * frequency, one that makes it less likely scores below. An engine sums the first word's
 * frequency and one bigram score per later word, and on a miss falls back to the later
 * word's frequency minus a penalty (#40 chooses it).
 *
 * The stored score is quantized to a whole number of steps below OFFSET:
 *
 *   stored(a, b) = OFFSET - STEP * round((OFFSET - score(a, b)) / STEP)
 *
 * with STEP a header field (64 in the real build, about 0.01 nat, far below any difference
 * that changes a ranking). `BigramTable.score` returns `stored(a, b)`, so an engine still only
 * sees integers on the frequency scale. A conditional probability is at most 1, so no score
 * is above OFFSET.
 *
 * ## Layout
 *
 *   header (32 bytes)
 *   word offsets  (wordCount + 1) * u32, byte offsets into the word text
 *   word text     the words as UTF-8, back to back, in id order
 *   sorted ids    wordCount * u32, the word ids in sorted order of their words
 *   pair starts   (wordCount + 1) * u32: the pairs whose first word is id i are
 *                 pairStart[i] .. pairStart[i + 1] - 1
 *   second ids    pairCount * u24, the second word of each pair, as three byte planes
 *   steps         pairCount * u16, (OFFSET - stored) / STEP of each pair, as two byte planes
 *
 * Header:
 *   0  4 bytes  magic "PDBG"
 *   4  u8       format version
 *   5  u8, u16  reserved (0)
 *   8  u32      wordCount
 *  12  u32      pairCount
 *  16  u32      wordTextLength, in bytes
 *  20  u32      OFFSET
 *  24  u32      STEP
 *  28  u32      reserved (0)
 *
 * Words are numbered by how many stored pairs use them, most first (ties in sorted order),
 * so the ids that fill the pair table are small. A word's id is found by binary search over
 * the sorted ids, comparing words by their UTF-16 code units (JavaScript's `<`, Kotlin's
 * `String.compareTo`). Within one first word, pairs are sorted by second id, so a pair is
 * found by a second binary search.
 *
 * A column "as byte planes" stores the low byte of every value, then the next byte of every
 * value, and so on: value i of a u24 column at `at` is
 * `b[at + i] | b[at + n + i] << 8 | b[at + 2n + i] << 16` for n values. It is still fixed
 * width, so it can be binary searched in place, and gzip packs it far better than whole
 * values side by side, since the high bytes barely change. Every integer elsewhere is
 * little-endian.
 */

export const BIGRAM_MAGIC = 'PDBG';
export const BIGRAM_FORMAT_VERSION = 1;
export const BIGRAM_HEADER_SIZE = 32;

/** The bound on word ids, which a u24 column holds. */
export const BIGRAM_MAX_WORDS = 0xffffff;
/** The most steps a score can sit below OFFSET, which a u16 column holds. */
export const BIGRAM_MAX_STEPS = 0xffff;

/** One stored word pair. */
export interface BigramPair {
  /** Simplified form of the earlier word. */
  first: string;
  /** Simplified form of the word right after it. */
  second: string;
  /** The precomputed score (see the module comment). */
  score: number;
}

/** The error for a bigram file that cannot be decoded, which a rebuild fixes. */
export function malformedBigramFile(reason: string): Error {
  return new Error(
    `The bigram file is malformed or truncated (${reason}). Run "npm run build:bigrams" to regenerate it.`
  );
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function compareWords(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface EncodeBigramOptions {
  /** OFFSET from the score formula: no score is above it. */
  scoreOffset: number;
  /** STEP: scores are stored as a whole number of steps below OFFSET. */
  scoreStep: number;
}

/**
 * Encodes `pairs` as a bigram file, quantizing each score to `scoreStep`. Pairs may come in
 * any order; a duplicate is an error.
 */
export function encodeBigramFile(pairs: BigramPair[], { scoreOffset, scoreStep }: EncodeBigramOptions): Uint8Array {
  if (!Number.isInteger(scoreStep) || scoreStep < 1 || !Number.isInteger(scoreOffset) || scoreOffset < 0) {
    throw new Error(`scoreOffset ${scoreOffset} and scoreStep ${scoreStep} must be integers, and scoreStep at least 1`);
  }
  const uses = new Map<string, number>();
  for (const pair of pairs) {
    uses.set(pair.first, (uses.get(pair.first) ?? 0) + 1);
    uses.set(pair.second, (uses.get(pair.second) ?? 0) + 1);
  }
  const sortedWords = [...uses.keys()].sort(compareWords);
  if (sortedWords.length > BIGRAM_MAX_WORDS) throw new Error(`Too many bigram words: ${sortedWords.length}`);
  const words = [...sortedWords].sort((a, b) => uses.get(b)! - uses.get(a)! || compareWords(a, b));
  const ids = new Map(words.map((word, id) => [word, id]));

  const sorted = pairs
    .map((pair) => ({ a: ids.get(pair.first)!, b: ids.get(pair.second)!, pair }))
    .sort((x, y) => x.a - y.a || x.b - y.b);
  for (let i = 0; i < sorted.length; i++) {
    const { pair } = sorted[i];
    if (!Number.isInteger(pair.score) || pair.score < 0 || pair.score > scoreOffset) {
      throw new Error(
        `A bigram score must be an integer from 0 to the offset ${scoreOffset}: ${pair.first} ${pair.second} ${pair.score}`
      );
    }
    if (Math.round((scoreOffset - pair.score) / scoreStep) > BIGRAM_MAX_STEPS) {
      throw new Error(
        `The bigram ${pair.first} ${pair.second} scores more than ${BIGRAM_MAX_STEPS} steps of ${scoreStep} below the offset`
      );
    }
    if (i > 0 && sorted[i - 1].a === sorted[i].a && sorted[i - 1].b === sorted[i].b) {
      throw new Error(`The bigram ${pair.first} ${pair.second} is listed twice`);
    }
  }

  const texts = words.map((word) => encoder.encode(word));
  const wordTextLength = texts.reduce((total, text) => total + text.length, 0);
  const wordCount = words.length;
  const pairCount = sorted.length;
  const layout = sections(wordCount, pairCount, wordTextLength);
  const bytes = new Uint8Array(layout.end);
  const view = new DataView(bytes.buffer);

  bytes.set(encoder.encode(BIGRAM_MAGIC), 0);
  view.setUint8(4, BIGRAM_FORMAT_VERSION);
  view.setUint32(8, wordCount, true);
  view.setUint32(12, pairCount, true);
  view.setUint32(16, wordTextLength, true);
  view.setUint32(20, scoreOffset, true);
  view.setUint32(24, scoreStep, true);

  let textOffset = 0;
  texts.forEach((text, id) => {
    view.setUint32(layout.wordOffsets + id * 4, textOffset, true);
    bytes.set(text, layout.wordText + textOffset);
    textOffset += text.length;
  });
  view.setUint32(layout.wordOffsets + wordCount * 4, textOffset, true);
  sortedWords.forEach((word, i) => view.setUint32(layout.sortedIds + i * 4, ids.get(word)!, true));

  let pairIndex = 0;
  for (let id = 0; id <= wordCount; id++) {
    while (pairIndex < pairCount && sorted[pairIndex].a < id) pairIndex++;
    view.setUint32(layout.pairStarts + id * 4, pairIndex, true);
  }
  sorted.forEach(({ b, pair }, i) => {
    const steps = Math.round((scoreOffset - pair.score) / scoreStep);
    for (let k = 0; k < 3; k++) bytes[layout.seconds + k * pairCount + i] = (b >>> (8 * k)) & 0xff;
    for (let k = 0; k < 2; k++) bytes[layout.steps + k * pairCount + i] = (steps >>> (8 * k)) & 0xff;
  });
  return bytes;
}

/** Where each section of a file with these counts starts, and where the file ends. */
function sections(wordCount: number, pairCount: number, wordTextLength: number) {
  const wordOffsets = BIGRAM_HEADER_SIZE;
  const wordText = wordOffsets + (wordCount + 1) * 4;
  const sortedIds = wordText + wordTextLength;
  const pairStarts = sortedIds + wordCount * 4;
  const seconds = pairStarts + (wordCount + 1) * 4;
  const steps = seconds + pairCount * 3;
  return { wordOffsets, wordText, sortedIds, pairStarts, seconds, steps, end: steps + pairCount * 2 };
}

/** A read-only bigram table in memory. */
export class BigramTable {
  private readonly ids: Map<string, number>;

  private constructor(
    private readonly bytes: Uint8Array,
    words: string[],
    private readonly pairStarts: DataView,
    private readonly secondsAt: number,
    private readonly stepsAt: number,
    readonly pairCount: number,
    /** OFFSET from the score formula: SCALE * ln(total count of the frequency list). */
    readonly scoreOffset: number,
    /** STEP: the resolution scores are stored at. */
    readonly scoreStep: number
  ) {
    this.words = words;
    this.ids = new Map(words.map((word, id) => [word, id]));
  }

  private readonly words: string[];

  /** Opens `bytes`, refusing anything that is not a bigram file of this format version. */
  static open(bytes: Uint8Array): BigramTable {
    if (bytes.byteLength < BIGRAM_HEADER_SIZE) throw malformedBigramFile('the header is truncated');
    const magic = String.fromCharCode(...bytes.subarray(0, 4));
    if (magic !== BIGRAM_MAGIC) throw malformedBigramFile('the payload is not a PinyinDuck bigram file');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint8(4);
    if (version !== BIGRAM_FORMAT_VERSION) {
      throw new Error(
        `The bigram file was built with format ${version}, but this reader expects ` +
          `${BIGRAM_FORMAT_VERSION}. Run "npm run build:bigrams" to regenerate it.`
      );
    }
    const wordCount = view.getUint32(8, true);
    const pairCount = view.getUint32(12, true);
    const wordTextLength = view.getUint32(16, true);
    const layout = sections(wordCount, pairCount, wordTextLength);
    if (layout.end !== bytes.byteLength) {
      throw malformedBigramFile(`expected ${layout.end} bytes, found ${bytes.byteLength}`);
    }

    const words: string[] = [];
    for (let id = 0; id < wordCount; id++) {
      const start = view.getUint32(layout.wordOffsets + id * 4, true);
      const end = view.getUint32(layout.wordOffsets + id * 4 + 4, true);
      if (start > end || end > wordTextLength) throw malformedBigramFile(`word ${id} is out of bounds`);
      words.push(decoder.decode(bytes.subarray(layout.wordText + start, layout.wordText + end)));
    }
    // This reader finds ids through a map, but the Android reader binary searches the sorted
    // ids in place, so they are checked here for both.
    for (let i = 0; i < wordCount; i++) {
      const id = view.getUint32(layout.sortedIds + i * 4, true);
      if (id >= wordCount) throw malformedBigramFile(`the sorted word index names word ${id}`);
    }
    const pairStarts = new DataView(bytes.buffer, bytes.byteOffset + layout.pairStarts, (wordCount + 1) * 4);
    if (pairStarts.getUint32(wordCount * 4, true) !== pairCount) {
      throw malformedBigramFile('the pair index does not end at the pair count');
    }
    return new BigramTable(
      bytes,
      words,
      pairStarts,
      layout.seconds,
      layout.steps,
      pairCount,
      view.getUint32(20, true),
      view.getUint32(24, true)
    );
  }

  /** How many distinct words the pairs use. */
  get wordCount(): number {
    return this.words.length;
  }

  private second(i: number): number {
    const { bytes, secondsAt: at, pairCount: n } = this;
    return bytes[at + i] | (bytes[at + n + i] << 8) | (bytes[at + 2 * n + i] << 16);
  }

  private storedScore(i: number): number {
    const { bytes, stepsAt: at, pairCount: n } = this;
    return this.scoreOffset - this.scoreStep * (bytes[at + i] | (bytes[at + n + i] << 8));
  }

  /**
   * The stored score of `second` right after `first`, both simplified forms, or undefined
   * when the table holds no such pair (the engine then backs off to unigram).
   */
  score(first: string, second: string): number | undefined {
    const a = this.ids.get(first);
    const b = this.ids.get(second);
    if (a === undefined || b === undefined) return undefined;
    return this.scoreById(a, b);
  }

  /**
   * The id of a simplified form in this table, or undefined when no pair uses it. A caller
   * scoring many pairs (the Sentence candidate search) resolves each word once and then
   * looks pairs up with `scoreById`.
   */
  wordId(word: string): number | undefined {
    return this.ids.get(word);
  }

  /** Per first word, the best score after it, or -1 until first asked (-2: no pairs). */
  private maxAfter: Int32Array | null = null;

  /**
   * The best score any word reaches right after word `id`, or undefined when no pair starts
   * with it. Worked out the first time each word is asked about and kept, so a search can
   * bound what a predecessor might still add without looking every pair up.
   */
  maxScoreAfter(id: number): number | undefined {
    this.maxAfter ??= new Int32Array(this.words.length).fill(-1);
    let best = this.maxAfter[id];
    if (best === -1) {
      best = -2;
      const end = this.pairStarts.getUint32(id * 4 + 4, true);
      for (let i = this.pairStarts.getUint32(id * 4, true); i < end; i++) best = Math.max(best, this.storedScore(i));
      this.maxAfter[id] = best;
    }
    return best === -2 ? undefined : best;
  }

  /** `score` for two ids from `wordId`. */
  scoreById(a: number, b: number): number | undefined {
    let low = this.pairStarts.getUint32(a * 4, true);
    let high = this.pairStarts.getUint32(a * 4 + 4, true) - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const id = this.second(mid);
      if (id < b) low = mid + 1;
      else if (id > b) high = mid - 1;
      else return this.storedScore(mid);
    }
    return undefined;
  }

  /** Every stored pair, sorted by first word, then second, in id order. */
  *pairs(): Generator<BigramPair> {
    for (let a = 0; a < this.words.length; a++) {
      const end = this.pairStarts.getUint32(a * 4 + 4, true);
      for (let i = this.pairStarts.getUint32(a * 4, true); i < end; i++) {
        yield { first: this.words[a], second: this.words[this.second(i)], score: this.storedScore(i) };
      }
    }
  }
}
