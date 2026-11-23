package dev.pinyinduck.android.engine

import java.util.PriorityQueue

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
 * Alongside the words it offers at most one Sentence candidate ([findSentence]), placed by
 * the rules of #30: words that leave nothing to compose come first; among them the sentence
 * leads only when its path score beats every such word scored as a one-word path; a partial
 * sentence ranks above words that cover less of the query; and a sentence showing the same
 * Hanzi as a word candidate is dropped, the word winning.
 *
 * The only difference from the TypeScript is that page reads are synchronous, because the
 * asset is mmap'd. That is what turns an async web search into a sub-millisecond call
 * that is safe to run directly inside `onKeyDown`, with no queue and no ordering hazard
 * between a keystroke and the candidates it expects to see.
 */
class PinyinDuckEngine(
    private val dictionary: BTreeDictionary,
    private val maxMatches: Int = DEFAULT_MAX_MATCHES,
    /**
     * The bigram table Sentence candidates score word pairs with. Optional, as in TypeScript:
     * without it every pair backs off to unigram with no penalty.
     */
    private val bigrams: BigramTable? = null,
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
        val toneFilter = parseToneFilter(rawQuery)
        val hasToneFilter = toneFilter.isNotEmpty()

        // Keep the best-scoring entry per displayed hanzi, so dedup and ranking happen in
        // one pass with no full-dictionary materialization. Insertion order is preserved
        // because it is the final tiebreak for entries that score identically.
        val chosen = LinkedHashMap<String, ScoredEntry>()

        fun consider(entry: StoredEntry) {
            // A row for one script only stands in for rows the other script shows instead.
            if (entry.onlyIn != null && entry.onlyIn != options.script) return
            val score = scoreEntry(entry.toScorable(), tonelessQuery, toneFilter)
            if (hasToneFilter && score <= 0) return
            val hanzi = if (options.script == ScriptType.TRADITIONAL) entry.traditional else entry.simplified
            val candidate = ScoredEntry(entry, score, coverage(entry.key, tonelessQuery))
            // Ties go through SCORED_ORDER rather than "first seen wins", so the reading that
            // represents a hanzi does not depend on page scan order.
            val previous = chosen[hanzi]
            if (previous == null || SCORED_ORDER.compare(candidate, previous) < 0) chosen[hanzi] = candidate
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

        // Coverage first (#30): words that leave nothing to compose, then the rest by how much
        // of the query they cover, each group in SCORED_ORDER.
        //
        // `chosen` holds one entry per displayed hanzi, which for a broad prefix such as `s` is
        // several thousand. Sorting all of them only to keep the first page is wasted work on
        // every keystroke, so rank the full set only when the caller needs all of it, and
        // otherwise keep a bounded heap of the top `offset + limit`. The Sentence candidate's
        // slot and its dedupe are worked out from counts over `chosen`, not the sorted list.
        val found =
            findSentence(
                dictionary,
                rawQuery,
                options.script,
                toneFilter,
                bigrams,
                options.exactOnly,
                budget,
                options.fixedWords,
            )
        // The edited sentence (#37) comes first, ahead of every word, and a word showing the
        // same Hanzi is the one dropped. Otherwise a sentence repeating a word is dropped.
        if (found?.fixed == true) chosen.remove(found.hanzi(options.script))
        val sentence = found?.takeUnless { chosen.containsKey(it.hanzi(options.script)) }

        val uniqueCount = chosen.size
        val needed = offset + limit
        val ranked =
            if (needed >= uniqueCount) {
                chosen.values.sortedWith(RANKED_ORDER)
            } else {
                topK(chosen.values, needed)
            }

        val slots = ArrayList<Any>(ranked.size + 1)
        slots.addAll(ranked)
        if (sentence != null) {
            val position = if (sentence.fixed) 0 else sentencePosition(sentence, chosen.values, tonelessQuery.length)
            // A slot past the words kept for this page is past the page too.
            if (position <= slots.size) slots.add(position, sentence)
        }
        val total = uniqueCount + if (sentence != null) 1 else 0

        val candidates =
            if (offset < slots.size) {
                slots.subList(offset, minOf(offset + limit, slots.size)).map { slot ->
                    when (slot) {
                        is SentenceResult -> slot.toCandidate(options.script, tonelessQuery)
                        else -> (slot as ScoredEntry).entry.toCandidate(options.script, tonelessQuery)
                    }
                }
            } else {
                emptyList()
            }

        return SearchResult(rawQuery, segments, candidates, total)
    }

    /**
     * The alternatives a word menu offers for one word of a Sentence candidate (#37): every
     * entry whose key is exactly [span] of the toneless query, one per Hanzi in [script], in
     * word-candidate order (`scoreEntry` on the span, then [SCORED_ORDER]). A port of
     * `alternativesForSpan` in `lazy-search.ts`.
     *
     * Rare words are included, since a word the learner picks becomes a [FixedWord] and skips
     * [MIN_SENTENCE_WORD_FREQUENCY]. A tone typed inside the span, or right after its last
     * syllable, keeps only the readings with that tone; a tone typed on another word says
     * nothing here. It never changes word boundaries, nor offers a word that runs across an
     * apostrophe or space typed inside the span anywhere but between its own syllables. The one exception is a span that ends
     * the query, where the last word may have been a completion (`kafe` → 咖啡), so keys that
     * start with the span are offered after the exact ones, unless [exactOnly]. Each candidate
     * carries [Candidate.span], so [Candidate.toFixedWord] turns it into a fixed word as is.
     * An out-of-range span gives an empty list.
     */
    fun alternativesForSpan(
        query: String,
        span: Span,
        script: ScriptType = ScriptType.SIMPLIFIED,
        exactOnly: Boolean = false,
        maxMatches: Int? = null,
    ): List<Candidate> {
        val rawQuery = query.trim().lowercase()
        val budget = maxMatches ?: this.maxMatches
        val boundaries = queryBoundaries(rawQuery)
        val toneless = boundaries.toneless
        val start = span.start
        val end = span.end
        if (start < 0 || end <= start || end > toneless.length) return emptyList()
        val key = toneless.substring(start, end)
        // The typed tones that fall on this span, as offsets into it.
        val toneFilter =
            parseToneFilter(rawQuery)
                .filter { it.offset > start && it.offset <= end }
                .map { it.copy(offset = it.offset - start) }

        val chosen = HashMap<String, ScoredEntry>()

        fun consider(entry: StoredEntry) {
            if (entry.onlyIn != null && entry.onlyIn != script) return
            // A word never runs across an apostrophe or space typed inside the span.
            if (!spansForced(entry.pinyinNumbers, start, end, boundaries.forced)) return
            val score = scoreEntry(entry.toScorable(), key, toneFilter)
            if (toneFilter.isNotEmpty() && score <= 0) return
            val hanzi = if (script == ScriptType.TRADITIONAL) entry.traditional else entry.simplified
            val candidate = ScoredEntry(entry, score, 0)
            val previous = chosen[hanzi]
            if (previous == null || SCORED_ORDER.compare(candidate, previous) < 0) chosen[hanzi] = candidate
        }

        for (entry in dictionary.lookupExact(key)) consider(entry)
        if (end == toneless.length && !exactOnly) {
            var scanned = 0
            dictionary.scanPrefix(key) {
                if (it.key.length > key.length) consider(it)
                scanned++
                scanned < budget
            }
        }
        return chosen.values.sortedWith(SCORED_ORDER).map { it.entry.toCandidate(script, key).copy(span = span) }
    }

    /**
     * Where the Sentence candidate goes among the ranked words (#30).
     *
     * A full sentence leads when no word covers the whole query, or when its path score beats
     * every word that does, scored as a one-word path; otherwise it goes right after those
     * words (a tie goes to the word: the bias is toward fewer words). A partial sentence goes
     * before the first word that covers less of the query than it does.
     */
    private fun sentencePosition(
        sentence: SentenceResult,
        words: Collection<ScoredEntry>,
        queryLength: Int,
    ): Int {
        if (sentence.full) {
            val cost = wordCost(dictionary)
            var fullWords = 0
            var bestWord = Int.MIN_VALUE
            for (word in words) {
                if (word.covers != queryLength) continue
                fullWords++
                bestWord = maxOf(bestWord, oneWordPathScore(word.entry.frequency, cost))
            }
            return if (fullWords == 0 || sentence.score > bestWord) 0 else fullWords
        }
        // Ranked by coverage first, so that is the count of words covering at least as much.
        return words.count { it.covers >= sentence.covered }
    }

    /**
     * Keeps only the best [k] entries according to [SCORED_ORDER], without sorting the
     * whole candidate set. A min-heap keyed on the reverse order holds the current
     * worst of the leaders at its head, so each new entry is compared once and the
     * heap never grows past [k].
     */
    private fun topK(
        entries: Collection<ScoredEntry>,
        k: Int,
    ): List<ScoredEntry> {
        if (k <= 0) return emptyList()
        val heap = PriorityQueue<ScoredEntry>(k, RANKED_ORDER.reversed())
        for (entry in entries) {
            if (heap.size < k) {
                heap.add(entry)
            } else {
                val worst = heap.peek()
                if (worst != null && RANKED_ORDER.compare(entry, worst) < 0) {
                    heap.poll()
                    heap.add(entry)
                }
            }
        }
        return heap.toList().sortedWith(RANKED_ORDER)
    }

    private class ScoredEntry(
        val entry: StoredEntry,
        val score: Int,
        /** How much of the query the word covers: all of it, its own key, or nothing. */
        val covers: Int,
    )

    private companion object {
        /**
         * Deterministic ordering for equal scores.
         *
         * Page scan order is a storage detail, so it must not decide a tie. Sorting ties by
         * frequency, then key, then form (core's `compareScored`) keeps the keyboard and the
         * web app returning the same list in the same order.
         */
        val SCORED_ORDER: Comparator<ScoredEntry> =
            compareByDescending<ScoredEntry> { it.score }
                .thenByDescending { it.entry.frequency }
                .thenBy { it.entry.key }
                .thenBy { it.entry.simplified }
                .thenBy { it.entry.pinyinNumbers }
                // Headwords sharing a simplified form and reading (後 and 后, both hòu) are
                // separate candidates in traditional script and tie on everything else.
                .thenBy { it.entry.traditional }

        /** Coverage first, then [SCORED_ORDER]: the order the word candidates are shown in. */
        val RANKED_ORDER: Comparator<ScoredEntry> =
            compareByDescending<ScoredEntry> { it.covers }.then(SCORED_ORDER)

        /** How much of [tonelessQuery] a word keyed [key] covers, as `lazy-search.ts` counts it. */
        fun coverage(
            key: String,
            tonelessQuery: String,
        ): Int =
            when {
                key.startsWith(tonelessQuery) -> tonelessQuery.length
                tonelessQuery.startsWith(key) -> key.length
                else -> 0
            }
    }
}

/** The sentence's Hanzi in [script], the form a word candidate repeating it would show. */
private fun SentenceResult.hanzi(script: ScriptType): String =
    words.joinToString("") { if (script == ScriptType.TRADITIONAL) it.entry.traditional else it.entry.simplified }

/**
 * Projects a Sentence candidate into a candidate: each word as its own candidate, and the
 * outer fields joined from them. The outer `entryIds` is empty; the words carry theirs.
 * `sentenceToCandidate` in `lazy-search.ts`.
 */
private fun SentenceResult.toCandidate(
    script: ScriptType,
    tonelessQuery: String,
): Candidate {
    val parts =
        words.map {
            it.entry.toCandidate(script, tonelessQuery.substring(it.start, it.end)).copy(span = Span(it.start, it.end))
        }
    val simplified = parts.joinToString("") { it.simplified }
    val pinyinNumbers = parts.joinToString(" ") { it.pinyinNumbers }
    return Candidate(
        id = "$simplified-$pinyinNumbers",
        hanzi = parts.joinToString("") { it.hanzi },
        simplified = simplified,
        traditional = parts.joinToString("") { it.traditional },
        pinyinMarks = parts.joinToString(" ") { it.pinyinMarks },
        pinyinNumbers = pinyinNumbers,
        shortGloss = parts.joinToString(" · ") { it.shortGloss },
        frequency = 0,
        matchedPinyin = parts.joinToString("") { it.matchedPinyin },
        remainingPinyin = if (full) "" else tonelessQuery.substring(covered),
        entryIds = emptyList(),
        words = parts,
    )
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
    entryIds = entryIds,
)
