package dev.pinyinduck.android.ime

import android.text.InputType
import dev.pinyinduck.android.ui.KeyLayout
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Which fields compose pinyin, which are typed directly, and which open on digits.
 *
 * A wrong entry here is silent everywhere else: a password field that composes still
 * "works", it just shows the secret as underlined pinyin and offers it back as candidates.
 */
class FieldPolicyTest {
    private val direct = FieldPolicy(direct = true, layout = KeyLayout.LETTERS)
    private val numbers = FieldPolicy(direct = true, layout = KeyLayout.NUMBERS)

    private fun text(variation: Int = 0) = InputType.TYPE_CLASS_TEXT or variation

    @Test
    fun plainTextComposesPinyin() {
        assertEquals(FieldPolicy.PINYIN, FieldPolicy.forInputType(text()))
        assertEquals(FieldPolicy.PINYIN, FieldPolicy.forInputType(text(InputType.TYPE_TEXT_VARIATION_SHORT_MESSAGE)))
        assertEquals(FieldPolicy.PINYIN, FieldPolicy.forInputType(text(InputType.TYPE_TEXT_VARIATION_PERSON_NAME)))
    }

    @Test
    fun everyPasswordVariationIsTypedDirectly() {
        for (variation in listOf(
            InputType.TYPE_TEXT_VARIATION_PASSWORD,
            InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,
            InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD,
        )) {
            assertEquals("variation $variation", direct, FieldPolicy.forInputType(text(variation)))
        }
    }

    @Test
    fun emailAndUrlFieldsAreTypedDirectly() {
        for (variation in listOf(
            InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS,
            InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS,
            InputType.TYPE_TEXT_VARIATION_URI,
        )) {
            assertEquals("variation $variation", direct, FieldPolicy.forInputType(text(variation)))
        }
    }

    @Test
    fun numberPhoneAndDateFieldsOpenOnTheNumberPage() {
        for (type in listOf(
            InputType.TYPE_CLASS_NUMBER,
            InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL,
            InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD,
            InputType.TYPE_CLASS_PHONE,
            InputType.TYPE_CLASS_DATETIME or InputType.TYPE_DATETIME_VARIATION_DATE,
        )) {
            assertEquals("inputType $type", numbers, FieldPolicy.forInputType(type))
        }
    }

    @Test
    fun flagsDoNotChangeTheDecision() {
        val flags = InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS or InputType.TYPE_TEXT_FLAG_MULTI_LINE
        assertEquals(FieldPolicy.PINYIN, FieldPolicy.forInputType(text() or flags))
        assertEquals(direct, FieldPolicy.forInputType(text(InputType.TYPE_TEXT_VARIATION_PASSWORD) or flags))
    }

    @Test
    fun aFieldWithNoTypeKeepsTheDefault() {
        assertEquals(FieldPolicy.PINYIN, FieldPolicy.forInputType(InputType.TYPE_NULL))
    }
}
