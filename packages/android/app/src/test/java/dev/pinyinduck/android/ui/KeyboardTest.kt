package dev.pinyinduck.android.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
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
import org.robolectric.annotation.Config

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
    @Config(qualifiers = "w411dp-h891dp")
    fun typingDoesNotChangeTheKeyboardsHeight() {
        // Before typing the composition bar holds a hint that wraps to two lines on a phone;
        // it must fit the bar, or the keyboard shrinks on the first key and the app jumps.
        var state by mutableStateOf(KeyboardUiState(loading = false, dictionaryEntries = 125_276))
        compose.setContent {
            PinyinDuckTheme {
                PinyinDuckKeyboard(state = state, callbacks = Recorder().callbacks(), modifier = Modifier.testTag(KEYBOARD_TAG))
            }
        }
        val before = compose.onNodeWithTag(KEYBOARD_TAG).getBoundsInRoot()

        state = state.copy(buffer = "ni", candidates = listOf(candidate("你", "nǐ", "you")), total = 1)
        compose.waitForIdle()
        val composing = compose.onNodeWithTag(KEYBOARD_TAG).getBoundsInRoot()

        assertEquals(before.bottom - before.top, composing.bottom - composing.top)
    }

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

    @Test
    fun aStripWaitingOnTheDictionaryDoesNotClaimAMissedLookup() {
        // The session accepts letters while the dictionary is still mapping, so a composition
        // can be in progress with nothing ranked yet. "No match" there would be a lie: the
        // lookup has not run, and telling the user their pinyin does not exist is worse than
        // admitting the wait.
        show(Recorder(), buffer = "ni", loading = true)

        compose.onAllNodesWithText("No match").assertCountEquals(0)
        compose.onNodeWithText("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun theCompositionBarShowsTypedPinyinWhileTheDictionaryLoads() {
        // The buffer is the more specific fact and the one the user is looking for. Showing
        // the loading hint over it would hide what they just typed behind a message about the
        // dictionary, which is how a keyboard mid-load reads as having swallowed the input.
        show(Recorder(), buffer = "ni", loading = true)

        compose.onNodeWithText("ni").assertIsDisplayed()
        compose.onAllNodesWithText("Loading dictionary", substring = true).assertCountEquals(0)
    }

    @Test
    fun theCompositionBarStillReportsProgressWhileNothingHasBeenTyped() {
        show(Recorder(), loading = true)

        compose.onNodeWithText("Loading dictionary", substring = true).assertIsDisplayed()
    }

    @Test
    fun aFailedDictionaryOutranksEverythingInTheBar() {
        // A load that failed outright has no composition to recover and no backlog to rank, so
        // the reason is all there is to say.
        show(Recorder(), buffer = "ni", loading = false, error = "The dictionary is missing.")

        compose.onNodeWithText("The dictionary is missing.").assertIsDisplayed()
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
    fun theExpandedPanelCanBeCollapsed() {
        val recorder = Recorder()
        show(
            recorder,
            expanded = true,
            buffer = "ni",
            candidates = listOf(candidate("你", "nǐ", "you")),
        )

        compose.onNodeWithText("▾").performClick()

        assertEquals(1, recorder.expandedToggles)
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
