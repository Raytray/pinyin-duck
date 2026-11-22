package dev.pinyinduck.android.engine

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * How a cross-reference's reading reads in running text. `DetailViewParityTest` pins this
 * against the TypeScript over the real corpus; these are the documented cases by name.
 */
class ReadingWithMarksTest {
    @Test
    fun joinsTheSyllablesOfAWordAndKeepsItsCapital() {
        assertEquals("Shūjīng", readingWithMarks("Shu1 jing1"))
    }

    @Test
    fun separatesAVowelInitialSyllableWithAnApostrophe() {
        assertEquals("Xī'ān", readingWithMarks("Xi1 an1"))
    }

    @Test
    fun splitsSyllablesRunTogetherAfterATone() {
        assertEquals("xiàhái", readingWithMarks("xia4hai2"))
        assertEquals("lǜr", readingWithMarks("lu:4r5"))
    }

    @Test
    fun keepsWhatIsNotASyllableAsWritten() {
        assertEquals("T xù", readingWithMarks("T xu4"))
        assertEquals("Zhēn · Àosītīng", readingWithMarks("Zhen1 · Ao4 si1 ting1"))
    }

    @Test
    fun closesACommaUpToTheWordBeforeIt() {
        assertEquals("rénbǐrén, qìsǐrén", readingWithMarks("ren2 bi3 ren2 , qi4 si3 ren2"))
    }

    @Test
    fun isEmptyForNoReading() {
        assertEquals("", readingWithMarks(""))
    }
}
