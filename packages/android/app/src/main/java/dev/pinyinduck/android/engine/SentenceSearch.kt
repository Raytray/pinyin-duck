package dev.pinyinduck.android.engine

/*
 * Sentence candidates: the best run of dictionary words covering a query from its start
 * (issues #29, #30 and #50).
 *
 * A port of `packages/core/src/sentence/sentence-search.ts`, whose module comment explains
 * the lattice, the score and the search. Every step, constant and tie-break here is the
 * TypeScript one, in the same order, because `PinyinEngineParityTest` pins both engines to
 * one golden: all integer arithmetic, and every tie broken by a fixed order.
 */

/**
 * The bias toward fewer words, added to the dictionary's base word cost (the scaled
 * ln(corpus total) in the B+ tree header, 119,936 for the shipped corpus).
 *
 * The same value as `EXTRA_WORD_COST` in `sentence-search.ts`, which records why: on the
 * shipped corpus `zhongwen` (中 + 文字 against 中文) needs it above −24,976, and `woshi`
 * (我 + 是 against 卧室) needs it below 27,433. 0 sits near the middle and leaves the path
 * score a plain scaled log-probability. Change both together.
 */
const val EXTRA_WORD_COST = 0

/**
 * What a bigram miss costs: a later word that followed the one before it fewer than five
 * times in the corpus scores its unigram frequency minus this.
 *
 * `BIGRAM_BACKOFF_PENALTY` in `sentence-search.ts`: the median by which a stored pair scores
 * above its second word's unigram frequency (12,492, rounded), so a miss is about as much
 * worse than unigram as a typical hit is better. With no bigram table there is no penalty.
 */
const val BIGRAM_BACKOFF_PENALTY = 12000

/**
 * Words rarer than this never appear inside a Sentence candidate.
 *
 * `MIN_SENTENCE_WORD_FREQUENCY` in `sentence-search.ts`: 1 drops exactly the words missing
 * from the frequency list (stored frequency 0, such as 睨视, 卧式 and 中国人), which still rank
 * as one-word paths among the word candidates.
 */
const val MIN_SENTENCE_WORD_FREQUENCY = 1

/**
 * One word of a Sentence candidate, or a fixed word resolved to its stored entry, and where it
 * starts and ends in the toneless query.
 */
internal class SentenceWord(
    val entry: StoredEntry,
    val start: Int,
    val end: Int,
)

internal class SentenceResult(
    val words: List<SentenceWord>,
    /** The path score: comparable with a single word's [oneWordPathScore]. */
    val score: Int,
    /** How much of the toneless query the sentence covers. */
    val covered: Int,
    /** True when the sentence covers (or, by completion, completes) the whole query. */
    val full: Boolean,
    /** True when the sentence holds at least one fixed word, which makes it the edited sentence. */
    val fixed: Boolean = false,
)

/**
 * Resolves the fixed words the query can honor, sorted by start. `resolveFixedWords` in
 * `sentence-search.ts`: one is honored when both ends of its span are lattice nodes (or, for a
 * completed last word, the span runs to the end of the query and the key is longer), its
 * entry is stored under that key and shown in the active script, and the typed tones and
 * boundaries allow it. A fixed word skips [MIN_SENTENCE_WORD_FREQUENCY]: the learner chose it. One that
 * overlaps a word honored earlier in the list is ignored.
 */
private fun resolveFixedWords(
    dictionary: BTreeDictionary,
    fixedWords: List<FixedWord>,
    boundaries: QueryBoundaries,
    script: ScriptType,
    toneFilter: List<ToneConstraint>,
    exactOnly: Boolean,
): List<SentenceWord> {
    val toneless = boundaries.toneless
    val nodes = boundaries.nodes
    val end = boundaries.end
    val n = toneless.length
    val resolved = ArrayList<SentenceWord>()
    for (word in fixedWords) {
        if (!isSpanIn(word.span, n)) continue
        val start = word.span.start
        val stop = word.span.end
        if (start > end || (start != 0 && !nodes[start])) continue
        if (resolved.any { start < it.end && stop > it.start }) continue
        val typed = toneless.substring(start, stop)
        val key = cleanPinyin(word.pinyinNumbers)
        val exact = key == typed && stop <= end && nodes[stop]
        val completes = !exactOnly && stop == n && key.length > typed.length && key.startsWith(typed)
        if (!exact && !completes) continue
        val entry =
            dictionary.lookupExact(key).firstOrNull { stored ->
                (stored.onlyIn == null || stored.onlyIn == script) &&
                    stored.simplified == word.simplified &&
                    stored.traditional == word.traditional &&
                    stored.pinyinNumbers == word.pinyinNumbers
            }
        if (entry == null || !fitsTones(entry, start, toneFilter)) continue
        if (!spansForced(entry.pinyinNumbers, start, stop, boundaries.forced)) continue
        resolved.add(SentenceWord(entry, start, stop))
    }
    resolved.sortBy { it.start }
    return resolved
}

/** The cost charged per word: the dictionary's base word cost plus the extra bias. */
internal fun wordCost(dictionary: BTreeDictionary): Int = dictionary.header.baseWordCost + EXTRA_WORD_COST

/** A single word scored as a one-word path, to compare with a sentence's score. */
internal fun oneWordPathScore(
    frequency: Int,
    cost: Int,
): Int = frequency - cost

private class Edge(
    val entry: StoredEntry,
    val start: Int,
    val end: Int,
    /** Position in the fixed edge order, the last tie-breaker. */
    val order: Int,
    /** The word's id in the bigram table, resolved once; [NO_BIGRAM] when no pair uses it. */
    val bigramId: Int,
)

private class State(
    val score: Int,
    val words: Int,
    val previous: State?,
    val edge: Edge,
)

/**
 * True when [a] is a better state than [b]: higher score, then fewer words, then the earlier
 * edge (or, for two paths into one edge, the predecessor met first in the sorted order).
 */
private fun better(
    a: State,
    b: State,
): Boolean {
    if (a.score != b.score) return a.score > b.score
    if (a.words != b.words) return a.words < b.words
    return a.edge.order < b.edge.order
}

private val BEST_FIRST =
    Comparator<State> { a, b ->
        if (better(a, b)) {
            -1
        } else if (better(b, a)) {
            1
        } else {
            0
        }
    }

/** The `compareScored` chain with frequency as the score: frequency, key, form, reading, traditional. */
private val ENTRY_ORDER: Comparator<StoredEntry> =
    compareByDescending<StoredEntry> { it.frequency }
        .thenBy { it.key }
        .thenBy { it.simplified }
        .thenBy { it.pinyinNumbers }
        .thenBy { it.traditional }

/** Whether [entry] fits every typed tone that falls inside the span starting at [start]. */
private fun fitsTones(
    entry: StoredEntry,
    start: Int,
    toneFilter: List<ToneConstraint>,
): Boolean {
    if (toneFilter.isEmpty()) return true
    val length = entry.key.length
    var ends: List<ToneConstraint>? = null
    for (constraint in toneFilter) {
        val offset = constraint.offset - start
        if (offset <= 0 || offset > length) continue
        val known = ends ?: syllableToneEnds(entry.pinyinNumbers).also { ends = it }
        val syllable = known.firstOrNull { it.offset == offset }
        if (syllable == null || syllable.tone != constraint.tone) return false
    }
    return true
}

/** Keeps the best entry per displayed Hanzi, in the order [ENTRY_ORDER] ranks them. */
private fun collapse(
    entries: List<StoredEntry>,
    script: ScriptType,
    start: Int,
    end: Int,
    forced: BooleanArray,
    toneFilter: List<ToneConstraint>,
): List<StoredEntry> {
    if (entries.isEmpty()) return entries
    val best = HashMap<String, StoredEntry>()
    for (entry in entries) {
        if (entry.onlyIn != null && entry.onlyIn != script) continue
        if (entry.frequency < MIN_SENTENCE_WORD_FREQUENCY || !fitsTones(entry, start, toneFilter)) continue
        if (!spansForced(entry.pinyinNumbers, start, end, forced)) continue
        val hanzi = hanziIn(entry, script)
        val previous = best[hanzi]
        if (previous == null || ENTRY_ORDER.compare(entry, previous) < 0) best[hanzi] = entry
    }
    return best.values.sortedWith(ENTRY_ORDER)
}

/** A toneless tail with a vowel in it, the point where completing the last word starts. */
private fun hasVowel(
    text: String,
    from: Int,
): Boolean {
    for (k in from until text.length) {
        when (text[k]) {
            'a', 'e', 'i', 'o', 'u', 'ü' -> return true
        }
    }
    return false
}

/**
 * Finds the Sentence candidate for [query] (trimmed and lowercased), or null when no path of
 * two or more words can be built with confidence.
 */
internal fun findSentence(
    dictionary: BTreeDictionary,
    query: String,
    script: ScriptType,
    toneFilter: List<ToneConstraint>,
    bigrams: BigramTable?,
    exactOnly: Boolean,
    maxMatches: Int,
    fixedWords: List<FixedWord> = emptyList(),
): SentenceResult? {
    val boundaries = queryBoundaries(query)
    val toneless = boundaries.toneless
    val nodes = boundaries.nodes
    val end = boundaries.end
    val n = toneless.length
    if (n == 0) return null
    val cost = wordCost(dictionary)
    val penalty = if (bigrams != null) BIGRAM_BACKOFF_PENALTY else 0
    val maxBigram = bigrams?.scoreOffset ?: 0
    // Fixed words force their edge: no other word may start, end or lie inside their span,
    // so every path past a fixed word's start goes through it, and the best path is found
    // before and after it as usual.
    val fixed = resolveFixedWords(dictionary, fixedWords, boundaries, script, toneFilter, exactOnly)

    fun fixedAt(i: Int) = fixed.firstOrNull { it.start == i }

    fun insideFixed(i: Int) = fixed.any { i > it.start && i < it.end }

    /** The first fixed word starting after [i], where every other edge from [i] must stop; -1 when none does. */
    fun nextFixedStart(i: Int) = fixed.firstOrNull { it.start > i }?.start ?: -1

    // Edges by start node, in the fixed order: shorter spans first, then completions, each
    // span in `compareScored` order.
    val outgoing = Array(n + 1) { ArrayList<Edge>() }
    var order = 0

    fun addEdges(
        start: Int,
        entries: List<StoredEntry>,
        stop: Int,
    ) {
        for (entry in entries) {
            val bigramId = bigrams?.wordId(entry.simplified) ?: NO_BIGRAM
            outgoing[start].add(Edge(entry, start, stop, order++, bigramId))
        }
    }

    // States by the node their last word ends at.
    val incoming = Array(n + 1) { ArrayList<State>() }
    val reached = BooleanArray(n + 1)
    reached[0] = true
    // The best full sentence so far (two or more words ending at n).
    var finalBest: State? = null

    for (i in 0 until n) {
        if (!nodes[i] && i != 0) continue
        if (!reached[i]) continue
        // Edges are built only from nodes a path reaches, so an unreachable stretch costs no lookups.
        val fixedHere = fixedAt(i)
        if (fixedHere != null) addEdges(i, listOf(fixedHere.entry), fixedHere.end)
        val next = nextFixedStart(i)
        // The last node an exact edge from here may end at: none at or inside a fixed word,
        // and no further than the next fixed word's start.
        val stop =
            when {
                fixedHere != null || insideFixed(i) -> -1
                next >= 0 -> minOf(end, next)
                else -> end
            }
        for (j in i + 1..stop) {
            if (!nodes[j]) continue
            addEdges(i, collapse(dictionary.lookupExact(toneless.substring(i, j)), script, i, j, boundaries.forced, toneFilter), j)
        }
        // A tail that is only a consonant initial so far (`z`, `zh`, a lone `w`) is not
        // completed: it says little about the word, and scanning it walks every key under that
        // letter. The amendment to #29 recorded on #40, as in the TypeScript.
        if (!exactOnly && i > 0 && stop >= 0 && next < 0 && hasVowel(toneless, i)) {
            val tail = toneless.substring(i)
            val found = ArrayList<StoredEntry>()
            dictionary.scanPrefixWithin(tail, maxMatches) { entry ->
                if (entry.key.length > tail.length) found.add(entry)
            }
            addEdges(i, collapse(found, script, i, n, boundaries.forced, toneFilter), n)
        }

        val previous = incoming[i].sortedWith(BEST_FIRST)
        for (edge in outgoing[i]) {
            val frequency = edge.entry.frequency
            var best: State? = null
            if (i == 0) {
                best = State(frequency - cost, 1, null, edge)
            } else if (edge.bigramId == NO_BIGRAM || bigrams == null) {
                // No pair ends in this word, so every transition is a miss and adds the same
                // amount: the best predecessor stays best.
                val prior = previous.firstOrNull()
                if (prior != null) best = State(prior.score + frequency - penalty - cost, prior.words + 1, prior, edge)
            } else {
                // Nothing follows a word that ends the query, so such a state only matters if it
                // can beat the best full sentence so far: the bar is that, not this edge's best.
                val endsQuery = edge.end == n
                val miss = frequency - penalty
                val ceiling = maxOf(maxBigram, miss)
                for (prior in previous) {
                    val bar = finalBest
                    val target = if (endsQuery && bar != null && (best == null || better(bar, best))) bar else best
                    // Sorted by score, so once even the best possible transition cannot beat the
                    // bar, no later predecessor can either.
                    if (target != null && prior.score + ceiling - cost < target.score) break
                    val priorId = prior.edge.bigramId
                    val reach = if (priorId == NO_BIGRAM) NO_BIGRAM else bigrams.maxScoreAfter(priorId)
                    // This predecessor's own bound: its best bigram, or a miss.
                    val bound = if (reach == NO_BIGRAM) miss else maxOf(reach, miss)
                    if (target != null && prior.score + bound - cost < target.score) continue
                    val hit = if (reach == NO_BIGRAM) NO_BIGRAM else bigrams.scoreById(priorId, edge.bigramId)
                    val score = prior.score + (if (hit == NO_BIGRAM) miss else hit) - cost
                    val candidate = State(score, prior.words + 1, prior, edge)
                    if (best == null || better(candidate, best)) best = candidate
                }
            }
            if (best == null) continue
            incoming[edge.end].add(best)
            reached[edge.end] = true
            val bar = finalBest
            if (edge.end == n && best.words >= 2 && (bar == null || better(best, bar))) finalBest = best
        }
    }

    fun pick(
        states: List<State>,
        minWords: Int,
    ): State? {
        var best: State? = null
        for (state in states) {
            if (state.words < minWords) continue
            if (best == null || better(state, best)) best = state
        }
        return best
    }

    // An edited sentence keeps the learner's choice even when it is a single word.
    val minWords = if (fixed.isNotEmpty()) 1 else 2
    // A path ending before the last fixed word does not include it.
    val lastFixedEnd = fixed.lastOrNull()?.end ?: 0
    var final = pick(incoming[n], minWords)
    var full = final != null
    if (final == null) {
        var furthest = n - 1
        while (furthest > 0 && incoming[furthest].isEmpty()) furthest--
        if (furthest > 0 && furthest >= lastFixedEnd) {
            val best = pick(incoming[furthest], 1)
            if (best != null && best.words >= minWords) final = best
        }
        full = false
    }
    if (final == null) return null

    val words = ArrayList<SentenceWord>()
    var state: State? = final
    while (state != null) {
        words.add(SentenceWord(state.edge.entry, state.edge.start, state.edge.end))
        state = state.previous
    }
    words.reverse()
    return SentenceResult(words, final.score, final.edge.end, full, fixed = fixed.isNotEmpty())
}
