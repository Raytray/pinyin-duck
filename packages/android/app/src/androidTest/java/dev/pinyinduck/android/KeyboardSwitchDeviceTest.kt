package dev.pinyinduck.android

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Switching to another keyboard while PinyinDuck is shown. The system destroys the service
 * with its input view still started, and the service must not crash on the way out.
 *
 * The service runs in the app's process, which is also the instrumentation's, so a crash
 * takes the test down too. The test still checks logcat and the process id, so a failure
 * names the crash.
 */
@RunWith(AndroidJUnit4::class)
class KeyboardSwitchDeviceTest {
    @get:Rule
    val ime = PinyinDuckImeRule()

    private val keyboard = KeyboardDriver()

    @Test
    fun switchingToAnotherKeyboardWhileShownDoesNotCrashPinyinDuck() {
        val others = shell("ime list -s").lines().filter { it.isNotBlank() && !it.startsWith(PACKAGE) }
        if (others.isEmpty()) failTest("No other enabled keyboard to switch to")

        keyboard.openSettingsSearch()
        keyboard.type(INPUT)
        val pidBefore = shell("pidof $PACKAGE")
        shell("logcat -b crash -c")

        val other =
            others.firstOrNull { candidate ->
                shell("ime set $candidate")
                shell("settings get secure default_input_method") == candidate
            } ?: failTest("None of the other enabled keyboards could be selected: ${others.joinToString()}")

        keyboard.assertKeyboardHides("Switching to $other")
        val crashes = shell("logcat -b crash -d -v brief")
        assertFalse(
            "PinyinDuck crashed when switching to $other:\n$crashes",
            "FATAL EXCEPTION" in crashes && "Process: $PACKAGE," in crashes,
        )
        assertEquals("PinyinDuck's process died or restarted when switching to $other", pidBefore, shell("pidof $PACKAGE"))
    }

    private companion object {
        const val INPUT = "nihao"
    }
}
