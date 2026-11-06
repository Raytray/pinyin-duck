package dev.pinyinduck.android.ime

import android.os.Looper
import android.text.InputType
import android.view.KeyEvent
import android.view.inputmethod.EditorInfo
import androidx.compose.ui.platform.ComposeView
import androidx.lifecycle.Lifecycle
import dev.pinyinduck.android.engine.ScriptType
import dev.pinyinduck.android.engine.TestDictionary
import dev.pinyinduck.android.ui.KeyAction
import dev.pinyinduck.android.ui.KeyLayout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
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
 * The input method service, driven end to end.
 *
 * Everything below the service — the parser, the dictionary, the composition rules, the key
 * mapping — is tested directly elsewhere. What is left is the wiring: that the dictionary
 * actually loads, that a key press reaches the session, that the session's changes reach the
 * UI state, and that keys the keyboard does not own are handed back to the system. That last
 * one is the failure this exists to catch — consuming a key the app behind the keyboard
 * needed is silent and leaves no trace in any other test.
 *
 * There is no `ShadowInputMethodService`, so `currentInputConnection` is always null and the
 * text this keyboard would have committed is not observable. Every assertion is therefore
 * about state the service itself owns, which is the part the service is responsible for.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp")
class PinyinDuckImeServiceTest {
    private lateinit var controller: ServiceController<PinyinDuckImeService>
    private var destroyed = false
    private val service get() = controller.get()

    @Before
    fun setUp() {
        controller = Robolectric.buildService(PinyinDuckImeService::class.java).create()
    }

    @After
    fun tearDown() {
        if (!destroyed) controller.destroy()
    }

    /**
     * Tears the service down through the controller rather than by calling `onDestroy`.
     *
     * Robolectric's controller refuses a second destroy ("can be called only once"), so the
     * callback is not something a test may invoke directly — and calling the real Android
     * teardown path through the controller is the more honest test anyway. Note that
     * [ServiceController.get] is only usable before this, hence capturing the instance first.
     */
    private fun destroy() {
        controller.destroy()
        destroyed = true
    }

    // --- startup ----------------------------------------------------------------

    @Test
    fun theDictionaryLoadsAndTheKeyboardStopsSayingItIsLoading() {
        awaitDictionary()

        assertFalse(service.uiState.loading)
        assertNull(service.uiState.dictionaryError)
        // A floor rather than an exact count, so a deliberate CC-CEDICT bump does not have to
        // edit this test. See TestDictionary.MIN_ENTRY_COUNT.
        assertTrue(
            "the dictionary reported ${service.uiState.dictionaryEntries} entries",
            service.uiState.dictionaryEntries >= TestDictionary.MIN_ENTRY_COUNT,
        )
        assertNotNull("no session was created", service.session)
    }

    @Test
    fun theServiceSuppliesTheLifecycleComposeLooksFor() {
        // An IME has no view tree of its own, so the service provides the owner. Without it the
        // keyboard renders nothing and throws nothing, which makes this silent.
        assertEquals(Lifecycle.State.CREATED, service.lifecycle.currentState)
    }

    @Test
    fun theInputViewIsCreated() {
        val view = service.onCreateInputView()

        assertTrue("expected a ComposeView, got ${view.javaClass.name}", view is ComposeView)
    }

    // --- hardware keys ----------------------------------------------------------

    @Test
    fun typingLettersOnAHardwareKeyboardBuildsAComposition() {
        awaitDictionary()

        "nihao".forEach { press(letterKey(it), it) }

        assertEquals("nihao", service.uiState.buffer)
        assertEquals(
            "你好",
            service.uiState.candidates
                .first()
                .hanzi,
        )
    }

    @Test
    fun aKeyTheKeyboardDoesNotOwnIsLeftToTheSystem() {
        awaitDictionary()

        // Consuming any of these would steal it from the app being typed into.
        assertFalse(service.onKeyDown(KeyEvent.KEYCODE_VOLUME_UP, unowned(KeyEvent.KEYCODE_VOLUME_UP)))
        assertFalse(service.onKeyDown(KeyEvent.KEYCODE_TAB, unowned(KeyEvent.KEYCODE_TAB, '\t')))
        assertFalse(service.onKeyDown(KeyEvent.KEYCODE_CAMERA, unowned(KeyEvent.KEYCODE_CAMERA)))
    }

    @Test
    fun theSessionExistsBeforeTheDictionaryIsReady() {
        // `onCreate` loads on a background thread and posts the result to the main looper, so
        // the dictionary is genuinely absent for a while after the keyboard is on screen. The
        // session is built in `onCreate` regardless, because one created only at the end of the
        // load left every input path bailing out on a null session — the keyboard ate what the
        // user typed during the load, showed no candidates, and typed nothing at all.
        assertNotNull("no session until the dictionary finishes", service.session)
        assertTrue("the dictionary should still be loading", service.uiState.loading)
    }

    @Test
    fun aHardwareLetterBeforeTheDictionaryIsReadyComposesRatherThanPassingThrough() {
        // This used to return false, handing the key to the app as raw text, so the same letter
        // bypassed the engine on a hardware keyboard while the on-screen keyboard swallowed it.
        // One session answers for both, whichever keyboard produced the key.
        val handled = service.onKeyDown(KeyEvent.KEYCODE_N, unowned(KeyEvent.KEYCODE_N, 'n'))

        assertTrue("the keyboard refused a letter it owns", handled)
        assertEquals("n", service.uiState.buffer)
    }

    @Test
    fun aCompositionStartedDuringTheLoadIsRankedWhenTheDictionaryLands() {
        // Deterministic under Robolectric because the load is a real background thread and the
        // main looper is not drained until `awaitDictionary`. On a device the same thing happens
        // whenever the user types faster than the dictionary maps, which is why it only ever
        // showed up on a fresh entry and could not be reproduced on demand.
        val keys = service.callbacks()
        keys.onKey(KeyAction.Letter('n'))
        keys.onKey(KeyAction.Letter('i'))
        keys.onKey(KeyAction.Letter('h'))
        assertTrue("nothing can be ranked before the load", service.uiState.candidates.isEmpty())

        awaitDictionary()

        assertEquals("the pinyin typed during the load", "nih", service.uiState.buffer)
        assertTrue("the backlog was never ranked", service.uiState.candidates.isNotEmpty())
        assertEquals(0, service.uiState.selectedIndex)
    }

    @Test
    fun theDownArrowMovesTheSelectionByAWholePage() {
        awaitDictionary()
        type("ni")

        val last = service.uiState.candidates.size - 1
        val before = service.uiState.selectedIndex

        assertTrue(service.onKeyDown(KeyEvent.KEYCODE_DPAD_DOWN, unowned(KeyEvent.KEYCODE_DPAD_DOWN)))

        assertEquals((before + KeyRouting.PAGE_SIZE).coerceAtMost(last), service.uiState.selectedIndex)
    }

    @Test
    fun theLeftArrowMovesTheSelectionBackByOne() {
        awaitDictionary()
        type("ni")
        service.onKeyDown(KeyEvent.KEYCODE_DPAD_DOWN, unowned(KeyEvent.KEYCODE_DPAD_DOWN))
        val afterPage = service.uiState.selectedIndex

        assertTrue(service.onKeyDown(KeyEvent.KEYCODE_DPAD_LEFT, unowned(KeyEvent.KEYCODE_DPAD_LEFT)))

        assertEquals(afterPage - 1, service.uiState.selectedIndex)
    }

    @Test
    fun escapeAbandonsTheComposition() {
        awaitDictionary()
        type("ni")

        assertTrue(service.onKeyDown(KeyEvent.KEYCODE_ESCAPE, unowned(KeyEvent.KEYCODE_ESCAPE)))

        assertEquals("", service.uiState.buffer)
        assertTrue(service.uiState.candidates.isEmpty())
    }

    @Test
    fun aShiftedLetterStillTypesALowerCasePinyinLetter() {
        awaitDictionary()

        service.onKeyDown(KeyEvent.KEYCODE_N, unowned(KeyEvent.KEYCODE_N, 'N', shift = true))

        assertEquals("n", service.uiState.buffer)
    }

    // --- on-screen callbacks ----------------------------------------------------

    @Test
    fun tappingALetterKeyTypesIt() {
        awaitDictionary()
        val keys = service.callbacks()

        keys.onKey(KeyAction.Letter('n'))
        keys.onKey(KeyAction.Letter('i'))

        assertEquals("ni", service.uiState.buffer)
    }

    @Test
    fun shiftIsOneShotSoTheNextLetterIsNotUpperCase() {
        awaitDictionary()
        val keys = service.callbacks()

        keys.onKey(KeyAction.Shift)
        assertTrue(service.uiState.shift)

        keys.onKey(KeyAction.Letter('n'))

        assertFalse("shift should have dropped after a letter", service.uiState.shift)
        assertEquals("n", service.uiState.buffer)
    }

    @Test
    fun shiftChangesTheLabelOnlyAndNeverTheTypedLetter() {
        // `Keys` builds every letter action from a lower-case row and `Keyboard` uppercases
        // only for display. The session lowercases before searching, so a key that started
        // sending the upper-case character would type the same pinyin — but this pins the
        // invariant, because "fixing" the label to come from the action would break it.
        awaitDictionary()
        val keys = service.callbacks()
        keys.onKey(KeyAction.Shift)

        keys.onKey(KeyAction.Letter('n'))

        assertEquals("n", service.uiState.buffer)
    }

    @Test
    fun switchingToTheNumberLayerDropsShift() {
        awaitDictionary()
        val keys = service.callbacks()

        keys.onKey(KeyAction.Shift)
        keys.onKey(KeyAction.SwitchTo(KeyLayout.NUMBERS))

        assertEquals(KeyLayout.NUMBERS, service.uiState.layout)
        assertFalse(service.uiState.shift)
    }

    @Test
    fun theExpandButtonToggles() {
        awaitDictionary()
        val keys = service.callbacks()

        keys.onToggleExpanded()
        assertTrue(service.uiState.expanded)

        keys.onToggleExpanded()
        assertFalse(service.uiState.expanded)
    }

    @Test
    fun theExpandKeyOnTheKeyboardAlsoToggles() {
        awaitDictionary()

        service.callbacks().onKey(KeyAction.ToggleExpanded)

        assertTrue(service.uiState.expanded)
    }

    @Test
    fun tappingACandidateCommitsTheComposition() {
        awaitDictionary()
        val keys = service.callbacks()
        type("ni")
        assertTrue(service.uiState.candidates.isNotEmpty())

        keys.onSelectCandidate(0)

        // The pinyin in the editor is replaced by the characters, so the strip empties. The
        // text itself is written through the editor connection, which is null under
        // Robolectric and so cannot be asserted on here.
        assertEquals("", service.uiState.buffer)
        assertTrue(service.uiState.candidates.isEmpty())
        assertEquals(-1, service.uiState.selectedIndex)
    }

    @Test
    fun tappingBeyondTheEndOfTheStripIsIgnored() {
        // A stale index from a strip that has since re-paged would otherwise crash on a list
        // access, or worse, commit an unrelated candidate.
        awaitDictionary()
        val keys = service.callbacks()
        type("ni")

        keys.onSelectCandidate(9999)
        keys.onSelectCandidate(-1)

        assertEquals("ni", service.uiState.buffer)
    }

    @Test
    fun theScriptButtonTogglesTheScript() {
        awaitDictionary()
        type("n")
        assertEquals(ScriptType.SIMPLIFIED, service.uiState.script)

        service.callbacks().onToggleScript()

        assertEquals(ScriptType.TRADITIONAL, service.uiState.script)
    }

    @Test
    fun theScriptKeyOnTheKeyboardAlsoToggles() {
        awaitDictionary()

        service.callbacks().onKey(KeyAction.ToggleScript)

        assertEquals(ScriptType.TRADITIONAL, service.uiState.script)
    }

    @Test
    fun theClearButtonEmptiesTheComposition() {
        awaitDictionary()
        type("n")

        service.callbacks().onClear()

        assertEquals("", service.uiState.buffer)
    }

    @Test
    fun aPunctuationKeyEndsTheCompositionRatherThanExtendingIt() {
        // `ni` then `。` should commit the pinyin and add the full stop. Appending it to the
        // buffer instead would produce a composition that can never match anything.
        awaitDictionary()
        type("ni")

        service.callbacks().onKey(KeyAction.Symbol("。"))

        assertEquals("", service.uiState.buffer)
    }

    @Test
    fun aToneDigitIsTreatedAsAToneRatherThanAsACandidateNumber() {
        // On a phone candidates are tapped, so a digit during a composition means a tone.
        awaitDictionary()
        type("ni")

        service.callbacks().onKey(KeyAction.Digit(3))

        assertEquals("ni3", service.uiState.buffer)
        assertTrue(service.uiState.candidates.isNotEmpty())
    }

    @Test
    fun backspaceShortensTheComposition() {
        awaitDictionary()
        type("ni")

        service.callbacks().onKey(KeyAction.Backspace)

        assertEquals("n", service.uiState.buffer)
    }

    @Test
    fun aSpaceCommitsTheTopCandidate() {
        awaitDictionary()
        type("nihao")

        service.callbacks().onKey(KeyAction.Space)

        assertEquals("", service.uiState.buffer)
        assertTrue(service.uiState.candidates.isEmpty())
    }

    @Test
    fun theControlKeysAreHarmlessBeforeTheDictionaryIsReady() {
        // A tap can land before the background load finishes. None of these may crash, and none
        // may leave a half-applied key behind for the next one to build on.
        val keys = service.callbacks()

        keys.onSelectCandidate(0)
        keys.onClear()
        keys.onToggleExpanded()

        assertEquals("", service.uiState.buffer)
    }

    @Test
    fun aTappedLetterIsNotSwallowedBeforeTheDictionaryIsReady() {
        // The regression itself. The tap was consumed by the Compose key and then dropped by the
        // `session ?: return` guard, so the character vanished with nothing on screen to show
        // that it had ever arrived.
        val keys = service.callbacks()

        keys.onKey(KeyAction.Letter('n'))
        keys.onKey(KeyAction.Letter('i'))

        assertEquals("ni", service.uiState.buffer)
    }

    @Test
    fun theScriptToggledDuringTheLoadIsNotRolledBackWhenItLands() {
        // The 简/繁 toggle is live while loading, so the load must not re-read the stored
        // preference on completion and silently undo the user's own choice.
        val keys = service.callbacks()
        keys.onToggleScript()
        assertEquals(ScriptType.TRADITIONAL, service.uiState.script)

        awaitDictionary()

        assertEquals(ScriptType.TRADITIONAL, service.uiState.script)
    }

    // --- input lifecycle --------------------------------------------------------

    @Test
    fun startingANewFieldResetsTheKeyboard() {
        awaitDictionary()
        val keys = service.callbacks()
        type("n")
        keys.onKey(KeyAction.Shift)
        keys.onToggleExpanded()
        keys.onKey(KeyAction.SwitchTo(KeyLayout.SYMBOLS))

        service.onStartInput(EditorInfo(), restarting = false)

        assertEquals("", service.uiState.buffer)
        assertFalse(service.uiState.shift)
        assertFalse(service.uiState.expanded)
        assertEquals(KeyLayout.LETTERS, service.uiState.layout)
    }

    // --- field types -------------------------------------------------------------

    /** Starts a field declaring [inputType], the way the platform does on focus. */
    private fun focusField(inputType: Int) {
        service.onStartInput(EditorInfo().also { it.inputType = inputType }, restarting = false)
    }

    /**
     * Taps [text] on the on-screen keyboard and asserts none of it was composed.
     *
     * The composition is what would expose a password, so the check is that the buffer never
     * held anything and no candidates were ever ranked, rather than what reached the editor,
     * which Robolectric cannot observe.
     */
    private fun assertTypedDirectly(text: String) {
        val keys = service.callbacks()
        for (char in text) {
            if (char.isDigit()) keys.onKey(KeyAction.Digit(char - '0')) else keys.onKey(KeyAction.Letter(char))
            assertEquals("'$char' was composed", "", service.uiState.buffer)
            assertTrue("'$char' produced candidates", service.uiState.candidates.isEmpty())
        }
    }

    @Test
    fun aPlainTextFieldComposesPinyin() {
        awaitDictionary()
        focusField(InputType.TYPE_CLASS_TEXT)

        service.callbacks().onKey(KeyAction.Letter('n'))

        assertFalse(service.fieldPolicy.direct)
        assertEquals(KeyLayout.LETTERS, service.uiState.layout)
        assertEquals("n", service.uiState.buffer)
        assertTrue(service.uiState.candidates.isNotEmpty())
    }

    @Test
    fun passwordFieldsAreTypedWithoutCompositionOrCandidates() {
        awaitDictionary()
        for (type in listOf(
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD,
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD,
        )) {
            focusField(type)
            assertTrue("inputType $type", service.fieldPolicy.direct)
            assertEquals(KeyLayout.LETTERS, service.uiState.layout)
            assertTypedDirectly("nihao123")
        }
    }

    @Test
    fun aNumericPasswordOpensOnDigitsAndIsTypedDirectly() {
        awaitDictionary()
        focusField(InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD)

        assertEquals(KeyLayout.NUMBERS, service.uiState.layout)
        assertTypedDirectly("1234")
    }

    @Test
    fun numberPhoneAndDateFieldsOpenOnTheNumberPage() {
        awaitDictionary()
        for (type in listOf(
            InputType.TYPE_CLASS_NUMBER,
            InputType.TYPE_CLASS_PHONE,
            InputType.TYPE_CLASS_DATETIME,
        )) {
            focusField(type)
            assertEquals("inputType $type", KeyLayout.NUMBERS, service.uiState.layout)
            assertTypedDirectly("12")
        }
    }

    @Test
    fun emailAndUrlFieldsAreTypedDirectly() {
        awaitDictionary()
        for (type in listOf(
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS,
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS,
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI,
        )) {
            focusField(type)
            assertEquals("inputType $type", KeyLayout.LETTERS, service.uiState.layout)
            assertTypedDirectly("xian")
        }
    }

    @Test
    fun aDirectFieldLeavesHardwareKeysToTheApp() {
        awaitDictionary()
        focusField(InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)

        // Not consumed, so the app receives the key with its own case and modifiers; the
        // session would have lowercased a shifted letter.
        assertFalse(service.onKeyDown(KeyEvent.KEYCODE_N, unowned(KeyEvent.KEYCODE_N, 'N', shift = true)))
        assertFalse(service.onKeyDown(KeyEvent.KEYCODE_SPACE, unowned(KeyEvent.KEYCODE_SPACE, ' ')))
        assertEquals("", service.uiState.buffer)
    }

    @Test
    fun leavingAPasswordFieldForATextFieldComposesAgain() {
        awaitDictionary()
        focusField(InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        focusField(InputType.TYPE_CLASS_TEXT)

        type("ni")

        assertEquals("ni", service.uiState.buffer)
        assertTrue(service.uiState.candidates.isNotEmpty())
    }

    @Test
    fun finishingInputAbandonsTheComposition() {
        awaitDictionary()
        type("n")

        service.onFinishInput()

        assertEquals("", service.uiState.buffer)
    }

    @Test
    fun theInputViewDrivesTheLifecycleSoComposeStaysAttached() {
        awaitDictionary()

        service.onStartInputView(EditorInfo(), restarting = false)
        assertEquals(Lifecycle.State.STARTED, service.lifecycle.currentState)

        service.onFinishInputView(finishingInput = true)
        assertEquals(Lifecycle.State.CREATED, service.lifecycle.currentState)
    }

    @Test
    fun destroyingTheServiceReleasesEverything() {
        awaitDictionary()
        val svc = service
        assertNotNull(svc.session)

        destroy()

        assertNull("the session outlived the service", svc.session)
        assertEquals(Lifecycle.State.DESTROYED, svc.lifecycle.currentState)
    }

    @Test
    fun destroyingBeforeTheDictionaryFinishesIsHarmless() {
        // The user can switch away from the keyboard while the dictionary is still mapping.
        // No dictionary is loaded, so there is nothing to close, and tearing down must not
        // block. The session does exist by now, and is released like anything else.
        val svc = service
        assertNotNull(svc.session)
        assertTrue(svc.uiState.loading)

        destroy()

        assertEquals(Lifecycle.State.DESTROYED, svc.lifecycle.currentState)
        assertNull("the session outlived the service", svc.session)
    }

    @Test
    fun destroyingTheServiceCancelsAnInFlightDictionaryLoad() {
        // The load is real I/O on a background thread, so it is still running when the user
        // switches away. Cancelling the scope must discard the result: no dictionary is
        // installed, the keyboard never claims to be ready, and nothing is resurrected.
        val svc = service
        assertTrue("the dictionary should still be loading", svc.uiState.loading)

        destroy()
        // Drain the main looper. Without cancellation the pending continuation would run
        // here and install the engine; with it, the coroutine is already cancelled and the
        // continuation throws instead.
        shadowOf(Looper.getMainLooper()).idle()

        assertTrue("a cancelled load must not clear the loading flag", svc.uiState.loading)
        assertEquals("a cancelled load must not install a dictionary", 0, svc.uiState.dictionaryEntries)
        assertNull("a cancelled load must not resurrect the session", svc.session)
    }

    // --- helpers ----------------------------------------------------------------

    /** Types [text] one hardware letter at a time. */
    private fun type(text: String) = text.forEach { press(letterKey(it), it) }

    private fun press(
        keyCode: Int,
        letter: Char,
    ) {
        assertTrue(
            "the keyboard refused to handle '$letter'",
            service.onKeyDown(keyCode, unowned(keyCode, letter)),
        )
    }

    /** The `KEYCODE_A`-style key code for a lowercase letter, e.g. `a` -> `KEYCODE_A`. */
    private fun letterKey(letter: Char): Int = KeyEvent.KEYCODE_A + (letter.lowercaseChar() - 'a')

    /**
     * A key event carrying a specific character.
     *
     * `getUnicodeChar` is derived from the key code and meta state, and a synthetic event
     * cannot be persuaded to report a character that does not match its code — shift+N really
     * does produce `N`, but the tone digit on a phone keyboard has no key code at all. So the
     * event is subclassed to report the character the test means, which is exactly the part of
     * the event the keyboard reads.
     */
    private fun unowned(
        keyCode: Int,
        unicode: Char = 0.toChar(),
        shift: Boolean = false,
    ) = object : KeyEvent(
        0L,
        0L,
        KeyEvent.ACTION_DOWN,
        keyCode,
        0,
        if (shift) KeyEvent.META_SHIFT_ON else 0,
    ) {
        override fun getUnicodeChar(): Int = unicode.code

        override fun getUnicodeChar(metaState: Int): Int = unicode.code
    }

    /**
     * Waits for the background dictionary load and drains the main looper.
     *
     * This is one of the few places where waiting is right: the load is a real thread doing
     * real `mmap`, not a scheduler Robolectric controls, so no idling call can be told when it
     * has finished.
     */
    private fun awaitDictionary(timeoutMillis: Long = 30_000) {
        val main = shadowOf(Looper.getMainLooper())
        val deadline = System.nanoTime() + timeoutMillis * 1_000_000L
        while (service.uiState.loading && System.nanoTime() < deadline) {
            main.idle()
            Thread.sleep(5)
        }
        main.idle()
        assertFalse(
            "the dictionary did not finish loading within ${timeoutMillis}ms",
            service.uiState.loading,
        )
    }
}
