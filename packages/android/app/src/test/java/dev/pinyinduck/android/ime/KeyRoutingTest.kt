package dev.pinyinduck.android.ime

import android.view.KeyEvent
import android.view.inputmethod.EditorInfo
import dev.pinyinduck.android.ui.KeyAction
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Hardware key routing.
 *
 * The mapping from a key event to what the keyboard does. This is where an IME quietly goes
 * wrong: swallowing a key the app behind it needed, or sending a tone digit as plain text.
 */
class KeyRoutingTest {
    // --- keys the keyboard owns -------------------------------------------------

    @Test
    fun spaceCommitsTheCandidate() {
        assertEquals(
            KeyRouting.Outcome.Act(KeyAction.Space),
            KeyRouting.route(KeyEvent.KEYCODE_SPACE),
        )
    }

    @Test
    fun backspaceDeletes() {
        assertEquals(
            KeyRouting.Outcome.Act(KeyAction.Backspace),
            KeyRouting.route(KeyEvent.KEYCODE_DEL),
        )
    }

    @Test
    fun escapeCancelsTheComposition() {
        assertEquals(KeyRouting.Outcome.Cancel, KeyRouting.route(KeyEvent.KEYCODE_ESCAPE))
    }

    @Test
    fun bothEnterKeysSendTheEditorAction() {
        assertEquals(KeyRouting.Outcome.Enter, KeyRouting.route(KeyEvent.KEYCODE_ENTER))
        assertEquals(KeyRouting.Outcome.Enter, KeyRouting.route(KeyEvent.KEYCODE_NUMPAD_ENTER))
    }

    @Test
    fun theArrowKeysMoveTheSelection() {
        assertEquals(KeyRouting.Outcome.Move(-1), KeyRouting.route(KeyEvent.KEYCODE_DPAD_LEFT))
        assertEquals(KeyRouting.Outcome.Move(1), KeyRouting.route(KeyEvent.KEYCODE_DPAD_RIGHT))
        assertEquals(KeyRouting.Outcome.MoveByPage(-1), KeyRouting.route(KeyEvent.KEYCODE_DPAD_UP))
        assertEquals(KeyRouting.Outcome.MoveByPage(1), KeyRouting.route(KeyEvent.KEYCODE_DPAD_DOWN))
    }

    // --- while the Candidate detail bubble is open ---------------------------------

    @Test
    fun backAndEscapeOnlyCloseAnOpenDetail() {
        // #11: both are consumed and close the bubble, nothing else; the second press is the
        // ordinary one.
        assertEquals(KeyRouting.Outcome.CloseDetail, KeyRouting.route(KeyEvent.KEYCODE_BACK, detailOpen = true))
        assertEquals(KeyRouting.Outcome.CloseDetail, KeyRouting.route(KeyEvent.KEYCODE_ESCAPE, detailOpen = true))
    }

    @Test
    fun withTheDetailClosedBackIsStillTheSystemsAndEscapeStillCancels() {
        assertNull(KeyRouting.route(KeyEvent.KEYCODE_BACK, detailOpen = false))
        assertEquals(KeyRouting.Outcome.Cancel, KeyRouting.route(KeyEvent.KEYCODE_ESCAPE, detailOpen = false))
    }

    @Test
    fun otherKeysRouteTheSameWhileTheDetailIsOpen() {
        for (keyCode in listOf(KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_DEL, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_DPAD_LEFT)) {
            assertEquals(KeyRouting.route(keyCode), KeyRouting.route(keyCode, detailOpen = true))
        }
        assertEquals(KeyRouting.route(KeyEvent.KEYCODE_A, 'a'), KeyRouting.route(KeyEvent.KEYCODE_A, 'a', detailOpen = true))
        assertNull(KeyRouting.route(KeyEvent.KEYCODE_VOLUME_UP, detailOpen = true))
    }

    // --- letters ---------------------------------------------------------------

    @Test
    fun lowercaseLettersTypePinyin() {
        assertEquals(
            KeyRouting.Outcome.Act(KeyAction.Letter('n')),
            KeyRouting.route(KeyEvent.KEYCODE_N, unicode = 'n'),
        )
    }

    @Test
    fun anUppercaseLetterStillTypesALowercaseLetter() {
        // The session lowercases the query before searching, so shift must not change what
        // syllable the buffer holds.
        assertEquals(
            KeyRouting.Outcome.Act(KeyAction.Letter('n')),
            KeyRouting.route(KeyEvent.KEYCODE_N, unicode = 'N', shift = true),
        )
        assertEquals(
            KeyRouting.Outcome.Act(KeyAction.Letter('n')),
            KeyRouting.route(KeyEvent.KEYCODE_N, unicode = 'N', shift = false),
        )
    }

    @Test
    fun theApostropheIsPartOfThePinyin() {
        // `xi'an` is 西安, so the apostrophe must reach the buffer rather than be dropped.
        assertEquals(
            KeyRouting.Outcome.Act(KeyAction.Letter('\'')),
            KeyRouting.route(KeyEvent.KEYCODE_APOSTROPHE, unicode = '\''),
        )
    }

    @Test
    fun digitsRouteAsDigitsRatherThanLetters() {
        // Whether a digit is a tone number depends on whether a composition is active, which
        // only the session knows, so the digit is passed through unchanged.
        assertEquals(
            KeyRouting.Outcome.Act(KeyAction.Digit(4)),
            KeyRouting.route(KeyEvent.KEYCODE_4, unicode = '4'),
        )
        assertEquals(
            KeyRouting.Outcome.Act(KeyAction.Digit(0)),
            KeyRouting.route(KeyEvent.KEYCODE_0, unicode = '0'),
        )
    }

    // --- keys the keyboard must not touch ---------------------------------------

    @Test
    fun anUnrelatedKeyIsLeftToTheSystem() {
        // Consuming a key the keyboard does not handle would stop the app behind it from
        // ever seeing it, so these must return null.
        for (keyCode in listOf(
            KeyEvent.KEYCODE_CAMERA,
            KeyEvent.KEYCODE_VOLUME_UP,
            KeyEvent.KEYCODE_DPAD_CENTER,
            KeyEvent.KEYCODE_TAB,
            KeyEvent.KEYCODE_SEARCH,
            KeyEvent.KEYCODE_BACK,
        )) {
            assertNull(
                "key code $keyCode must not be consumed",
                KeyRouting.route(keyCode),
            )
        }
    }

    @Test
    fun aKeyWithNoUnicodeIsLeftToTheSystem() {
        assertNull(KeyRouting.route(KeyEvent.KEYCODE_SHIFT_LEFT))
        assertNull(KeyRouting.route(KEYCODE_UNKNOWN, unicode = 0.toChar()))
    }

    @Test
    fun punctuationWithNoPinyinRoleIsLeftToTheSystem() {
        // The on-screen keyboard has its own symbol layer, so these are not wired to letters.
        for (char in listOf('.', ',', ';', '/', '@', '#')) {
            assertNull(
                "'$char' must not be claimed as a key",
                KeyRouting.route(KEYCODE_UNKNOWN, unicode = char),
            )
        }
    }

    @Test
    fun theHomeAndEndKeysAreLeftToTheField() {
        // The field owns caret movement; the keyboard only owns the candidate selection.
        assertNull(KeyRouting.route(KeyEvent.KEYCODE_MOVE_HOME))
        assertNull(KeyRouting.route(KeyEvent.KEYCODE_MOVE_END))
    }

    // --- editor actions --------------------------------------------------------

    @Test
    fun aFieldWithAnActionUsesIt() {
        assertTrue(KeyRouting.usesEditorAction(EditorInfo.IME_ACTION_SEARCH))
        assertEquals(
            EditorInfo.IME_ACTION_SEARCH,
            KeyRouting.editorAction(EditorInfo.IME_ACTION_SEARCH),
        )
    }

    @Test
    fun aFieldWithNoActionSendsAKeyEvent() {
        assertFalse(KeyRouting.usesEditorAction(EditorInfo.IME_ACTION_NONE))
        assertFalse(KeyRouting.usesEditorAction(EditorInfo.IME_ACTION_UNSPECIFIED))
        assertNull(KeyRouting.editorAction(EditorInfo.IME_ACTION_NONE))
    }

    @Test
    fun anAbsentEditorInfoIsTreatedAsNoAction() {
        assertFalse(KeyRouting.usesEditorAction(null))
        assertNull(KeyRouting.editorAction(null))
    }

    @Test
    fun theEditorActionIsMaskedOutOfTheOptions() {
        // `imeOptions` packs the action with flags such as `IME_FLAG_NO_FULLSCREEN`, so only
        // the action bits may be read.
        val options = EditorInfo.IME_ACTION_DONE or EditorInfo.IME_FLAG_NO_FULLSCREEN or EditorInfo.IME_FLAG_NO_EXTRACT_UI
        assertEquals(EditorInfo.IME_ACTION_DONE, KeyRouting.editorAction(options))
    }

    private companion object {
        /** A key code that is not one the keyboard handles. */
        const val KEYCODE_UNKNOWN = KeyEvent.KEYCODE_BUTTON_A
    }
}
