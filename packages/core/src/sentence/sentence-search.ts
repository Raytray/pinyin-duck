/**
 * Sentence candidates: the best run of dictionary words covering a query from its start
 * (issues #29, #30 and #50).
 *
 * 1. **Lattice.** Nodes are the syllable boundaries `queryBoundaries` finds. An edge is an
 *    entry whose key is exactly the span between two nodes, shown in the active script, with
 *    the entries in one span that show the same Hanzi collapsed to the best one (the
 *    `compareScored` chain on frequency, as the word list picks a reading for a Hanzi).
 *    Words rarer than `MIN_SENTENCE_WORD_FREQUENCY` are dropped, and so is any edge a typed
 *    tone rules out, or that runs across a typed apostrophe or space anywhere but between
 *    its own syllables (`xi'an` holds 西安, never 先; `spansForced`). The last word alone may also be a prefix completion that runs past the
 *    end of the query (`kafe` → 咖啡), found with one `scanPrefix` from each node whose
 *    tail holds a vowel (a bare initial such as `z` is not completed; see below).
 * 2. **Score.** A path scores the first word's stored frequency, plus for each later word its
 *    bigram score after the word before it, or on a miss its stored frequency minus
 *    `BIGRAM_BACKOFF_PENALTY`, minus `wordCost` per word. All integers. With no bigram table
 *    every pair is a miss with no penalty, so the score is unigram only.
 * 3. **Search.** 1-best Viterbi over edges (the state is the last word, which the next
 *    bigram needs). A path reaching the end of the query is a full Sentence candidate;
 *    otherwise the best path to the furthest node is a partial one when it has two or more
 *    words. Only paths of two or more words are sentences: one word is a word candidate.
 *
 * Everything is integer arithmetic and every tie is broken by a fixed order, because the
 * Kotlin engine ports this and the parity golden pins the two to the same output.
 */

import type { FixedWord, ScriptType } from '../types.js';
import type { BTreeDictionary } from '../data/btree-dictionary.js';
import type { StoredEntry } from '../data/btree-codec.js';
import type { BigramTable } from '../bigram/bigram-codec.js';
import { cleanPinyin, syllableToneEnds, type ToneConstraint } from '../parser/pinyin.js';
import { DEFAULT_MAX_MATCHES, hanziIn } from '../index/ranking.js';
import { isSpanIn, queryBoundaries, spansForced, type QueryBoundaries } from './lattice.js';

/**
 * The bias toward fewer words, added to the dictionary's base word cost (the scaled
 * ln(corpus total) in the B+ tree header, 119,936 for the shipped corpus).
 *
 * The base cost alone turns stored frequencies and bigram scores into scaled
 * log-probabilities, so a path of several words is weighed against a one-word path on
 * likelihood. The extra is what a sentence must clear beyond that to displace a word that
 * covers the whole query. On the shipped corpus, with the bigram table and the penalty below:
 *   - `zhongwen` sets the floor: 中 + 文字 (文字 by prefix completion, bigram hit 62,976)
 *     against 中文 (40,736) needs a total cost above 94,960, so the extra must exceed
 *     −24,976. (中 + 文 and 你 + 好 would bind harder, but they repeat the words 中文 and
 *     你好, and a sentence repeating a word is dropped.)
 *   - `woshi` sets the ceiling: 我 + 是 (hit 98,048) against 卧室 (50,182) needs a cost
 *     below 147,369, so the extra must stay under 27,433.
 * 0 sits near the middle of that window, about 25k from each edge, and leaves the path
 * score a plain log-probability; nothing in the cases asks for a lean either way.
 */
export const EXTRA_WORD_COST = 0;

/**
 * What a bigram miss costs: a word that followed the one before it fewer than five times in
 * the bigram corpus scores its unigram frequency minus this.
 *
 * Over the pairs the table keeps, a hit scores a median 12,492 above the second word's
 * unigram frequency (p25 3,942, p75 24,889). A miss is a pair the corpus saw rarely or
 * never, so it should land below unigram rather than at it, and 12,000 (that median,
 * rounded) makes a miss about as much worse than unigram as a typical hit is better. The
 * nine acceptance cases all pass for any penalty from 0 to at least 60,000, so they do not
 * pin it; the median is the corpus's own answer.
 */
export const BIGRAM_BACKOFF_PENALTY = 12000;

/**
 * Words rarer than this never appear inside a Sentence candidate.
 *
 * A word with stored frequency 0 is missing from the frequency list, so nothing says how
 * likely it is, while every listed word stores at least about 27,000 (the 50,000th word of
 * the list still appears a few dozen times). 1 therefore keeps every word the corpus
 * counted and drops exactly the unlisted ones, such as 睨视, 卧式 and 中国人, which still
 * rank as one-word paths among the word candidates. The cases tolerate a cutoff up to
 * 59,813 (咖啡); higher ones would start dropping everyday words for no case that needs it.
 */
export const MIN_SENTENCE_WORD_FREQUENCY = 1;

/** A toneless tail with a vowel in it, the point where completing the last word starts. */
const HAS_VOWEL = /[aeiouü]/;

/** One word of a Sentence candidate, or a fixed word resolved to its stored entry. */
export interface SentenceWord {
  entry: StoredEntry;
  /** Where the word starts and ends in the toneless query. */
  start: number;
  end: number;
}

export interface SentenceResult {
  words: SentenceWord[];
  /** The path score: comparable with a single word's `oneWordPathScore`. */
  score: number;
  /** How much of the toneless query the sentence covers (all of it, or the end of a partial). */
  covered: number;
  /** True when the sentence covers (or, by completion, completes) the whole query. */
  full: boolean;
  /** True when the sentence holds at least one fixed word, which makes it the edited sentence. */
  fixed: boolean;
}

export interface SentenceSearchOptions {
  script: ScriptType;
  toneFilter: readonly ToneConstraint[];
  bigrams?: BigramTable;
  /** Turns prefix completion of the last word off. */
  exactOnly?: boolean;
  maxMatches?: number;
  /** Words the learner fixed on their spans; see `SearchOptions.fixedWords`. */
  fixedWords?: readonly FixedWord[];
}

/** The cost charged per word: the dictionary's base word cost plus the extra bias. */
export function wordCost(dictionary: BTreeDictionary): number {
  return dictionary.baseWordCost + EXTRA_WORD_COST;
}

/** A single word scored as a one-word path, to compare with a sentence's score. */
export function oneWordPathScore(frequency: number, cost: number): number {
  return frequency - cost;
}

interface Edge {
  entry: StoredEntry;
  start: number;
  end: number;
  /** Position in the fixed edge order, the last tie-breaker. */
  order: number;
  /** The word's id in the bigram table, resolved once; undefined when no pair uses it. */
  bigramId: number | undefined;
}

interface State {
  score: number;
  words: number;
  previous: State | null;
  edge: Edge;
  /** The last word's edge order, the last tie-breaker between states. */
  order: number;
}

/** Whether `entry` fits every typed tone that falls inside the span starting at `start`. */
function fitsTones(entry: StoredEntry, start: number, toneFilter: readonly ToneConstraint[]): boolean {
  if (toneFilter.length === 0) return true;
  const length = entry.key.length;
  let ends: ToneConstraint[] | null = null;
  for (const constraint of toneFilter) {
    const offset = constraint.offset - start;
    if (offset <= 0 || offset > length) continue;
    ends ??= syllableToneEnds(entry.pinyinNumbers);
    const syllable = ends.find((end) => end.offset === offset);
    if (!syllable || syllable.tone !== constraint.tone) return false;
  }
  return true;
}

/**
 * Resolves the fixed words the query can honor, sorted by start. One is honored when both ends
 * of its span are lattice nodes (or, for a completed last word, the span runs to the end of
 * the query and the key is longer), its entry is stored under that key and shown in the
 * active script, and the typed tones and boundaries allow it. A fixed word skips
 * `MIN_SENTENCE_WORD_FREQUENCY`: the learner chose it. One that overlaps a word honored
 * earlier in the list is ignored.
 */
function resolveFixedWords(
  dictionary: BTreeDictionary,
  fixedWords: readonly FixedWord[],
  lattice: QueryBoundaries,
  options: { script: ScriptType; toneFilter: readonly ToneConstraint[]; exactOnly?: boolean }
): SentenceWord[] {
  const { toneless, nodes, end, forced } = lattice;
  const n = toneless.length;
  const resolved: SentenceWord[] = [];
  for (const { span, word } of fixedWords) {
    if (!isSpanIn(span, n)) continue;
    const { start, end: stop } = span;
    if (start > end || (start !== 0 && !nodes[start])) continue;
    if (resolved.some((other) => start < other.end && stop > other.start)) continue;
    const typed = toneless.slice(start, stop);
    const key = cleanPinyin(word.pinyinNumbers);
    const exact = key === typed && stop <= end && nodes[stop];
    const completes = !options.exactOnly && stop === n && key.length > typed.length && key.startsWith(typed);
    if (!exact && !completes) continue;
    let entry: StoredEntry | undefined;
    for (const stored of dictionary.lookupExact(key)) {
      if (stored.onlyIn && stored.onlyIn !== options.script) continue;
      if (stored.simplified !== word.simplified || stored.traditional !== word.traditional) continue;
      if (stored.pinyinNumbers !== word.pinyinNumbers) continue;
      entry = stored;
      break;
    }
    if (!entry || !fitsTones(entry, start, options.toneFilter)) continue;
    if (!spansForced(entry.pinyinNumbers, start, stop, forced)) continue;
    resolved.push({ entry, start, end: stop });
  }
  return resolved.sort((a, b) => a.start - b.start);
}

/** Keeps the best entry per displayed Hanzi, in the order `compareScored` ranks them. */
function collapse(
  entries: Iterable<StoredEntry>,
  script: ScriptType,
  span: { start: number; end: number; forced: readonly boolean[] },
  toneFilter: readonly ToneConstraint[]
): StoredEntry[] {
  const { start, end, forced } = span;
  const best = new Map<string, StoredEntry>();
  for (const entry of entries) {
    if (entry.onlyIn && entry.onlyIn !== script) continue;
    if (entry.frequency < MIN_SENTENCE_WORD_FREQUENCY || !fitsTones(entry, start, toneFilter)) continue;
    if (!spansForced(entry.pinyinNumbers, start, end, forced)) continue;
    const hanzi = hanziIn(entry, script);
    const previous = best.get(hanzi);
    if (!previous || compareEntries(entry, previous) < 0) best.set(hanzi, entry);
  }
  return [...best.values()].sort(compareEntries);
}

/**
 * The `compareScored` chain with frequency as the score (frequency, then key, form, reading
 * and traditional form), written out so collapsing thousands of completions allocates nothing.
 */
function compareEntries(a: StoredEntry, b: StoredEntry): number {
  if (a.frequency !== b.frequency) return b.frequency - a.frequency;
  if (a.key !== b.key) return a.key < b.key ? -1 : 1;
  if (a.simplified !== b.simplified) return a.simplified < b.simplified ? -1 : 1;
  if (a.pinyinNumbers !== b.pinyinNumbers) return a.pinyinNumbers < b.pinyinNumbers ? -1 : 1;
  if (a.traditional !== b.traditional) return a.traditional < b.traditional ? -1 : 1;
  return 0;
}

/**
 * True when `a` is a better state than `b`: higher score, then fewer words, then the earlier
 * edge (or, for two paths into one edge, the predecessor met first in the sorted order).
 */
function better(a: State, b: State): boolean {
  if (a.score !== b.score) return a.score > b.score;
  if (a.words !== b.words) return a.words < b.words;
  return a.order < b.order;
}

/**
 * Finds the Sentence candidate for `query` (trimmed and lowercased), or null when no path of
 * two or more words can be built with confidence.
 */
export function findSentence(
  dictionary: BTreeDictionary,
  query: string,
  options: SentenceSearchOptions
): SentenceResult | null {
  const { script, toneFilter, bigrams } = options;
  const maxMatches = options.maxMatches ?? DEFAULT_MAX_MATCHES;
  const boundaries = queryBoundaries(query);
  const { toneless, nodes, end, forced } = boundaries;
  const n = toneless.length;
  if (n === 0) return null;
  const cost = wordCost(dictionary);
  const penalty = bigrams ? BIGRAM_BACKOFF_PENALTY : 0;
  const maxBigram = bigrams ? bigrams.scoreOffset : 0;
  // Fixed words force their edge: no other word may start, end or lie inside their span,
  // so every path past a fixed word's start goes through it, and the best path is found
  // before and after it as usual.
  const fixed = resolveFixedWords(dictionary, options.fixedWords ?? [], boundaries, options);
  const fixedAt = new Map(fixed.map((word) => [word.start, word]));
  const insideFixed = (i: number) => fixed.some((word) => i > word.start && i < word.end);
  /** The first fixed word starting after `i`, where every other edge from `i` must stop. */
  const nextFixedStart = (i: number) => fixed.find((word) => word.start > i)?.start ?? Infinity;

  // Edges by start node, in the fixed order: shorter spans first, then completions, each
  // span in `compareScored` order.
  const outgoing: Edge[][] = Array.from({ length: n + 1 }, () => []);
  let order = 0;
  const addEdges = (start: number, entries: StoredEntry[], end: number) => {
    for (const entry of entries) {
      const bigramId = bigrams?.wordId(entry.simplified);
      outgoing[start].push({ entry, start, end, order: order++, bigramId });
    }
  };

  // States by the node their last word ends at.
  const incoming: State[][] = Array.from({ length: n + 1 }, () => []);
  const reached: boolean[] = new Array(n + 1).fill(false);
  reached[0] = true;
  // The best full sentence so far (two or more words ending at n).
  let finalBest: State | null = null;

  for (let i = 0; i < n; i++) {
    if (!nodes[i] && i !== 0) continue;
    if (!reached[i]) continue;
    // Edges are built only from nodes a path reaches, so an unreachable stretch costs no lookups.
    const fixedHere = fixedAt.get(i);
    if (fixedHere) addEdges(i, [fixedHere.entry], fixedHere.end);
    const stop = fixedHere || insideFixed(i) ? -1 : Math.min(end, nextFixedStart(i));
    for (let j = i + 1; j <= stop; j++) {
      if (!nodes[j]) continue;
      addEdges(i, collapse(dictionary.lookupExact(toneless.slice(i, j)), script, { start: i, end: j, forced }, toneFilter), j);
    }
    const tail = toneless.slice(i);
    // Amendment to #29's completion rule: a tail that is only a consonant initial so far
    // (`z`, `zh`, `j`, a lone `w`) is not completed. It says little about the word, and
    // scanning it walks every key under that letter (2,138 Hanzi for `z`), which made those
    // keystrokes the slowest. Completion starts once the tail holds a vowel, so `kaf` still
    // gives 咖啡; the bare initial stays to compose, after a partial sentence if there is one.
    if (!options.exactOnly && i > 0 && stop >= 0 && nextFixedStart(i) === Infinity && HAS_VOWEL.test(tail)) {
      // A completion of the last word: a key that starts with the rest of the query and runs past it.
      const found: StoredEntry[] = [];
      dictionary.scanPrefixWithin(tail, maxMatches, (entry) => {
        if (entry.key.length > tail.length) found.push(entry);
      });
      addEdges(i, collapse(found, script, { start: i, end: n, forced }, toneFilter), n);
    }

    const previous = incoming[i].slice().sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
    for (const edge of outgoing[i]) {
      const frequency = edge.entry.frequency;
      let best: State | null = null;
      if (i === 0) {
        best = { score: frequency - cost, words: 1, previous: null, edge, order: edge.order };
      } else if (edge.bigramId === undefined || previous.length === 0) {
        // No pair ends in this word, so every transition is a miss and adds the same amount:
        // the best predecessor stays best.
        const prior = previous[0];
        if (prior) {
          const score = prior.score + frequency - penalty - cost;
          best = { score, words: prior.words + 1, previous: prior, edge, order: edge.order };
        }
      } else {
        // Nothing follows a word that ends the query, so such a state only matters if it can
        // beat the best full sentence found so far: the bar is that, not this edge's best.
        const endsQuery = edge.end === n;
        const ceiling = Math.max(maxBigram, frequency - penalty);
        for (const prior of previous) {
          // Sorted by score, so once even the best possible transition cannot beat the
          // bar, no later predecessor can either.
          const target = endsQuery && finalBest && (!best || better(finalBest, best)) ? finalBest : best;
          if (target && prior.score + ceiling - cost < target.score) break;
          const priorId = prior.edge.bigramId;
          const reach = priorId === undefined ? undefined : bigrams!.maxScoreAfter(priorId);
          // This predecessor's own bound: its best bigram, or a miss.
          if (target && prior.score + Math.max(reach ?? -Infinity, frequency - penalty) - cost < target.score) continue;
          const hit = reach === undefined ? undefined : bigrams!.scoreById(priorId!, edge.bigramId);
          const score = prior.score + (hit ?? frequency - penalty) - cost;
          const candidate = { score, words: prior.words + 1, previous: prior, edge, order: edge.order };
          if (!best || better(candidate, best)) best = candidate;
        }
      }
      if (!best) continue;
      incoming[edge.end].push(best);
      reached[edge.end] = true;
      if (edge.end === n && best.words >= 2 && (!finalBest || better(best, finalBest))) finalBest = best;
    }
  }

  const pick = (states: State[], minWords: number): State | null => {
    let best: State | null = null;
    for (const state of states) {
      if (state.words < minWords) continue;
      if (!best || better(state, best)) best = state;
    }
    return best;
  };

  // An edited sentence keeps the learner's choice even when it is a single word.
  const minWords = fixed.length > 0 ? 1 : 2;
  // A path ending before the last fixed word does not include it.
  const lastFixedEnd = fixed.length > 0 ? fixed[fixed.length - 1].end : 0;
  let final: State | null = pick(incoming[n], minWords);
  let full = final !== null;
  if (!final) {
    let furthest = n - 1;
    while (furthest > 0 && incoming[furthest].length === 0) furthest--;
    if (furthest > 0 && furthest >= lastFixedEnd) {
      const best = pick(incoming[furthest], 1);
      if (best && best.words >= minWords) final = best;
    }
    full = false;
  }
  if (!final) return null;

  const words: SentenceWord[] = [];
  for (let state: State | null = final; state; state = state.previous) {
    words.unshift({ entry: state.edge.entry, start: state.edge.start, end: state.edge.end });
  }
  return { words, score: final.score, covered: final.edge.end, full, fixed: fixed.length > 0 };
}
