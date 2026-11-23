/**
 * Where a Sentence candidate's words may start and end in a query.
 *
 * The lattice's nodes are positions in the toneless query (the key the B+ tree searches
 * on). A word may only span two nodes that are both syllable boundaries in at least one
 * valid split of the query into syllables, not only the split `segmentPinyin` picks:
 * `xian` is xian or xi + an, so 先 and 西安 both get an edge and neither needs a special
 * case. An apostrophe, a space, a hyphen or a tone digit forces a boundary where it was
 * typed, so `xi'an` never offers 先.
 *
 * When the whole query cannot be split (`woxianghekafe`, `woxianghekafeiqqq`), the splits
 * are of its longest splittable prefix, and everything after that prefix is the tail: it is
 * reached only by a prefix completion of the last word, or left to compose.
 */

import { VALID_PINYIN_SYLLABLES, syllableToneEnds, tonelessLetter } from '../parser/pinyin.js';

/** The longest syllable (`zhuang`, `chuang`, `shuang`). */
const MAX_SYLLABLE = 6;

export interface QueryBoundaries {
  /** The query without tones or separators, as `cleanPinyin` gives it. */
  toneless: string;
  /** `nodes[i]`: offset `i` is a syllable boundary on some valid split. Length n + 1. */
  nodes: boolean[];
  /** The end of the longest splittable prefix; `toneless.length` when the whole query splits. */
  end: number;
  /**
   * `forced[i]`: something other than a letter (an apostrophe, a space, a hyphen, a tone
   * digit) was typed at offset `i`. Length n + 1. A word may span offset `i` only when `i`
   * falls between two of its own syllables (`spansForced`).
   */
  forced: boolean[];
}

/**
 * Finds the syllable boundaries of `query` (lowercased, trimmed). Offsets line up with
 * `cleanPinyin(query)` and with `parseToneFilter(query)`.
 */
export function queryBoundaries(query: string): QueryBoundaries {
  const normalized = query.toLowerCase().replace(/u:/g, 'ü').replace(/v/g, 'ü');
  let toneless = '';
  // forced[i]: something other than a letter (a tone digit, an apostrophe, a space) was
  // typed at offset i, so no syllable may run across it.
  const forcedAt = new Set<number>();
  for (const char of normalized) {
    const letter = tonelessLetter(char);
    if (letter !== null) toneless += letter;
    else forcedAt.add(toneless.length);
  }

  const n = toneless.length;
  const forced: boolean[] = Array.from({ length: n + 1 }, (_, i) => forcedAt.has(i));
  const crossesForced = (i: number, j: number): boolean => {
    for (let k = i + 1; k < j; k++) if (forced[k]) return true;
    return false;
  };
  const isSyllable = (i: number, j: number): boolean =>
    !crossesForced(i, j) && VALID_PINYIN_SYLLABLES.has(toneless.slice(i, j));

  const reach: boolean[] = new Array(n + 1).fill(false);
  reach[0] = true;
  let end = 0;
  for (let j = 1; j <= n; j++) {
    for (let i = Math.max(0, j - MAX_SYLLABLE); i < j; i++) {
      if (reach[i] && isSyllable(i, j)) {
        reach[j] = true;
        end = j;
        break;
      }
    }
  }

  // Keep only the boundaries a split of [0, end) passes through.
  const nodes: boolean[] = new Array(n + 1).fill(false);
  nodes[end] = true;
  for (let i = end - 1; i >= 0; i--) {
    if (!reach[i]) continue;
    for (let j = i + 1; j <= Math.min(end, i + MAX_SYLLABLE); j++) {
      if (nodes[j] && isSyllable(i, j)) {
        nodes[i] = true;
        break;
      }
    }
  }
  return { toneless, nodes, end, forced };
}

/**
 * Whether a word read `pinyinNumbers`, placed on `[start, end)` of the query, fits the
 * boundaries typed inside that span: each must fall on one of the word's own syllable ends,
 * so `xi'an` holds 西安 (xi1 an1) but not 先 (xian1).
 */
export function spansForced(pinyinNumbers: string, start: number, end: number, forced: readonly boolean[]): boolean {
  let ends: ReturnType<typeof syllableToneEnds> | null = null;
  for (let k = start + 1; k < end; k++) {
    if (!forced[k]) continue;
    ends ??= syllableToneEnds(pinyinNumbers);
    if (!ends.some(({ offset }) => offset === k - start)) return false;
  }
  return true;
}
