package dev.pinyinduck.android.ime

import android.text.InputType
import dev.pinyinduck.android.ui.KeyLayout

/**
 * How the keyboard behaves in a field, decided from the field's `EditorInfo.inputType`.
 *
 * A field says what it holds, and a pinyin keyboard that ignores that is actively harmful in
 * some of them. A password typed through composition sits in the composing region as plain
 * pinyin and is offered as candidates on screen; a number or phone field gets a letter
 * layout it cannot use; an email address or URL is mangled the moment a letter run happens
 * to spell a syllable and space commits a hanzi.
 *
 * Kept as plain data with no service behind it, so every class of field can be tested as a
 * value rather than through a running keyboard.
 */
data class FieldPolicy(
    /**
     * Whether keys bypass composition and go straight to the field.
     *
     * When true, letters, digits and space are committed as typed: there is no composing
     * region and no candidate list, so nothing the user types is ever displayed as a
     * suggestion. Hardware keys are left entirely to the system.
     */
    val direct: Boolean,
    /** The page the keyboard opens on. */
    val layout: KeyLayout,
) {
    companion object {
        /** An ordinary text field: pinyin composition on the letter layout. */
        val PINYIN = FieldPolicy(direct = false, layout = KeyLayout.LETTERS)

        /**
         * The policy for a field declaring [inputType].
         *
         * `TYPE_NULL` (0) is a field with no type at all, such as a terminal, and keeps the
         * default rather than guessing: it is how fields behaved before this existed.
         */
        fun forInputType(inputType: Int): FieldPolicy {
            val variation = inputType and InputType.TYPE_MASK_VARIATION
            return when (inputType and InputType.TYPE_MASK_CLASS) {
                // Every numeric class opens on the number page. Its password variation
                // (a PIN) is covered too: a number field is always typed directly.
                InputType.TYPE_CLASS_NUMBER,
                InputType.TYPE_CLASS_PHONE,
                InputType.TYPE_CLASS_DATETIME,
                -> FieldPolicy(direct = true, layout = KeyLayout.NUMBERS)

                InputType.TYPE_CLASS_TEXT ->
                    if (variation in DIRECT_TEXT_VARIATIONS) {
                        FieldPolicy(direct = true, layout = KeyLayout.LETTERS)
                    } else {
                        PINYIN
                    }

                else -> PINYIN
            }
        }

        /**
         * Text variations typed without composition.
         *
         * Passwords, so a secret is never shown as composing text or candidates; and email
         * addresses and URLs, which are Latin by nature and which pinyin composition would
         * turn into hanzi on the first space.
         */
        private val DIRECT_TEXT_VARIATIONS =
            setOf(
                InputType.TYPE_TEXT_VARIATION_PASSWORD,
                InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,
                InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD,
                InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS,
                InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS,
                InputType.TYPE_TEXT_VARIATION_URI,
            )
    }
}
