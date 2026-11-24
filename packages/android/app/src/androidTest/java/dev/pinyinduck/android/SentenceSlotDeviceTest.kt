package dev.pinyinduck.android

import android.graphics.Rect
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiObject2
import dev.pinyinduck.android.ui.KEYBOARD_TAG
import dev.pinyinduck.android.ui.LEFTOVER_CHIP_TAG
import dev.pinyinduck.android.ui.MORE_WORDS_CHIP_TAG
import dev.pinyinduck.android.ui.SENTENCE_SLOT_PADDING_DP
import dev.pinyinduck.android.ui.SENTENCE_SLOT_TAG
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import kotlin.math.roundToInt

/**
 * The Sentence candidate's double-width slot in the strip, measured on a device.
 *
 * Robolectric has no real CJK font metrics, so whether the word blocks and chips really fit is
 * only known here. Every bound comes from `UiObject2.visibleBounds`, at the default font scale.
 *
 * Each slot state has one chosen input. Before measuring anything the test checks that the
 * slot shows exactly the chips that state should: if the dictionary or ranking drifts so the
 * input lands in another state, it fails saying so, rather than on a confusing bounds diff.
 * The inputs were picked on the `pixel6api36` managed device (1080 px wide, 2.625 px per dp),
 * where the slot's content area is about 124 dp.
 */
@RunWith(AndroidJUnit4::class)
class SentenceSlotDeviceTest {
    private val ime = PinyinDuckImeRule()
    private val orientation = DeviceOrientationRule()

    /**
     * Rules run outside in and tear down inside out: the rotation is put back to portrait
     * before the input method settings are restored, so the keyboard is never switched away
     * while the activity is being re-created.
     */
    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(ime).around(orientation)

    private val keyboard = KeyboardDriver()

    private val density =
        InstrumentationRegistry
            .getInstrumentation()
            .targetContext.resources.displayMetrics.density

    @Test
    fun aSentenceThatFitsShowsNoChips() = checkSlot(NO_CHIPS)

    @Test
    fun aPartialSentenceThatFitsShowsOnlyTheLeftoverChip() = checkSlot(LEFTOVER_ONLY)

    @Test
    fun aFullSentenceThatOverflowsShowsOnlyTheCountChip() = checkSlot(COUNT_ONLY)

    @Test
    fun aPartialSentenceThatOverflowsShowsBothChips() = checkSlot(BOTH_CHIPS)

    @Test
    fun inLandscapeASentenceThatFitsShowsNoChips() {
        orientation.landscape()
        checkSlot(NO_CHIPS)
    }

    @Test
    fun inLandscapeAPartialSentenceThatFitsShowsOnlyTheLeftoverChip() {
        orientation.landscape()
        checkSlot(LEFTOVER_ONLY)
    }

    @Test
    fun inLandscapeAPartialSentenceThatOverflowsShowsBothChips() {
        orientation.landscape()
        checkSlot(LANDSCAPE_BOTH_CHIPS)
    }

    @Test
    fun theKeyboardKeepsItsHeightFromBeforeTypingToALongSentence() = checkKeyboardHeight(COUNT_ONLY, BOTH_CHIPS)

    @Test
    fun inLandscapeTheKeyboardKeepsItsHeightFromBeforeTypingToALongSentence() {
        orientation.landscape()
        checkKeyboardHeight(LANDSCAPE_BOTH_CHIPS)
    }

    private fun checkKeyboardHeight(vararg longStates: SlotState) {
        keyboard.openSettingsSearch()
        val before = keyboardBounds("before typing")

        keyboard.type(WORDS_ONLY)
        keyboard.waitForText(WORDS_ONLY_FIRST, "Wrong state for \"$WORDS_ONLY\": no $WORDS_ONLY_FIRST candidate in the strip")
        // The Sentence candidate can arrive after the words, so its absence has to hold a while.
        keyboard.assertTagStaysAway(SENTENCE_SLOT_TAG, "Wrong state for \"$WORDS_ONLY\": expected only word candidates")
        assertSameTopAndHeight(before, keyboardBounds("composing \"$WORDS_ONLY\""))
        keyboard.clearComposition(WORDS_ONLY)

        for (state in longStates) {
            keyboard.type(state.input)
            slotIn(state)
            assertSameTopAndHeight(before, keyboardBounds("composing \"${state.input}\""))
            keyboard.clearComposition(state.input)
        }
    }

    /** Types [state]'s input, checks the slot shows that state's chips, then checks the layout. */
    private fun checkSlot(state: SlotState) {
        keyboard.openSettingsSearch()
        keyboard.type(state.input)
        val slot = slotIn(state)

        // The slot's content sits inside its horizontal padding; a chip pushed past that
        // is clipped, even when the slot's clip trims what the chip reports as its bounds.
        val padding = (SENTENCE_SLOT_PADDING_DP * density).roundToInt()
        val content = LabelledBounds("the slot's content area", insetX(slot.visibleBounds, padding))
        val chips = chipsIn(slot)
        chips.forEach { assertInside(it, content) }

        assertNoOverlapInX(wordBlocksFromTextRows(slot) + chips)
    }

    /** The slot once it shows [state]'s sentence, failing if its chips are not that state's. */
    private fun slotIn(state: SlotState): UiObject2 {
        keyboard.waitForSentence(state.input, state.description)
        val slot = keyboard.waitForTag(SENTENCE_SLOT_TAG)
        val shown =
            SlotChips.of(
                leftover = keyboard.findAllTagged(LEFTOVER_CHIP_TAG, slot).isNotEmpty(),
                more = keyboard.findAllTagged(MORE_WORDS_CHIP_TAG, slot).isNotEmpty(),
            )
        if (shown != state.chips) {
            failTest(
                "Wrong state for \"${state.input}\": expected ${state.chips.label}, but the slot shows " +
                    "${shown.label} (${chipsIn(slot).joinToString { it.label }}). The words' widths or the " +
                    "sentence have changed; pick a new input for this state.",
            )
        }
        return slot
    }

    private fun chipsIn(slot: UiObject2): List<LabelledBounds> =
        listOf(LEFTOVER_CHIP_TAG, MORE_WORDS_CHIP_TAG).flatMap { tag ->
            keyboard.findAllTagged(tag, slot).map { LabelledBounds("$tag \"${it.text}\"", it.visibleBounds) }
        }

    /**
     * The word blocks the slot placed, left to right, rebuilt from rows of text lines.
     *
     * A block has no node of its own: it is three text lines, pinyin over Hanzi over gloss, each
     * centred in the block, so the widest of them spans it. Every block is laid out alike, so the
     * lines form three rows by their top edge, and the block at index i spans the i-th line of
     * each row.
     */
    private fun wordBlocksFromTextRows(slot: UiObject2): List<LabelledBounds> {
        val chipTags = setOf(LEFTOVER_CHIP_TAG, MORE_WORDS_CHIP_TAG)
        val lines = slot.children.filter { it.text != null && it.resourceName !in chipTags }
        val rows =
            lines
                .groupBy { it.visibleBounds.top }
                .toSortedMap()
                .values
                .map { row -> row.sortedBy { it.visibleBounds.left } }
        val described = lines.joinToString { "\"${it.text}\" ${it.visibleBounds.toShortString()}" }
        if (rows.size != BLOCK_LINES || rows.any { it.size != rows[0].size }) {
            failTest("Expected the slot's words as $BLOCK_LINES rows of lines, one line per word in each, but got: $described")
        }
        return rows[0].indices.map { i ->
            val block = Rect(rows[0][i].visibleBounds)
            rows.forEach { block.union(it[i].visibleBounds) }
            LabelledBounds("word block \"${rows[1][i].text}\"", block)
        }
    }

    private fun keyboardBounds(moment: String) = LabelledBounds("the keyboard $moment", keyboard.waitForTag(KEYBOARD_TAG).visibleBounds)

    /** Which chips the slot shows, as the failure messages say it. */
    private enum class SlotChips(
        val label: String,
        val leftover: Boolean,
        val more: Boolean,
    ) {
        NONE("no chips", leftover = false, more = false),
        LEFTOVER_ONLY("only the leftover chip", leftover = true, more = false),
        MORE_ONLY("only the \"+N\" chip", leftover = false, more = true),
        BOTH("both chips", leftover = true, more = true),
        ;

        companion object {
            fun of(
                leftover: Boolean,
                more: Boolean,
            ) = entries.single { it.leftover == leftover && it.more == more }
        }
    }

    /** One state of the slot, by the chips it shows, and the input chosen to reach it. */
    private class SlotState(
        val input: String,
        /** How the slot's content description starts once it shows the expected sentence. */
        val description: String,
        val chips: SlotChips,
    )

    private companion object {
        /** Pinyin, Hanzi and gloss. */
        const val BLOCK_LINES = 3

        /** No chips: a full sentence of two short words, 你好 吗, which fit with room to spare. */
        val NO_CHIPS = SlotState("nihaoma", "Sentence 你好吗, ", SlotChips.NONE)

        /**
         * Leftover chip only: 我 想 then "v", which starts no syllable, so the sentence is
         * partial and leaves "+ü". Both words fit beside the chip.
         */
        val LEFTOVER_ONLY =
            SlotState("woxiangv", "Sentence 我想, wǒ xiǎng, then ü", SlotChips.LEFTOVER_ONLY)

        /**
         * "+N" chip only: 我想喝咖啡 is a full sentence whose glosses make 喝 and 咖啡 overflow,
         * so the slot shows 我 想 "+2". (The ticket guessed this input would fit; on the Pixel 6
         * it does not.)
         */
        val COUNT_ONLY =
            SlotState("woxianghekafei", "Sentence 我想喝咖啡, ", SlotChips.MORE_ONLY)

        /**
         * Both chips: the same sentence then "v", so it is partial and overflows. Also the long
         * input for the sentence card checks (`SentenceCardDeviceTest`).
         */
        val BOTH_CHIPS =
            SlotState("woxianghekafeiv", "Sentence 我想喝咖啡, wǒ xiǎng hē kā fēi, then ü", SlotChips.BOTH)

        /*
         * In landscape the slot is about 294 dp wide, against about 124 dp of content in
         * portrait, so the portrait inputs fit without a chip. This is the longest input
         * (the keyboard composes 20 letters at most) that still overflows. The "+N chip only"
         * state has no landscape check: no full sentence of 20 letters or fewer overflows
         * a 294 dp slot (我爱吃也不想我, 18 letters, still fits).
         */

        /** Both chips in landscape: the same sentence then "v". */
        val LANDSCAPE_BOTH_CHIPS =
            SlotState("woaichiyebuxianghev", "Sentence 我爱吃也不想和, wǒ ài chī yě bù xiǎng hé, then ü", SlotChips.BOTH)

        /** A composition with word candidates and no Sentence candidate: a single word. */
        const val WORDS_ONLY = "nihao"

        /** The first word candidate for [WORDS_ONLY], waited for before measuring. */
        const val WORDS_ONLY_FIRST = "你好"
    }
}
