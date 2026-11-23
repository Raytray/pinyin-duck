package dev.pinyinduck.android

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiObject2
import dev.pinyinduck.android.ui.KEYBOARD_TAG
import dev.pinyinduck.android.ui.SENTENCE_CARD_TAG
import dev.pinyinduck.android.ui.SENTENCE_SLOT_TAG
import dev.pinyinduck.android.ui.WORD_MENU_TAG
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.regex.Pattern

/**
 * The Sentence candidate's card in the Expanded candidate list and its word menu, measured on
 * a device.
 *
 * Every check types [INPUT] and opens the card with a long press on the strip slot, which is
 * also the device check for that long press. Every bound comes from `UiObject2.visibleBounds`,
 * at the default font scale. The card's word blocks and leftover are found by their content
 * descriptions, which are what TalkBack reads.
 */
@RunWith(AndroidJUnit4::class)
class SentenceCardDeviceTest {
    @get:Rule
    val ime = PinyinDuckImeRule()

    @get:Rule
    val orientation = DeviceOrientationRule()

    private val keyboard = KeyboardDriver()

    @Test
    fun theCardWrapsItsWordBlocksOntoRowsInsideIt() = checkCardWraps()

    @Test
    fun inLandscapeTheCardWrapsItsWordBlocksOntoRowsInsideIt() {
        orientation.landscape()
        checkCardWraps()
    }

    private fun checkCardWraps() {
        val card = openCard()
        val bounds = LabelledBounds("the card", card.visibleBounds)
        val blocks = wordBlocksByDescription(card)
        val leftover =
            card.findObject(By.desc("then $LEFTOVER"))
                ?: failTest("The card has no leftover block described as \"then $LEFTOVER\"")

        val rows = blocks.map { it.rect.top }.distinct()
        if (rows.size < 2) failTest("Expected the word blocks on at least two rows, but they all sit on one: ${blocks.joinToString()}")
        blocks.forEach { assertInside(it, bounds) }
        assertNoOverlap(blocks)
        assertInside(LabelledBounds("the leftover block", leftover.visibleBounds), bounds)
    }

    @Test
    fun theWordMenuFitsUnderTheCardWithItsCommitChipInView() = checkWordMenuFits()

    @Test
    fun inLandscapeTheWordMenuFitsUnderTheCardWithItsCommitChipInView() {
        orientation.landscape()
        checkWordMenuFits()
    }

    private fun checkWordMenuFits() {
        val card = openCard()
        val menu = openMenu(card)

        val cardBounds = LabelledBounds("the card", card.visibleBounds)
        val menuBounds = LabelledBounds("the word menu", menu.visibleBounds)
        if (menuBounds.rect.top < cardBounds.rect.bottom) failTest("$menuBounds starts above the bottom of $cardBounds")

        // Bounds are clipped to what is visible, so a menu pushed past the list's bottom would
        // still look inside the keyboard. Its visible bottom would then land on the list's
        // bottom edge; ending above that edge shows none of it is scrolled out of view.
        val list = LabelledBounds("the Expanded candidate list", expandedList().visibleBounds)
        assertInside(menuBounds, list)
        if (menuBounds.rect.bottom >= list.rect.bottom) failTest("$menuBounds runs to the bottom of $list, so the list clips it")
        assertInside(menuBounds, LabelledBounds("the keyboard", keyboard.waitForTag(KEYBOARD_TAG).visibleBounds))
        assertInside(menuBounds, LabelledBounds("the screen", keyboard.screenBounds()))

        // Only worth checking while the alternatives overflow their row. The row is lazy, so it
        // holds a node only for each alternative it shows: fewer than all of them means the
        // rest are scrolled out of view.
        val alternatives =
            menu.findObject(By.scrollable(true))
                ?: failTest("The word menu has no scrollable row of alternatives")
        val shown = alternatives.children.size
        if (shown >= MENU_WORD_ALTERNATIVES) {
            failTest(
                "The word menu shows $shown alternatives for $MENU_WORD (it has $MENU_WORD_ALTERNATIVES), so its row " +
                    "does not overflow and cannot test that \"$COMMIT_THROUGH\" stays in view. Pick a word with more alternatives.",
            )
        }

        val commit =
            menu.findObject(By.text(COMMIT_THROUGH))
                ?: failTest("The word menu has no \"$COMMIT_THROUGH\" chip in view")
        assertInside(LabelledBounds("the \"$COMMIT_THROUGH\" chip", commit.visibleBounds), menuBounds)
    }

    @Test
    fun commitThroughCommitsTheWordsUpToTheChosenOneAndLeavesTheRestComposing() {
        val card = openCard()
        val menu = openMenu(card)

        menu.findObject(By.text(COMMIT_THROUGH))?.click()
            ?: failTest("The word menu has no \"$COMMIT_THROUGH\" chip to tap")

        // 我爱吃 is committed; the pinyin after 吃 stays in the field as composing text.
        keyboard.waitForFieldText(COMMITTED_THROUGH + REST_OF_INPUT)
        assertEquals(COMMITTED_THROUGH + REST_OF_INPUT, keyboard.fieldText())
        // And it is still composing, not plain text: the strip offers a Sentence for the rest.
        keyboard.waitForSentence(REST_OF_INPUT, REST_SENTENCE_DESCRIPTION)
        keyboard.assertTagGoes(WORD_MENU_TAG, "\"$COMMIT_THROUGH\"")
    }

    @Test
    fun backClosesTheMenuThenHidesTheKeyboardWithoutReachingTheApp() {
        val card = openCard()
        openMenu(card)
        val before = keyboard.fieldText()

        keyboard.pressBack()
        keyboard.assertTagGoes(WORD_MENU_TAG, "Back")
        keyboard.waitForTag(SENTENCE_CARD_TAG)
        assertEquals("Back changed the field's text", before, keyboard.fieldText())

        keyboard.pressBack()
        keyboard.assertKeyboardHides("The second Back")
        keyboard.assertSearchFieldStays("the second Back")
    }

    /**
     * Types [INPUT], checks the strip slot shows its sentence, and long-presses the slot to
     * open the Expanded candidate list at the sentence's card.
     */
    private fun openCard(): UiObject2 {
        keyboard.openSettingsSearch()
        keyboard.type(INPUT)
        keyboard.waitForSentence(INPUT, SENTENCE_DESCRIPTION)
        keyboard.waitForTag(SENTENCE_SLOT_TAG).longClick()
        return keyboard.waitForTag(SENTENCE_CARD_TAG)
    }

    /** Taps [MENU_WORD]'s block on [card] and waits for its word menu. */
    private fun openMenu(card: UiObject2): UiObject2 {
        val block =
            card.findObject(By.descStartsWith("$MENU_WORD, "))
                ?: failTest("The card has no block for $MENU_WORD. Blocks: ${wordBlocksByDescription(card).joinToString()}")
        block.click()
        return keyboard.waitForTag(WORD_MENU_TAG)
    }

    /**
     * The card's word blocks, found by their content descriptions ("吃, chī, …"), failing
     * unless there is one per word of the sentence.
     */
    private fun wordBlocksByDescription(card: UiObject2): List<LabelledBounds> {
        val words = WORDS.joinToString("|") { Pattern.quote(it) }
        val blocks =
            card
                .findObjects(By.desc(Pattern.compile("($words), .*")))
                .map { LabelledBounds("word block \"${it.contentDescription}\"", it.visibleBounds) }
        if (blocks.size != WORDS.size) {
            failTest("Expected ${WORDS.size} word blocks for ${WORDS.joinToString(" ")}, but the card has ${blocks.joinToString()}")
        }
        return blocks
    }

    /** The Expanded candidate list: the keyboard's scrollable grid holding the card. */
    private fun expandedList(): UiObject2 = keyboard.scrollableHolding(SENTENCE_CARD_TAG)

    private companion object {
        /**
         * 我爱吃也不想和 then "v", a partial sentence of six words, five of whose glosses are
         * long enough to reach the card's gloss cap, so the blocks wrap with room to spare.
         *
         * The strip slot checks' long input (`woxianghekafeiv`, 我想喝咖啡 then "ü") fits its four blocks on one
         * row of the card on the `pixel6api36` managed device (1080 px wide), using little more
         * than half of it, so it cannot show the card wrapping; and a longer sentence such as
         * 我想喝咖啡也不想喝水 runs past the 20 letters the keyboard composes at most
         * (`MAX_BUFFER_LENGTH`). This input is 19 letters.
         */
        const val INPUT = "woaichiyebuxianghev"

        const val SENTENCE_DESCRIPTION = "Sentence 我爱吃也不想和, wǒ ài chī yě bù xiǎng hé, then ü"

        /** The sentence's words, in order. */
        val WORDS = listOf("我", "爱", "吃", "也", "不想", "和")

        const val LEFTOVER = "ü"

        /**
         * The word whose menu is checked: 吃, which has the most alternatives of the sentence's
         * words (65 on `chi`, against 52 for 和, 40 for 也, 39 for 爱, 23 for 我 and 3 for 不想),
         * so its alternatives overflow the menu's row and "Commit through" has to stay in view
         * anyway.
         */
        const val MENU_WORD = "吃"

        /** How many alternatives [MENU_WORD]'s menu offers. */
        const val MENU_WORD_ALTERNATIVES = 65

        /** What "Commit through" [MENU_WORD] commits: the sentence's words up to and including it. */
        const val COMMITTED_THROUGH = "我爱吃"

        /** [INPUT] after the pinyin of [COMMITTED_THROUGH] (`woaichi`), which is still composing. */
        const val REST_OF_INPUT = "yebuxianghev"

        /** The Sentence candidate the strip offers for [REST_OF_INPUT]. */
        const val REST_SENTENCE_DESCRIPTION = "Sentence 也不想和, "

        const val COMMIT_THROUGH = "Commit through $MENU_WORD"
    }
}
