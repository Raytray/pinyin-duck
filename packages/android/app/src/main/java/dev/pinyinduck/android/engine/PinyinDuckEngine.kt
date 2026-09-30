package dev.pinyinduck.android.engine

/**
 * Candidate search over the paged B-tree dictionary.
 *
 * A port of `packages/core/src/index/lazy-search.ts`. The pass structure is identical:
 *
 *  1. exact matches, from one root-to-leaf descent;
 *  2. prefix matches, from that descent plus a bounded forward leaf scan;
 *  3. for a multi-syllable query whose last syllable is still incomplete, the first
 *     syllable is looked up too, so `nihao` can still offer `你`.
 *
 * The only difference from the TypeScript is that page reads are synchronous, because the
 * asset is mmap'd. That is what turns an async web search into a sub-millisecond call
 * that is safe to run directly inside `onKeyDown`, with no queue and no ordering hazard
 * between a keystroke and the candidates it expects to see.
 */
class PinyinDuckEngine(
    private val dictionary: BTreeDictionary,
    private val maxMatches: Int = DEFAULT_MAX_MATCHES,
) {
    /** Number of entries in the backing dictionary. */
    val entryCount: Int get() = dictionary.entryCount

    fun search(
        query: String,
        options: SearchOptions = SearchOptions(),
    ): SearchResult {
        val rawQuery = query.trim().lowercase()
        if (rawQuery.isEmpty()) return SearchResult(rawQuery, emptyList(), emptyList(), 0)

        val limit = options.limit
        val offset = options.offset
        val budget = options.maxMatches ?: maxMatches

        val segments = segmentPinyin(rawQuery)
        val tonelessQuery = cleanPinyin(rawQuery)
        val toneFilterNumbers = toneDigitsOf(rawQuery)
        val hasToneFilter = toneFilterNumbers.isNotEmpty()

        // Keep the best-scoring entry per displayed hanzi, so dedup and ranking happen in
        // one pass with no full-dictionary materialization. Insertion order is preserved
        // because it is the final tiebreak for entries that score identically.
        val chosen = LinkedHashMap<String, ScoredEntry>()

        fun consider(entry: StoredEntry) {
            val score = scoreEntry(entry.toScorable(), tonelessQuery, toneFilterNumbers)
            if (hasToneFilter && score <= 0) return
            val hanzi = if (options.script == ScriptType.TRADITIONAL) entry.traditional else entry.simplified
            val previous = chosen[hanzi]
            if (previous == null || score > previous.score) chosen[hanzi] = ScoredEntry(entry, score)
        }

        for (entry in dictionary.lookupExact(tonelessQuery)) consider(entry)

        if (!options.exactOnly) {
            var scanned = 0
            dictionary.scanPrefix(tonelessQuery) {
                consider(it)
                scanned++
                scanned < budget
            }
        }

        // A multi-syllable query whose last syllable is incomplete (e.g. "nih" or "nihao")
        // also offers matches for the first full syllable.
        val firstSyllable = segments.firstOrNull()?.let { cleanPinyin(it) }.orEmpty()
        if (segments.size > 1 && firstSyllable.isNotEmpty() && firstSyllable != tonelessQuery) {
            for (entry in dictionary.lookupExact(firstSyllable)) consider(entry)
        }

        val ranked = chosen.values.sortedWith(SCORED_ORDER)
        val candidates =
            if (offset < ranked.size) {
                ranked
                    .subList(offset, minOf(offset + limit, ranked.size))
                    .map { it.entry.toCandidate(options.script, tonelessQuery) }
            } else {
                emptyList()
            }

        return SearchResult(rawQuery, segments, candidates, ranked.size)
    }

    private class ScoredEntry(
        val entry: StoredEntry,
        val score: Int,
    )

    private companion object {
        /**
         * Deterministic ordering for equal scores.
         *
         * The in-memory trie engine's tie order falls out of trie insertion order, which
         * a B-tree scan cannot reproduce. Sorting ties by frequency, then key, then form
         * keeps the keyboard and the web app returning the same list in the same order.
         */
        val SCORED_ORDER: Comparator<ScoredEntry> =
            compareByDescending<ScoredEntry> { it.score }
                .thenByDescending { it.entry.frequency }
                .thenBy { it.entry.key }
                .thenBy { it.entry.simplified }
                .thenBy { it.entry.pinyinNumbers }
    }
}

/** Projects a stored leaf entry into the fields scoring needs. */
private fun StoredEntry.toScorable() =
    ScorableEntry(
        simplified = simplified,
        pinyinClean = key,
        pinyinNumbers = pinyinNumbers,
        frequency = frequency,
        // 0 means "not on the HSK list", which the ranker treats as no bonus.
        hskLevel = hskLevel.takeIf { it != 0 },
    )

/** Projects a stored leaf entry into a rendered candidate. */
private fun StoredEntry.toCandidate(
    script: ScriptType,
    tonelessQuery: String,
) = entryToCandidate(
    entry = toScorable(),
    traditional = traditional,
    pinyinMarks = pinyinNumbersToMarks(pinyinNumbers),
    shortGloss = shortGloss,
    script = script,
    tonelessQuery = tonelessQuery,
)
