/**
 * Search over the B-tree dictionary.
 *
 * The search is synchronous, and it decodes only the pages a query touches rather than
 * materializing all 122k entries:
 *
 *   1. exact matches come from a single root-to-leaf descent
 *   2. prefix matches come from that descent plus a bounded forward leaf scan
 *   3. a multi-syllable query whose last syllable is incomplete also looks up the
 *      first syllable, so `nihao` can still offer `你`
 *
 * Ranking goes through the shared `scoreEntry` and `compareScored`. Memory is bounded
 * by the page cache plus the `maxMatches` scan budget, not the dictionary size.
 *
 * Alongside the words it offers at most one Sentence candidate (`sentence/`), placed by the
 * rules of issue #30: candidates that leave nothing to compose come first; among them the
 * sentence leads only when its path score beats every such word scored as a one-word path;
 * a partial sentence ranks above words that cover less of the query; and a sentence showing
 * the same Hanzi as a word candidate is dropped, the word winning.
 */

import type { Candidate, SearchOptions, SearchResult, ScriptType, Span } from '../types.js';
import {
  cleanPinyin,
  parseToneFilter,
  pinyinNumbersToMarks,
  segmentPinyin,
  type ToneConstraint,
} from '../parser/pinyin.js';
import { BTreeDictionary } from '../data/btree-dictionary.js';
import type { StoredEntry } from '../data/btree-codec.js';
import type { BigramTable } from '../bigram/bigram-codec.js';
import { isSpanIn, queryBoundaries, spansForced } from '../sentence/lattice.js';
import { findSentence, oneWordPathScore, wordCost, type SentenceResult } from '../sentence/sentence-search.js';
import {
  DEFAULT_MAX_MATCHES,
  compareScored,
  entryToCandidate,
  hanziIn,
  scoreEntry,
  type ScorableEntry,
  type ScoredEntry,
} from './ranking.js';

interface ScoredStoredEntry extends ScoredEntry {
  stored: StoredEntry;
}

/**
 * Collects the best-scoring entry per displayed Hanzi against `query`, so dedup and ranking
 * happen in one pass with no full-dictionary materialization. With a tone filter, entries it
 * rules out (score 0 or less) are skipped.
 */
function bestPerHanzi(script: ScriptType, query: string, toneFilter: readonly ToneConstraint[]) {
  const chosen = new Map<string, ScoredStoredEntry>();
  const consider = (stored: StoredEntry): void => {
    // A row for one script only stands in for rows the other script shows instead.
    if (stored.onlyIn && stored.onlyIn !== script) return;
    const entry = storedEntryToScorable(stored);
    const score = scoreEntry(entry, query, toneFilter);
    if (toneFilter.length > 0 && score <= 0) return;
    const hanzi = hanziIn(stored, script);
    const candidate = { entry, score, stored };
    // Ties go through the shared order rather than "first seen wins", so the reading
    // that represents a hanzi does not depend on page scan order.
    const previous = chosen.get(hanzi);
    if (!previous || compareScored(candidate, previous) < 0) chosen.set(hanzi, candidate);
  };
  return { chosen, consider };
}

export interface SearchEngineOptions {
  /**
   * The bigram table Sentence candidates score word pairs with. Optional: without it every
   * pair backs off to unigram with no penalty, and the web app loads it after the dictionary.
   */
  bigrams?: BigramTable;
}

export class LazyPinyinSearchEngine {
  private readonly bigrams?: BigramTable;

  constructor(
    private readonly dictionary: BTreeDictionary,
    engineOptions: SearchEngineOptions = {}
  ) {
    this.bigrams = engineOptions.bigrams;
  }

  search(query: string, options: SearchOptions = {}): SearchResult {
    const rawQuery = query.trim().toLowerCase();
    if (!rawQuery) {
      return { query: rawQuery, segments: [], candidates: [], total: 0 };
    }

    const script: ScriptType = options.script || 'simplified';
    const limit = options.limit ?? 10;
    const offset = options.offset ?? 0;
    const maxMatches = options.maxMatches ?? DEFAULT_MAX_MATCHES;

    const segments = segmentPinyin(rawQuery);
    const tonelessQuery = cleanPinyin(rawQuery);
    const toneFilter = parseToneFilter(rawQuery);

    const { chosen, consider } = bestPerHanzi(script, tonelessQuery, toneFilter);
    for (const entry of this.dictionary.lookupExact(tonelessQuery)) consider(entry);
    if (!options.exactOnly) this.dictionary.scanPrefixWithin(tonelessQuery, maxMatches, consider);

    // A multi-syllable query whose last syllable is incomplete (e.g. "nih" or "nihao")
    // also offers matches for the first full syllable.
    const firstSyllable = segments[0] ? cleanPinyin(segments[0]) : '';
    if (segments.length > 1 && firstSyllable && firstSyllable !== tonelessQuery) {
      for (const entry of this.dictionary.lookupExact(firstSyllable)) consider(entry);
    }

    // Coverage first (#30): words that leave nothing to compose, then the rest by how much
    // of the query they cover, each group in the shared order.
    const coverage = (item: ScoredStoredEntry): number =>
      item.entry.pinyinClean.startsWith(tonelessQuery)
        ? tonelessQuery.length
        : tonelessQuery.startsWith(item.entry.pinyinClean)
          ? item.entry.pinyinClean.length
          : 0;
    const ranked = Array.from(chosen.values())
      .sort(compareScored)
      .map((item) => ({ item, covers: coverage(item) }))
      .sort((a, b) => b.covers - a.covers);

    const ordered: Array<{ item: ScoredStoredEntry } | { sentence: SentenceResult }> = ranked.map(({ item }) => ({ item }));
    const sentence = findSentence(this.dictionary, rawQuery, {
      script,
      toneFilter,
      bigrams: this.bigrams,
      exactOnly: options.exactOnly,
      maxMatches,
      fixedWords: options.fixedWords,
    });
    if (sentence?.fixed) {
      // The edited sentence (#37): the learner's own choice comes first, ahead of every word.
      // A word showing the same Hanzi is the one dropped this time.
      const hanzi = sentenceHanzi(sentence, script);
      const kept = ordered.filter((slot) => !('item' in slot) || hanziIn(slot.item.stored, script) !== hanzi);
      ordered.splice(0, ordered.length, { sentence }, ...kept);
    } else if (sentence) {
      const hanzi = sentenceHanzi(sentence, script);
      const repeatsAWord = ranked.some(({ item }) => hanziIn(item.stored, script) === hanzi);
      if (!repeatsAWord) {
        let position: number;
        if (sentence.full) {
          const fullWords = ranked.filter(({ covers }) => covers === tonelessQuery.length);
          const cost = wordCost(this.dictionary);
          const bestWord = Math.max(
            ...fullWords.map(({ item }) => oneWordPathScore(item.entry.frequency, cost))
          );
          // A tie goes to the word: the bias is toward fewer words.
          position = fullWords.length === 0 || sentence.score > bestWord ? 0 : fullWords.length;
        } else {
          position = ranked.findIndex(({ covers }) => covers < sentence.covered);
          if (position < 0) position = ranked.length;
        }
        ordered.splice(position, 0, { sentence });
      }
    }

    const total = ordered.length;
    const candidates = ordered
      .slice(offset, offset + limit)
      .map((slot) =>
        'sentence' in slot
          ? sentenceToCandidate(slot.sentence, script, tonelessQuery)
          : storedEntryToCandidate(slot.item.stored, script, tonelessQuery)
      );

    return {
      query: rawQuery,
      segments,
      candidates,
      total,
    };
  }

  /**
   * The alternatives a word menu offers for one word of a Sentence candidate (#37): every
   * entry whose key is exactly the span `[start, end)` of the toneless query, one per Hanzi
   * in the active script, in word-candidate order (`scoreEntry` on the span, then
   * `compareScored`). Rare words are included, since a word the learner picks becomes a
   * fixed word and skips `MIN_SENTENCE_WORD_FREQUENCY`. A tone typed inside the span, or
   * right after its last syllable, keeps only the readings with that tone. A tone typed on
   * another word says nothing here.
   *
   * It never changes word boundaries, nor offers a word that runs across an apostrophe or
   * space typed inside the span anywhere but between its own syllables: a longer or shorter span is a different question. The
   * one exception is a span that ends the query, where the last word may have been a
   * completion (`kafe` → 咖啡), so keys that start with the span are offered after the exact
   * ones, unless `exactOnly`. Each candidate carries `span`, so it can be passed back as a
   * `FixedWord` as is. An out-of-range span gives an empty list.
   */
  alternativesForSpan(
    query: string,
    span: Span,
    options: Pick<SearchOptions, 'script' | 'exactOnly' | 'maxMatches'> = {}
  ): Candidate[] {
    const rawQuery = query.trim().toLowerCase();
    const script: ScriptType = options.script || 'simplified';
    const maxMatches = options.maxMatches ?? DEFAULT_MAX_MATCHES;
    const { toneless, forced } = queryBoundaries(rawQuery);
    if (!isSpanIn(span, toneless.length)) return [];
    const { start, end } = span;
    const key = toneless.slice(start, end);
    // The typed tones that fall on this span, as offsets into it.
    const toneFilter = parseToneFilter(rawQuery)
      .filter(({ offset }) => offset > start && offset <= end)
      .map(({ offset, tone }) => ({ offset: offset - start, tone }));

    const best = bestPerHanzi(script, key, toneFilter);
    // A word never runs across an apostrophe or space typed inside the span.
    const consider = (stored: StoredEntry): void => {
      if (spansForced(stored.pinyinNumbers, start, end, forced)) best.consider(stored);
    };
    for (const entry of this.dictionary.lookupExact(key)) consider(entry);
    if (end === toneless.length && !options.exactOnly) {
      this.dictionary.scanPrefixWithin(key, maxMatches, (entry) => {
        if (entry.key.length > key.length) consider(entry);
      });
    }
    return Array.from(best.chosen.values())
      .sort(compareScored)
      .map(({ stored }) => ({ ...storedEntryToCandidate(stored, script, key), span: { start, end } }));
  }
}

/** A Sentence candidate's Hanzi in the active script. */
function sentenceHanzi(sentence: SentenceResult, script: ScriptType): string {
  return sentence.words.map(({ entry }) => hanziIn(entry, script)).join('');
}

/**
 * Projects a Sentence candidate into a candidate: each word as its own candidate, and the
 * outer fields joined from them. The outer `entryIds` is empty; the words carry theirs.
 */
export function sentenceToCandidate(
  sentence: SentenceResult,
  script: ScriptType,
  tonelessQuery: string
): Candidate {
  const words = sentence.words.map(({ entry, start, end }) => ({
    ...storedEntryToCandidate(entry, script, tonelessQuery.slice(start, end)),
    span: { start, end },
  }));
  const join = (field: (word: Candidate) => string, separator = '') => words.map(field).join(separator);
  const simplified = join((word) => word.simplified);
  const pinyinNumbers = join((word) => word.pinyinNumbers, ' ');
  return {
    id: `${simplified}-${pinyinNumbers}`,
    hanzi: join((word) => word.hanzi),
    simplified,
    traditional: join((word) => word.traditional),
    pinyinMarks: join((word) => word.pinyinMarks, ' '),
    pinyinNumbers,
    shortGloss: join((word) => word.shortGloss, ' · '),
    frequency: 0,
    matchedPinyin: join((word) => word.matchedPinyin),
    remainingPinyin: sentence.full ? '' : tonelessQuery.slice(sentence.covered),
    entryIds: [],
    words,
  };
}

/** Projects a stored leaf entry into the fields scoring needs. */
export function storedEntryToScorable(entry: StoredEntry): ScorableEntry {
  return {
    simplified: entry.simplified,
    pinyinClean: entry.key,
    pinyinNumbers: entry.pinyinNumbers,
    frequency: entry.frequency,
    hskLevel: entry.hskLevel || undefined,
    traditional: entry.traditional,
  };
}

/** Projects a stored leaf entry into a rendered candidate. */
export function storedEntryToCandidate(
  entry: StoredEntry,
  script: ScriptType,
  tonelessQuery: string
) {
  return entryToCandidate(
    {
      ...storedEntryToScorable(entry),
      traditional: entry.traditional,
      pinyinMarks: pinyinNumbersToMarks(entry.pinyinNumbers),
      shortGloss: entry.shortGloss,
      entryIds: entry.entryIds,
    },
    script,
    tonelessQuery
  );
}
