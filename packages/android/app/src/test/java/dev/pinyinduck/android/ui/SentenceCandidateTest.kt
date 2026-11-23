package dev.pinyinduck.android.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotDisplayed
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasAnyDescendant
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpRect
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
 * Sentence candidates on the keyboard (#46, decided on #36): a double-width slot in the strip,
 * a full-width card in the Expanded candidate list, and the stacked per-word Candidate detail.
 *
 * What the session does with a commit is `PinyinDuckSessionTest`'s, and what the service puts
 * in the detail is `CandidateDetailServiceTest`'s; this is what is drawn and what a touch or an
 * accessibility service can do with it.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp")
class SentenceCandidateTest {
    @get:Rule
    val compose = createComposeRule()

    private class Recorder {
        val selected = mutableListOf<Int>()
        val details = mutableListOf<Int>()
        val wordDetails = mutableListOf<Pair<Int, Int>>()
        var expandedToggles = 0

        fun callbacks() =
            KeyboardCallbacks(
                onKey = {},
                onSelectCandidate = { selected.add(it) },
                onToggleScript = {},
                onToggleExpanded = { expandedToggles++ },
                onClear = {},
                onShowDetail = { details.add(it) },
                onShowWordDetail = { index, word -> wordDetails.add(index to word) },
            )
    }

    // --- the strip ------------------------------------------------------------------

    @Test
    fun theStripShowsASentenceAsInterlinearWordBlocks() {
        show(Recorder(), candidates = listOf(COFFEE, candidate("我", "wǒ")))

        val slot = compose.onNodeWithTag(SENTENCE_SLOT_TAG).getBoundsInRoot()
        for (text in listOf("wǒ", "我", "I; me; my")) {
            compose.onNode(hasText(text) and hasAnyAncestor(hasTestTag(SENTENCE_SLOT_TAG)), useUnmergedTree = true).assertIsDisplayed()
        }
        val word =
            compose
                .onNode(
                    hasText("我") and hasAnyAncestor(hasTestTag(KEYBOARD_TAG)) and !hasAnyAncestor(hasTestTag(SENTENCE_SLOT_TAG)),
                    useUnmergedTree = true,
                ).getBoundsInRoot()
        val slotWidth = slot.right - slot.left
        val wordWidth = word.right - word.left
        assertTrue("the slot is $slotWidth wide against a word's $wordWidth", slotWidth > wordWidth)
    }

    @Test
    fun aLongSentenceShowsTheWordsThatFitThenCountsTheRest() {
        show(Recorder(), candidates = listOf(TOO_LONG, candidate("我", "wǒ")))

        val slot = compose.onNodeWithTag(SENTENCE_SLOT_TAG).getBoundsInRoot()
        val words = TOO_LONG.words!!
        val shown = words.count { isShownInSlot(it.hanzi) }
        assertTrue("no word of the sentence is shown", shown > 0)
        assertTrue("all ${words.size} words fit, so the test needs a longer sentence", shown < words.size)
        assertEquals(
            "the words shown are not the first ones",
            (0 until shown).toList(),
            words.indices.filter { isShownInSlot(words[it].hanzi) },
        )
        val chip = compose.onNodeWithTag(MORE_WORDS_CHIP_TAG, useUnmergedTree = true)
        chip.assertTextEquals("+${words.size - shown}")
        assertInside(slot, chip.unclippedBounds(), "the +N chip")
        assertWordsEndBefore(chip.unclippedBounds().left, words.take(shown))
    }

    @Test
    fun aPartialSentenceKeepsRoomForBothChips() {
        // The prototype fitted the words first and clipped the leftover chip off the end.
        val partial = TOO_LONG.copy(remainingPinyin = "hekafe")
        show(Recorder(), candidates = listOf(partial, candidate("我", "wǒ")))

        val slot = compose.onNodeWithTag(SENTENCE_SLOT_TAG).getBoundsInRoot()
        val more = compose.onNodeWithTag(MORE_WORDS_CHIP_TAG, useUnmergedTree = true).unclippedBounds()
        val leftover = compose.onNodeWithTag(LEFTOVER_CHIP_TAG, useUnmergedTree = true)
        leftover.assertTextEquals("+hekafe")
        assertInside(slot, more, "the +N chip")
        assertInside(slot, leftover.unclippedBounds(), "the leftover chip")
        assertTrue("the chips overlap", more.right <= leftover.unclippedBounds().left)
    }

    @Test
    fun aSentenceThatFitsHasNoCountChip() {
        show(Recorder(), candidates = listOf(sentence(WO, HE, remaining = "fe")))

        assertTrue(isShownInSlot("我") && isShownInSlot("喝"))
        compose.onAllNodesWithTag(MORE_WORDS_CHIP_TAG, useUnmergedTree = true).assertCountEquals(0)
        compose.onNodeWithTag(LEFTOVER_CHIP_TAG, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun aSentenceDoesNotChangeTheKeyboardsHeight() {
        // Variant A was rejected for adding a row whenever a sentence showed (#36).
        var candidates by mutableStateOf(listOf(candidate("我", "wǒ", "I; me; my"), candidate("窝", "wō", "nest")))
        show(Recorder(), candidatesState = { candidates })
        val words = compose.onNodeWithTag(KEYBOARD_TAG).getBoundsInRoot()

        candidates = listOf(LONG.copy(remainingPinyin = "fe")) + candidates
        compose.waitForIdle()
        val withSentence = compose.onNodeWithTag(KEYBOARD_TAG).getBoundsInRoot()

        assertEquals(words.top, withSentence.top)
        assertEquals(words.bottom, withSentence.bottom)
    }

    @Test
    fun tappingTheSlotCommitsTheSentence() {
        val recorder = Recorder()
        show(recorder, candidates = listOf(candidate("我", "wǒ"), COFFEE))

        compose.onNodeWithTag(SENTENCE_SLOT_TAG).performClick()

        assertEquals(listOf(1), recorder.selected)
    }

    @Test
    fun longPressingTheSlotOpensTheExpandedListNotTheDetail() {
        // #36: in the list nothing is cut short, and its card opens the detail per word.
        val recorder = Recorder()
        show(recorder, candidates = listOf(COFFEE, candidate("我", "wǒ")))

        compose.onNodeWithTag(SENTENCE_SLOT_TAG).performTouchInput { longClick() }

        assertEquals(1, recorder.expandedToggles)
        assertEquals(emptyList<Int>(), recorder.details)
        assertEquals("a long press must not also commit", emptyList<Int>(), recorder.selected)
    }

    @Test
    fun theSlotsShowDetailsActionOpensTheDetailDirectly() {
        // A timed press to reach the list and then a second press is not discoverable.
        val recorder = Recorder()
        show(recorder, candidates = listOf(candidate("我", "wǒ"), COFFEE))

        val slot = compose.onNodeWithTag(SENTENCE_SLOT_TAG).fetchSemanticsNode()
        val showDetails = slot.config[SemanticsActions.CustomActions].single { it.label == "Show details" }
        assertEquals("Show all candidates", slot.config[SemanticsActions.OnLongClick].label)
        compose.runOnIdle { showDetails.action() }

        assertEquals(listOf(1), recorder.details)
        assertEquals(0, recorder.expandedToggles)
    }

    @Test
    fun theSlotReadsAsTheWholeSentence() {
        show(Recorder(), candidates = listOf(COFFEE.copy(remainingPinyin = "fe")))

        compose
            .onNodeWithTag(SENTENCE_SLOT_TAG)
            .assertContentDescriptionEquals("Sentence 我想喝咖啡, wǒ xiǎng hē kā fēi, then fe")
    }

    // --- the Expanded candidate list ---------------------------------------------------

    @Test
    fun theSentenceIsAFullWidthCardAboveTheWordGrid() {
        show(Recorder(), candidates = listOf(COFFEE, candidate("我", "wǒ"), candidate("窝", "wō")), expanded = true)

        val card = compose.onNodeWithTag(SENTENCE_CARD_TAG).getBoundsInRoot()
        val first = compose.onNode(hasText("窝") and !hasAnyAncestor(hasTestTag(SENTENCE_CARD_TAG))).getBoundsInRoot()
        val second = compose.onNode(hasText("我") and !hasAnyAncestor(hasTestTag(SENTENCE_CARD_TAG))).getBoundsInRoot()
        assertTrue(
            "the card at ${card.left}..${card.right} does not span both columns",
            card.left <= minOf(first.left, second.left) && card.right >= maxOf(first.right, second.right),
        )
        assertTrue("the words are not below the card", first.top >= card.bottom && second.top >= card.bottom)
        for (word in COFFEE.words!!) {
            compose.onNodeWithContentDescription(wordDescription(word), useUnmergedTree = true).assertIsDisplayed()
        }
    }

    @Test
    fun aLongSentenceWrapsOntoMoreRowsInTheCard() {
        show(Recorder(), candidates = listOf(TOO_LONG), expanded = true)

        val first =
            compose
                .onNodeWithContentDescription(
                    wordDescription(TOO_LONG.words!!.first()),
                    useUnmergedTree = true,
                ).unclippedBounds()
        val second =
            compose
                .onNodeWithContentDescription(
                    wordDescription(TOO_LONG.words!!.last()),
                    useUnmergedTree = true,
                ).unclippedBounds()
        assertTrue("the last word at $second is on the first row with $first", second.top >= first.bottom)
    }

    @Test
    fun theWordBlocksInTheCardDescribeTheirWord() {
        show(Recorder(), candidates = listOf(COFFEE), expanded = true)

        compose.onNodeWithContentDescription("咖啡, kā fēi, coffee", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun tappingTheCardOrOneOfItsWordsCommitsTheWholeSentence() {
        val recorder = Recorder()
        show(recorder, candidates = listOf(candidate("我", "wǒ"), COFFEE), expanded = true)

        compose.onNodeWithTag(SENTENCE_CARD_TAG).performClick()
        compose.onNodeWithContentDescription(wordDescription(KAFEI), useUnmergedTree = true).performClick()

        assertEquals(listOf(1, 1), recorder.selected)
    }

    @Test
    fun longPressingAWordInTheCardOpensTheDetailAtThatWord() {
        val recorder = Recorder()
        show(recorder, candidates = listOf(candidate("我", "wǒ"), COFFEE), expanded = true)

        compose.onNodeWithContentDescription(wordDescription(HE), useUnmergedTree = true).performTouchInput { longClick() }

        assertEquals(listOf(1 to 2), recorder.wordDetails)
        assertEquals(emptyList<Int>(), recorder.details)
        assertEquals(emptyList<Int>(), recorder.selected)
    }

    @Test
    fun longPressingElsewhereOnTheCardOpensTheDetailFromTheTop() {
        val recorder = Recorder()
        show(recorder, candidates = listOf(candidate("我", "wǒ"), COFFEE), expanded = true)

        // The card's right end, past its last word.
        compose.onNodeWithTag(SENTENCE_CARD_TAG).performTouchInput { longClick(centerRight - Offset(8f, 0f)) }

        assertEquals(listOf(1), recorder.details)
        assertEquals(emptyList<Pair<Int, Int>>(), recorder.wordDetails)
    }

    @Test
    fun theCardOffersShowDetailsAsAnAccessibilityAction() {
        val recorder = Recorder()
        show(recorder, candidates = listOf(COFFEE), expanded = true)

        val card = compose.onNodeWithTag(SENTENCE_CARD_TAG).fetchSemanticsNode()
        compose.runOnIdle { card.config[SemanticsActions.CustomActions].single { it.label == "Show details" }.action() }

        assertEquals(listOf(0), recorder.details)
    }

    // --- the Candidate detail ----------------------------------------------------------

    @Test
    fun theDetailStacksASectionPerWordWithTwoSensesPerGroup() {
        show(Recorder(), candidates = listOf(LONG), detail = longDetail())

        for (word in LONG.words!!) compose.onNode(inBubble(word.hanzi)).assertExists("the section for ${word.hanzi}")
        compose.onNode(inBubble("醫院")).assertExists("医院's counterpart")
        compose.onNode(inBubble("to go")).assertExists()
        compose.onNode(inBubble("to leave")).assertExists()
        compose.onAllNodes(inBubble("to remove")).assertCountEquals(0)
        compose.onNode(inBubble("+12 more")).assertExists()
    }

    @Test
    fun theSentencesReadingHasALineOfItsOwnBelowUse() {
        // The prototype squeezed the reading into a narrow column beside "Use …" (#36).
        show(Recorder(), candidates = listOf(LONG), detail = longDetail())

        val reading = compose.onNode(inBubble(LONG.pinyinMarks)).getBoundsInRoot()
        val use = compose.onNodeWithContentDescription("Use ${LONG.hanzi}").getBoundsInRoot()
        val bubble = compose.onNodeWithTag(DETAIL_BUBBLE_TAG).getBoundsInRoot()
        assertTrue(
            "the reading at ${reading.top}..${reading.bottom} shares a row with Use at ${use.top}..${use.bottom}",
            reading.top >= use.bottom,
        )
        assertTrue("the reading starts at ${reading.left}, not the bubble's edge at ${bubble.left}", reading.left - bubble.left <= 16.dp)
    }

    @Test
    fun aPartialSentencesDetailSaysWhatIsComposedNext() {
        val partial = COFFEE.copy(remainingPinyin = "fe")
        show(Recorder(), candidates = listOf(partial), detail = OpenDetail(0, partial, null, wordViews = listOf(null, null, null, null)))

        compose.onNode(inBubble("then compose ‘fe’", substring = true)).assertExists()
    }

    @Test
    fun useCommitsTheSentence() {
        val recorder = Recorder()
        show(
            recorder,
            candidates = listOf(candidate("我", "wǒ"), COFFEE),
            detail = OpenDetail(1, COFFEE, null, wordViews = listOf(null, null, null, null)),
        )

        compose.onNodeWithContentDescription("Use 我想喝咖啡").performClick()

        assertEquals(listOf(1), recorder.selected)
    }

    @Test
    fun aWordWhoseDetailCouldNotBeReadFallsBackOnItsShortGloss() {
        show(Recorder(), candidates = listOf(COFFEE), detail = OpenDetail(0, COFFEE, null, wordViews = listOf(null, null, null, null)))

        compose.onNode(inBubble("(loanword) coffee")).assertExists()
        compose.onNode(inBubble("Couldn't load details")).assertExists()
    }

    @Test
    fun aDetailOpenedAtAWordIsScrolledToItAndHighlightsIt() {
        show(Recorder(), candidates = listOf(LONG), detail = longDetail(focusWord = 7), windowHeight = SHORT_WINDOW_HEIGHT)
        compose.waitForIdle()

        compose.onNode(inBubble("看")).assertIsDisplayed()
        compose.onNode(inBubble("然后")).assertIsNotDisplayed()
        compose.onNode(wordSection("看")).assertIsSelected()
        compose.onNode(wordSection("喝")).assertIsNotSelected()
    }

    @Test
    fun aDetailOpenedFromTheCardStartsAtTheTopWithNoWordHighlighted() {
        show(Recorder(), candidates = listOf(LONG), detail = longDetail(), windowHeight = SHORT_WINDOW_HEIGHT)
        compose.waitForIdle()

        compose.onNode(inBubble("我")).assertIsDisplayed()
        compose.onNode(inBubble("看")).assertIsNotDisplayed()
        for (word in LONG.words!!) compose.onNode(wordSection(word.hanzi)).assertIsNotSelected()
    }

    // --- helpers --------------------------------------------------------------------

    private fun longDetail(focusWord: Int? = null) =
        OpenDetail(
            index = 0,
            candidate = LONG,
            view = null,
            wordViews =
                LONG.words!!.map { word ->
                    when (word) {
                        QU -> view(senses = listOf("to go", "to leave") + (1..12).map { "to remove $it" })
                        YIYUAN -> view(counterpart = "醫院", senses = listOf("hospital"))
                        else -> view(senses = listOf(wordGloss(word.shortGloss)))
                    }
                },
            focusWord = focusWord,
        )

    private fun view(
        counterpart: String? = null,
        senses: List<String>,
    ) = DetailView(
        counterpart = counterpart,
        groups =
            listOf(
                DetailGroup(
                    null,
                    null,
                    emptyList(),
                    senses.mapIndexed {
                        i,
                        text,
                        ->
                        DetailViewSense(i + 1, text, false)
                    },
                    emptyList(),
                ),
            ),
    )

    /** A node with [text] inside the bubble. */
    private fun inBubble(
        text: String,
        substring: Boolean = false,
    ) = hasText(text, substring = substring) and hasAnyAncestor(hasTestTag(DETAIL_BUBBLE_TAG))

    /** The bubble's section for the word written [hanzi]. */
    private fun wordSection(hanzi: String) = hasTestTag(DETAIL_WORD_TAG) and hasAnyDescendant(hasText(hanzi))

    private fun isShownInSlot(text: String) =
        compose
            .onAllNodes(hasText(text) and hasAnyAncestor(hasTestTag(SENTENCE_SLOT_TAG)), useUnmergedTree = true)
            .fetchSemanticsNodes(atLeastOneRootRequired = false)
            .isNotEmpty() &&
            runCatching {
                compose.onNode(hasText(text) and hasAnyAncestor(hasTestTag(SENTENCE_SLOT_TAG)), useUnmergedTree = true).assertIsDisplayed()
            }.isSuccess

    private fun assertWordsEndBefore(
        x: Dp,
        words: List<Candidate>,
    ) {
        for (word in words) {
            val bounds =
                compose
                    .onNode(
                        hasText(word.hanzi) and hasAnyAncestor(hasTestTag(SENTENCE_SLOT_TAG)),
                        useUnmergedTree = true,
                    ).unclippedBounds()
            assertTrue("${word.hanzi} ends at ${bounds.right}, past $x", bounds.right <= x)
        }
    }

    /**
     * Where the node is laid out, not clipped to its parent the way [getBoundsInRoot] is: a
     * chip pushed off the end of the slot is still drawn inside it there, just cut short.
     */
    private fun SemanticsNodeInteraction.unclippedBounds(): DpRect {
        val node = fetchSemanticsNode()
        return with(compose.density) {
            val position = node.positionInRoot
            DpRect(position.x.toDp(), position.y.toDp(), (position.x + node.size.width).toDp(), (position.y + node.size.height).toDp())
        }
    }

    private fun assertInside(
        outer: DpRect,
        inner: DpRect,
        what: String,
    ) {
        assertTrue(
            "$what at ${inner.left}..${inner.right} x ${inner.top}..${inner.bottom} is clipped by the slot at " +
                "${outer.left}..${outer.right} x ${outer.top}..${outer.bottom}",
            inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom,
        )
    }

    private fun show(
        recorder: Recorder,
        candidates: List<Candidate> = emptyList(),
        candidatesState: () -> List<Candidate> = { candidates },
        expanded: Boolean = false,
        detail: OpenDetail? = null,
        selectedIndex: Int = 0,
        windowHeight: Int = 800,
    ) {
        compose.setContent {
            PinyinDuckTheme {
                Box(Modifier.size(width = 400.dp, height = windowHeight.dp)) {
                    KeyboardWindow(
                        state =
                            KeyboardUiState(
                                loading = false,
                                buffer = "woxianghekafei",
                                candidates = candidatesState(),
                                total = candidatesState().size,
                                selectedIndex = selectedIndex,
                                expanded = expanded,
                                detail = detail,
                            ),
                        callbacks = recorder.callbacks(),
                        onKeyboardTop = {},
                    )
                }
            }
        }
    }

    private companion object {
        fun candidate(
            hanzi: String,
            marks: String,
            gloss: String = "",
            remaining: String = "",
        ) = Candidate(
            id = "$hanzi-$marks",
            hanzi = hanzi,
            simplified = hanzi,
            traditional = hanzi,
            pinyinMarks = marks,
            pinyinNumbers = "",
            shortGloss = gloss,
            frequency = 0,
            matchedPinyin = "",
            remainingPinyin = remaining,
        )

        /** A Sentence candidate as the engine builds one: joined outer fields, then the words. */
        fun sentence(
            vararg words: Candidate,
            remaining: String = "",
        ) = candidate(
            hanzi = words.joinToString("") { it.hanzi },
            marks = words.joinToString(" ") { it.pinyinMarks },
            gloss = words.joinToString(" · ") { it.shortGloss },
            remaining = remaining,
        ).copy(words = words.toList())

        val WO = candidate("我", "wǒ", "I; me; my")
        val XIANG = candidate("想", "xiǎng", "to think (about) / to believe / to suppose")
        val HE = candidate("喝", "hē", "to drink")
        val KAFEI = candidate("咖啡", "kā fēi", "(loanword) coffee")
        val RANHOU = candidate("然后", "rán hòu", "then / after that")
        val QU = candidate("去", "qù", "to go")
        val YIYUAN = candidate("医院", "yī yuàn", "hospital").copy(traditional = "醫院")
        val KAN = candidate("看", "kàn", "to see / to look at")
        val YISHENG = candidate("医生", "yī shēng", "doctor")

        /** Roughly a landscape phone, so the bubble's sections do not all fit at once. */
        const val SHORT_WINDOW_HEIGHT = 500

        val COFFEE = sentence(WO, XIANG, HE, KAFEI)

        /** `woxianghekafeiranhouquyiyuankanyisheng`: nine words, far wider than the slot. */
        val LONG = sentence(WO, XIANG, HE, KAFEI, RANHOU, QU, YIYUAN, KAN, YISHENG)

        /**
         * Far wider than the slot on any screen. The test JVM has no CJK font, so Hanzi draw
         * about 1 dp wide there and nine real words still fit; each word here is unique, so
         * it can be found by its Hanzi.
         */
        val TOO_LONG = sentence(*(1..40).map { candidate("字$it", "zì", "character") }.toTypedArray())
    }
}
