package dev.pinyinduck.android.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer

/**
 * The bigram table reader, against files the test writer builds.
 *
 * Mirrors `packages/core/src/bigram/bigram-codec.test.ts`: the two readers must find the same
 * score for every pair in the one file both clients ship.
 */
class BigramTableTest {
    private val pairs =
        listOf(
            BigramFileWriter.Pair("我", "想", 97088),
            BigramFileWriter.Pair("想", "喝", 85440),
            BigramFileWriter.Pair("想", "和", 93632),
            BigramFileWriter.Pair("喝", "咖啡", 98368),
            BigramFileWriter.Pair("和", "咖啡", 67968),
            BigramFileWriter.Pair("我", "是", 98048),
        )

    private fun table(bytes: ByteArray = BigramFileWriter.encode(pairs, scoreOffset = OFFSET)) = BigramTable.open(ByteBuffer.wrap(bytes))

    @Test
    fun findsTheScoreStoredForAPairOfSimplifiedForms() {
        val table = table()
        assertEquals(85440, table.score("想", "喝"))
        assertEquals(98368, table.score("喝", "咖啡"))
        assertEquals(97088, table.score("我", "想"))
    }

    @Test
    fun scoresAPairByWordIdsAsItDoesByForms() {
        val table = table()
        for (pair in pairs) {
            assertEquals(pair.score, table.scoreById(table.wordId(pair.first), table.wordId(pair.second)))
        }
    }

    @Test
    fun knowsTheBestScoreAnyWordReachesAfterAGivenOne() {
        val table = table()
        assertEquals(98048, table.maxScoreAfter(table.wordId("我")))
        assertEquals(93632, table.maxScoreAfter(table.wordId("想")))
        // 咖啡 only ever comes second, so nothing follows it.
        assertEquals(NO_BIGRAM, table.maxScoreAfter(table.wordId("咖啡")))
        // Asked twice, it is the kept value.
        assertEquals(98048, table.maxScoreAfter(table.wordId("我")))
    }

    @Test
    fun hasNoIdForAWordNoPairUses() {
        val table = table()
        assertEquals(NO_BIGRAM, table.wordId("卧室"))
        assertEquals(NO_BIGRAM, table.wordId(""))
        assertEquals(6, table.wordCount)
        assertEquals(6, table.pairCount)
    }

    @Test
    fun hasNoScoreForAPairItNeverStoredOrAnUnknownWord() {
        val table = table()
        assertNull(table.score("想", "我"))
        assertNull(table.score("咖啡", "我"))
        assertNull(table.score("卧室", "我"))
        assertNull(table.score("我", "卧室"))
        assertEquals(NO_BIGRAM, table.scoreById(table.wordId("想"), table.wordId("我")))
    }

    @Test
    fun keepsWordsOutsideTheBasicMultilingualPlaneApartFromTheOnesAroundThem() {
        // U+2C90A sorts after U+FFxx by code point but before it by UTF-16 unit; the sorted
        // index uses UTF-16 units, and the reader must compare the same way.
        val astral = String(Character.toChars(0x2C90A))
        val halfWidth = "｡"
        val table =
            table(
                BigramFileWriter.encode(
                    listOf(
                        BigramFileWriter.Pair(astral, "是", 90000),
                        BigramFileWriter.Pair(halfWidth, "是", 80000),
                        BigramFileWriter.Pair("é", astral, 70000),
                        BigramFileWriter.Pair("a", halfWidth, 60000),
                    ),
                    scoreOffset = OFFSET,
                ),
            )
        assertEquals(89984, table.score(astral, "是"))
        assertEquals(80000, table.score(halfWidth, "是"))
        assertEquals(70016, table.score("é", astral))
        assertEquals(59968, table.score("a", halfWidth))
        assertNull(table.score(astral.substring(0, 1), "是"))
        assertNull(table.score("ab", halfWidth))
    }

    @Test
    fun recordsTheScoreOffsetAndStepAndRoundsEachScoreToTheNearestStep() {
        val table = table(BigramFileWriter.encode(listOf(BigramFileWriter.Pair("a", "b", OFFSET - 100)), OFFSET, 64))
        assertEquals(OFFSET, table.scoreOffset)
        assertEquals(64, table.scoreStep)
        // 100 below the offset rounds to two steps of 64.
        assertEquals(OFFSET - 128, table.score("a", "b"))
    }

    @Test
    fun readsAnEmptyTable() {
        val table = table(BigramFileWriter.encode(emptyList(), OFFSET))
        assertEquals(0, table.wordCount)
        assertNull(table.score("a", "b"))
    }

    @Test
    fun refusesAFileWithTheWrongMagicNumber() {
        val bytes = BigramFileWriter.encode(pairs, OFFSET).also { it[0] = 'X'.code.toByte() }
        val error = assertThrows(BigramFormatException::class.java) { table(bytes) }
        assertTrue(error.message!!, error.message!!.contains("not a PinyinDuck bigram file"))
    }

    @Test
    fun refusesAFileOfAnotherFormatVersion() {
        val error = assertThrows(BigramFormatException::class.java) { table(BigramFileWriter.encode(pairs, OFFSET, version = 2)) }
        assertTrue(error.message!!, error.message!!.contains("built with format 2"))
    }

    @Test
    fun refusesATruncatedHeaderOrBody() {
        val bytes = BigramFileWriter.encode(pairs, OFFSET)
        assertThrows(BigramFormatException::class.java) { table(bytes.copyOf(20)) }
        val error = assertThrows(BigramFormatException::class.java) { table(bytes.copyOf(bytes.size - 1)) }
        assertTrue(error.message!!, error.message!!.contains("expected ${bytes.size} bytes"))
        // A word count with the top bit set reads as a huge count, not a negative one.
        val huge = bytes.copyOf().also { writeU32(it, 8, -1) }
        assertThrows(BigramFormatException::class.java) { table(huge) }
    }

    @Test
    fun refusesAWordWhoseTextRunsPastTheWordTable() {
        val bytes = BigramFileWriter.encode(pairs, OFFSET)
        // The first word's end offset (word offsets start right after the header).
        writeU32(bytes, BIGRAM_HEADER_SIZE + 4, 0x7fff)
        val error = assertThrows(BigramFormatException::class.java) { table(bytes) }
        assertTrue(error.message!!, error.message!!.contains("word 0 is out of bounds"))

        // A word that ends before it starts.
        val backwards = BigramFileWriter.encode(pairs, OFFSET)
        writeU32(backwards, BIGRAM_HEADER_SIZE + 8, 0)
        val reversed = assertThrows(BigramFormatException::class.java) { table(backwards) }
        assertTrue(reversed.message!!, reversed.message!!.contains("word 1 is out of bounds"))
    }

    @Test
    fun refusesASortedWordIndexThatNamesNoWord() {
        val bytes = BigramFileWriter.encode(pairs, OFFSET)
        val textLength = readU32(bytes, 16)
        val sortedIds = BIGRAM_HEADER_SIZE + (6 + 1) * 4 + textLength
        writeU32(bytes, sortedIds, 99)
        val error = assertThrows(BigramFormatException::class.java) { table(bytes) }
        assertTrue(error.message!!, error.message!!.contains("names word 99"))
    }

    @Test
    fun refusesAPairIndexThatDoesNotEndAtThePairCount() {
        val bytes = BigramFileWriter.encode(pairs, OFFSET)
        val textLength = readU32(bytes, 16)
        val pairStarts = BIGRAM_HEADER_SIZE + (6 + 1) * 4 + textLength + 6 * 4
        writeU32(bytes, pairStarts + 6 * 4, 5)
        val error = assertThrows(BigramFormatException::class.java) { table(bytes) }
        assertTrue(error.message!!, error.message!!.contains("does not end at the pair count"))
    }

    @Test
    fun aBigramFailureIsADictionaryFormatFailure() {
        // So the keyboard reports it through the existing dictionary error path.
        val error = assertThrows(DictionaryFormatException::class.java) { table(ByteArray(4)) }
        assertTrue(error.message!!, error.message!!.contains("npm run build:bigrams"))
    }

    @Test
    fun readsATableThatSitsInsideALargerBuffer() {
        val bytes = BigramFileWriter.encode(pairs, OFFSET)
        val padded = ByteArray(7) + bytes + ByteArray(5)
        val view = ByteBuffer.wrap(padded, 7, bytes.size).slice()
        assertEquals(85440, BigramTable.open(view).score("想", "喝"))
        // And through a page source, which is how the keyboard opens it.
        assertEquals(85440, BigramTable.open(ByteArrayPageSource(bytes)).score("想", "喝"))
    }

    private fun readU32(
        bytes: ByteArray,
        at: Int,
    ) = (0 until 4).sumOf { (bytes[at + it].toInt() and 0xff) shl (8 * it) }

    private fun writeU32(
        bytes: ByteArray,
        at: Int,
        value: Int,
    ) {
        for (i in 0 until 4) bytes[at + i] = (value ushr (8 * i)).toByte()
    }

    private companion object {
        const val OFFSET = 119936
    }
}
