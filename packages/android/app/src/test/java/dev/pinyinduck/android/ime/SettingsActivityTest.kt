package dev.pinyinduck.android.ime

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import dev.pinyinduck.android.engine.ScriptType
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The settings screen.
 *
 * It is the only part of the app a user can reach without the keyboard being up, so it is
 * also the first thing that breaks when the app is installed wrong. These assertions cover
 * the screen rendering, the script preference round-tripping, and the dictionary health
 * check that tells a user why they are getting no candidates.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp")
class SettingsActivityTest {

    @get:Rule
    val compose = createAndroidComposeRule<SettingsActivity>()

    private val settings
        get() = KeyboardSettings(ApplicationProvider.getApplicationContext())

    @Test
    fun itShowsTheSettings() {
        compose.onNodeWithText("PinyinDuck").assertIsDisplayed()
        compose.onNodeWithText("Characters").assertIsDisplayed()
        compose.onNodeWithText("Dictionary").assertIsDisplayed()
    }

    @Test
    fun itTellsTheUserHowToEnableTheKeyboard() {
        // Installing is not enough; the keyboard stays switched off until it is enabled, and
        // that is the single most common reason for "it isn't in the list".
        compose.onNodeWithText("On-screen keyboard", substring = true).assertIsDisplayed()
    }

    @Test
    fun itOffersBothScriptsAndMarksTheCurrentOne() {
        compose.onNodeWithText("Simplified").assertIsDisplayed()
        compose.onNodeWithText("Traditional").assertIsDisplayed()
        // The default is Simplified, so it is the one showing a tick.
        compose.onAllNodes(hasText("✓")).assertCountEquals(1)
    }

    @Test
    fun choosingTraditionalPersistsThePreference() {
        compose.onNodeWithText("Traditional").performClick()

        assertEquals(ScriptType.TRADITIONAL, settings.defaultScript)
    }

    @Test
    fun choosingSimplifiedPersistsThePreference() {
        settings.defaultScript = ScriptType.TRADITIONAL

        compose.onNodeWithText("Simplified").performClick()

        assertEquals(ScriptType.SIMPLIFIED, settings.defaultScript)
    }

    @Test
    fun theDictionaryHealthCheckReportsTheCorpusSize() {
        // This is what distinguishes "loaded, genuinely no match" from "the keyboard is broken".
        // The asset is mapped on a background dispatcher, so the first frames still say Loading.
        compose.waitUntil(timeoutMillis = 30_000) {
            compose.onAllNodes(hasText("CC-CEDICT", substring = true))
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("CC-CEDICT: 122746 entries").assertIsDisplayed()
    }

    @Test
    fun thereIsAnEntryPointToTheSystemKeyboardSettings() {
        compose.onNodeWithText("Open keyboard settings").assertIsDisplayed()
    }
}
