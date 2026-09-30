package dev.pinyinduck.android.ime

import dev.pinyinduck.android.engine.Candidate
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
) {
    /** How many candidates were actually ranked, which the scan budget may cap. */
    val fetched: Int get() = candidates.size
}
