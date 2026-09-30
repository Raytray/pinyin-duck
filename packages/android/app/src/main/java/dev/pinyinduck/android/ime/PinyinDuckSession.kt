package dev.pinyinduck.android.ime

import dev.pinyinduck.android.engine.Candidate
import dev.pinyinduck.android.engine.PinyinDuckEngine
import dev.pinyinduck.android.engine.ScriptType
import dev.pinyinduck.android.engine.SearchOptions

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
 */
class PinyinDuckSession(
    private val engine: PinyinDuckEngine,
    private val sink: TextSink,
    script: ScriptType = ScriptType.SIMPLIFIED,
) {
    /** Called after every state change so a UI can refresh. */
    var onChange: (() -> Unit)? = null

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

    /** Whether anything is selected or offered. */
    val hasCandidates: Boolean get() = candidates.isNotEmpty()

    /** Clears the composition without touching the editor, on a new editing session. */
    fun reset() {
        buffer = ""
        candidates = emptyList()
        total = 0
        selectedIndex = -1
        notifyChanged()
    }

    /** Appends a letter to the composition, or inserts it directly when not composing. */
    fun typeLetter(letter: Char) {
        if (!isComposing && !isPinyinLetter(letter)) {
            sink.commitText(letter.toString())
            return
        }
        if (buffer.length >= MAX_BUFFER_LENGTH) {
            // Guard against an unbounded scan on a long unbroken run of letters.
            commitTopCandidate()
            if (buffer.length >= MAX_BUFFER_LENGTH) return
        }
        buffer += letter
        sink.setComposingText(buffer)
        refresh(resetSelection = true)
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
        if (!isComposing || digit !in 1..5) {
            if (isComposing) {
                // A non-tone digit cannot continue the pinyin, so the composition ends:
                // the pinyin is committed as text and the digit inserted alongside it.
                // The old code appended the digit to the editor while leaving the buffer
                // untouched, which meant the editor held `shi0` against a buffer of `shi` —
                // the exact drift the composing region exists to prevent.
                sink.commitText(buffer + digit.toString())
                buffer = ""
                refresh(resetSelection = true)
            } else {
                sink.commitText(digit.toString())
            }
            return
        }
        if (buffer.length >= MAX_BUFFER_LENGTH) return
        buffer += digit.toString()
        sink.setComposingText(buffer)
        refresh(resetSelection = true)
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
        buffer = buffer.dropLast(1)
        sink.setComposingText(buffer)
        refresh(resetSelection = true)
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
        buffer = ""
        refresh(resetSelection = true)
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
        val remaining = candidate.remainingPinyin
        buffer = remaining
        if (remaining.isNotEmpty()) sink.setComposingText(remaining)

        refresh(resetSelection = true)
    }

    private fun keepBufferAsText() {
        // The pinyin is in the composing region; committing it finalises it as ordinary
        // text. This is the only way out of an input the dictionary cannot resolve, such
        // as `qqq`.
        sink.commitText(buffer)
        buffer = ""
        refresh(resetSelection = true)
    }

    private fun refresh(resetSelection: Boolean = false) {
        if (buffer.isEmpty()) {
            candidates = emptyList()
            total = 0
            selectedIndex = -1
            notifyChanged()
            return
        }

        val result = engine.search(buffer, SearchOptions(script = script, limit = FETCH_LIMIT))
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
