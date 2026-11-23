package dev.pinyinduck.android.ime

import dev.pinyinduck.android.engine.Candidate
import dev.pinyinduck.android.engine.DetailView
import dev.pinyinduck.android.engine.ScriptType
import dev.pinyinduck.android.ui.KeyLayout

/**
 * Everything the keyboard draws, as one immutable value.
 *
 * The session owns the composition rules and the UI owns no state of its own beyond its
 * current page, so the whole keyboard is refreshed by replacing one of these. That keeps
 * the buffer, the candidate list and the highlighted index impossible to desynchronise.
 */
data class KeyboardUiState(
    /** The dictionary is still being mapped. */
    val loading: Boolean = true,
    /** Why the dictionary could not be opened, or null when it is fine. */
    val dictionaryError: String? = null,
    /** Entries available, shown in the settings screen. */
    val dictionaryEntries: Int = 0,
    /** The pinyin being composed, which is also what is in the editor. */
    val buffer: String = "",
    val candidates: List<Candidate> = emptyList(),
    val total: Int = 0,
    val selectedIndex: Int = -1,
    val script: ScriptType = ScriptType.SIMPLIFIED,
    val shift: Boolean = false,
    val layout: KeyLayout = KeyLayout.LETTERS,
    /** Whether the full candidate list is showing instead of the strip. */
    val expanded: Boolean = false,
    /** The open Candidate detail bubble, or null while it is closed. */
    val detail: OpenDetail? = null,
) {
    /** Whether the Candidate detail bubble is open. */
    val detailOpen: Boolean get() = detail != null

    /** The candidate whose detail is open, or null while it is closed. */
    val detailIndex: Int? get() = detail?.index

    /** How many candidates were actually ranked, which the scan budget may cap. */
    val fetched: Int get() = candidates.size
}

/**
 * The Candidate detail the bubble is showing.
 *
 * It carries the [candidate] as well as its [index], so the bubble draws the candidate it was
 * opened for even in the instant between the composition changing and the bubble closing.
 */
data class OpenDetail(
    /** Where [candidate] sits in [KeyboardUiState.candidates]; what the bubble is anchored to. */
    val index: Int,
    val candidate: Candidate,
    /** What the detail says, or null when it could not be read (and for a Sentence candidate). */
    val view: DetailView?,
    /**
     * For a Sentence candidate, what the detail says about each of its words, in order; null
     * for a word whose detail could not be read. Empty for a word candidate.
     */
    val wordViews: List<DetailView?> = emptyList(),
    /**
     * For a Sentence candidate opened from one word's block, which word: the bubble scrolls to
     * it and highlights its section. Null when it was opened for the whole sentence.
     */
    val focusWord: Int? = null,
)
