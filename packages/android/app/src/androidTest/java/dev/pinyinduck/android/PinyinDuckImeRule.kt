package dev.pinyinduck.android

import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.rules.ExternalResource

/**
 * Makes PinyinDuck the selected keyboard for one test and puts the device's input method
 * settings back afterwards: the selected keyboard, the enabled list and the "show with a
 * hardware keyboard" setting.
 *
 * Before anything else it checks that the APK has the bigram table. Without it Sentence
 * candidates are scored on unigram frequencies alone and the keyboard quietly offers other
 * sentences (我想和咖啡 for `woxianghekafei`), so every device test would fail on a diff that
 * hides the cause.
 */
class PinyinDuckImeRule : ExternalResource() {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    /** What the device had before the test changed it, or null when nothing was changed yet. */
    private var saved: SavedImeSettings? = null

    override fun before() {
        assertBigramsPackaged()

        saved =
            SavedImeSettings(
                defaultIme = shell("settings get secure default_input_method"),
                wasEnabled = PINYIN_DUCK in shell("ime list -s").lines(),
                showWithHardKeyboard = shell("settings get secure show_ime_with_hard_keyboard"),
            )

        // After install, never before: reinstalling the app drops its input method binding.
        shell("ime enable $PINYIN_DUCK")
        shell("ime set $PINYIN_DUCK")
        // An emulator usually reports a hardware keyboard, which hides every soft keyboard.
        shell("settings put secure show_ime_with_hard_keyboard 1")

        assertEquals(
            "PinyinDuck did not become the selected input method",
            PINYIN_DUCK,
            shell("settings get secure default_input_method"),
        )
    }

    override fun after() {
        val saved = saved ?: return
        if (saved.defaultIme.isSet()) shell("ime set ${saved.defaultIme}")
        if (!saved.wasEnabled) shell("ime disable $PINYIN_DUCK")
        if (saved.showWithHardKeyboard.isSet()) {
            shell("settings put secure show_ime_with_hard_keyboard ${saved.showWithHardKeyboard}")
        } else {
            shell("settings delete secure show_ime_with_hard_keyboard")
        }
    }

    private fun assertBigramsPackaged() {
        val assets =
            instrumentation.targetContext.assets
                .list("")
                .orEmpty()
        assertTrue(
            "bigrams.bin is not in the app's assets. Run `npm run build:bigrams` at the " +
                "repository root, then run the device test again.",
            "bigrams.bin" in assets,
        )
    }

    private data class SavedImeSettings(
        val defaultIme: String,
        val wasEnabled: Boolean,
        val showWithHardKeyboard: String,
    )

    private fun String.isSet() = isNotEmpty() && this != "null"

    private companion object {
        const val PINYIN_DUCK = "$PACKAGE/.ime.PinyinDuckImeService"
    }
}
