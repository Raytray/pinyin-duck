package dev.pinyinduck.android.ime

import android.content.res.Configuration
import android.os.Looper
import android.view.KeyEvent
import android.view.inputmethod.EditorInfo
import dev.pinyinduck.android.data.DictionaryLoader
import dev.pinyinduck.android.ui.KeyAction
import dev.pinyinduck.android.ui.KeyLayout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ServiceController
import org.robolectric.annotation.Config

/**
 * The Candidate detail bubble, as the service drives it (#21).
 *
 * The rules are #11's: what opens it, what switches it, and everything that closes it. They
 * are asserted on the state the service owns, against the real dictionary and detail file the
 * APK ships, so "the bubble shows 猫's senses" is checked end to end rather than on a fixture.
 * Where the bubble is drawn and what it says is `KeyboardWindowTest`'s.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp")
class CandidateDetailServiceTest {
    private lateinit var controller: ServiceController<PinyinDuckImeService>
    private val service get() = controller.get()

    @Before
    fun setUp() {
        controller = Robolectric.buildService(PinyinDuckImeService::class.java)
        controller.get().openDictionary = { DictionaryLoader.openFromAssets(it) }
        controller.create()
        awaitDictionary()
    }

    @After
    fun tearDown() {
        controller.destroy()
    }

    // --- opening ------------------------------------------------------------------

    @Test
    fun longPressingACandidateOpensItsDetail() {
        type("mao")
        val cat = indexOf("猫")

        service.callbacks().onShowDetail(cat)

        val detail = assertNotNull(service.uiState.detail)
        assertEquals(cat, detail.index)
        assertEquals("猫", detail.candidate.hanzi)
        val senses = detail.view!!.groups.flatMap { group -> group.senses.map { it.text } }
        assertTrue("猫's senses were $senses", senses.any { "cat" in it })
    }

    @Test
    fun aDetailOpenedForAnIndexWithNoCandidateIsIgnored() {
        type("mao")

        service.callbacks().onShowDetail(service.uiState.candidates.size)

        assertFalse(service.uiState.detailOpen)
    }

    // --- keys while it is open -------------------------------------------------------

    @Test
    fun aLetterThatChangesTheCompositionClosesTheDetail() {
        type("mao")
        service.callbacks().onShowDetail(0)

        service.callbacks().onKey(KeyAction.Letter('z'))

        assertFalse(service.uiState.detailOpen)
        assertEquals("maoz", service.uiState.buffer)
    }

    @Test
    fun backspaceClosesTheDetail() {
        type("mao")
        service.callbacks().onShowDetail(0)

        service.callbacks().onKey(KeyAction.Backspace)

        assertFalse(service.uiState.detailOpen)
    }

    @Test
    fun aToneDigitChangesTheCompositionAndClosesTheDetail() {
        // On Android 1-5 are tone numbers while composing (PinyinDuckSession.typeDigit), so a
        // digit changes the composition rather than committing a candidate.
        type("mao")
        service.callbacks().onShowDetail(0)

        service.onKeyDown(KeyEvent.KEYCODE_1, keyEvent(KeyEvent.KEYCODE_1, '1'))

        assertFalse(service.uiState.detailOpen)
        assertEquals("mao1", service.uiState.buffer)
    }

    @Test
    fun spaceCommitsAndClosesTheDetail() {
        type("mao")
        service.callbacks().onShowDetail(0)

        service.onKeyDown(KeyEvent.KEYCODE_SPACE, keyEvent(KeyEvent.KEYCODE_SPACE, ' '))

        assertFalse(service.uiState.detailOpen)
        assertEquals("", service.uiState.buffer)
    }

    @Test
    fun tappingAStripCandidateCommitsItAndClosesTheDetail() {
        type("mao")
        service.callbacks().onShowDetail(0)

        service.callbacks().onSelectCandidate(1)

        assertFalse(service.uiState.detailOpen)
        assertEquals("", service.uiState.buffer)
    }

    @Test
    fun longPressingAnotherCandidateSwitchesTheDetailToIt() {
        type("mao")
        service.callbacks().onShowDetail(0)
        val cat = indexOf("猫")
        val other = if (cat == 1) 2 else 1

        service.callbacks().onShowDetail(other)

        assertEquals(other, service.uiState.detail?.index)
        assertEquals(service.uiState.candidates[other], service.uiState.detail?.candidate)
    }

    @Test
    fun clearingTheCompositionClosesTheDetail() {
        type("mao")
        service.callbacks().onShowDetail(0)

        service.callbacks().onClear()

        assertFalse(service.uiState.detailOpen)
    }

    @Test
    fun switchingScriptClosesTheDetailRatherThanShowingTheOldScript() {
        type("mao")
        service.callbacks().onShowDetail(0)

        service.callbacks().onToggleScript()

        assertFalse(service.uiState.detailOpen)
    }

    @Test
    fun openingTheExpandedListClosesTheStripsDetail() {
        // The strip candidate it was anchored to is no longer on screen.
        type("mao")
        service.callbacks().onShowDetail(0)

        service.callbacks().onToggleExpanded()

        assertFalse(service.uiState.detailOpen)
    }

    @Test
    fun keysThatLeaveTheCompositionAloneKeepTheDetailOpen() {
        type("mao")
        service.callbacks().onShowDetail(0)

        service.callbacks().onKey(KeyAction.Shift)
        service.callbacks().onKey(KeyAction.SwitchTo(KeyLayout.NUMBERS))
        service.onKeyDown(KeyEvent.KEYCODE_DPAD_RIGHT, keyEvent(KeyEvent.KEYCODE_DPAD_RIGHT))

        assertEquals(0, service.uiState.detail?.index)
    }

    // --- what else closes it ---------------------------------------------------------

    @Test
    fun hidingTheKeyboardClosesTheDetailAndShowingItAgainDoesNotReopenIt() {
        type("mao")
        service.callbacks().onShowDetail(0)

        service.onFinishInputView(true)
        service.onWindowHidden()
        service.onWindowShown()
        service.onStartInputView(EditorInfo(), true)

        assertFalse(service.uiState.detailOpen)
    }

    @Test
    fun theWindowHidingClosesTheDetail() {
        // Belt and braces next to onFinishInputView: the window can be hidden without the input
        // view finishing, e.g. when the user dismisses the keyboard from the navigation bar.
        type("mao")
        service.callbacks().onShowDetail(0)

        service.onWindowHidden()

        assertFalse(service.uiState.detailOpen)
    }

    @Test
    fun finishingTheInputClosesTheDetail() {
        type("mao")
        service.callbacks().onShowDetail(0)

        service.onFinishInput()

        assertFalse(service.uiState.detailOpen)
    }

    @Test
    fun aNewFieldClosesTheDetail() {
        type("mao")
        service.callbacks().onShowDetail(0)

        service.onStartInput(EditorInfo(), false)

        assertFalse(service.uiState.detailOpen)
    }

    @Test
    fun turningTheDeviceClosesTheDetail() {
        type("mao")
        service.callbacks().onShowDetail(0)

        val landscape = Configuration(service.resources.configuration).apply { orientation = Configuration.ORIENTATION_LANDSCAPE }
        service.onConfigurationChanged(landscape)

        assertFalse(service.uiState.detailOpen)
    }

    // --- Back and Esc ---------------------------------------------------------------

    @Test
    fun backWhileTheDetailIsOpenIsConsumedAndOnlyClosesIt() {
        type("mao")
        service.callbacks().onShowDetail(0)

        assertTrue("Back down was not consumed", service.onKeyDown(KeyEvent.KEYCODE_BACK, keyEvent(KeyEvent.KEYCODE_BACK)))
        assertTrue(
            "Back up was not consumed, so the framework would hide the keyboard too",
            service.onKeyUp(KeyEvent.KEYCODE_BACK, keyEvent(KeyEvent.KEYCODE_BACK, action = KeyEvent.ACTION_UP)),
        )

        assertFalse(service.uiState.detailOpen)
        assertEquals("the composition survives", "mao", service.uiState.buffer)
    }

    @Test
    fun aSecondBackIsLeftToTheSystem() {
        type("mao")
        service.callbacks().onShowDetail(0)
        service.onKeyDown(KeyEvent.KEYCODE_BACK, keyEvent(KeyEvent.KEYCODE_BACK))
        service.onKeyUp(KeyEvent.KEYCODE_BACK, keyEvent(KeyEvent.KEYCODE_BACK, action = KeyEvent.ACTION_UP))

        // The framework's own Back handling: with no input view shown it declines the key, which
        // is the same answer it gives with the bubble never opened.
        val closedAnswer = service.onKeyDown(KeyEvent.KEYCODE_BACK, keyEvent(KeyEvent.KEYCODE_BACK))
        assertFalse("a second Back was swallowed", closedAnswer)
    }

    @Test
    fun escapeWhileTheDetailIsOpenOnlyClosesItAndASecondEscapeCancels() {
        type("mao")
        service.callbacks().onShowDetail(0)

        assertTrue(service.onKeyDown(KeyEvent.KEYCODE_ESCAPE, keyEvent(KeyEvent.KEYCODE_ESCAPE)))
        assertFalse(service.uiState.detailOpen)
        assertEquals("mao", service.uiState.buffer)

        assertTrue(service.onKeyDown(KeyEvent.KEYCODE_ESCAPE, keyEvent(KeyEvent.KEYCODE_ESCAPE)))
        assertEquals("", service.uiState.buffer)
    }

    // --- from the Expanded candidate list (#22) ---------------------------------------

    @Test
    fun longPressingACardOpensItsDetailAndLeavesTheListOpen() {
        type("mao")
        service.callbacks().onToggleExpanded()
        val cat = indexOf("猫")

        service.callbacks().onShowDetail(cat)

        assertEquals(cat, service.uiState.detail?.index)
        assertTrue("the list closed under the bubble", service.uiState.expanded)
    }

    @Test
    fun longPressingAnotherCardSwitchesTheDetailAndTheListStaysOpen() {
        type("mao")
        service.callbacks().onToggleExpanded()
        service.callbacks().onShowDetail(0)

        service.callbacks().onShowDetail(3)

        assertEquals(service.uiState.candidates[3], service.uiState.detail?.candidate)
        assertTrue(service.uiState.expanded)
    }

    @Test
    fun tappingACardCommitsItAndClosesTheDetail() {
        type("mao")
        service.callbacks().onToggleExpanded()
        service.callbacks().onShowDetail(0)

        service.callbacks().onSelectCandidate(2)

        assertFalse(service.uiState.detailOpen)
        assertEquals("", service.uiState.buffer)
    }

    @Test
    fun backClosesOnlyTheDetailAndLeavesTheListOpen() {
        type("mao")
        service.callbacks().onToggleExpanded()
        service.callbacks().onShowDetail(0)

        assertTrue(service.onKeyDown(KeyEvent.KEYCODE_BACK, keyEvent(KeyEvent.KEYCODE_BACK)))
        assertTrue(service.onKeyUp(KeyEvent.KEYCODE_BACK, keyEvent(KeyEvent.KEYCODE_BACK, action = KeyEvent.ACTION_UP)))

        assertFalse(service.uiState.detailOpen)
        assertTrue(service.uiState.expanded)
        assertEquals("mao", service.uiState.buffer)
    }

    @Test
    fun escapeClosesOnlyTheDetailAndLeavesTheListOpen() {
        type("mao")
        service.callbacks().onToggleExpanded()
        service.callbacks().onShowDetail(0)

        assertTrue(service.onKeyDown(KeyEvent.KEYCODE_ESCAPE, keyEvent(KeyEvent.KEYCODE_ESCAPE)))

        assertFalse(service.uiState.detailOpen)
        assertTrue(service.uiState.expanded)
        assertEquals("mao", service.uiState.buffer)
    }

    @Test
    fun anOutsideTapClosesOnlyTheDetailAndLeavesTheListOpen() {
        type("mao")
        service.callbacks().onToggleExpanded()
        service.callbacks().onShowDetail(0)

        service.callbacks().onCloseDetail()

        assertFalse(service.uiState.detailOpen)
        assertTrue(service.uiState.expanded)
    }

    @Test
    fun collapsingTheListClosesItsDetail() {
        // The card it was anchored to is no longer on screen.
        type("mao")
        service.callbacks().onToggleExpanded()
        service.callbacks().onShowDetail(0)

        service.callbacks().onToggleExpanded()

        assertFalse(service.uiState.detailOpen)
        assertFalse(service.uiState.expanded)
    }

    // --- helpers ------------------------------------------------------------------

    private fun indexOf(hanzi: String): Int =
        service.uiState.candidates
            .indexOfFirst { it.hanzi == hanzi }
            .also { assertTrue("$hanzi is not a candidate for ${service.uiState.buffer}", it >= 0) }

    private fun type(text: String) =
        text.forEach { letter ->
            val keyCode = KeyEvent.KEYCODE_A + (letter - 'a')
            assertTrue(service.onKeyDown(keyCode, keyEvent(keyCode, letter)))
        }

    /** A hardware key press; see `PinyinDuckImeServiceTest.unowned` for why it is subclassed. */
    private fun keyEvent(
        keyCode: Int,
        unicode: Char = 0.toChar(),
        action: Int = KeyEvent.ACTION_DOWN,
    ) = object : KeyEvent(0L, 0L, action, keyCode, 0, 0) {
        override fun getUnicodeChar(): Int = unicode.code

        override fun getUnicodeChar(metaState: Int): Int = unicode.code
    }

    private fun awaitDictionary(timeoutMillis: Long = 30_000) {
        val main = shadowOf(Looper.getMainLooper())
        val deadline = System.nanoTime() + timeoutMillis * 1_000_000L
        while (service.uiState.loading && System.nanoTime() < deadline) {
            main.idle()
            Thread.sleep(5)
        }
        main.idle()
        assertFalse("the dictionary did not load", service.uiState.loading)
    }

    private fun <T : Any> assertNotNull(value: T?): T {
        assertNotNull("expected a value", value)
        return value!!
    }
}
