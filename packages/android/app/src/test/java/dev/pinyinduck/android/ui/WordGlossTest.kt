package dev.pinyinduck.android.ui

import org.junit.Assert.assertEquals
import org.junit.Test

/** The one-sense gloss under a word of a Sentence candidate; the web's `word-gloss.test.ts`. */
class WordGlossTest {
    @Test
    fun keepsOnlyTheFirstSenseOfTheShortGloss() = assertEquals("to think", wordGloss("to think / to believe / to suppose"))

    @Test
    fun dropsALeadingParenthetical() = assertEquals("tall", wordGloss("(of a person) tall / high"))

    @Test
    fun keepsAParentheticalThatIsNotAtTheStart() = assertEquals("coffee (loanword)", wordGloss("coffee (loanword) / CL:杯 bēi"))

    @Test
    fun keepsASingleSenseAsItIs() = assertEquals("I", wordGloss("I"))

    @Test
    fun fallsBackToTheWholeSenseWhenItIsOnlyAParenthetical() = assertEquals("(particle)", wordGloss("(particle)"))
}
