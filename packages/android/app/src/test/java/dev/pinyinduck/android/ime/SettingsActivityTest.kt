package dev.pinyinduck.android.ime

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ApplicationProvider
import dev.pinyinduck.android.engine.ScriptType
import dev.pinyinduck.android.engine.TestDictionary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
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
            compose
                .onAllNodes(hasText("CC-CEDICT: ", substring = true))
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        // What this test is actually about is that the screen reports the corpus size rather
        // than sitting on "Loading" or an error, so it pins the shape of the line and reads
        // the number back out. Hard-coding the number would re-break this every time the
        // pinned CC-CEDICT edition is bumped.
        val label =
            compose
                .onAllNodes(hasText("CC-CEDICT: ", substring = true))
                .fetchSemanticsNodes()
                .single()
                .config[SemanticsProperties.Text]
                .joinToString("") { it.text }
        assertTrue("expected a corpus size, got \"$label\"", label.matches(Regex("^CC-CEDICT: [\\d,]+ entries$")))
        val reported =
            label
                .removePrefix("CC-CEDICT: ")
                .removeSuffix(" entries")
                .replace(",", "")
                .toInt()
        assertTrue(
            "expected the full CC-CEDICT corpus, the screen reported $reported",
            reported >= TestDictionary.MIN_ENTRY_COUNT,
        )
    }

    @Test
    fun itCreditsEveryDictionarySourceAndItsLicense() {
        // CC BY-SA 4.0 requires the credit wherever the bundled dictionary goes, and this
        // screen is the only place in the app a user can see it.
        compose.onNodeWithText("Credits").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("licensed under CC BY-SA 4.0", substring = true).assertExists()
        for (source in listOf(
            "CC-CEDICT",
            "FrequencyWords (OpenSubtitles 2018)",
            "HSK 3.0 syllabus (2025)",
            "English Wiktionary",
            "HanDeDict",
        )) {
            compose.onNodeWithText(source).performScrollTo().assertIsDisplayed()
        }
        for (author in listOf(
            "By MDBG",
            "By Hermit Dave",
            "By Center for Language Education and Cooperation (中外语言交流合作中心)",
            "By Wiktionary contributors",
            "By HanDeDict contributors",
        )) {
            compose.onNodeWithText(author, substring = true).assertExists()
        }
        // Part of speech: the dump date and commit they were taken from, and what was taken.
        compose.onNodeWithText("dump 2026-10-01", substring = true).assertExists()
        compose.onNodeWithText("commit 0760a107", substring = true).assertExists()
        compose.onNodeWithText("CC BY-SA 2.0 DE / 3.0, adapted under 4.0", substring = true).assertExists()
        compose.onAllNodesWithText("word-class tags only, mapped", substring = true).assertCountEquals(2)
        // HSK: an unlicensed official syllabus, of which only the levels are taken.
        compose.onNodeWithText("No licence · levels only", substring = true).assertExists()
        compose.onNodeWithText("Source: www.chinesetest.cn", substring = true).assertExists()
    }

    @Test
    fun thereIsAnEntryPointToTheSystemKeyboardSettings() {
        compose.onNodeWithText("Open keyboard settings").assertIsDisplayed()
    }
}
