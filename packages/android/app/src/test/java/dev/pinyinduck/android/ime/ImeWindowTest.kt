package dev.pinyinduck.android.ime

import android.graphics.Color
import android.graphics.Rect
import android.inputmethodservice.InputMethodService
import android.view.ContextThemeWrapper
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.inputmethod.EditorInfo
import dev.pinyinduck.android.R
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.android.controller.ServiceController
import org.robolectric.annotation.Config

/**
 * The IME window the Candidate detail bubble is drawn in.
 *
 * The bubble floats over the host app inside the keyboard's own window, which only works if
 * the window is full height, transparent, never fullscreen, and reports insets that stop at
 * the top of the keyboard. Each of those is a framework default this service overrides, and
 * getting one wrong is silent in every other test: the app behind squashes, or swallows no
 * touches, or the bubble has no room. See `docs/research/android-ime-bubble.md` (#10).
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp")
class ImeWindowTest {
    private lateinit var controller: ServiceController<PinyinDuckImeService>
    private val service get() = controller.get()

    @Before
    fun setUp() {
        controller = Robolectric.buildService(PinyinDuckImeService::class.java)
        // The dictionary plays no part in the window; keep the load off the real asset.
        controller.get().openDictionary = { error("not needed for window tests") }
        controller.create()
    }

    @After
    fun tearDown() {
        controller.destroy()
    }

    // --- fullscreen (extract) mode ----------------------------------------------

    @Test
    @Config(qualifiers = "w891dp-h411dp-land")
    fun theKeyboardIsNeverFullscreenInLandscape() {
        // The framework default is fullscreen in landscape, which leaves no room above the
        // strip for the bubble (#11 turned it off everywhere).
        assertFalse(service.onEvaluateFullscreenMode())
    }

    @Test
    fun theKeyboardIsNeverFullscreenInPortrait() {
        assertFalse(service.onEvaluateFullscreenMode())
    }

    // --- the window ---------------------------------------------------------------

    @Test
    fun theWindowTheInputAreaAndTheInputViewAllFillTheScreen() {
        val view = service.onCreateInputView()
        service.setInputView(view)

        assertFullHeight(view)
    }

    @Test
    fun aFullscreenModeUpdateDoesNotShrinkTheWindowBackToTheKeyboard() {
        // The framework resets the window to WRAP_CONTENT whenever it re-evaluates fullscreen
        // mode, which it does on every configuration change and input start.
        val view = service.onCreateInputView()
        service.setInputView(view)

        service.updateFullscreenMode()

        assertFullHeight(view)
    }

    @Test
    fun theWindowBackgroundIsTransparent() {
        // The window now covers the app, so any background colour would paint over it; the
        // keyboard draws its own.
        val themed = ContextThemeWrapper(service, R.style.Theme_PinyinDuck_Ime)
        val attrs = themed.obtainStyledAttributes(intArrayOf(android.R.attr.windowBackground))
        try {
            assertEquals(Color.TRANSPARENT, attrs.getColor(0, Color.RED))
        } finally {
            attrs.recycle()
        }
    }

    private fun assertFullHeight(view: android.view.View) {
        val window = checkNotNull(service.window.window)
        assertEquals("window height", MATCH_PARENT, window.attributes.height)
        val inputArea = window.findViewById<android.view.View>(android.R.id.inputArea)
        assertEquals("inputArea height", MATCH_PARENT, inputArea.layoutParams.height)
        assertEquals("input view height", MATCH_PARENT, view.layoutParams.height)
    }

    // --- insets -----------------------------------------------------------------

    @Test
    fun beforeTheFirstLayoutTheInsetsCoverNothing() {
        service.setInputView(service.onCreateInputView())

        val insets = computeInsets()

        val displayHeight = service.resources.displayMetrics.heightPixels
        assertTrue("content top ${insets.contentTopInsets} is above the display bottom", insets.contentTopInsets >= displayHeight)
        assertTrue("visible top ${insets.visibleTopInsets} is above the display bottom", insets.visibleTopInsets >= displayHeight)
        assertEquals(InputMethodService.Insets.TOUCHABLE_INSETS_REGION, insets.touchableInsets)
        assertTrue("something is touchable before layout", insets.touchableRegion.isEmpty)
    }

    @Test
    fun onceLaidOutTheInsetsStopAtTheKeyboardTop() {
        layOut(width = 1080, height = 2200, keyboardTop = 1400)

        val insets = computeInsets()

        assertEquals(1400, insets.contentTopInsets)
        assertEquals(1400, insets.visibleTopInsets)
        assertEquals(InputMethodService.Insets.TOUCHABLE_INSETS_REGION, insets.touchableInsets)
        assertEquals(Rect(0, 1400, 1080, 2200), insets.touchableRegion.bounds)
    }

    @Test
    fun whileTheDetailIsOpenTheWholeWindowIsTouchableAndTheInsetsStayPut() {
        layOut(width = 1080, height = 2200, keyboardTop = 1400)

        service.callbacks().onShowDetail(0)
        val insets = computeInsets()

        assertEquals(1400, insets.contentTopInsets)
        assertEquals(1400, insets.visibleTopInsets)
        assertEquals(Rect(0, 0, 1080, 2200), insets.touchableRegion.bounds)
    }

    @Test
    fun closingTheDetailHandsTheAppAreaBackToTheApp() {
        layOut(width = 1080, height = 2200, keyboardTop = 1400)

        service.callbacks().onShowDetail(0)
        service.callbacks().onCloseDetail()

        assertEquals(Rect(0, 1400, 1080, 2200), computeInsets().touchableRegion.bounds)
    }

    // --- what else closes the bubble ----------------------------------------------

    @Test
    fun hidingTheKeyboardClosesTheDetail() {
        // Otherwise the next show would open with the whole window swallowing the app's touches.
        service.callbacks().onShowDetail(0)

        service.onFinishInputView(true)

        assertFalse(service.uiState.detailOpen)
    }

    @Test
    fun aNewFieldClosesTheDetail() {
        service.callbacks().onShowDetail(0)

        service.onStartInput(EditorInfo(), false)

        assertFalse(service.uiState.detailOpen)
    }

    /**
     * Gives the input view a known frame, and reports where the keyboard landed.
     *
     * Robolectric never attaches the input view to a real window, and a `ComposeView` refuses
     * to measure without one, so the frame is set directly and the Compose layout that reports
     * the keyboard's top on device is stood in for by a direct report.
     */
    private fun layOut(
        width: Int,
        height: Int,
        keyboardTop: Int,
    ) {
        val view = service.onCreateInputView()
        service.setInputView(view)
        view.left = 0
        view.top = 0
        view.right = width
        view.bottom = height
        service.onKeyboardTop(keyboardTop)
    }

    private fun computeInsets() = InputMethodService.Insets().also { service.onComputeInsets(it) }
}
