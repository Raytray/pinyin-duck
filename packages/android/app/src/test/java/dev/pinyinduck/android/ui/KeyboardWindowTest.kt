package dev.pinyinduck.android.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotDisplayed
import androidx.compose.ui.test.click
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import dev.pinyinduck.android.engine.Candidate
import dev.pinyinduck.android.ime.KeyboardUiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The full-height IME window's content: the keyboard on the bottom edge and, while it is open,
 * the stub Candidate detail bubble in the space above it.
 *
 * The window itself (size, insets, fullscreen) is `ImeWindowTest`'s; this is what is drawn in
 * it. The bubble is a stub with fixed placeholder content (#16), so nothing here is about the
 * detail data, only where the bubble goes and how it closes.
 */
@RunWith(RobolectricTestRunner::class)
class KeyboardWindowTest {
    @get:Rule
    val compose = createComposeRule()

    private class Recorder {
        val keys = mutableListOf<KeyAction>()
        val details = mutableListOf<Int>()
        var closes = 0
        var keyboardTop: Int? = null

        fun callbacks() =
            KeyboardCallbacks(
                onKey = { keys.add(it) },
                onSelectCandidate = {},
                onToggleScript = {},
                onToggleExpanded = {},
                onClear = {},
                onShowDetail = { details.add(it) },
                onCloseDetail = { closes++ },
            )
    }

    @Test
    fun theKeyboardSitsOnTheBottomEdgeOfTheWindow() {
        show(Recorder())

        val window = compose.onRoot().getBoundsInRoot()
        val keyboard = compose.onNodeWithTag(KEYBOARD_TAG).getBoundsInRoot()
        assertEquals(window.bottom, keyboard.bottom)
        assertTrue("the keyboard fills the window", keyboard.top > window.top)
    }

    @Test
    fun theKeyboardReportsWhereItsTopLanded() {
        val recorder = Recorder()
        show(recorder)

        val keyboardTopPx =
            with(compose.density) {
                compose
                    .onNodeWithTag(KEYBOARD_TAG)
                    .getBoundsInRoot()
                    .top
                    .toPx()
            }
        assertEquals(keyboardTopPx.toInt(), recorder.keyboardTop)
    }

    @Test
    fun longPressingAStripCandidateAsksForItsDetail() {
        val recorder = Recorder()
        show(recorder, candidates = listOf(candidate("他"), candidate("她")))

        compose.onNodeWithText("她").performTouchInput { longClick() }

        assertEquals(listOf(1), recorder.details)
    }

    @Test
    fun theBubbleIsHiddenUntilTheDetailIsOpen() {
        show(Recorder())

        compose.onAllNodesWithTag(DETAIL_BUBBLE_TAG).assertCountEquals(0)
    }

    @Test
    fun theStubBubbleShowsWhileTheDetailIsOpen() {
        show(Recorder(), detailIndex = 0)

        compose.onNodeWithTag(DETAIL_BUBBLE_TAG).assertIsDisplayed()
    }

    @Test
    fun aTapOnTheAppAreaClosesTheBubble() {
        val recorder = Recorder()
        show(recorder, detailIndex = 0)

        compose.onNodeWithTag(APP_AREA_TAG).performTouchInput { click(topLeft) }

        assertEquals(1, recorder.closes)
    }

    @Test
    fun theBubblesCloseButtonClosesIt() {
        val recorder = Recorder()
        show(recorder, detailIndex = 0)

        compose.onNodeWithTag(DETAIL_CLOSE_TAG).performClick()

        assertEquals(1, recorder.closes)
    }

    @Test
    fun theKeysStillWorkWhileTheBubbleIsOpen() {
        val recorder = Recorder()
        show(recorder, detailIndex = 0)

        compose.onNodeWithText("q").performClick()

        assertEquals(listOf<KeyAction>(KeyAction.Letter('q')), recorder.keys)
        assertEquals(0, recorder.closes)
    }

    @Test
    fun theBubbleNeverReachesDownOverTheKeyboard() {
        show(Recorder(), detailIndex = 0)

        val bubble = compose.onNodeWithTag(DETAIL_BUBBLE_TAG).getBoundsInRoot()
        val keyboard = compose.onNodeWithTag(KEYBOARD_TAG).getBoundsInRoot()
        assertTrue("bubble bottom ${bubble.bottom} is below the keyboard top ${keyboard.top}", bubble.bottom <= keyboard.top)
    }

    @Test
    fun inAShortWindowTheBubbleFitsAboveTheKeyboardAndScrolls() {
        // Landscape on a phone leaves little room above the keyboard (#11 measured it on
        // device); the stub's placeholder content is taller than that on purpose.
        show(Recorder(), detailIndex = 0, windowHeight = SHORT_WINDOW_HEIGHT)

        val bubble = compose.onNodeWithTag(DETAIL_BUBBLE_TAG).getBoundsInRoot()
        val keyboard = compose.onNodeWithTag(KEYBOARD_TAG).getBoundsInRoot()
        assertTrue("bubble top ${bubble.top} is above the window", bubble.top >= 0.dp)
        assertTrue("bubble bottom ${bubble.bottom} is below the keyboard top ${keyboard.top}", bubble.bottom <= keyboard.top)
        // The last placeholder line does not fit, and scrolling the content brings it into view.
        compose.onNodeWithText(LAST_PLACEHOLDER_LINE).assertIsNotDisplayed()
        compose.onNodeWithText(LAST_PLACEHOLDER_LINE).performScrollTo().assertIsDisplayed()
    }

    private fun show(
        recorder: Recorder,
        candidates: List<Candidate> = emptyList(),
        detailIndex: Int? = null,
        windowHeight: Int = TALL_WINDOW_HEIGHT,
    ) {
        compose.setContent {
            PinyinDuckTheme {
                Box(Modifier.size(width = 400.dp, height = windowHeight.dp)) {
                    KeyboardWindow(
                        state =
                            KeyboardUiState(
                                loading = false,
                                buffer = if (candidates.isEmpty()) "" else "ta",
                                candidates = candidates,
                                total = candidates.size,
                                detailIndex = detailIndex,
                            ),
                        callbacks = recorder.callbacks(),
                        onKeyboardTop = { recorder.keyboardTop = it },
                    )
                }
            }
        }
    }

    private fun candidate(hanzi: String) =
        Candidate(
            id = hanzi,
            hanzi = hanzi,
            simplified = hanzi,
            traditional = hanzi,
            pinyinMarks = "tā",
            pinyinNumbers = "ta1",
            shortGloss = "",
            frequency = 0,
            matchedPinyin = "",
            remainingPinyin = "",
        )

    private companion object {
        const val TALL_WINDOW_HEIGHT = 800

        /** Roughly a landscape phone: a little room above a ~300 dp keyboard. */
        const val SHORT_WINDOW_HEIGHT = 420

        const val LAST_PLACEHOLDER_LINE = "Placeholder line 20"
    }
}
