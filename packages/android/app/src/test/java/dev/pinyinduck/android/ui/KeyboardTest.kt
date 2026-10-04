package dev.pinyinduck.android.ui

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.pinyinduck.android.engine.Candidate
import dev.pinyinduck.android.engine.ScriptType
import dev.pinyinduck.android.ime.KeyboardUiState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The keyboard as drawn.
 *
 * The composition rules are covered against a fake editor in `PinyinDuckSessionTest`; what
 * is checked here is that the UI reflects that state and that every control reports the
 * action it advertises. A keyboard that ranks correctly but never shows the candidate, or
 * whose expand button does nothing, fails the user while every engine test passes.
 */
@RunWith(RobolectricTestRunner::class)
class KeyboardTest {
    @get:Rule
    val compose = createComposeRule()

    /** Records what the user tapped, so each control can be tied to the action it triggers. */
    private class Recorder {
        val keys = mutableListOf<KeyAction>()
        val selected = mutableListOf<Int>()
        var scriptToggles = 0
        var expandedToggles = 0
        var clears = 0

        fun callbacks() =
            KeyboardCallbacks(
                onKey = { keys.add(it) },
                onSelectCandidate = { selected.add(it) },
                onToggleScript = { scriptToggles++ },
                onToggleExpanded = { expandedToggles++ },
                onClear = { clears++ },
            )
    }

    // --- keys -------------------------------------------------------------------

    @Test
    fun theLetterKeysAppear() {
        show(Recorder())

        compose.onNodeWithText("q").assertIsDisplayed()
        compose.onNodeWithText("p").assertIsDisplayed()
        compose.onNodeWithText("z").assertIsDisplayed()
    }

    @Test
    fun tappingALetterReportsThatLetter() {
        val recorder = Recorder()
        show(recorder)

        compose.onNodeWithText("n").performClick()
        compose.onNodeWithText("i").performClick()

        assertEquals(listOf(KeyAction.Letter('n'), KeyAction.Letter('i')), recorder.keys)
    }

    @Test
    fun shiftUppercasesTheLettersItLabels() {
        val recorder = Recorder()
        show(recorder, shift = true)

        compose.onNodeWithText("⇧").performClick()
        compose.onNodeWithText("N").performClick()

        assertEquals(KeyAction.Shift, recorder.keys.first())
        // The key carries the upper-case letter; the session lowercases the query itself.
        assertEquals(KeyAction.Letter('N'), recorder.keys.last())
    }

    @Test
    fun theCoreKeysAreAlwaysPresent() {
        show(Recorder())

        compose.onNodeWithText("⌫").assertIsDisplayed()
        compose.onNodeWithText("↵").assertIsDisplayed()
        compose.onNodeWithText("space").assertIsDisplayed()
        compose.onNodeWithText("?123").assertIsDisplayed()
    }

    @Test
    fun theLayerSwitchesToDigits() {
        show(Recorder(), layout = KeyLayout.NUMBERS)

        compose.onNodeWithText("1").assertIsDisplayed()
        compose.onNodeWithText("0").assertIsDisplayed()
        compose.onNodeWithText("ABC").assertIsDisplayed()
    }

    @Test
    fun theSymbolLayerOffersItsOwnKeys() {
        show(Recorder(), layout = KeyLayout.SYMBOLS)

        compose.onNodeWithText("~").assertIsDisplayed()
        compose.onNodeWithText("123").assertIsDisplayed()
    }

    // --- candidate strip --------------------------------------------------------

    @Test
    fun theStripShowsTheCompositionAndEachCandidateWithItsDefinition() {
        show(
            Recorder(),
            buffer = "nihao",
            candidates = listOf(candidate("你好", "nǐ hǎo", "hello; hi")),
        )

        compose.onNodeWithText("nihao").assertIsDisplayed()
        compose.onNodeWithText("你好").assertIsDisplayed()
        // The definition, not the pinyin: the collapsed strip has one line and the gloss is
        // what distinguishes `你` from `泥`.
        compose.onNodeWithText("hello; hi").assertIsDisplayed()
        compose.onAllNodesWithText("nǐ hǎo").assertCountEquals(0)
    }

    @Test
    fun tappingACandidateReportsItsIndex() {
        val recorder = Recorder()
        show(
            recorder,
            buffer = "ta",
            candidates = listOf(candidate("他", "tā"), candidate("她", "tā")),
        )

        compose.onNodeWithText("她").performClick()

        assertEquals(listOf(1), recorder.selected)
    }

    @Test
    fun anUnmatchedCompositionSaysSo() {
        show(Recorder(), buffer = "qqq")

        compose.onNodeWithText("No match").assertIsDisplayed()
    }

    @Test
    fun anIdleStripDoesNotClaimAMissedLookup() {
        show(Recorder())

        // Nothing composed means nothing was searched, so "No match" would wrongly imply a
        // lookup came back empty.
        compose.onAllNodesWithText("No match").assertCountEquals(0)
    }

    // --- composition bar --------------------------------------------------------

    @Test
    fun theScriptButtonShowsWhichScriptIsActive() {
        show(Recorder(), script = ScriptType.SIMPLIFIED)
        compose.onNodeWithText("简").assertIsDisplayed()
    }

    @Test
    fun theTraditionalScriptIsLabelledInTraditional() {
        show(Recorder(), script = ScriptType.TRADITIONAL)
        compose.onNodeWithText("繁").assertIsDisplayed()
    }

    @Test
    fun theScriptButtonReportsAToggle() {
        val recorder = Recorder()
        show(recorder)

        compose.onNodeWithText("简").performClick()

        assertEquals(1, recorder.scriptToggles)
    }

    @Test
    fun theExpandButtonReportsAToggle() {
        val recorder = Recorder()
        show(recorder)

        compose.onNodeWithText("▴").performClick()

        assertEquals(1, recorder.expandedToggles)
    }

    @Test
    fun theClearButtonRemovesTheComposition() {
        val recorder = Recorder()
        show(recorder, buffer = "nihao")

        compose.onNodeWithText("✕").performClick()

        assertEquals(1, recorder.clears)
    }

    @Test
    fun theIdleBarCountsTheDictionary() {
        // The entry count tells the user the dictionary loaded, which is the difference
        // between "no candidates" and "the keyboard is broken".
        show(Recorder(), entries = 122_746)

        compose.onNodeWithText("122,746 entries ready", substring = true).assertIsDisplayed()
    }

    @Test
    fun aLoadingDictionarySaysItIsLoading() {
        show(Recorder(), loading = true)

        compose.onNodeWithText("Loading dictionary", substring = true).assertIsDisplayed()
    }

    @Test
    fun aFailedDictionaryExplainsItself() {
        show(Recorder(), error = "dictionary.btree is missing from the app.")

        compose
            .onNodeWithText("dictionary.btree is missing from the app.", substring = true)
            .assertIsDisplayed()
    }

    // --- expanded panel ---------------------------------------------------------

    @Test
    fun theExpandedPanelListsTheDefinitions() {
        show(
            Recorder(),
            expanded = true,
            buffer = "ni",
            candidates =
                listOf(
                    candidate("你", "nǐ", "you (informal)"),
                    candidate("泥", "ní", "mud / clay"),
                ),
        )

        compose.onNodeWithText("你").assertIsDisplayed()
        compose.onNodeWithText("nǐ").assertIsDisplayed()
        compose.onNodeWithText("you (informal)").assertIsDisplayed()
        compose.onNodeWithText("泥").assertIsDisplayed()
        compose.onNodeWithText("mud / clay").assertIsDisplayed()
    }

    @Test
    fun theExpandedPanelShowsTheMatchCount() {
        show(
            Recorder(),
            expanded = true,
            buffer = "ta",
            total = 1476,
            candidates = listOf(candidate("他", "tā")),
        )

        compose.onNodeWithText("1476 matches", substring = true).assertIsDisplayed()
    }

    @Test
    fun theExpandedPanelShowsTheHskLevel() {
        show(
            Recorder(),
            expanded = true,
            buffer = "ni",
            candidates = listOf(candidate("你", "nǐ", "you", hskLevel = 1)),
        )

        compose.onNodeWithText("HSK1").assertIsDisplayed()
    }

    @Test
    fun theWholeCardSelectsTheCandidate() {
        val recorder = Recorder()
        show(
            recorder,
            expanded = true,
            buffer = "ni",
            candidates =
                listOf(
                    candidate("你", "nǐ", "you"),
                    candidate("尼", "ní", "nun"),
                ),
        )

        // Tapping the definition rather than the character selects the same candidate.
        compose.onNodeWithText("nun").performClick()

        assertEquals(listOf(1), recorder.selected)
    }

    // --- helpers ----------------------------------------------------------------

    private fun show(
        recorder: Recorder,
        buffer: String = "",
        candidates: List<Candidate> = emptyList(),
        total: Int = candidates.size,
        selectedIndex: Int = -1,
        script: ScriptType = ScriptType.SIMPLIFIED,
        shift: Boolean = false,
        layout: KeyLayout = KeyLayout.LETTERS,
        expanded: Boolean = false,
        loading: Boolean = false,
        error: String? = null,
        entries: Int = 0,
    ) {
        compose.setContent {
            PinyinDuckTheme {
                PinyinDuckKeyboard(
                    state =
                        KeyboardUiState(
                            loading = loading,
                            dictionaryError = error,
                            dictionaryEntries = entries,
                            buffer = buffer,
                            candidates = candidates,
                            total = total,
                            selectedIndex = selectedIndex,
                            script = script,
                            shift = shift,
                            layout = layout,
                            expanded = expanded,
                        ),
                    callbacks = recorder.callbacks(),
                )
            }
        }
    }

    private fun candidate(
        hanzi: String,
        marks: String,
        gloss: String = "",
        hskLevel: Int? = null,
    ) = Candidate(
        id = "$hanzi-$marks",
        hanzi = hanzi,
        simplified = hanzi,
        traditional = hanzi,
        pinyinMarks = marks,
        pinyinNumbers = "",
        shortGloss = gloss,
        frequency = 0,
        matchedPinyin = "",
        remainingPinyin = "",
        hskLevel = hskLevel,
    )
}
