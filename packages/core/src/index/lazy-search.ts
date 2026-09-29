/**
 * Search over the lazy B-tree dictionary.
 *
 * The eager `PinyinSearchEngine` loads every entry and builds a trie, which is fine
 * for tests and a desktop process but too much resident memory for an Android
 * keyboard. This engine walks only the pages a query touches:
 *
 *   1. exact matches come from a single root-to-leaf descent
 *   2. prefix matches come from that descent plus a bounded forward leaf scan
 *   3. a multi-syllable query whose last syllable is incomplete also looks up the
 *      first syllable, so `nihao` can still offer `你`
 *
 * Ranking is identical to the trie engine because both call `scoreEntry`. Memory is
 * bounded by the page cache plus the `maxMatches` scan budget, not the dictionary
 * size.
 */

import { SearchOptions, SearchResult, ScriptType } from '../types.js';
import { cleanPinyin, pinyinNumbersToMarks, segmentPinyin } from '../parser/pinyin.js';
import { BTreeDictionary } from '../data/btree-dictionary.js';
import type { StoredEntry } from '../data/btree-codec.js';
import {
  DEFAULT_MAX_MATCHES,
  entryToCandidate,
  scoreEntry,
  type ScorableEntry,
} from './ranking.js';

export interface LazySearchEngineOptions {
  /** Default scan budget, overridable per `search` call via `SearchOptions.maxMatches`. */
  maxMatches?: number;
}

interface ScoredStoredEntry {
  entry: StoredEntry;
  score: number;
}

/**
 * Deterministic ordering for equal scores.
 *
 * The trie engine's tie order falls out of trie insertion order, which a B-tree scan
 * cannot reproduce. Sorting ties by frequency (then key, then form) keeps result
 * ordering stable across clients and build layouts.
 */
function compareScored(a: ScoredStoredEntry, b: ScoredStoredEntry): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.entry.frequency !== b.entry.frequency) return b.entry.frequency - a.entry.frequency;
  if (a.entry.key !== b.entry.key) return a.entry.key < b.entry.key ? -1 : 1;
  if (a.entry.simplified !== b.entry.simplified) {
    return a.entry.simplified < b.entry.simplified ? -1 : 1;
  }
  if (a.entry.pinyinNumbers !== b.entry.pinyinNumbers) {
    return a.entry.pinyinNumbers < b.entry.pinyinNumbers ? -1 : 1;
  }
  return 0;
}

export class LazyPinyinSearchEngine {
  private readonly maxMatches: number;

  constructor(
    private readonly dictionary: BTreeDictionary,
    options: LazySearchEngineOptions = {}
  ) {
    this.maxMatches = options.maxMatches ?? DEFAULT_MAX_MATCHES;
  }

  /** The number of entries in the backing dictionary. */
  get entryCount(): number {
    return this.dictionary.entryCount;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult> {
    const rawQuery = query.trim().toLowerCase();
    if (!rawQuery) {
      return { query: rawQuery, segments: [], candidates: [], total: 0 };
    }

    const script: ScriptType = options.script || 'simplified';
    const limit = options.limit ?? 10;
    const offset = options.offset ?? 0;
    const maxMatches = options.maxMatches ?? this.maxMatches;

    const segments = segmentPinyin(rawQuery);
    const tonelessQuery = cleanPinyin(rawQuery);
    const toneFilterNumbers = rawQuery.match(/\d/g)?.map(Number) || [];
    const hasToneFilter = toneFilterNumbers.length > 0;

    // Keep the best-scoring entry per displayed hanzi so dedup and ranking happen in
    // one pass, with no full-dictionary materialization.
    const chosen = new Map<string, ScoredStoredEntry>();

    const consider = (entry: StoredEntry): void => {
      const score = scoreEntry(storedEntryToScorable(entry), tonelessQuery, toneFilterNumbers);
      if (hasToneFilter && score <= 0) return;
      const hanzi = script === 'traditional' ? entry.traditional : entry.simplified;
      const previous = chosen.get(hanzi);
      if (!previous || score > previous.score) chosen.set(hanzi, { entry, score });
    };

    for (const entry of await this.dictionary.lookupExact(tonelessQuery)) consider(entry);

    let scanned = 0;
    if (!options.exactOnly) {
      await this.dictionary.scanPrefix(tonelessQuery, (entry) => {
        consider(entry);
        scanned++;
        return scanned < maxMatches;
      });
    }

    // A multi-syllable query whose last syllable is incomplete (e.g. "nih" or "nihao")
    // also offers matches for the first full syllable.
    const firstSyllable = segments[0] ? cleanPinyin(segments[0]) : '';
    if (segments.length > 1 && firstSyllable && firstSyllable !== tonelessQuery) {
      for (const entry of await this.dictionary.lookupExact(firstSyllable)) consider(entry);
    }

    const ranked = Array.from(chosen.values()).sort(compareScored);
    const total = ranked.length;
    const candidates = ranked
      .slice(offset, offset + limit)
      .map((item) => storedEntryToCandidate(item.entry, script, tonelessQuery));

    return {
      query: rawQuery,
      segments,
      candidates,
      total,
    };
  }
}

/** Projects a stored leaf entry into the fields scoring needs. */
export function storedEntryToScorable(entry: StoredEntry): ScorableEntry {
  return {
    simplified: entry.simplified,
    pinyinClean: entry.key,
    pinyinNumbers: entry.pinyinNumbers,
    frequency: entry.frequency,
    hskLevel: entry.hskLevel || undefined,
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
    },
    script,
    tonelessQuery
  );
}
