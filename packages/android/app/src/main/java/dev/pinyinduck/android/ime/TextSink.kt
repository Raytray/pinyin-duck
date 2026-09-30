package dev.pinyinduck.android.ime

/**
 * Where composed text goes.
 *
 * The composition rules live in [PinyinDuckSession], which knows nothing about Android.
 * Keeping the sink this narrow means the whole buffer/commit state machine can be tested
 * against a fake editor, which is the part of an IME most likely to be wrong.
 */
interface TextSink {

    /** Inserts text at the cursor. */
    fun commitText(text: String)

    /** Deletes [before] characters behind the cursor and [after] in front of it. */
    fun deleteSurrounding(before: Int, after: Int = 0)

    /** Sends a raw key event, for Enter and the like. */
    fun sendEnter()
}
