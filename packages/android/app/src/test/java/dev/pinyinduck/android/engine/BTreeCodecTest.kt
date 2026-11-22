package dev.pinyinduck.android.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer

/**
 * The B-tree wire format: varints, page decoding and every malformed-input path.
 *
 * These are the paths that only run when the committed asset is wrong, which is exactly
 * when a keyboard should report a clear error rather than return no candidates. The web
 * suite covers the same ground in `btree-codec.test.ts`.
 */
class BTreeCodecTest {
    private fun bufferOf(vararg bytes: Int): ByteBuffer = ByteBuffer.wrap(ByteArray(bytes.size) { bytes[it].toByte() })

    // --- varints -----------------------------------------------------------------

    @Test
    fun readsSingleByteVarints() {
        assertEquals(0, ByteReader(bufferOf(0x00)).varint())
        assertEquals(1, ByteReader(bufferOf(0x01)).varint())
        assertEquals(127, ByteReader(bufferOf(0x7f)).varint())
    }

    @Test
    fun readsMultiByteVarints() {
        // 128 and 300 both need a continuation byte.
        assertEquals(128, ByteReader(bufferOf(0x80, 0x01)).varint())
        assertEquals(300, ByteReader(bufferOf(0xac, 0x02)).varint())
    }

    @Test
    fun rejectsAnOverlongVarint() {
        // Every byte has the continuation bit set, which no real value uses.
        val corrupt = bufferOf(0xff, 0xff, 0xff, 0xff, 0xff, 0xff)
        assertThrows(DictionaryFormatException::class.java) { ByteReader(corrupt).varint() }
    }

    @Test
    fun readsLittleEndianFixedWidthValues() {
        assertEquals(0x0102, ByteReader(bufferOf(0x02, 0x01)).u16())
        assertEquals(0x01020304, ByteReader(bufferOf(0x04, 0x03, 0x02, 0x01)).u32())
        assertEquals(0xff, ByteReader(bufferOf(0xff)).u8())
    }

    @Test
    fun reportsHowFarItHasRead() {
        val reader = ByteReader(bufferOf(1, 2, 3))
        assertEquals(0, reader.offset)
        assertEquals(3, reader.remaining)
        reader.u8()
        assertEquals(1, reader.offset)
        assertEquals(2, reader.remaining)
    }

    // --- strings -----------------------------------------------------------------

    @Test
    fun readsUtf8Strings() {
        // 你好 in UTF-8 is six bytes, preceded by its length varint.
        val bytes = byteArrayOf(0x06) + "你好".toByteArray(Charsets.UTF_8)
        assertEquals("你好", ByteReader(ByteBuffer.wrap(bytes)).string())
    }

    @Test
    fun readsZeroTerminatedStrings() {
        // The Candidate detail file's strings: UTF-8 ended by a zero byte, not length-prefixed.
        val reader = ByteReader(bufferOf(0x61, 0x62, 0x00, 0x00, 0xe4, 0xb8, 0xaa, 0x00))
        assertEquals("ab", reader.zeroTerminatedString())
        assertEquals("", reader.zeroTerminatedString())
        assertEquals("个", reader.zeroTerminatedString())
        assertEquals(0, reader.remaining)
    }

    @Test
    fun rejectsAZeroTerminatedStringWithNoEnd() {
        val error = assertThrows(DictionaryFormatException::class.java) { ByteReader(bufferOf(0x61, 0x62)).zeroTerminatedString() }
        assertTrue(error.message, error.message!!.contains("no end"))
    }

    @Test
    fun rejectsATruncatedString() {
        // Claims six bytes of string but supplies two.
        val truncated = byteArrayOf(0x06, 0xe4.toByte(), 0xbd.toByte()) // 你
        assertThrows(DictionaryFormatException::class.java) {
            ByteReader(ByteBuffer.wrap(truncated)).string()
        }
    }

    // --- header and directory ----------------------------------------------------

    @Test
    fun readsAValidHeader() {
        val header =
            encodeHeaderForTest(
                entryCount = 122746,
                pageCount = 1196,
                root = 1195,
                directoryOffset = 32,
                buildId = 0x1234abcd,
                baseWordCost = 119936,
            )
        assertEquals(122746, decodeHeader(header).entryCount)
        assertEquals(1196, decodeHeader(header).pageCount)
        assertEquals(1195, decodeHeader(header).rootPageId)
        assertEquals(32, decodeHeader(header).directoryOffset)
        assertEquals(0x1234abcd, decodeHeader(header).buildId)
        assertEquals(119936, decodeHeader(header).baseWordCost)
    }

    @Test
    fun isFormat3AndRejectsAFormat2Asset() {
        // Format 3 added the base word cost; a format 2 asset lacks it.
        assertEquals(3, BTREE_FORMAT_VERSION)
        assertEquals(32, HEADER_SIZE)
        val header =
            ByteBuffer.wrap(
                "PDBT".toByteArray(Charsets.US_ASCII) + byteArrayOf(2) + ByteArray(HEADER_SIZE - 5),
            )
        val error = assertThrows(DictionaryFormatException::class.java) { decodeHeader(header) }
        assertTrue(error.message!!.contains("built with B-tree format 2"))
    }

    @Test
    fun rejectsAHeaderWithTheWrongMagic() {
        val header = ByteBuffer.wrap("XXXX".toByteArray(Charsets.US_ASCII) + ByteArray(HEADER_SIZE - 4))
        val error = assertThrows(DictionaryFormatException::class.java) { decodeHeader(header) }
        assertTrue(error.message!!.contains("not a PinyinDuck B-tree"))
    }

    @Test
    fun rejectsAnUnsupportedFormatVersion() {
        val header =
            ByteBuffer.wrap(
                "PDBT".toByteArray(Charsets.US_ASCII) + byteArrayOf(99.toByte()) + ByteArray(HEADER_SIZE - 5),
            )
        val error = assertThrows(DictionaryFormatException::class.java) { decodeHeader(header) }
        assertTrue(error.message!!.contains("format 99"))
    }

    @Test
    fun rejectsATruncatedHeader() {
        val error =
            assertThrows(DictionaryFormatException::class.java) {
                decodeHeader(bufferOf('P'.code, 'D'.code))
            }
        assertTrue(error.message!!.contains("truncated"))
    }

    @Test
    fun readsThePageDirectory() {
        val bytes =
            byteArrayOf(
                0x18,
                0,
                0,
                0,
                0x64,
                0,
                0,
                0,
                0x40,
                0,
                0,
                0,
                0x32,
                0,
                0,
                0,
            )
        val directory = decodeDirectory(ByteBuffer.wrap(bytes), 2)
        assertEquals(2, directory.size)
        assertEquals(24, directory[0].offset)
        assertEquals(100, directory[0].length)
        assertEquals(64, directory[1].offset)
        assertEquals(50, directory[1].length)
    }

    // --- pages -------------------------------------------------------------------

    @Test
    fun decodesALeafPage() {
        val page = decodeLeafPage(encodeLeafForTest(listOf("nihao"), nextLeaf = 42))
        assertEquals(42, page.nextLeaf)
        assertEquals(1, page.entries.size)
        assertEquals("你好", page.entries[0].simplified)
        assertEquals("ni3 hao3", page.entries[0].pinyinNumbers)
        assertEquals("hello", page.entries[0].shortGloss)
        assertEquals(50_000, page.entries[0].frequency)
        assertEquals(3, page.entries[0].hskLevel)
        assertEquals(emptyList<Int>(), page.entries[0].entryIds)
        assertEquals(null, page.entries[0].onlyIn)
    }

    @Test
    fun decodesTheEntryIdsARecordStandsForAndItsScript() {
        // 后 hòu stands for 後 and 后, in headword order; 300 needs a two-byte varint.
        val simplifiedOnly = decodeLeafPage(encodeLeafForTest(listOf("hou"), NO_PAGE, listOf(300, 7), script = 1))
        assertEquals(listOf(300, 7), simplifiedOnly.entries[0].entryIds)
        assertEquals(ScriptType.SIMPLIFIED, simplifiedOnly.entries[0].onlyIn)

        val traditionalOnly = decodeLeafPage(encodeLeafForTest(listOf("hou"), NO_PAGE, listOf(7), script = 2))
        assertEquals(ScriptType.TRADITIONAL, traditionalOnly.entries[0].onlyIn)
    }

    @Test
    fun readsEachIdAsADeltaFromThePreviousIdInTheLeaf() {
        // Two records in one leaf: the second's first id is stored relative to the first's last.
        val page = decodeLeafPage(encodeLeafForTest(listOf("hou", "hou"), NO_PAGE, listOf(70_000, 3)))
        assertEquals(listOf(70_000, 3), page.entries[0].entryIds)
        assertEquals(listOf(70_000, 3), page.entries[1].entryIds)
    }

    @Test
    fun rejectsAnUnknownScriptMarker() {
        val bytes = encodeLeafForTest(listOf("hou"), NO_PAGE, script = 9)
        val error = assertThrows(DictionaryFormatException::class.java) { decodeLeafPage(bytes) }
        assertTrue(error.message!!.contains("script"))
    }

    @Test
    fun decodesTheLastLeafAsHavingNoNext() {
        val page = decodeLeafPage(encodeLeafForTest(listOf("ni"), nextLeaf = NO_PAGE))
        assertEquals(NO_PAGE, page.nextLeaf)
    }

    @Test
    fun rejectsALeafPageReadAsInternal() {
        val bytes = encodeLeafForTest(listOf("ni"), nextLeaf = NO_PAGE)
        assertThrows(DictionaryFormatException::class.java) { decodeInternalPage(bytes) }
    }

    @Test
    fun decodesAnInternalPage() {
        // Two children means one high key, stored between the two child ids.
        val bytes =
            byteArrayOf(
                INTERNAL_KIND.toByte(),
                0x02,
                0x00,
                0x07,
                0x00,
                0x00,
                0x00,
                0x02,
                'n'.code.toByte(),
                'i'.code.toByte(),
                0x09,
                0x00,
                0x00,
                0x00,
            )
        val page = decodeInternalPage(ByteBuffer.wrap(bytes))
        assertEquals(listOf(7, 9), page.children.toList())
        assertEquals(listOf("ni"), page.highKeys)
    }

    @Test
    fun rejectsAnInternalPageWithNoChildren() {
        val bytes = byteArrayOf(INTERNAL_KIND.toByte(), 0x00, 0x00)
        val error =
            assertThrows(DictionaryFormatException::class.java) {
                decodeInternalPage(ByteBuffer.wrap(bytes))
            }
        assertTrue(error.message!!.contains("at least one child"))
    }

    @Test
    fun rejectsAnInternalPageReadAsLeaf() {
        val bytes = byteArrayOf(INTERNAL_KIND.toByte(), 0x01, 0x00, 0x01, 0x00, 0x00, 0x00)
        assertThrows(DictionaryFormatException::class.java) { decodeLeafPage(ByteBuffer.wrap(bytes)) }
    }

    // --- helpers -----------------------------------------------------------------

    /** Builds a header the same way the builder in `packages/core` writes one. */
    private fun encodeHeaderForTest(
        entryCount: Int,
        pageCount: Int,
        root: Int,
        directoryOffset: Int,
        buildId: Int,
        baseWordCost: Int = 0,
    ): ByteBuffer =
        ByteBuffer.wrap(
            byteArrayOf('P'.code.toByte(), 'D'.code.toByte(), 'B'.code.toByte(), 'T'.code.toByte()) +
                byteArrayOf(BTREE_FORMAT_VERSION.toByte(), 0, 0, 0) +
                intBytes(entryCount) + intBytes(pageCount) + intBytes(root) + intBytes(directoryOffset) +
                intBytes(buildId) + intBytes(baseWordCost),
        )

    private fun intBytes(value: Int) =
        byteArrayOf(
            (value and 0xff).toByte(),
            ((value ushr 8) and 0xff).toByte(),
            ((value ushr 16) and 0xff).toByte(),
            ((value ushr 24) and 0xff).toByte(),
        )

    private fun encodeLeafForTest(
        keys: List<String>,
        nextLeaf: Int,
        entryIds: List<Int> = emptyList(),
        script: Int = 0,
    ): ByteBuffer {
        val out = mutableListOf<Byte>()

        fun writeString(value: String) {
            val bytes = value.toByteArray(Charsets.UTF_8)
            var length = bytes.size
            while (length >= 0x80) {
                out.add(((length and 0x7f) or 0x80).toByte())
                length = length ushr 7
            }
            out.add(length.toByte())
            bytes.forEach { out.add(it) }
        }

        out.add(LEAF_KIND.toByte())
        out.add(intBytes(keys.size)[0])
        out.add(intBytes(keys.size)[1])
        intBytes(nextLeaf).forEach { out.add(it) }

        // Ids are zigzag deltas from the previous id in the leaf, starting from 0.
        var previousId = 0
        for (key in keys) {
            writeString(key)
            writeString("你好") // simplified
            writeString("你好") // traditional
            writeString("ni3 hao3") // pinyinNumbers
            writeString("hello") // shortGloss
            varintBytes(50_000).forEach { out.add(it) } // frequency
            out.add(3) // hskLevel
            varintBytes(entryIds.size).forEach { out.add(it) }
            for (id in entryIds) {
                val delta = id - previousId
                varintBytes(if (delta >= 0) delta * 2 else -delta * 2 - 1).forEach { out.add(it) }
                previousId = id
            }
            out.add(script.toByte()) // 0 both, 1 simplified only, 2 traditional only
        }

        return ByteBuffer.wrap(out.toByteArray())
    }

    private fun varintBytes(value: Int): ByteArray {
        val out = mutableListOf<Byte>()
        var remaining = value
        while (remaining >= 0x80) {
            out += ((remaining and 0x7f) or 0x80).toByte()
            remaining = remaining ushr 7
        }
        out += remaining.toByte()
        return out.toByteArray()
    }
}
