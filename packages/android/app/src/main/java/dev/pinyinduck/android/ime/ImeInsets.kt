package dev.pinyinduck.android.ime

/**
 * The IME window as `onComputeInsets` sees it, in window pixels.
 *
 * @property width the input view's width.
 * @property bottom the input view's bottom edge in window coordinates, or 0 before it has been
 *   laid out.
 * @property fallbackBottom a value at least as tall as the window, used to say "covers nothing"
 *   before the window has a height of its own. The display height is a safe choice.
 */
data class ImeWindowFrame(
    val width: Int,
    val bottom: Int,
    val fallbackBottom: Int,
)

/** A touchable rectangle in window pixels; [NONE] is an empty one. */
data class TouchableArea(
    val left: Int,
    val top: Int,
    val right: Int,
    val bottom: Int,
) {
    companion object {
        val NONE = TouchableArea(0, 0, 0, 0)
    }
}

/**
 * The insets to report, ready to copy into `InputMethodService.Insets`.
 *
 * [touchable] is meant for `TOUCHABLE_INSETS_REGION`; everything outside it goes to the app.
 */
data class ImeInsetsSpec(
    val contentTop: Int,
    val visibleTop: Int,
    val touchable: TouchableArea,
)

/**
 * What the full-height IME window reports to the window manager.
 *
 * The window is `MATCH_PARENT` so the Candidate detail bubble can float above the keyboard in
 * the same window, which makes the framework's default insets wrong: they would claim the
 * whole screen as keyboard and squash the app behind to nothing. Instead:
 *
 * - The content and visible insets are the keyboard's top, and opening the bubble never moves
 *   them. The app's resize or pan follows only those two numbers (the server builds the `ime()`
 *   insets source from them), so the bubble is invisible to the app's layout.
 * - While the bubble is closed only the keyboard is touchable and the transparent area above it
 *   passes touches straight to the app.
 * - While the bubble is open the whole window is touchable, so a tap on the app area reaches
 *   the keyboard and closes the bubble instead of acting on the app (#11, option A; LatinIME
 *   does the same while more-keys is showing).
 * - Before the keyboard has been laid out its top is unknown, and the window reports covering
 *   nothing rather than guessing, so the app does not flash-squash when the keyboard shows.
 *
 * Pure arithmetic, so the rules are testable without a window; `PinyinDuckImeService` copies
 * the result into the framework's `Insets`.
 */
object ImeInsets {
    fun compute(
        frame: ImeWindowFrame,
        keyboardTop: Int?,
        bubbleOpen: Boolean,
    ): ImeInsetsSpec {
        val laidOut = frame.bottom > 0
        if (keyboardTop == null || !laidOut) {
            val below = if (laidOut) frame.bottom else frame.fallbackBottom
            return ImeInsetsSpec(contentTop = below, visibleTop = below, touchable = TouchableArea.NONE)
        }
        val touchTop = if (bubbleOpen) 0 else keyboardTop
        return ImeInsetsSpec(
            contentTop = keyboardTop,
            visibleTop = keyboardTop,
            touchable = TouchableArea(left = 0, top = touchTop, right = frame.width, bottom = frame.bottom),
        )
    }
}
