import {
  Candidate,
  DictEntry,
  SearchOptions,
  SearchResult,
  ScriptType,
} from '../types.js';
import { cleanPinyin, segmentPinyin } from '../parser/pinyin.js';
import { PinyinTrie } from './trie.js';

export class PinyinSearchEngine {
  private trie: PinyinTrie = new PinyinTrie();
  private entries: DictEntry[] = [];

  constructor(entries?: DictEntry[]) {
    if (entries && entries.length > 0) {
      this.loadEntries(entries);
    }
  }

  /**
   * Loads dictionary entries and populates the search trie.
   */
  public loadEntries(entries: DictEntry[]): void {
    this.entries = entries;
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
      : this.trie.searchPrefix(tonelessQuery, 200);

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
    const scored = allEntries.map((entry) => {
      let score = 0;
      const isExactPinyin = entry.pinyinClean === tonelessQuery;
      const startsWithPinyin = entry.pinyinClean.startsWith(tonelessQuery);
      const isPrefixQuery = tonelessQuery.startsWith(entry.pinyinClean);

      // Match quality dominates. The tiers are spaced 50000 apart, and the largest
      // popularity contribution below is 30000, so a common character can never
      // outrank a better match: typing "nihao" must offer 你好, not the far more
      // frequent 你.
      if (isExactPinyin) {
        score += 100000;
      } else if (startsWithPinyin) {
        score += 50000;
      } else if (isPrefixQuery) {
        // e.g. entry is "ni" when query is "nihao"
        score += 20000;
      }

      // Prefer multi-character words over single characters for the same reading.
      // The boost is capped rather than scaled by length: against a full dictionary
      // an 8-character exact match (e.g. 中国中央电视台) would otherwise bury the
      // common 2-character word it contains.
      if (isExactPinyin && entry.simplified.length > 1) {
        score += 20000;
      }

      // Popularity and difficulty are tiebreakers within a tier. Frequency is
      // compressed to at most 20000 so it orders candidates but cannot promote a
      // weaker match above a stronger one.
      score += Math.round(entry.frequency / 5);

      // HSK bonus (HSK 1 words are most frequent for learners)
      if (entry.hskLevel) {
        score += (7 - entry.hskLevel) * 5000;
      }

      // Tone matching check
      if (hasToneFilter) {
        const entryTones = entry.pinyinNumbers.match(/\d/g)?.map(Number) || [];
        let toneMatches = 0;
        for (let i = 0; i < Math.min(toneFilterNumbers.length, entryTones.length); i++) {
          if (toneFilterNumbers[i] === entryTones[i]) {
            toneMatches++;
          }
        }
        if (toneMatches > 0) {
          score += toneMatches * 200000; // Heavily favor exact tone match!
        } else {
          score -= 500000; // Penalize mismatch if tone was explicitly typed
        }
      }

      return { entry, score };
    });

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

      const matchedPinyin = entry.pinyinClean;
      const remainingPinyin = tonelessQuery.startsWith(entry.pinyinClean)
        ? tonelessQuery.slice(entry.pinyinClean.length)
        : '';

      candidates.push({
        id: `${entry.simplified}-${entry.pinyinNumbers}`,
        hanzi,
        simplified: entry.simplified,
        traditional: entry.traditional,
        pinyinMarks: entry.pinyinMarks,
        pinyinNumbers: entry.pinyinNumbers,
        shortGloss: entry.shortGloss,
        definitions: entry.definitions,
        frequency: entry.frequency,
        matchedPinyin,
        remainingPinyin,
        hskLevel: entry.hskLevel,
      });
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
