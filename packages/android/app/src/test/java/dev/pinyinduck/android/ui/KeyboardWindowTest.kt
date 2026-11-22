package dev.pinyinduck.android.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotDisplayed
import androidx.compose.ui.test.click
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.pinyinduck.android.engine.Candidate
import dev.pinyinduck.android.engine.DetailGroup
import dev.pinyinduck.android.engine.DetailView
import dev.pinyinduck.android.engine.DetailViewSense
import dev.pinyinduck.android.ime.KeyboardUiState
import dev.pinyinduck.android.ime.OpenDetail
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The full-height IME window's content: the keyboard on the bottom edge and, while it is open,
 * the Candidate detail bubble in the space above it (#16, #21), opened from the strip or from the
 * Expanded candidate list (#22).
 *
 * The window itself (size, insets, fullscreen) is `ImeWindowTest`'s and the rules for what
 * opens and closes the bubble are `CandidateDetailServiceTest`'s; this is what is drawn and
 * what a touch or an accessibility service can do with it.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp")
class KeyboardWindowTest {
    @get:Rule
    val compose = createComposeRule()

    private class Recorder {
        val keys = mutableListOf<KeyAction>()
        val details = mutableListOf<Int>()
        val selected = mutableListOf<Int>()
        var closes = 0
        var keyboardTop: Int? = null

        fun callbacks() =
            KeyboardCallbacks(
                onKey = { keys.add(it) },
                onSelectCandidate = { selected.add(it) },
                onToggleScript = {},
                onToggleExpanded = {},
                onClear = {},
                onShowDetail = { details.add(it) },
                onCloseDetail = { closes++ },
            )
    }

    // --- the window ---------------------------------------------------------------

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

    // --- opening --------------------------------------------------------------------

    @Test
    fun longPressingAStripCandidateAsksForItsDetail() {
        val recorder = Recorder()
        show(recorder, candidates = listOf(candidate("他"), candidate("她")))

        compose.onNodeWithText("她").performTouchInput { longClick() }

        assertEquals(listOf(1), recorder.details)
        assertEquals("a long press must not also commit", emptyList<Int>(), recorder.selected)
    }

    @Test
    fun aStripCandidateOpensItsDetailAfterAboutHalfASecond() {
        // #5: ~450 ms, whatever the platform's own timeout (400 or 500 ms by version).
        val recorder = Recorder()
        show(recorder, candidates = listOf(candidate("他"), candidate("她")))

        hold("她", SHORT_OF_LONG_PRESS_MS)
        assertEquals("a 420 ms press is still a tap", listOf(1), recorder.selected)
        assertEquals(emptyList<Int>(), recorder.details)

        hold("她", PAST_LONG_PRESS_MS)
        assertEquals(listOf(1), recorder.details)
    }

    @Test
    fun aTapOnAStripCandidateStillCommitsIt() {
        val recorder = Recorder()
        show(recorder, candidates = listOf(candidate("他"), candidate("她")))

        compose.onNodeWithText("她").performClick()

        assertEquals(listOf(1), recorder.selected)
        assertEquals(emptyList<Int>(), recorder.details)
    }

    @Test
    fun eachStripCandidateOffersShowDetailsAsAnAccessibilityAction() {
        val recorder = Recorder()
        show(recorder, candidates = listOf(candidate("他"), candidate("她")))

        val actions = compose.onNodeWithText("她").fetchSemanticsNode().config[SemanticsActions.CustomActions]
        val showDetails = actions.single { it.label == "Show details" }
        compose.runOnIdle { showDetails.action() }

        assertEquals(listOf(1), recorder.details)
    }

    @Test
    fun theBubbleIsHiddenUntilTheDetailIsOpen() {
        show(Recorder())

        compose.onAllNodesWithTag(DETAIL_BUBBLE_TAG).assertCountEquals(0)
    }

    // --- what it shows ------------------------------------------------------------

    @Test
    fun theBubbleShowsTheCandidateAndEveryLineOfItsDetail() {
        show(Recorder(), candidates = listOf(CAT), detail = OpenDetail(0, CAT, CAT_VIEW))

        for (text in listOf(
            "猫",
            "māo",
            "貓",
            "noun",
            "Surname Mao",
            "1",
            "cat",
            "2",
            "(dialect) to hide oneself",
            "Measure words",
            "只 zhī · 个 gè",
        )) {
            compose.onNode(inBubble(text)).assertExists("bubble line \"$text\"")
        }
    }

    @Test
    fun aGroupedCandidateShowsEachHeadwordsHeading() {
        val view =
            DetailView(
                counterpart = null,
                groups =
                    listOf(
                        group(heading = "後", senses = listOf("back")),
                        group(heading = "后", senses = listOf("empress")),
                    ),
            )
        show(Recorder(), candidates = listOf(candidate("后")), detail = OpenDetail(0, candidate("后"), view))

        compose.onNode(inBubble("後")).assertExists()
        compose.onNode(inBubble("back")).assertExists()
        compose.onNode(inBubble("empress")).assertExists()
    }

    @Test
    fun aDetailThatCouldNotBeReadSaysSoAndFallsBackOnTheShortGloss() {
        show(Recorder(), candidates = listOf(CAT), detail = OpenDetail(0, CAT, null))

        compose.onNode(inBubble("cat")).assertExists()
        compose.onNode(inBubble("Couldn't load details")).assertExists()
    }

    @Test
    fun theBubbleNeverReachesDownOverTheKeyboard() {
        show(Recorder(), candidates = listOf(CAT), detail = OpenDetail(0, CAT, CAT_VIEW))

        val bubble = compose.onNodeWithTag(DETAIL_BUBBLE_TAG).getBoundsInRoot()
        val keyboard = compose.onNodeWithTag(KEYBOARD_TAG).getBoundsInRoot()
        assertTrue("bubble bottom ${bubble.bottom} is below the keyboard top ${keyboard.top}", bubble.bottom <= keyboard.top)
    }

    @Test
    fun inAShortWindowTheBubbleFitsAboveTheKeyboardAndScrolls() {
        // Landscape on a phone leaves little room above the keyboard (#11).
        val view = DetailView(counterpart = null, groups = listOf(group(senses = (1..20).map { "sense $it" })))
        show(Recorder(), candidates = listOf(CAT), detail = OpenDetail(0, CAT, view), windowHeight = SHORT_WINDOW_HEIGHT)

        val bubble = compose.onNodeWithTag(DETAIL_BUBBLE_TAG).getBoundsInRoot()
        val keyboard = compose.onNodeWithTag(KEYBOARD_TAG).getBoundsInRoot()
        assertTrue("bubble top ${bubble.top} is above the window", bubble.top >= 0.dp)
        assertTrue("bubble bottom ${bubble.bottom} is below the keyboard top ${keyboard.top}", bubble.bottom <= keyboard.top)
        compose.onNode(inBubble("sense 20")).assertIsNotDisplayed()
        compose.onNode(inBubble("sense 20")).performScrollTo().assertIsDisplayed()
    }

    // --- where it goes ----------------------------------------------------------------

    @Test
    fun theBubbleSitsOverTheCandidateItWasOpenedForAndInsideTheRightEdge() {
        show(Recorder(), candidates = FOUR, detail = OpenDetail(3, FOUR[3], CAT_VIEW))

        assertBubbleOverAnchorAndInsideWindow("四")
    }

    @Test
    fun theBubbleSitsOverTheFirstCandidateAndInsideTheLeftEdge() {
        show(Recorder(), candidates = FOUR, detail = OpenDetail(0, FOUR[0], CAT_VIEW))

        assertBubbleOverAnchorAndInsideWindow("一")
    }

    @Test
    fun theBubbleFollowsTheCandidateWhenItSwitches() {
        var detail by mutableStateOf(OpenDetail(0, FOUR[0], CAT_VIEW))
        show(Recorder(), candidates = FOUR, detailState = { detail })
        val overFirst = compose.onNodeWithTag(DETAIL_BUBBLE_TAG).getBoundsInRoot()

        detail = OpenDetail(3, FOUR[3], CAT_VIEW)
        compose.waitForIdle()
        val overLast = compose.onNodeWithTag(DETAIL_BUBBLE_TAG).getBoundsInRoot()

        assertTrue("the bubble stayed at ${overFirst.left} rather than moving right", overLast.left > overFirst.left)
        // Clamped at the right edge, it ends where its margin says.
        assertEquals(compose.onRoot().getBoundsInRoot().right - 10.dp, overLast.right)
    }

    private fun assertBubbleOverAnchorAndInsideWindow(anchorText: String) {
        val window = compose.onRoot().getBoundsInRoot()
        val bubble = compose.onNodeWithTag(DETAIL_BUBBLE_TAG).getBoundsInRoot()
        val anchor = compose.onNode(inStrip(anchorText)).getBoundsInRoot()
        val anchorCentre = (anchor.left + anchor.right) / 2
        assertTrue(
            "bubble ${bubble.left}..${bubble.right} is not over $anchorText at $anchorCentre",
            anchorCentre > bubble.left && anchorCentre < bubble.right,
        )
        assertTrue("bubble starts off the window at ${bubble.left}", bubble.left >= window.left)
        assertTrue("bubble ends off the window at ${bubble.right}", bubble.right <= window.right)
        assertTrue("bubble fills the window", bubble.right - bubble.left < window.right - window.left)
    }

    // --- closing and committing -----------------------------------------------------

    @Test
    fun aTapOnTheAppAreaClosesTheBubble() {
        val recorder = Recorder()
        show(recorder, candidates = listOf(CAT), detail = OpenDetail(0, CAT, CAT_VIEW))

        compose.onNodeWithTag(APP_AREA_TAG).performTouchInput { click(topLeft) }

        assertEquals(1, recorder.closes)
        assertEquals(emptyList<Int>(), recorder.selected)
    }

    @Test
    fun theBubblesCloseButtonClosesIt() {
        val recorder = Recorder()
        show(recorder, candidates = listOf(CAT), detail = OpenDetail(0, CAT, CAT_VIEW))

        compose.onNodeWithTag(DETAIL_CLOSE_TAG).performClick()

        assertEquals(1, recorder.closes)
    }

    @Test
    fun useCommitsTheCandidateTheBubbleIsFor() {
        val recorder = Recorder()
        show(recorder, candidates = listOf(candidate("毛"), CAT), detail = OpenDetail(1, CAT, CAT_VIEW))

        compose.onNodeWithText("Use 猫").performClick()

        assertEquals(listOf(1), recorder.selected)
    }

    @Test
    fun theKeysStillWorkWhileTheBubbleIsOpen() {
        val recorder = Recorder()
        show(recorder, candidates = listOf(CAT), detail = OpenDetail(0, CAT, CAT_VIEW))

        compose.onNodeWithText("q").performClick()

        assertEquals(listOf<KeyAction>(KeyAction.Letter('q')), recorder.keys)
    }

    // --- accessibility ----------------------------------------------------------------

    @Test
    fun theBubbleIsAPaneTitledForItsCandidate() {
        show(Recorder(), candidates = listOf(CAT), detail = OpenDetail(0, CAT, CAT_VIEW))

        compose
            .onNodeWithTag(DETAIL_BUBBLE_TAG)
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.PaneTitle, "Details for 猫 māo"))
    }

    @Test
    fun closeAndUseAreFocusableButtons() {
        show(Recorder(), candidates = listOf(CAT), detail = OpenDetail(0, CAT, CAT_VIEW))

        for (node in listOf(compose.onNodeWithContentDescription("Close"), compose.onNodeWithText("Use 猫"))) {
            node.assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button))
            node.assertHasClickAction()
            node.assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Focused))
        }
    }

    @Test
    fun focusMovesToTheHeadingWhenTheBubbleOpensAndBackToTheCandidateWhenItCloses() {
        var detail by mutableStateOf<OpenDetail?>(null)
        show(Recorder(), candidates = listOf(candidate("毛"), CAT), detailState = { detail })

        detail = OpenDetail(1, CAT, CAT_VIEW)
        compose.waitForIdle()
        compose
            .onNodeWithTag(DETAIL_HEADING_TAG)
            .assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading))
            .assertIsFocused()

        detail = null
        compose.waitForIdle()
        compose.onNode(inStrip("猫")).assertIsFocused()
    }

    // --- from the Expanded candidate list (#22) -----------------------------------------

    @Test
    fun longPressingACardInTheExpandedListAsksForItsDetail() {
        val recorder = Recorder()
        show(recorder, candidates = listOf(candidate("他"), candidate("她")), expanded = true)

        compose.onNodeWithText("她").performTouchInput { longClick() }

        assertEquals(listOf(1), recorder.details)
        assertEquals("a long press must not also commit", emptyList<Int>(), recorder.selected)
    }

    @Test
    fun aCardInTheExpandedListOpensItsDetailAfterAboutHalfASecond() {
        val recorder = Recorder()
        show(recorder, candidates = listOf(candidate("他"), candidate("她")), expanded = true)

        hold("她", SHORT_OF_LONG_PRESS_MS)
        assertEquals("a 420 ms press is still a tap", listOf(1), recorder.selected)
        assertEquals(emptyList<Int>(), recorder.details)

        hold("她", PAST_LONG_PRESS_MS)
        assertEquals(listOf(1), recorder.details)
    }

    @Test
    fun aTapOnACardInTheExpandedListStillCommitsIt() {
        val recorder = Recorder()
        show(recorder, candidates = listOf(candidate("他"), candidate("她")), expanded = true)

        compose.onNodeWithText("她").performClick()

        assertEquals(listOf(1), recorder.selected)
        assertEquals(emptyList<Int>(), recorder.details)
    }

    @Test
    fun eachCardInTheExpandedListOffersShowDetailsAsAnAccessibilityAction() {
        val recorder = Recorder()
        show(recorder, candidates = listOf(candidate("他"), candidate("她")), expanded = true)

        val card = compose.onNodeWithText("她").fetchSemanticsNode()
        val showDetails = card.config[SemanticsActions.CustomActions].single { it.label == "Show details" }
        assertEquals("Show details", card.config[SemanticsActions.OnLongClick].label)
        compose.runOnIdle { showDetails.action() }

        assertEquals(listOf(1), recorder.details)
    }

    @Test
    fun theBubbleSitsOverACardInTheRightColumnAndInsideTheRightEdge() {
        // Two columns: 二 and 四 are on the right.
        show(Recorder(), candidates = FOUR, detail = OpenDetail(3, FOUR[3], CAT_VIEW), expanded = true)

        assertBubbleOverAnchorAndInsideWindow("四")
        // Centred in the window it would end 40 dp short of the edge; over 四 it is clamped.
        val right = compose.onRoot().getBoundsInRoot().right - 10.dp
        assertEquals(right, compose.onNodeWithTag(DETAIL_BUBBLE_TAG).getBoundsInRoot().right)
    }

    @Test
    fun theBubbleSitsOverACardInTheLeftColumnAndInsideTheLeftEdge() {
        show(Recorder(), candidates = FOUR, detail = OpenDetail(2, FOUR[2], CAT_VIEW), expanded = true)

        assertBubbleOverAnchorAndInsideWindow("三")
        assertEquals(10.dp, compose.onNodeWithTag(DETAIL_BUBBLE_TAG).getBoundsInRoot().left)
    }

    @Test
    fun inAShortWindowTheExpandedListMakesRoomForTheBubbleAndItScrolls() {
        // Without the list giving way, a landscape phone has no room at all above it (#22).
        val view = DetailView(counterpart = null, groups = listOf(group(senses = (1..20).map { "sense $it" })))
        show(
            Recorder(),
            candidates = FOUR,
            detail = OpenDetail(3, FOUR[3], view),
            windowHeight = SHORT_WINDOW_HEIGHT,
            expanded = true,
        )

        val bubble = compose.onNodeWithTag(DETAIL_BUBBLE_TAG).getBoundsInRoot()
        val keyboard = compose.onNodeWithTag(KEYBOARD_TAG).getBoundsInRoot()
        assertTrue("the bubble is only ${bubble.bottom - bubble.top} tall", bubble.bottom - bubble.top >= 100.dp)
        assertTrue("bubble top ${bubble.top} is above the window", bubble.top >= 0.dp)
        assertTrue("bubble bottom ${bubble.bottom} is below the keyboard top ${keyboard.top}", bubble.bottom <= keyboard.top)
        compose.onNode(inStrip("四")).assertIsDisplayed()
        compose.onNode(inBubble("sense 20")).assertIsNotDisplayed()
        compose.onNode(inBubble("sense 20")).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun theExpandedListShrinksWhileTheBubbleIsOpenAndComesBackWhenItCloses() {
        var detail by mutableStateOf<OpenDetail?>(null)
        val recorder = Recorder()
        show(recorder, candidates = FOUR, detailState = { detail }, expanded = true)
        val closedTop = compose.onNodeWithTag(KEYBOARD_TAG).getBoundsInRoot().top

        detail = OpenDetail(1, FOUR[1], CAT_VIEW)
        compose.waitForIdle()
        val openTop = compose.onNodeWithTag(KEYBOARD_TAG).getBoundsInRoot().top
        assertTrue("the keyboard top stayed at $openTop", openTop > closedTop)
        assertEquals("the insets follow the shorter keyboard", topInPx(openTop), recorder.keyboardTop)

        detail = null
        compose.waitForIdle()
        val restoredTop = compose.onNodeWithTag(KEYBOARD_TAG).getBoundsInRoot().top
        assertEquals(closedTop, restoredTop)
        assertEquals("the insets follow it back", topInPx(restoredTop), recorder.keyboardTop)
    }

    private fun topInPx(top: Dp) = with(compose.density) { top.toPx().toInt() }

    @Test
    fun theBubbleFollowsTheCardWhenItSwitchesWithinTheExpandedList() {
        var detail by mutableStateOf(OpenDetail(2, FOUR[2], CAT_VIEW))
        show(Recorder(), candidates = FOUR, detailState = { detail }, expanded = true)
        assertEquals(10.dp, compose.onNodeWithTag(DETAIL_BUBBLE_TAG).getBoundsInRoot().left)

        detail = OpenDetail(1, FOUR[1], CAT_VIEW)
        compose.waitForIdle()

        assertBubbleOverAnchorAndInsideWindow("二")
        assertEquals(compose.onRoot().getBoundsInRoot().right - 10.dp, compose.onNodeWithTag(DETAIL_BUBBLE_TAG).getBoundsInRoot().right)
    }

    @Test
    fun aTapOnTheAppAreaClosesABubbleOpenedFromTheExpandedList() {
        val recorder = Recorder()
        show(recorder, candidates = FOUR, detail = OpenDetail(1, FOUR[1], CAT_VIEW), expanded = true)

        compose.onNodeWithTag(APP_AREA_TAG).performTouchInput { click(topLeft) }

        assertEquals(1, recorder.closes)
        assertEquals(emptyList<Int>(), recorder.selected)
    }

    @Test
    fun closingABubbleOpenedFromTheExpandedListReturnsFocusToTheCard() {
        var detail by mutableStateOf<OpenDetail?>(null)
        show(Recorder(), candidates = listOf(candidate("毛"), CAT), detailState = { detail }, expanded = true)

        detail = OpenDetail(1, CAT, CAT_VIEW)
        compose.waitForIdle()
        compose.onNodeWithTag(DETAIL_HEADING_TAG).assertIsFocused()

        detail = null
        compose.waitForIdle()
        compose.onNode(inStrip("猫")).assertIsFocused()
    }

    // --- helpers ------------------------------------------------------------------

    /** Presses the node showing [text] for [millis] and lets go. */
    private fun hold(
        text: String,
        millis: Long,
    ) {
        compose.onNodeWithText(text).performTouchInput {
            down(center)
            advanceEventTime(millis)
            up()
        }
        compose.waitForIdle()
    }

    /** A node with [text] inside the bubble. */
    private fun inBubble(text: String) = within(DETAIL_BUBBLE_TAG, text)

    /** A strip candidate showing [text], rather than the bubble's copy of it. */
    private fun inStrip(text: String) = within(KEYBOARD_TAG, text)

    private fun within(
        tag: String,
        text: String,
    ) = SemanticsMatcher("has text \"$text\" inside $tag") { node ->
        val texts =
            node.config
                .getOrNull(SemanticsProperties.Text)
                ?.map { it.text }
                .orEmpty()
        text in texts &&
            generateSequence(node.parent) { it.parent }.any { it.config.getOrNull(SemanticsProperties.TestTag) == tag }
    }

    private fun show(
        recorder: Recorder,
        candidates: List<Candidate> = emptyList(),
        detail: OpenDetail? = null,
        windowHeight: Int = TALL_WINDOW_HEIGHT,
        detailState: () -> OpenDetail? = { detail },
        expanded: Boolean = false,
    ) {
        compose.setContent {
            PinyinDuckTheme {
                Box(Modifier.size(width = 400.dp, height = windowHeight.dp)) {
                    KeyboardWindow(
                        state =
                            KeyboardUiState(
                                loading = false,
                                buffer = if (candidates.isEmpty()) "" else "mao",
                                candidates = candidates,
                                total = candidates.size,
                                expanded = expanded,
                                detail = detailState(),
                            ),
                        callbacks = recorder.callbacks(),
                        onKeyboardTop = { recorder.keyboardTop = it },
                    )
                }
            }
        }
    }

    private companion object {
        const val TALL_WINDOW_HEIGHT = 800

        /** Either side of the bubble's 450 ms long press. */
        const val SHORT_OF_LONG_PRESS_MS = 420L
        const val PAST_LONG_PRESS_MS = 480L

        /**
         * Roughly a landscape phone: about 140 dp above a ~360 dp keyboard, inside the
         * ~100-150 dp #11 expects there.
         */
        const val SHORT_WINDOW_HEIGHT = 500

        fun candidate(
            hanzi: String,
            gloss: String = "",
        ) = Candidate(
            id = hanzi,
            hanzi = hanzi,
            simplified = hanzi,
            traditional = hanzi,
            pinyinMarks = "māo",
            pinyinNumbers = "mao1",
            shortGloss = gloss,
            frequency = 0,
            matchedPinyin = "",
            remainingPinyin = "",
        )

        fun group(
            heading: String? = null,
            partOfSpeech: String? = null,
            tags: List<String> = emptyList(),
            senses: List<String>,
            measureWords: List<String> = emptyList(),
        ) = DetailGroup(
            heading = heading,
            partOfSpeech = partOfSpeech,
            tags = tags,
            senses = senses.mapIndexed { i, text -> DetailViewSense(i + 1, text, proper = false) },
            measureWords = measureWords,
        )

        val CAT = candidate("猫", gloss = "cat").copy(traditional = "貓")

        val FOUR = listOf("一", "二", "三", "四").map { candidate(it) }

        val CAT_VIEW =
            DetailView(
                counterpart = "貓",
                groups =
                    listOf(
                        group(
                            partOfSpeech = "noun",
                            tags = listOf("Surname Mao"),
                            senses = listOf("cat", "(dialect) to hide oneself"),
                            measureWords = listOf("只 zhī", "个 gè"),
                        ),
                    ),
            )
    }
}
