package dev.pinyinduck.android

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * End to end on a device: PinyinDuck types a Sentence candidate into another app's field.
 *
 * The field is Settings search. The test types `woxianghekafei` on PinyinDuck's keys, taps the
 * Sentence slot in the strip, and checks that 我想喝咖啡 is what the field holds. The slot is
 * found by its content description, which is what TalkBack reads, rather than by its tag.
 *
 * Run it with `npm run test:device -w @pinyinduck/android` (a managed emulator) or
 * `./gradlew connectedDebugAndroidTest` (your own phone). Either way the device's input method
 * settings are put back afterwards.
 */
@RunWith(AndroidJUnit4::class)
class SentenceCommitDeviceTest {
    @get:Rule
    val ime = PinyinDuckImeRule()

    private val keyboard = KeyboardDriver()

    @Test
    fun commitsTheSentenceCandidateIntoSettingsSearch() {
        keyboard.openSettingsSearch()

        keyboard.type("woxianghekafei")

        val sentence = keyboard.waitForSentence("woxianghekafei", "Sentence 我想喝咖啡, ")
        sentence.click()

        keyboard.waitForFieldText("我想喝咖啡")
        assertEquals("我想喝咖啡", keyboard.fieldText())
    }
}
