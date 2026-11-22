package dev.pinyinduck.android.engine

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The Candidate detail file's wire format, mirroring `detail-codec.test.ts`.
 *
 * The layout is pinned by the same hand-worked bytes the TypeScript suite writes, so the two
 * readers cannot drift apart on the file both platforms ship. The other cases build files
 * with [DetailFileWriter], which is held to those same bytes.
 */
class DetailCodecTest {
    /** The bytes `detail-codec.test.ts` pins in "writes the documented layout byte for byte". */
    private val documentedLayout =
        listOf(
            "50 44 44 54 01 00 00 00", // "PDDT", format 1, reserved
            "01 00 00 00 04 03 02 01", // one entry, build id 0x01020304
            "18 00 00 00 30 00 00 00", // the record runs from byte 24 to byte 48
            "00", // no heading
            "01 00 01", // one sense: common, one reference
            "61 62 00", // "ab"
            "e5 80 8b 00 e4 b8 aa 00 67 65 34 00", // 個 个 ge4
            "00", // "" after the reference
            "00 00", // no tags, no measure words
            "01 00", // one part of speech: noun
        ).joinToString(" ")

    /** The record [documentedLayout] holds. */
    private val documentedRecord =
        DetailRecord(
            heading = "",
            senses = listOf(DetailSense(proper = false, text = RichText(listOf("ab", ""), listOf(CrossRef("個", "个", "ge4"))))),
            tags = emptyList(),
            measureWords = emptyList(),
            partsOfSpeech = listOf(PartOfSpeech.NOUN),
        )

    /** 書 shū: common and proper noun senses, measure words, a cross-reference, a tag. */
    private val shu =
        DetailRecord(
            heading = "",
            senses =
                listOf(
                    DetailSense(false, RichText(listOf("book"))),
                    DetailSense(false, RichText(listOf("letter"))),
                    DetailSense(true, RichText(listOf("", " (classic)"), listOf(CrossRef("書經", "书经", "Shu1 jing1")))),
                ),
            tags = listOf(DetailTag(TagKind.ALSO_PRONOUNCED, RichText(listOf("", ""), listOf(CrossRef("", "", "shu4"))))),
            measureWords = listOf(CrossRef("本", "本", "ben3"), CrossRef("冊", "册", "ce4")),
            partsOfSpeech = emptyList(),
        )

    /** 唸 niàn: a variant-only entry, which carries its target's gloss. */
    private val nian =
        DetailRecord(
            heading = "唸",
            senses = emptyList(),
            tags =
                listOf(
                    DetailTag(TagKind.VARIANT, RichText(listOf("", ""), listOf(CrossRef("念", "念", "nian4"))), "to read aloud"),
                ),
            measureWords = emptyList(),
            partsOfSpeech = listOf(PartOfSpeech.NOUN, PartOfSpeech.VERB),
        )

    private val empty = DetailRecord("", emptyList(), emptyList(), emptyList(), emptyList())

    private fun bytesOf(hex: String): ByteArray =
        hex
            .split(" ")
            .map { it.toInt(16).toByte() }
            .toByteArray()

    private fun open(
        bytes: ByteArray,
        buildId: Int,
    ) = DetailFile.open(ByteArrayPageSource(bytes), buildId)

    private fun ByteArray.u32At(offset: Int): Int = ByteBuffer.wrap(this).order(ByteOrder.LITTLE_ENDIAN).getInt(offset)

    private fun ByteArray.setU32(
        offset: Int,
        value: Int,
    ) {
        ByteBuffer.wrap(this).order(ByteOrder.LITTLE_ENDIAN).putInt(offset, value)
    }

    @Test
    fun readsTheDocumentedLayoutByteForByte() {
        val file = open(bytesOf(documentedLayout), 0x01020304)

        assertEquals(1, file.entryCount)
        assertEquals(0x01020304, file.buildId)
        assertEquals(documentedRecord, file.record(0))
    }

    @Test
    fun theTestWriterWritesTheDocumentedLayout() {
        assertArrayEquals(bytesOf(documentedLayout), DetailFileWriter.encode(listOf(documentedRecord), 0x01020304))
    }

    @Test
    fun readsEveryRecordByEntryId() {
        val file = open(DetailFileWriter.encode(listOf(shu, nian, empty), 0x1234abcd), 0x1234abcd)

        assertEquals(3, file.entryCount)
        assertEquals(0x1234abcd, file.buildId)
        assertEquals(shu, file.record(0))
        assertEquals(nian, file.record(1))
        assertEquals(empty, file.record(2))
    }

    @Test
    fun readsABuildIdWithTheTopBitSet() {
        // Build ids are u32s; half of them read back negative as a Kotlin Int.
        val buildId = 0xdb58b1dc.toInt()
        assertEquals(buildId, open(DetailFileWriter.encode(listOf(empty), buildId), buildId).buildId)
    }

    @Test
    fun refusesAFileFromAnotherBuildAsAFailedLoad() {
        val bytes = DetailFileWriter.encode(listOf(shu), 7)
        val error = assertThrows(DetailBuildMismatchException::class.java) { open(bytes, 8) }
        assertEquals(7, error.detailBuildId)
        assertEquals(8, error.dictionaryBuildId)
        assertTrue(error.message, error.message!!.contains("build 00000007"))
        assertTrue(error.message, error.message!!.contains("build 00000008"))
    }

    @Test
    fun refusesBytesThatAreNotADetailFile() {
        val notDetail = assertThrows(DictionaryFormatException::class.java) { open(ByteArray(16) { (it + 1).toByte() }, 1) }
        assertTrue(notDetail.message, notDetail.message!!.contains("not a PinyinDuck Candidate detail file"))

        val short = assertThrows(DictionaryFormatException::class.java) { open(ByteArray(3), 1) }
        assertTrue(short.message, short.message!!.contains("truncated"))
    }

    @Test
    fun refusesAnotherFormatVersion() {
        val bytes = DetailFileWriter.encode(listOf(empty), 1)
        bytes[4] = 99
        val error = assertThrows(DictionaryFormatException::class.java) { open(bytes, 1) }
        assertTrue(error.message, error.message!!.contains("format 99"))
    }

    @Test
    fun refusesAFileWhoseRecordsRunPastItsEnd() {
        val bytes = DetailFileWriter.encode(listOf(shu, nian), 1)
        val error = assertThrows(DictionaryFormatException::class.java) { open(bytes.copyOf(bytes.size - 5), 1) }
        assertTrue(error.message, error.message!!.contains("truncated"))
    }

    @Test
    fun refusesAnEntryIdItDoesNotHold() {
        val file = open(DetailFileWriter.encode(listOf(empty), 1), 1)
        val tooHigh = assertThrows(IllegalArgumentException::class.java) { file.record(1) }
        assertTrue(tooHigh.message, tooHigh.message!!.contains("entry 1"))
        val negative = assertThrows(IllegalArgumentException::class.java) { file.record(-1) }
        assertTrue(negative.message, negative.message!!.contains("entry -1"))
    }

    @Test
    fun callsARecordCutOffMidStringMalformed() {
        val bytes = DetailFileWriter.encode(listOf(shu), 1)
        // End the only record four bytes in, inside "book".
        bytes.setU32(20, bytes.u32At(16) + 4)
        val error = assertThrows(DictionaryFormatException::class.java) { open(bytes, 1).record(0) }
        assertTrue(error.message, error.message!!.contains("malformed or truncated"))
    }

    @Test
    fun callsARecordCutOffMidCountMalformed() {
        val bytes = DetailFileWriter.encode(listOf(shu), 1)
        // End the record after its heading and sense count, before the first sense kind.
        bytes.setU32(20, bytes.u32At(16) + 2)
        val error = assertThrows(DictionaryFormatException::class.java) { open(bytes, 1).record(0) }
        assertTrue(error.message, error.message!!.contains("malformed or truncated"))
    }

    @Test
    fun callsACountLargerThanTheRecordMalformed() {
        val bytes = DetailFileWriter.encode(listOf(shu), 1)
        // The sense count follows the empty heading; claim a hundred senses in a short record.
        bytes[bytes.u32At(16) + 1] = 100
        val error = assertThrows(DictionaryFormatException::class.java) { open(bytes, 1).record(0) }
        assertTrue(error.message, error.message!!.contains("count runs past"))
    }

    @Test
    fun callsACountPastTwoToTheThirtyOneMalformed() {
        // A five-byte varint count of 0xffffffff, which reads back negative as a Kotlin Int.
        val bytes = fileWithRecord(0x00, 0xff, 0xff, 0xff, 0xff, 0x0f)
        val error = assertThrows(DictionaryFormatException::class.java) { open(bytes, 1).record(0) }
        assertTrue(error.message, error.message!!.contains("count runs past"))
    }

    @Test
    fun callsAHeadingWithNoEndMalformed() {
        val bytes = fileWithRecord(0x61, 0x62)
        val error = assertThrows(DictionaryFormatException::class.java) { open(bytes, 1).record(0) }
        assertTrue(error.message, error.message!!.contains("malformed or truncated (a string has no end)"))
    }

    @Test
    fun refusesALastOffsetPastTwoGibibytes() {
        val bytes = DetailFileWriter.encode(listOf(empty), 1)
        bytes.setU32(20, -1)
        val error = assertThrows(DictionaryFormatException::class.java) { open(bytes, 1) }
        assertTrue(error.message, error.message!!.contains("records are truncated"))
    }

    @Test
    fun refusesAnEntryCountPastTwoToTheThirtyOne() {
        val bytes = DetailFileWriter.encode(listOf(empty), 1)
        bytes.setU32(8, Int.MIN_VALUE)
        val error = assertThrows(DictionaryFormatException::class.java) { open(bytes, 1) }
        assertTrue(error.message, error.message!!.contains("offset table is truncated"))
    }

    /** A one-entry file whose only record is exactly [record], for bytes the writer cannot produce. */
    private fun fileWithRecord(vararg record: Int): ByteArray {
        val prefix = DetailFileWriter.encode(emptyList(), 1).size + 4
        val bytes = DetailFileWriter.encode(listOf(empty), 1).copyOf(prefix) + ByteArray(record.size) { record[it].toByte() }
        bytes.setU32(20, bytes.size)
        return bytes
    }

    @Test
    fun refusesAnOffsetTableThatRunsPastTheEndOfTheFile() {
        val bytes = DetailFileWriter.encode(listOf(empty), 1)
        bytes.setU32(8, 1000)
        val error = assertThrows(DictionaryFormatException::class.java) { open(bytes, 1) }
        assertTrue(error.message, error.message!!.contains("offset table is truncated"))
    }

    @Test
    fun refusesARecordThatEndsBeforeItStarts() {
        val bytes = DetailFileWriter.encode(listOf(shu, empty), 1)
        bytes.setU32(20, bytes.u32At(16) - 1)
        val error = assertThrows(DictionaryFormatException::class.java) { open(bytes, 1).record(0) }
        assertTrue(error.message, error.message!!.contains("entry 0 ends before it starts"))
    }

    @Test
    fun refusesARecordThatNamesAnUnknownSenseKind() {
        val bytes = DetailFileWriter.encode(listOf(shu), 1)
        // The record is the empty heading, the sense count, then the first sense kind.
        bytes[bytes.u32At(16) + 2] = 7
        val error = assertThrows(DictionaryFormatException::class.java) { open(bytes, 1).record(0) }
        assertTrue(error.message, error.message!!.contains("sense kind 7"))
    }

    @Test
    fun refusesARecordThatNamesAnUnknownTagOrPartOfSpeech() {
        val bytes = DetailFileWriter.encode(listOf(nian), 1)
        // The record is heading (唸 and its end), sense count, tag count, then the tag kind.
        val badTag = bytes.copyOf()
        badTag[bytes.u32At(16) + "唸".toByteArray().size + 1 + 1 + 1] = 200.toByte()
        val tagError = assertThrows(DictionaryFormatException::class.java) { open(badTag, 1).record(0) }
        assertTrue(tagError.message, tagError.message!!.contains("tag kind 200"))

        val badPos = bytes.copyOf()
        badPos[bytes.size - 1] = 200.toByte()
        val posError = assertThrows(DictionaryFormatException::class.java) { open(badPos, 1).record(0) }
        assertTrue(posError.message, posError.message!!.contains("part of speech 200"))
    }
}
