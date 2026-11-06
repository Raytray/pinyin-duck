package dev.pinyinduck.android.ime

import dev.pinyinduck.android.engine.ScriptType
import dev.pinyinduck.android.engine.TestDictionary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The composition rules, exercised against a fake editor.
 *
 * Every assertion is on the *editor's* text, not just the session's buffer, because the
 * keyboard writes pinyin into the field as it is typed and then replaces it. Buffer and
 * editor drifting apart is the failure that produces the classic "the cursor ate my
 * character" bug, and it is invisible if a test only inspects the session's own state.
 */
class PinyinDuckSessionTest {
    /**
     * A stand-in editor that models the composing region separately from committed text.
     *
     * The real editor keeps the two apart: `setComposingText` sets the underlined,
     * in-progress region, and `commitText` finalises it. A fake that only has one buffer
     * cannot tell the difference between "the pinyin is being composed" and "the pinyin
     * has been committed as text", which is the distinction the whole change turns on.
     */
    private class FakeEditor : TextSink {
        internal val committed = StringBuilder()
        internal var composing = ""
        var enterCount = 0

        /** What the user actually sees: committed text followed by the composing region. */
        val text: String get() = committed.toString() + composing

        override fun setComposingText(text: String) {
            composing = text
        }

        override fun commitText(text: String) {
            // Committing finalises any composing region and appends the new text.
            committed.append(text)
            composing = ""
        }

        override fun deleteSurrounding(
            before: Int,
            after: Int,
        ) {
            // The cursor sits at the end of the composing region, so a delete takes from
            // there first and only then from committed text.
            val fromComposing = if (before < composing.length) before else composing.length
            composing = composing.dropLast(fromComposing)
            val remaining = before - fromComposing
            if (remaining > 0) {
                val start = (committed.length - remaining).coerceAtLeast(0)
                committed.delete(start, committed.length)
            }
        }

        override fun sendEnter() {
            enterCount++
        }
    }

    private val editor = FakeEditor()
    private val session =
        PinyinDuckSession(sink = editor).also {
            // The dictionary arrives separately, the way the service delivers it once its
            // background load finishes. Handing it over here keeps every test below on the
            // same ready path the running keyboard is on.
            it.onDictionaryReady(TestDictionary.engine)
        }

    private fun type(text: String) = text.forEach { session.typeLetter(it) }

    @Test
    fun typedLettersAppearInTheEditorAndTheBuffer() {
        type("nihao")

        assertEquals("nihao", editor.text.toString())
        assertEquals("nihao", session.buffer)
        assertTrue(session.isComposing)
        assertTrue("expected candidates for nihao", session.hasCandidates)
    }

    @Test
    fun spaceCommitsTheTopCandidate() {
        type("nihao")
        session.space()

        assertEquals("你好", editor.text.toString())
        assertFalse(session.isComposing)
    }

    @Test
    fun selectingAPartialMatchKeepsTheLeftoverPinyinBuffered() {
        type("nihao")
        // 你 sits below 你好 and consumes only "ni", leaving "hao" to finish the phrase.
        val ni = session.candidates.indexOfFirst { it.hanzi == "你" }
        session.selectCandidate(ni)

        assertEquals("你hao", editor.text.toString())
        assertEquals("hao", session.buffer)
        assertTrue(session.isComposing)

        session.space()
        assertEquals("你好", editor.text.toString())
        assertFalse(session.isComposing)
    }

    @Test
    fun backspaceRemovesOneBufferedCharacter() {
        type("nih")
        session.backspace()

        assertEquals("ni", editor.text.toString())
        assertEquals("ni", session.buffer)
    }

    @Test
    fun backspaceClearsTheCompositionWithoutEatingEditorText() {
        type("n")
        session.backspace()

        assertEquals("", editor.text.toString())
        assertEquals("", session.buffer)
    }

    @Test
    fun backspaceWithNoCompositionDeletesBeforeTheCursor() {
        session.typeLetter('h')
        session.typeLetter('i')
        session.backspace()

        assertEquals("h", editor.text.toString())
    }

    @Test
    fun spaceWithNothingComposingInsertsASpace() {
        // A digit starts no composition, so this is plain text followed by a space.
        session.typeDigit(4)
        session.space()

        assertEquals("4 ", editor.text.toString())
    }

    @Test
    fun unresolvableInputCommitsAsRawPinyin() {
        type("qqq")
        assertFalse("qqq should match nothing", session.hasCandidates)

        session.space()
        assertEquals("qqq", editor.text.toString())
        assertFalse(session.isComposing)
    }

    @Test
    fun cancellingRemovesThePinyinFromTheEditor() {
        type("nihao")
        session.cancelComposition()

        assertEquals("", editor.text.toString())
        assertEquals("", session.buffer)
    }

    @Test
    fun enterSendsThePlatformKeyEvenMidComposition() {
        // Space is what commits a candidate; Enter stays "done", as Android users expect.
        type("nihao")
        session.enter()

        assertEquals(1, editor.enterCount)
        assertTrue("the composition is left alone", session.isComposing)
    }

    @Test
    fun aDigitDuringCompositionIsAToneNumber() {
        type("shi")
        session.typeDigit(4)

        assertEquals("shi4", session.buffer)
        assertEquals("shi4", editor.text.toString())
        assertEquals("是", session.candidates.first().hanzi)
    }

    @Test
    fun aDigitWithNoCompositionIsOrdinaryText() {
        session.typeDigit(4)

        assertEquals("4", editor.text.toString())
        assertFalse(session.isComposing)
    }

    @Test
    fun switchingScriptKeepsTheComposition() {
        type("zhongguo")
        assertEquals("中国", session.candidates.first().hanzi)

        session.toggleScript()
        assertEquals(ScriptType.TRADITIONAL, session.script)
        assertEquals("中國", session.candidates.first().hanzi)
        assertEquals("zhongguo", session.buffer)

        session.space()
        assertEquals("中國", editor.text.toString())
    }

    @Test
    fun movingTheSelectionIsBoundedByTheCandidateList() {
        type("ta")
        session.moveSelection(1)
        assertEquals(1, session.selectedIndex)

        session.moveSelection(-1)
        assertEquals(0, session.selectedIndex)

        session.moveSelection(-5)
        assertEquals("selection stops at the first candidate", 0, session.selectedIndex)

        session.moveSelection(Int.MAX_VALUE)
        assertEquals(session.candidates.lastIndex, session.selectedIndex)
    }

    @Test
    fun pagingMovesTheSelectionByAWholePage() {
        type("ta")
        session.moveSelectionByPage(1, pageSize = 5)
        assertEquals(5, session.selectedIndex)
    }

    @Test
    fun theSelectionIsResetWhenTheBufferChanges() {
        type("shi")
        session.moveSelection(3)
        assertEquals(3, session.selectedIndex)

        session.typeLetter('i')
        assertEquals("a new buffer restarts at the top candidate", 0, session.selectedIndex)
    }

    @Test
    fun aNonPinyinKeyWithNoCompositionInsertsItDirectly() {
        // Punctuation and digits must not start a composition they cannot contribute to.
        session.typeDigit(0)
        session.typeDigit(7)
        session.typeDigit(9)

        assertEquals("079", editor.text.toString())
        assertFalse(session.isComposing)
        assertEquals("", session.buffer)
    }

    @Test
    fun aDigitThatIsNotAToneNumberIsPlainTextEvenWhileComposing() {
        type("shi")
        // 0 is never a tone, so it cannot continue the pinyin. The composition ends and
        // the digit is inserted alongside the committed text.
        session.typeDigit(0)

        assertEquals("shi0", editor.text.toString())
        assertEquals("the composition must not absorb it", "", session.buffer)
    }

    @Test
    fun thePinyinIsHeldInTheComposingRegionNotCommitted() {
        // The whole point of the composing region: the editor is told the pinyin is in
        // progress, so it underlines it and leaves it alone. Committing it as plain text
        // would let autocorrect "fix" `nihao` into something else.
        type("nihao")

        assertEquals("nothing should be committed while composing", "", editor.committed.toString())
        assertEquals("nihao", editor.composing)
        assertEquals("nihao", editor.text.toString())
    }

    @Test
    fun committingFinalisesTheComposingRegion() {
        type("nihao")
        session.space()

        assertEquals("你好", editor.committed.toString())
        assertEquals("the composing region should be empty after committing", "", editor.composing)
    }

    @Test
    fun aLongRunOfLettersForceCommitsRatherThanGrowingForever() {
        // A letter run longer than any syllable must not be allowed to scan without bound.
        repeat(PinyinDuckSession.MAX_BUFFER_LENGTH + 10) { session.typeLetter('a') }

        assertTrue(
            "the buffer must stay bounded, was ${session.buffer.length}",
            session.buffer.length <= PinyinDuckSession.MAX_BUFFER_LENGTH,
        )
        assertTrue("the editor must still hold the committed text", editor.text.length > 1)
    }

    @Test
    fun aLongToneRunIsRefusedRatherThanGrowingTheBuffer() {
        type("shi")
        repeat(PinyinDuckSession.MAX_BUFFER_LENGTH + 5) { session.typeDigit(3) }

        assertEquals(
            PinyinDuckSession.MAX_BUFFER_LENGTH,
            session.buffer.length,
        )
    }

    @Test
    fun cancellingWithNothingComposingDoesNothing() {
        session.typeDigit(4)
        session.cancelComposition()

        assertEquals("4", editor.text.toString())
    }

    @Test
    fun cancellingClearsAnyHighlight() {
        type("ta")
        session.moveSelection(5)
        session.cancelComposition()

        assertEquals(-1, session.selectedIndex)
        assertFalse(session.hasCandidates)
    }

    @Test
    fun movingTheSelectionWithNoCandidatesIsHarmless() {
        session.moveSelection(1)
        session.moveSelectionByPage(1, pageSize = 9)
        assertEquals(-1, session.selectedIndex)
    }

    @Test
    fun selectingAnIndexThatIsNotThereDoesNothing() {
        type("nihao")
        val before = editor.text.toString()

        session.selectCandidate(-1)
        session.selectCandidate(9999)

        assertEquals(before, editor.text.toString())
        assertEquals("nihao", session.buffer)
    }

    @Test
    fun committingTheTopCandidateWithNothingComposingKeepsTheRawText() {
        session.typeDigit(4)
        session.commitTopCandidate()

        assertEquals("4", editor.text.toString())
        assertFalse(session.isComposing)
    }

    @Test
    fun committingRawTextWithNothingComposingIsHarmless() {
        session.typeDigit(4)
        session.commitRawText()

        assertEquals("4", editor.text.toString())
        assertFalse(session.isComposing)
    }

    @Test
    fun theScriptSetterWithNoChangeDoesNotRefresh() {
        type("nihao")
        var changes = 0
        session.onChange = { changes++ }

        session.script = session.script
        assertEquals(0, changes)

        session.script = session.script.toggled()
        assertEquals(1, changes)
    }

    @Test
    fun theCandidatesAreCappedAtTheScanBudget() {
        // `s` is the widest prefix in the corpus, so this is the query that would hit the
        // cap. The list is bounded but `total` still reports the true count.
        type("s")
        assertTrue(session.total > session.candidates.size)
        assertEquals(PinyinDuckSession.FETCH_LIMIT, session.candidates.size)
    }

    @Test
    fun aBroadSyllablePagesThroughManyCandidates() {
        type("ta")

        assertTrue("expected a large candidate list", session.total > 100)
        // Paging must not disturb the composition.
        session.moveSelectionByPage(1, pageSize = 9)
        assertEquals(9, session.selectedIndex)
        assertEquals("ta", session.buffer)
    }

    @Test
    fun resettingLeavesTheEditorAlone() {
        type("nihao")
        session.reset()

        assertEquals("", session.buffer)
        assertEquals("nihao", editor.text.toString())
    }

    // --- before the dictionary arrives ------------------------------------------------

    /**
     * A session with no dictionary yet.
     *
     * This is the state the keyboard is in for the whole window between `onCreate` and the
     * background load finishing, and it is the state the bug lived in: keys arriving in it
     * used to be dropped, because the session itself did not exist until the load was done.
     */
    private fun pending() = PinyinDuckSession(sink = editor)

    @Test
    fun lettersTypedBeforeTheDictionaryArrivesStillReachTheEditor() {
        val pending = pending()

        "ni".forEach { pending.typeLetter(it) }

        assertEquals("ni", editor.composing)
        assertEquals("ni", pending.buffer)
    }

    @Test
    fun nothingCanBeRankedBeforeTheDictionaryArrives() {
        val pending = pending()

        "nih".forEach { pending.typeLetter(it) }

        assertFalse(pending.hasCandidates)
        assertEquals(0, pending.total)
        assertEquals(-1, pending.selectedIndex)
    }

    @Test
    fun theDictionaryRanksWhateverWasTypedBeforeItArrived() {
        // The point of `onDictionaryReady`: the pinyin typed during the load is already in
        // the editor, so it gets candidates the moment the engine exists rather than waiting
        // for the user to press another key to provoke a refresh.
        val pending = pending()
        "nih".forEach { pending.typeLetter(it) }

        pending.onDictionaryReady(TestDictionary.engine)

        assertTrue("the backlog must be ranked", pending.hasCandidates)
        assertEquals("nih", pending.buffer)
        assertEquals("the top candidate should be highlighted", 0, pending.selectedIndex)
    }

    @Test
    fun aCompositionIsNotForgottenWhileTheDictionaryIsMissing() {
        // The buffer and the editor's composing region are two views of one text, so
        // forgetting the ranking must never mean forgetting what the user typed. This is
        // the desync that makes a keyboard look like it ate the character.
        val pending = pending()

        pending.typeLetter('n')
        pending.typeLetter('i')

        assertEquals("ni", pending.buffer)
        assertEquals("ni", editor.composing)
    }

    @Test
    fun spaceWithNoDictionaryCommitsTheRawPinyinRatherThanNothing() {
        // If the dictionary never arrives — a corrupt asset, a failed map — the keyboard has
        // to degrade to a plain text keyboard. It must not become one that eats input and
        // types nothing at all.
        val pending = pending()
        "ni".forEach { pending.typeLetter(it) }

        pending.space()

        assertEquals("ni", editor.committed.toString())
        assertFalse(pending.isComposing)
    }

    @Test
    fun aCandidateCanBePickedOnceTheDictionaryArrives() {
        val pending = pending()
        "nihao".forEach { pending.typeLetter(it) }
        pending.onDictionaryReady(TestDictionary.engine)

        pending.space()

        assertEquals("你好", editor.text.toString())
        assertFalse(pending.isComposing)
    }

    @Test
    fun theScriptCanBeToggledBeforeTheDictionaryArrivesAndIsNotUndone() {
        // The toggle is live during the load, so nothing downstream may re-read the stored
        // preference and silently roll the user's own choice back.
        val pending = pending()
        pending.toggleScript()
        pending.typeLetter('n')

        pending.onDictionaryReady(TestDictionary.engine)

        assertEquals(ScriptType.TRADITIONAL, pending.script)
        assertEquals("n", pending.buffer)
    }

    @Test
    fun pinyinTypedInTheChosenScriptRanksInThatScript() {
        val pending = pending()
        pending.toggleScript()
        "zhongguo".forEach { pending.typeLetter(it) }

        pending.onDictionaryReady(TestDictionary.engine)

        assertEquals("中國", pending.candidates.first().hanzi)
    }

    @Test
    fun installingTheDictionaryWithNothingComposedIsHarmless() {
        val pending = pending()
        assertFalse(pending.isReady)

        pending.onDictionaryReady(TestDictionary.engine)

        assertTrue(pending.isReady)
        assertEquals("", pending.buffer)
        assertFalse(pending.hasCandidates)
    }

    // --- direct input (password, email and number fields) ------------------------

    @Test
    fun directInputCommitsLettersAsTypedWithoutComposing() {
        session.direct = true
        type("niHao")

        assertEquals("niHao", editor.committed.toString())
        assertEquals("", editor.composing)
        assertEquals("", session.buffer)
        assertFalse(session.hasCandidates)
    }

    @Test
    fun directInputCommitsEveryDigitIncludingToneDigits() {
        session.direct = true
        type("shi")
        (0..9).forEach { session.typeDigit(it) }

        assertEquals("shi0123456789", editor.text)
        assertFalse(session.isComposing)
    }

    @Test
    fun directInputSpaceAndBackspaceActOnTheText() {
        session.direct = true
        type("ab")
        session.space()
        session.backspace()
        session.backspace()

        assertEquals("a", editor.text)
    }

    @Test
    fun turningDirectInputOnDropsAComposition() {
        type("ni")
        session.direct = true

        assertEquals("", session.buffer)
        assertFalse(session.hasCandidates)
    }

    @Test
    fun turningDirectInputOffComposesAgain() {
        session.direct = true
        session.direct = false
        type("ni")

        assertEquals("ni", session.buffer)
        assertTrue(session.hasCandidates)
    }
}
