package dev.pinyinduck.android

import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.pinyinduck.android.ui.SENTENCE_SLOT_TAG
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Typing over a selection in another app's field. How a selection and a composing region
 * interact depends on the real app's `InputConnection`, which Robolectric only fakes.
 *
 * Settings search holds [BEFORE][SELECTED][AFTER] with [SELECTED] selected. Typing [INPUT]
 * composes in place of the selection, and committing [WORD] must leave [BEFORE] and [AFTER]
 * untouched.
 */
@RunWith(AndroidJUnit4::class)
class SelectionDeviceTest {
    @get:Rule
    val ime = PinyinDuckImeRule()

    private val keyboard = KeyboardDriver()

    @Test
    fun committingOverASelectionReplacesExactlyTheSelection() {
        keyboard.openSettingsSearch()
        keyboard.setFieldText(BEFORE + SELECTED + AFTER)
        keyboard.selectInField(fromEnd = AFTER.length, length = SELECTED.length)

        keyboard.type(INPUT, fieldTextWhileComposing = BEFORE + INPUT + AFTER)
        keyboard.waitForText(WORD, "Wrong state for \"$INPUT\": no $WORD candidate in the strip. Pick a new input.")
        keyboard.assertTagStaysAway(SENTENCE_SLOT_TAG, "Wrong state for \"$INPUT\": expected only word candidates")
        keyboard.tapText(WORD, "No $WORD candidate in the strip")

        keyboard.waitForFieldText(BEFORE + WORD + AFTER)
        assertEquals(BEFORE + WORD + AFTER, keyboard.fieldText())
    }

    private companion object {
        const val BEFORE = "abc"
        const val SELECTED = "123"
        const val AFTER = "xyz"
        const val INPUT = "nihao"
        const val WORD = "你好"
    }
}
