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
 */

import { SearchOptions, SearchResult, ScriptType } from '../types.js';
import { cleanPinyin, parseToneFilter, pinyinNumbersToMarks, segmentPinyin } from '../parser/pinyin.js';
import { BTreeDictionary } from '../data/btree-dictionary.js';
import type { StoredEntry } from '../data/btree-codec.js';
import {
  DEFAULT_MAX_MATCHES,
  compareScored,
  entryToCandidate,
  scoreEntry,
  type ScorableEntry,
  type ScoredEntry,
} from './ranking.js';

interface ScoredStoredEntry extends ScoredEntry {
  stored: StoredEntry;
}

export class LazyPinyinSearchEngine {
  constructor(private readonly dictionary: BTreeDictionary) {}

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
    const hasToneFilter = toneFilter.length > 0;

    // Keep the best-scoring entry per displayed hanzi so dedup and ranking happen in
    // one pass, with no full-dictionary materialization.
    const chosen = new Map<string, ScoredStoredEntry>();

    const consider = (stored: StoredEntry): void => {
      // A row for one script only stands in for rows the other script shows instead.
      if (stored.onlyIn && stored.onlyIn !== script) return;
      const entry = storedEntryToScorable(stored);
      const score = scoreEntry(entry, tonelessQuery, toneFilter);
      if (hasToneFilter && score <= 0) return;
      const hanzi = script === 'traditional' ? stored.traditional : stored.simplified;
      const candidate = { entry, score, stored };
      // Ties go through the shared order rather than "first seen wins", so the reading
      // that represents a hanzi does not depend on page scan order.
      const previous = chosen.get(hanzi);
      if (!previous || compareScored(candidate, previous) < 0) chosen.set(hanzi, candidate);
    };

    for (const entry of this.dictionary.lookupExact(tonelessQuery)) consider(entry);

    let scanned = 0;
    if (!options.exactOnly) {
      this.dictionary.scanPrefix(tonelessQuery, (entry) => {
        consider(entry);
        scanned++;
        return scanned < maxMatches;
      });
    }

    // A multi-syllable query whose last syllable is incomplete (e.g. "nih" or "nihao")
    // also offers matches for the first full syllable.
    const firstSyllable = segments[0] ? cleanPinyin(segments[0]) : '';
    if (segments.length > 1 && firstSyllable && firstSyllable !== tonelessQuery) {
      for (const entry of this.dictionary.lookupExact(firstSyllable)) consider(entry);
    }

    const ranked = Array.from(chosen.values()).sort(compareScored);
    const total = ranked.length;
    const candidates = ranked
      .slice(offset, offset + limit)
      .map((item) => storedEntryToCandidate(item.stored, script, tonelessQuery));

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
