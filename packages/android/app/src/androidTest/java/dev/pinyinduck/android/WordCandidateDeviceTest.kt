package dev.pinyinduck.android

import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.pinyinduck.android.ui.SENTENCE_SLOT_TAG
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The ordinary candidate strip on a device, without the Sentence slot: committing a word,
 * opening the Expanded candidate list, and clearing the composition with ✕. Robolectric
 * covers these with a fake `InputConnection`; here the field is Settings search.
 *
 * The input is [INPUT] (`nihao`), whose first candidate is [WORD]. [typeAndWaitForWord]
 * checks that first, so a dictionary or ranking change fails with a hint, as in the slot tests.
 */
@RunWith(AndroidJUnit4::class)
class WordCandidateDeviceTest {
    @get:Rule
    val ime = PinyinDuckImeRule()

    private val keyboard = KeyboardDriver()

    @Test
    fun tappingAWordCandidateCommitsItIntoTheField() {
        keyboard.openSettingsSearch()
        typeAndWaitForWord()

        keyboard.tapText(WORD, "No $WORD candidate in the strip")

        keyboard.waitForFieldText(WORD)
        assertEquals(WORD, keyboard.fieldText())
    }

    @Test
    fun theExpandToggleOpensTheExpandedCandidateList() {
        keyboard.openSettingsSearch()
        typeAndWaitForWord()

        keyboard.tapText("▴", "No ▴ button to open the Expanded candidate list")

        keyboard.waitForTextContaining(" matches", "The Expanded candidate list did not open: no \"N matches\" header")
        keyboard.waitForText("▾", "The Expanded candidate list has no ▾ button to close it")
        assertEquals("Opening the list changed the field", INPUT, keyboard.fieldText())
    }

    @Test
    fun theClearButtonDropsTheCompositionWithNothingCommitted() {
        keyboard.openSettingsSearch()
        // An empty field reports its hint ("Search…") as its text, so compare with that.
        val empty = keyboard.fieldText()
        typeAndWaitForWord()

        keyboard.clearComposition(INPUT)

        // Nothing committed: the field is as it started, not holding $WORD or the pinyin.
        assertEquals("The field is not back to how it started", empty, keyboard.fieldText())
    }

    private fun typeAndWaitForWord() {
        keyboard.type(INPUT)
        keyboard.waitForText(WORD, "Wrong state for \"$INPUT\": no $WORD candidate in the strip. Pick a new input.")
        // The Sentence candidate can arrive after the words, so its absence has to hold a while.
        keyboard.assertTagStaysAway(SENTENCE_SLOT_TAG, "Wrong state for \"$INPUT\": expected only word candidates")
    }

    private companion object {
        /** A single word with no Sentence candidate, as in `SentenceSlotDeviceTest`. */
        const val INPUT = "nihao"

        /** The first word candidate for [INPUT]. */
        const val WORD = "你好"
    }
}
