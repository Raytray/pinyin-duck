package dev.pinyinduck.android.ime

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * What the keyboard tells the window manager about the space it covers.
 *
 * The window is full height so the Candidate detail bubble can float over the app, but the
 * app must only ever see the keyboard: the content and visible insets stop at the keyboard's
 * top whether or not the bubble is open, or the app resizes on every long press. Touches go
 * to the app above the keyboard while the bubble is closed, and to the keyboard everywhere
 * while it is open, so an outside tap can close it (#11, option A).
 *
 * The numbers are a 1080 x 2200 px window with the keyboard's top at 1400 px.
 */
class ImeInsetsTest {
    @Test
    fun theAppIsCoveredOnlyDownFromTheKeyboardTop() {
        val insets = ImeInsets.compute(WINDOW, keyboardTop = 1400, bubbleOpen = false)

        assertEquals(1400, insets.contentTop)
        assertEquals(1400, insets.visibleTop)
    }

    @Test
    fun onlyTheKeyboardIsTouchableWhileTheBubbleIsClosed() {
        val insets = ImeInsets.compute(WINDOW, keyboardTop = 1400, bubbleOpen = false)

        assertEquals(TouchableArea(left = 0, top = 1400, right = 1080, bottom = 2200), insets.touchable)
    }

    @Test
    fun theWholeWindowIsTouchableWhileTheBubbleIsOpen() {
        val insets = ImeInsets.compute(WINDOW, keyboardTop = 1400, bubbleOpen = true)

        assertEquals(TouchableArea(left = 0, top = 0, right = 1080, bottom = 2200), insets.touchable)
    }

    @Test
    fun openingTheBubbleNeverMovesTheInsetsTheAppResizesFor() {
        val closed = ImeInsets.compute(WINDOW, keyboardTop = 1400, bubbleOpen = false)
        val open = ImeInsets.compute(WINDOW, keyboardTop = 1400, bubbleOpen = true)

        assertEquals(closed.contentTop, open.contentTop)
        assertEquals(closed.visibleTop, open.visibleTop)
    }

    @Test
    fun beforeTheFirstLayoutTheKeyboardCoversNothing() {
        // Until the keyboard has been measured its top is unknown, and reporting the default
        // (the top of a MATCH_PARENT frame) would squash the app for a frame on every show.
        val insets = ImeInsets.compute(WINDOW, keyboardTop = null, bubbleOpen = false)

        assertEquals(2200, insets.contentTop)
        assertEquals(2200, insets.visibleTop)
        assertEquals(TouchableArea.NONE, insets.touchable)
    }

    @Test
    fun beforeTheWindowIsLaidOutTheFallbackHeightCoversNothing() {
        // A window of height zero has not been laid out at all, so its bottom is no measure of
        // "below everything"; the display height is.
        val unlaid = ImeWindowFrame(width = 0, bottom = 0, fallbackBottom = 2400)

        val insets = ImeInsets.compute(unlaid, keyboardTop = null, bubbleOpen = true)

        assertEquals(2400, insets.contentTop)
        assertEquals(2400, insets.visibleTop)
        assertEquals(TouchableArea.NONE, insets.touchable)
    }

    private companion object {
        val WINDOW = ImeWindowFrame(width = 1080, bottom = 2200, fallbackBottom = 2400)
    }
}
