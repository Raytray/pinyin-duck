package dev.pinyinduck.android.ime

import android.view.KeyEvent
import android.view.inputmethod.EditorInfo
import dev.pinyinduck.android.ui.KeyAction

/**
 * What a physical key press means to the keyboard.
 *
 * Split out of [PinyinDuckImeService] so the mapping is plain data rather than framework
 * callbacks. An IME's key handling is easy to get subtly wrong — swallowing a key the app
 * behind it needed, or treating a tone digit as plain text — and here it can be tested
 * directly instead of through a running service.
 */
object KeyRouting {
    /**
     * The candidate-selection distance for a paging key press.
     *
     * Up and down move by a whole page of the strip, matching what the arrow keys do on the
     * on-screen keyboard's pager.
     */
    const val PAGE_SIZE = 9

    /** What the keyboard should do about a key, or `null` to let the system have it. */
    sealed interface Outcome {
        /** Act on the composition. */
        data class Act(
            val action: KeyAction,
        ) : Outcome

        /** Move the candidate selection by [delta] positions. */
        data class Move(
            val delta: Int,
        ) : Outcome

        /** Move the candidate selection by [pages] pages. */
        data class MoveByPage(
            val pages: Int,
        ) : Outcome

        /** Send the field's own action, or a raw Enter when it declares none. */
        data object Enter : Outcome

        /** Abandon the composition. */
        data object Cancel : Outcome
    }

    /**
     * Classifies a key event.
     *
     * Returns `null` for anything the keyboard does not own, which the service must pass on
     * rather than consume, or the app behind the keyboard would never receive it.
     *
     * [unicode] is `KeyEvent.getUnicodeChar()`; [shift] is that event's shift state, since a
     * shifted letter still types a pinyin letter.
     */
    fun route(
        keyCode: Int,
        unicode: Char = 0.toChar(),
        shift: Boolean = false,
    ): Outcome? =
        when (keyCode) {
            KeyEvent.KEYCODE_SPACE -> Outcome.Act(KeyAction.Space)
            KeyEvent.KEYCODE_DEL -> Outcome.Act(KeyAction.Backspace)
            KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> Outcome.Enter
            KeyEvent.KEYCODE_ESCAPE -> Outcome.Cancel
            KeyEvent.KEYCODE_DPAD_LEFT -> Outcome.Move(-1)
            KeyEvent.KEYCODE_DPAD_RIGHT -> Outcome.Move(1)
            KeyEvent.KEYCODE_DPAD_UP -> Outcome.MoveByPage(-1)
            KeyEvent.KEYCODE_DPAD_DOWN -> Outcome.MoveByPage(1)
            else -> unicodeAction(unicode, shift)
        }

    /**
     * Maps a printable character onto a key action.
     *
     * The apostrophe is part of pinyin, so `xi'an` is 西安 and not `xian`. Digits are routed
     * as digits rather than as letters: whether one is a tone number is a decision for the
     * session, which knows whether a composition is active.
     */
    private fun unicodeAction(
        unicode: Char,
        shift: Boolean,
    ): Outcome? =
        when {
            unicode == '\'' -> Outcome.Act(KeyAction.Letter('\''))
            unicode in '0'..'9' -> Outcome.Act(KeyAction.Digit(unicode - '0'))
            unicode in 'a'..'z' -> Outcome.Act(KeyAction.Letter(unicode))
            // Shift changes nothing but the case of the letter, and the session lowercases the
            // query before searching, so the key still carries a lower-case letter.
            unicode in 'A'..'Z' && shift -> Outcome.Act(KeyAction.Letter(unicode.lowercaseChar()))
            unicode in 'A'..'Z' -> Outcome.Act(KeyAction.Letter(unicode.lowercaseChar()))
            else -> null
        }

    /**
     * Whether Enter should perform the field's declared action rather than send a key event.
     *
     * A search box wants `IME_ACTION_SEARCH`, not a newline, and `imeOptions` is the only
     * place that says which. `IME_ACTION_NONE` and `IME_ACTION_UNSPECIFIED` both mean the
     * field has no opinion, so a raw Enter is sent.
     */
    fun usesEditorAction(imeOptions: Int?): Boolean {
        val action = imeOptions?.let { it and EditorInfo.IME_MASK_ACTION } ?: return false
        return action != EditorInfo.IME_ACTION_NONE && action != EditorInfo.IME_ACTION_UNSPECIFIED
    }

    /** The editor action to perform, or null when the field declares none. */
    fun editorAction(imeOptions: Int?): Int? = imeOptions?.let { it and EditorInfo.IME_MASK_ACTION }.takeIf { usesEditorAction(imeOptions) }
}
