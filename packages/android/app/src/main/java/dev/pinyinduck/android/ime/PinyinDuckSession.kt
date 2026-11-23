package dev.pinyinduck.android.ime

import dev.pinyinduck.android.engine.Candidate
import dev.pinyinduck.android.engine.FixedWord
import dev.pinyinduck.android.engine.PinyinDuckEngine
import dev.pinyinduck.android.engine.ScriptType
import dev.pinyinduck.android.engine.SearchOptions
import dev.pinyinduck.android.engine.toFixedWord

/**
 * The composition state machine: what the letters typed so far mean, which candidate is
 * highlighted, and what a key press does to the editor.
 *
 * Deliberately free of Android types. The editor is reached only through [TextSink] and
 * every decision here is a pure function of the buffer, so the rules can be tested
 * directly instead of through a keyboard.
 *
 * The pinyin being composed is held in the editor's *composing region* via
 * [TextSink.setComposingText], the way a phone keyboard shows `nihao` underlined and then
 * replaces it with 你好. That keeps what the user sees identical to what [buffer] holds,
 * and it tells the editor the text is in progress — so autocorrect leaves it alone and the
 * standard underline is shown. Committing finalises the region.
 *
 * The dictionary is *not* a constructor argument. Mapping it is real I/O on a background
 * thread, and the keyboard is on screen and being tapped long before that finishes, so the
 * session has to exist without one and have it arrive later via [onDictionaryReady]. A
 * session with no dictionary still composes: letters reach the editor and [buffer] grows.
 * It simply cannot rank anything yet, and [onDictionaryReady] ranks the backlog the moment
 * it can.
 */
class PinyinDuckSession(
    private val sink: TextSink,
    script: ScriptType = ScriptType.SIMPLIFIED,
) {
    /** Called after every state change so a UI can refresh. */
    var onChange: (() -> Unit)? = null

    /** The dictionary to rank against, or null until [onDictionaryReady] installs one. */
    private var engine: PinyinDuckEngine? = null

    /** Whether the dictionary has arrived, so a composition can be ranked. */
    val isReady: Boolean get() = engine != null

    var script: ScriptType = script
        set(value) {
            if (field == value) return
            field = value
            refresh()
        }

    /** The pinyin typed so far, which is also what is sitting in the editor. */
    var buffer: String = ""
        private set

    /** Ranked candidates for [buffer]. Empty while nothing is composed. */
    var candidates: List<Candidate> = emptyList()
        private set

    /** Candidates available in total, which can exceed [candidates] by [FETCH_LIMIT]. */
    var total: Int = 0
        private set

    /** Index into [candidates] of the highlighted one, or -1 when there is none. */
    var selectedIndex: Int = -1
        private set

    val isComposing: Boolean get() = buffer.isNotEmpty()

    /**
     * Whether keys skip composition and go straight to the editor, as in a password, email
     * or number field (see [FieldPolicy]).
     *
     * While set, letters and digits are committed as typed, case included, so nothing ever
     * enters [buffer] and no candidates are ranked: a password is never shown as composing
     * text or offered back as a suggestion. Turning it on drops any composition in progress
     * without touching the editor, the same as [reset].
     */
    var direct: Boolean = false
        set(value) {
            field = value
            if (value && isComposing) reset()
        }

    /**
     * The Fixed words the learner has chosen in the Sentence candidate being composed (#37),
     * passed with every search, since the engine keeps no state. They last while the learner
     * types on ([carryFixedWords] drops one a Backspace reaches into), and go on every commit,
     * on cancelling, and on [dropFixedWords].
     */
    var fixedWords: List<FixedWord> = emptyList()
        private set

    /**
     * The word menu's alternatives for word [word] of the Sentence candidate at [index]: every
     * entry on the same span of the query, in word-candidate order. Empty when that is not a
     * word of a Sentence candidate (the leftover pinyin of a partial one is not a word).
     */
    fun wordAlternatives(
        index: Int,
        word: Int,
    ): List<Candidate> {
        val span =
            candidates
                .getOrNull(index)
                ?.words
                ?.getOrNull(word)
                ?.span ?: return emptyList()
        return engine?.alternativesForSpan(buffer, span, script).orEmpty()
    }

    /**
     * Fixes [alternative] (one of [wordAlternatives]) on its span, in place of any fixed word it
     * overlaps, and rebuilds the sentence around it. The edited sentence ranks first and is
     * highlighted.
     */
    fun fixWord(alternative: Candidate) {
        val span = alternative.span ?: return
        fixedWords = fixedWords.filter { it.end <= span.start || it.start >= span.end } + alternative.toFixedWord()
        refresh(resetSelection = true)
    }

    /** Drops every Fixed word and keeps the composition, as when the keyboard is put away. */
    fun dropFixedWords() {
        if (fixedWords.isEmpty()) return
        fixedWords = emptyList()
        refresh(resetSelection = true)
    }

    /**
     * Commits the Sentence candidate at [index] up to and including its word [word], and leaves
     * the rest of the composition composing, searched again like a prefix word's leftover.
     */
    fun commitThrough(
        index: Int,
        word: Int,
    ) {
        val words = candidates.getOrNull(index)?.words ?: return
        val span = words.getOrNull(word)?.span ?: return
        sink.commitText(words.take(word + 1).joinToString("") { it.hanzi })
        composeNext(composingAfter(buffer, span.end))
    }

    /** Whether anything is selected or offered. */
    val hasCandidates: Boolean get() = candidates.isNotEmpty()

    /** Clears the composition without touching the editor, on a new editing session. */
    fun reset() {
        buffer = ""
        fixedWords = emptyList()
        candidates = emptyList()
        total = 0
        selectedIndex = -1
        notifyChanged()
    }

    /**
     * Installs the dictionary and ranks whatever is already buffered.
     *
     * The refresh is the point of the whole two-phase design. Pinyin typed while the
     * dictionary was still mapping is already sitting in the editor's composing region, so
     * it needs its candidates the instant the engine exists — not after the user happens to
     * press another key and provoke a second refresh. Without this, the wait for the
     * dictionary would cost the user every letter they typed during it.
     */
    fun onDictionaryReady(engine: PinyinDuckEngine) {
        this.engine = engine
        refresh()
    }

    /** Appends a letter to the composition, or inserts it directly when not composing. */
    fun typeLetter(letter: Char) {
        if (direct || (!isComposing && !isPinyinLetter(letter))) {
            sink.commitText(letter.toString())
            return
        }
        if (buffer.length >= MAX_BUFFER_LENGTH) {
            // Guard against an unbounded scan on a long unbroken run of letters.
            commitTopCandidate()
            if (buffer.length >= MAX_BUFFER_LENGTH) return
        }
        edit(buffer + letter)
    }

    /**
     * Handles a digit.
     *
     * While a composition is active a 1-5 is a tone number, so `shi` then `4` filters to
     * shì. This is the one place the two clients deliberately differ: on the web the
     * digit keys are taken by candidate selection for the whole composition, which leaves
     * no room for tone input. On a phone the candidates are picked by tapping, so the
     * number row is free to carry tone numbers instead.
     */
    fun typeDigit(digit: Int) {
        if (direct) {
            sink.commitText(digit.toString())
            return
        }
        if (!isComposing || digit !in 1..5) {
            if (isComposing) {
                // A non-tone digit cannot continue the pinyin, so the composition ends:
                // the pinyin is committed as text and the digit inserted alongside it.
                // The old code appended the digit to the editor while leaving the buffer
                // untouched, which meant the editor held `shi0` against a buffer of `shi` —
                // the exact drift the composing region exists to prevent.
                sink.commitText(buffer + digit.toString())
                composeNext("")
            } else {
                sink.commitText(digit.toString())
            }
            return
        }
        if (buffer.length >= MAX_BUFFER_LENGTH) return
        edit(buffer + digit.toString())
    }

    /**
     * Space: commits the highlighted candidate while composing, otherwise inserts a space.
     *
     * With no candidates at all the raw pinyin is committed as text, which is the only way
     * out of an input the dictionary cannot resolve, such as `qqq`.
     */
    fun space() {
        if (!isComposing) {
            sink.commitText(" ")
            return
        }
        if (selectedIndex in candidates.indices) {
            commitCandidate(selectedIndex)
        } else {
            keepBufferAsText()
        }
    }

    /**
     * Backspace: removes the last buffered character, or deletes before the cursor when
     * nothing is being composed.
     */
    fun backspace() {
        if (!isComposing) {
            sink.deleteSurrounding(1)
            return
        }
        edit(buffer.dropLast(1))
    }

    /**
     * Enter sends the platform Enter key even mid-composition, matching the Android
     * convention that the return key is "done" rather than "accept the top candidate".
     * Space is what commits a candidate.
     */
    fun enter() = sink.sendEnter()

    /** Abandons the composition and removes the pinyin from the editor. */
    fun cancelComposition() {
        if (!isComposing) return
        // Committing an empty string clears the composing region. Deleting the surrounding
        // text instead would also remove anything the user had already committed before the
        // composition started.
        sink.commitText("")
        composeNext("")
    }

    /** Toggles Simplified/Traditional, keeping the composition. */
    fun toggleScript() {
        script = script.toggled()
    }

    /** Moves the highlight by [delta], rolling across the candidate list. */
    fun moveSelection(delta: Int) {
        if (candidates.isEmpty()) return
        val next = (selectedIndex + delta).coerceIn(0, candidates.size - 1)
        if (next == selectedIndex) return
        selectedIndex = next
        notifyChanged()
    }

    /** Moves the highlight by a whole page. */
    fun moveSelectionByPage(
        delta: Int,
        pageSize: Int,
    ) = moveSelection(delta * pageSize)

    /** Commits the highlighted or given candidate, keeping any leftover pinyin buffered. */
    fun selectCandidate(index: Int) {
        if (index !in candidates.indices) return
        commitCandidate(index)
    }

    /** Commits the current top candidate, or the raw pinyin when there is none. */
    fun commitTopCandidate() {
        if (selectedIndex in candidates.indices) commitCandidate(selectedIndex) else keepBufferAsText()
    }

    /**
     * Ends the composition, leaving the typed pinyin in the editor as ordinary text.
     *
     * Used when a key arrives that cannot continue a composition, such as a punctuation
     * mark: `nihao` followed by a full stop becomes `nihao.`, not a silently dropped
     * composition.
     */
    fun commitRawText() {
        if (!isComposing) return
        keepBufferAsText()
    }

    private fun commitCandidate(index: Int) {
        val candidate = candidates[index]
        // Committing replaces the composing region with the chosen characters.
        sink.commitText(candidate.hanzi)

        // Partial-match chaining: selecting 你 from `nihao` leaves `hao` buffered so the
        // rest of the phrase can be finished without retyping.
        composeNext(candidate.remainingPinyin)
    }

    /**
     * Starts composing [remaining] after a commit. The Fixed words belonged to what was just
     * committed, so they go.
     */
    private fun composeNext(remaining: String) {
        buffer = remaining
        fixedWords = emptyList()
        if (remaining.isNotEmpty()) sink.setComposingText(remaining)
        refresh(resetSelection = true)
    }

    /** Changes the composition to [next] in place, keeping the Fixed words it still holds. */
    private fun edit(next: String) {
        buffer = next
        fixedWords = carryFixedWords(fixedWords, next)
        sink.setComposingText(next)
        refresh(resetSelection = true)
    }

    private fun keepBufferAsText() {
        // The pinyin is in the composing region; committing it finalises it as ordinary
        // text. This is the only way out of an input the dictionary cannot resolve, such
        // as `qqq`.
        sink.commitText(buffer)
        composeNext("")
    }

    private fun refresh(resetSelection: Boolean = false) {
        if (buffer.isEmpty()) {
            clearRanking()
            return
        }

        val engine = engine
        if (engine == null) {
            // Nothing to rank yet, but the buffer is already in the editor's composing
            // region, so it stays exactly where it is — clearing it here would desync the
            // editor from [buffer] and lose the user's typing. `onDictionaryReady` ranks it.
            clearRanking()
            return
        }

        val result = engine.search(buffer, SearchOptions(script = script, limit = FETCH_LIMIT, fixedWords = fixedWords))
        candidates = result.candidates
        total = result.total
        // A composition that suddenly matches nothing should not keep a stale highlight.
        selectedIndex =
            if (candidates.isEmpty()) {
                -1
            } else if (resetSelection) {
                0
            } else {
                selectedIndex.coerceIn(0, candidates.size - 1)
            }
        notifyChanged()
    }

    /**
     * Drops the ranking while leaving [buffer] alone.
     *
     * The buffer and the editor's composing region are two views of the same text, so
     * forgetting the candidates must never mean forgetting what the user typed.
     */
    private fun clearRanking() {
        candidates = emptyList()
        total = 0
        selectedIndex = -1
        notifyChanged()
    }

    private fun notifyChanged() = onChange?.invoke()

    private fun isPinyinLetter(letter: Char): Boolean = letter in 'a'..'z'

    companion object {
        /**
         * How many candidates one keystroke ranks.
         *
         * Ranking sorts the whole result set before slicing, so a cap only hides the tail
         * of a broad syllable. The widest prefix in the corpus is `s` at 10,266 entries,
         * but the count that matters here is the deduplicated hanzi, and 500 covers every
         * realistic query with room for paging.
         */
        const val FETCH_LIMIT = 500

        /** Longest composition held before a keystroke force-commits the top candidate. */
        const val MAX_BUFFER_LENGTH = 20
    }
}
