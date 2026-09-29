import {
  Candidate,
  DictEntry,
  SearchOptions,
  SearchResult,
  ScriptType,
} from '../types.js';
import { cleanPinyin, segmentPinyin } from '../parser/pinyin.js';
import { PinyinTrie } from './trie.js';
import { DEFAULT_MAX_MATCHES, entryToCandidate, scoreEntry } from './ranking.js';

export class PinyinSearchEngine {
  private trie: PinyinTrie = new PinyinTrie();

  constructor(entries?: DictEntry[]) {
    if (entries && entries.length > 0) {
      this.loadEntries(entries);
    }
  }

  /**
   * Loads dictionary entries and populates the search trie.
   */
  public loadEntries(entries: DictEntry[]): void {
    this.trie = new PinyinTrie();

    for (const entry of entries) {
      // Index by clean toneless pinyin (e.g. "nihao")
      this.trie.insert(entry.pinyinClean, entry);
    }
  }

  /**
   * Search for candidates matching the input query string.
   */
  public search(query: string, options: SearchOptions = {}): SearchResult {
    const rawQuery = query.trim().toLowerCase();
    if (!rawQuery) {
      return { query: rawQuery, segments: [], candidates: [], total: 0 };
    }

    const script: ScriptType = options.script || 'simplified';
    const limit = options.limit ?? 10;
    const offset = options.offset ?? 0;
    const maxMatches = options.maxMatches ?? DEFAULT_MAX_MATCHES;

    // Segment syllables
    const segments = segmentPinyin(rawQuery);
    const tonelessQuery = cleanPinyin(rawQuery);

    // Extract tone filters if present (e.g. "ni3" -> { tone: 3 })
    const toneFilterNumbers = rawQuery.match(/\d/g)?.map(Number) || [];
    const hasToneFilter = toneFilterNumbers.length > 0;

    // Retrieve matching candidates from Trie
    const exactMatches = this.trie.searchExact(tonelessQuery);
    const prefixMatches = options.exactOnly
      ? []
      : this.trie.searchPrefix(tonelessQuery, maxMatches);

    // If query has multiple syllables (e.g. "nihao"), also look up first syllable for single-character fallback
    const firstSyllable = segments[0] ? cleanPinyin(segments[0]) : '';
    const firstSyllableMatches =
      segments.length > 1 && firstSyllable && firstSyllable !== tonelessQuery
        ? this.trie.searchExact(firstSyllable)
        : [];

    const candidateMap = new Map<string, DictEntry>();

    // Combine matches
    for (const entry of exactMatches) {
      candidateMap.set(entry.simplified + '|' + entry.pinyinNumbers, entry);
    }
    for (const entry of prefixMatches) {
      const key = entry.simplified + '|' + entry.pinyinNumbers;
      if (!candidateMap.has(key)) {
        candidateMap.set(key, entry);
      }
    }
    for (const entry of firstSyllableMatches) {
      const key = entry.simplified + '|' + entry.pinyinNumbers;
      if (!candidateMap.has(key)) {
        candidateMap.set(key, entry);
      }
    }

    const allEntries = Array.from(candidateMap.values());

    // Score and rank candidates
    const scored = allEntries.map((entry) => ({
      entry,
      score: scoreEntry(entry, tonelessQuery, toneFilterNumbers),
    }));

    // Filter out candidates with severe tone penalties if we have matching ones
    const filteredScored = hasToneFilter
      ? scored.filter((s) => s.score > 0)
      : scored;

    filteredScored.sort((a, b) => b.score - a.score);

    // Deduplicate by displayed Hanzi text according to script
    const seenHanzi = new Set<string>();
    const candidates: Candidate[] = [];

    for (const item of filteredScored) {
      const entry = item.entry;
      const hanzi = script === 'traditional' ? entry.traditional : entry.simplified;
      if (seenHanzi.has(hanzi)) continue;
      seenHanzi.add(hanzi);

      candidates.push(entryToCandidate(entry, script, tonelessQuery));
    }

    const total = candidates.length;
    const pagedCandidates = candidates.slice(offset, offset + limit);

    return {
      query: rawQuery,
      segments,
      candidates: pagedCandidates,
      total,
    };
  }
}
