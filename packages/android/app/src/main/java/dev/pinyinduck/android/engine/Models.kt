package dev.pinyinduck.android.engine

/** Which character set candidates are displayed in. */
enum class ScriptType {
    SIMPLIFIED,
    TRADITIONAL,
    ;

    /** Cycles between the two scripts, for the keyboard's toggle. */
    fun toggled(): ScriptType = if (this == SIMPLIFIED) TRADITIONAL else SIMPLIFIED
}

/** A ranked, renderable candidate. */
data class Candidate(
    val id: String,
    /** The characters as displayed under the active [ScriptType]. */
    val hanzi: String,
    val simplified: String,
    val traditional: String,
    val pinyinMarks: String,
    val pinyinNumbers: String,
    val shortGloss: String,
    val frequency: Int,
    val matchedPinyin: String,
    /** Pinyin left over after this candidate, to keep buffered for the next one. */
    val remainingPinyin: String,
    val hskLevel: Int? = null,
    /**
     * The dictionary entries this candidate stands for, which key its Candidate detail; several
     * when a simplified candidate stands for headwords sharing its form (后 hòu for 後 and 后).
     */
    val entryIds: List<Int> = emptyList(),
    /**
     * The words of a Sentence candidate, one per segment, each with its own Hanzi, reading,
     * gloss and [entryIds] (the outer [entryIds] is then empty). Null on a word candidate.
     */
    val words: List<Candidate>? = null,
    /**
     * Set only on a word inside a Sentence candidate's [words], and on every span alternative:
     * the span of the toneless query it covers. [matchedPinyin] is the word's own key, which
     * for a completed last word runs past the query (`kafe` gives `kafei`, span 9-13), so the
     * span is what to pass to [PinyinDuckEngine.alternativesForSpan] or a [FixedWord].
     * Committing through word k commits `words[0..k]` and leaves the toneless query from
     * `words[k].span.end` composing.
     */
    val span: Span? = null,
)

/** A span `[start, end)` of the toneless query (`cleanPinyin(query)` offsets). */
data class Span(
    val start: Int,
    val end: Int,
)

data class SearchResult(
    val query: String,
    val segments: List<String>,
    val candidates: List<Candidate>,
    /** Candidates available before [SearchOptions.offset] and [SearchOptions.limit]. */
    val total: Int,
)

data class SearchOptions(
    val script: ScriptType = ScriptType.SIMPLIFIED,
    val limit: Int = 10,
    val offset: Int = 0,
    val exactOnly: Boolean = false,
    val maxMatches: Int? = null,
    /**
     * Fixed words: words the learner chose in place of others inside the Sentence candidate
     * (see [FixedWord]). The sentence is rebuilt so each one sits on its span, with the best
     * path before and after it, and while any is held that edited sentence is the first
     * candidate. `SearchOptions.fixedWords` in `packages/core/src/types.ts`.
     *
     * The engine keeps no state between searches: the UI holds this list and passes it with
     * every keystroke while the learner keeps composing. Dropping fixed words is the UI's job:
     * clear the whole list when the sentence (or part of it) is committed and on Esc, and drop
     * a fixed word as soon as a Backspace deletes into its span ([FixedWord.end] > the new
     * toneless query length). Typing more pinyin after them keeps them.
     *
     * A fixed word the current query cannot hold is ignored, not an error: its span is not a
     * word boundary on both ends, its entry is not under that span, a typed tone rules it out,
     * or it overlaps an earlier one in the list.
     */
    val fixedWords: List<FixedWord> = emptyList(),
)

/**
 * A word the learner chose in place of another inside a Sentence candidate, pinned to the
 * span `[start, end)` of the toneless query it covers, and naming its entry by forms and
 * reading. Build one from a span alternative with [Candidate.toFixedWord].
 *
 * The entry's key is normally exactly the span. For the last word it may instead be a longer
 * key that completes the query (`kafe` → 咖啡), held only while the span ends the query.
 */
data class FixedWord(
    val start: Int,
    val end: Int,
    val simplified: String,
    val traditional: String,
    val pinyinNumbers: String,
)

/**
 * This candidate fixed on its [Candidate.span]: pass an alternative from
 * [PinyinDuckEngine.alternativesForSpan] (or a word of a Sentence candidate) as is.
 */
fun Candidate.toFixedWord(): FixedWord {
    val on = requireNotNull(span) { "only a span alternative or a sentence word has a span" }
    return FixedWord(on.start, on.end, simplified, traditional, pinyinNumbers)
}
