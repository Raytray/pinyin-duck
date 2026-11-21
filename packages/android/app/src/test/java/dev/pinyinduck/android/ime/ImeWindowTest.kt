package dev.pinyinduck.android.ime

import org.junit.After
import org.junit.Assert.assertFalse
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
}
