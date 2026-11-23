package dev.pinyinduck.android.ime

import dev.pinyinduck.android.engine.FixedWord
import dev.pinyinduck.android.engine.Span
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * What stays composing after a commit-through, and which Fixed words last as the composition
 * changes (#37). A port of the web's `fixed-words.test.ts`, case for case, so both platforms
 * carry fixed words the same way.
 */
class FixedWordsTest {
    // --- composingAfter -------------------------------------------------------------

    @Test
    fun composingAfterKeepsTheRawTextAfterTheTonelessOffset() {
        assertEquals("hekafei", composingAfter("woxianghekafei", 7))
    }

    @Test
    fun composingAfterCommitsASeparatorThatFollowsTheWordWithIt() {
        assertEquals("ren", composingAfter("xi'an'ren", 4))
    }

    @Test
    fun composingAfterCommitsAToneDigitTypedAfterTheWordWithIt() {
        assertEquals("xiang3he1", composingAfter("wo3xiang3he1", 2))
        assertEquals("he1", composingAfter("wo3xiang3he1", 7))
    }

    @Test
    fun composingAfterCountsUColonAsTheOneLetterUmlaut() {
        assertEquals("ren", composingAfter("nu:ren", 2))
    }

    @Test
    fun composingAfterLeavesNothingWhenTheWordEndsTheQuery() {
        assertEquals("", composingAfter("woxiang3", 7))
    }

    // --- carryFixedWords ------------------------------------------------------------

    @Test
    fun fixedWordsLastWhileTheLearnerTypesOn() {
        assertEquals(listOf(XIANG, HE), carryFixedWords(listOf(XIANG, HE), "woxianghekafei"))
    }

    @Test
    fun aBackspaceIntoASpanDropsThatFixedWordAndKeepsThoseBeforeIt() {
        assertEquals(listOf(XIANG), carryFixedWords(listOf(XIANG, HE), "woxiangh"))
        assertEquals(listOf(XIANG, HE), carryFixedWords(listOf(XIANG, HE), "woxianghe"))
    }

    @Test
    fun aFixedCompletionStretchesAsTheLearnerTypesMoreOfItsKey() {
        assertEquals(listOf(KAFEI_ON_KA.copy(span = Span(9, 12))), carryFixedWords(listOf(KAFEI_ON_KA), "woxianghekaf"))
    }

    @Test
    fun aFixedCompletionBecomesAnExactWordOnceItsKeyIsTypedAndThenLasts() {
        assertEquals(listOf(KAFEI_ON_KA.copy(span = Span(9, 14))), carryFixedWords(listOf(KAFEI_ON_KA), "woxianghekafei"))
        assertEquals(
            listOf(KAFEI_ON_KA.copy(span = Span(9, 14))),
            carryFixedWords(listOf(KAFEI_ON_KA.copy(span = Span(9, 14))), "woxianghekafeiranhou"),
        )
    }

    @Test
    fun aFixedCompletionReAnchorsToItsKeyWhenTheLearnerTypesPastItAtOnce() {
        assertEquals(listOf(KAFEI_ON_KA.copy(span = Span(9, 14))), carryFixedWords(listOf(KAFEI_ON_KA), "woxianghekafeir"))
    }

    @Test
    fun aFixedCompletionIsDroppedOnceTheTypingLeavesItsKey() {
        assertEquals(emptyList<FixedWord>(), carryFixedWords(listOf(KAFEI_ON_KA), "woxianghekan"))
    }

    @Test
    fun offsetsAreReadInTheTonelessQueryPastToneDigitsAndSeparators() {
        assertEquals(listOf(KAFEI_ON_KA.copy(span = Span(9, 13))), carryFixedWords(listOf(KAFEI_ON_KA), "wo3xiang3he1ka'fe"))
    }

    private companion object {
        val HE = FixedWord(Span(7, 9), "喝", "喝", "he1")
        val XIANG = FixedWord(Span(2, 7), "向", "向", "xiang4")

        /** 咖啡 fixed on `ka`, a completion: its key `kafei` runs past the span. */
        val KAFEI_ON_KA = FixedWord(Span(9, 11), "咖啡", "咖啡", "ka1 fei1")
    }
}
