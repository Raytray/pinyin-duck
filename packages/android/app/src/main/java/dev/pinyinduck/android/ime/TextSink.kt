package dev.pinyinduck.android.ime

/**
 * Where composed text goes.
 *
 * The composition rules live in [PinyinDuckSession], which knows nothing about Android.
 * Keeping the sink this narrow means the whole buffer/commit state machine can be tested
 * against a fake editor, which is the part of an IME most likely to be wrong.
 */
interface TextSink {

    /**
     * Replaces the composing region with [text].
     *
     * The editor shows this with an underline and does not run autocorrect over it, which
     * is what keeps `nihao` from being "corrected" into something else while it is still
     * being typed. Committing ([commitText]) finalises the region.
     */
    fun setComposingText(text: String)

    /** Inserts text at the cursor, finalising any composing region. */
    fun commitText(text: String)

    /** Deletes [before] characters behind the cursor and [after] in front of it. */
    fun deleteSurrounding(before: Int, after: Int = 0)

    /** Sends a raw key event, for Enter and the like. */
    fun sendEnter()
}
