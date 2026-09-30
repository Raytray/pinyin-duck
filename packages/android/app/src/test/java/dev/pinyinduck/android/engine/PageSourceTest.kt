package dev.pinyinduck.android.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * The page sources and the B-tree reader that sits on top of them.
 *
 * `MappedPageSource` is the production path, so it is exercised against a real mmap of a
 * real file rather than a mock. The synthetic dictionaries are small enough to build in
 * memory and let the reader's bounds checking, leaf chaining and prefix scanning be checked
 * against an exact expected answer.
 */
class PageSourceTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    // --- page sources -----------------------------------------------------------

    @Test
    fun mapsAFileAndReadsRangesOutOfIt() {
        val file = temporaryFolder.newFile("asset.bin")
        file.writeBytes(ByteArray(256) { it.toByte() })

        MappedPageSource.open(file).use { source ->
            assertEquals(256, source.size)

            val middle = source.read(100, 10)
            assertEquals(10, middle.limit())
            assertEquals("the range must start at the requested offset", 100, middle.get(0).toInt())
            assertEquals(109, middle.get(9).toInt())
        }
    }

    @Test
    fun clampsAReadThatRunsPastTheEnd() {
        val file = temporaryFolder.newFile("short.bin")
        file.writeBytes(ByteArray(20))

        MappedPageSource.open(file).use { source ->
            // A dictionary truncated mid-page should yield the bytes that exist rather than
            // an exception, so the decoder can report a useful message about the format.
            assertEquals(5, source.read(15, 50).limit())
            // Reading exactly at the end is an empty range, not an error.
            assertEquals(0, source.read(20, 10).limit())
        }
    }

    @Test
    fun rejectsAReadBeforeTheStart() {
        val file = temporaryFolder.newFile("small.bin")
        file.writeBytes(ByteArray(20))

        MappedPageSource.open(file).use { source ->
            assertThrows(DictionaryFormatException::class.java) { source.read(-1, 4) }
            assertThrows(DictionaryFormatException::class.java) { source.read(999, 4) }
        }
    }

    @Test
    fun readsRangesFromAHeapBuffer() {
        val bytes = ByteArray(40) { it.toByte() }
        ByteArrayPageSource(bytes).use { source ->
            assertEquals(40, source.size)
            assertEquals(10, source.read(5, 10).limit())
            assertEquals("the range must start at the requested offset", 5, source.read(5, 10).get(0).toInt())
            assertEquals("a read past the end is clamped", 3, source.read(37, 10).limit())
        }
    }

    // --- the reader over a synthetic dictionary ---------------------------------

    @Test
    fun walksAWholeTree() {
        withDictionary(listOf("ni", "nihao", "shi", "zhongguo", "hao")) { dictionary ->
            assertEquals(5, dictionary.entryCount)
            assertEquals(1, dictionary.pageCount)

            assertEquals("ni", dictionary.lookupExact("ni").single().simplified)
            assertEquals("nihao", dictionary.lookupExact("nihao").single().simplified)

            // A prefix scan walks the leaf chain in key order and stops at the first key
            // that sorts past the prefix.
            assertEquals(listOf("ni", "nihao"), dictionary.scanKeys("ni"))
            assertEquals(listOf("hao"), dictionary.scanKeys("ha"))
            assertEquals(listOf("ni", "nihao"), dictionary.scanKeys("n"))
            assertEquals(listOf("shi"), dictionary.scanKeys("sh"))
            assertEquals(listOf("zhongguo"), dictionary.scanKeys("zh"))
            assertEquals(emptyList<String>(), dictionary.scanKeys("zz"))
        }
    }

    @Test
    fun findsKeysThatSpanSeveralLeaves() {
        // One key can occupy more than one leaf, so the reader follows `nextLeaf` rather
        // than stopping at the first hit. This is what the high-key separator exists for,
        // and a wrong separator would silently return a partial result here.
        withDictionary(List(20) { "ni" }) { dictionary ->
            assertTrue("expected the key to span several leaves", dictionary.pageCount > 1)
            assertEquals(20, dictionary.lookupExact("ni").size)
        }
    }

    @Test
    fun stopsAPrefixScanOnRequest() {
        withDictionary(listOf("ni", "niha", "nihao", "nihaoma")) { dictionary ->
            var seen = 0
            dictionary.scanPrefix("ni") {
                seen++
                false
            }
            assertEquals("the visitor returning false must end the scan", 1, seen)
        }
    }

    @Test
    fun returnsNothingForAKeyThatIsAbsent() {
        withDictionary(listOf("ni", "hao")) { dictionary ->
            assertEquals(emptyList<StoredEntry>(), dictionary.lookupExact("zz"))
        }
    }

    @Test
    fun rejectsAPageThatIsNeitherALeafNorInternal() {
        val file = temporaryFolder.newFile("corrupt.btree")
        val header =
            byteArrayOf('P'.code.toByte(), 'D'.code.toByte(), 'B'.code.toByte(), 'T'.code.toByte()) +
                byteArrayOf(BTREE_FORMAT_VERSION.toByte(), 0, 0, 0) +
                intBytes(1) + intBytes(1) + intBytes(0) + intBytes(24)
        // One directory entry pointing at a page whose kind byte is nonsense.
        val directory = intBytes(52) + intBytes(4)
        val page = byteArrayOf(0x7f, 0, 0, 0)
        file.writeBytes(header + directory + page)

        // Opening only reads the header and directory, so the bad page is not decoded until
        // a lookup actually descends into it.
        MappedPageSource.open(file).use { source ->
            val dictionary = BTreeDictionary.open(source)
            assertThrows(DictionaryFormatException::class.java) { dictionary.lookupExact("ni") }
        }
    }

    @Test
    fun rejectsAnAssetThatIsNotADictionaryAtAll() {
        val file = temporaryFolder.newFile("notadict.btree")
        file.writeBytes(ByteArray(64) { 0x41 })

        MappedPageSource.open(file).use { source ->
            assertThrows(DictionaryFormatException::class.java) { BTreeDictionary.open(source) }
        }
    }

    @Test
    fun readsTheHeaderBeforeTouchingAnyPage() {
        // Opening must not depend on page contents, or an asset whose first page is broken
        // could not even report its own entry count.
        val file = temporaryFolder.newFile("headeronly.btree")
        file.writeBytes(ByteArray(24) { 0 })

        MappedPageSource.open(file).use { source ->
            assertThrows(DictionaryFormatException::class.java) { BTreeDictionary.open(source) }
        }
    }

    @Test
    fun aCacheClearDoesNotCloseTheDictionary() {
        withDictionary(listOf("ni", "hao")) { dictionary ->
            dictionary.clearCache()
            assertEquals("ni", dictionary.lookupExact("ni").single().simplified)
            dictionary.clearCache()
            assertEquals("hao", dictionary.lookupExact("hao").single().simplified)
        }
    }

    @Test
    fun keepsThePageCacheWithinItsBudget() {
        // A tiny budget forces eviction on nearly every lookup, which is the situation a
        // keyboard reaches on a broad query and must still answer correctly.
        val file = temporaryFolder.newFile("cache.btree")
        val entries = (0 until 400).map { "k$it" to "字" }
        file.writeBytes(SyntheticDictionary.encode(entries))

        MappedPageSource.open(file).use { source ->
            val dictionary = BTreeDictionary.open(source, pageCacheBytes = 256)
            assertTrue("expected several pages", dictionary.pageCount > 1)

            // Reading in an order that touches different leaves each time.
            entries.reversed().forEach { (key, _) ->
                assertEquals("字", dictionary.lookupExact(key).single().simplified)
            }
        }
    }

    // --- helpers ----------------------------------------------------------------

    private fun BTreeDictionary.scanKeys(prefix: String): List<String> {
        val keys = mutableListOf<String>()
        scanPrefix(prefix) {
            keys.add(it.key)
            true
        }
        return keys
    }

    /**
     * Runs [block] against a dictionary built from [keys].
     *
     * Each key is paired with a character derived from it, so a lookup that returns the
     * wrong entry is visible in the assertion rather than looking plausible.
     */
    private fun withDictionary(
        keys: List<String>,
        block: (BTreeDictionary) -> Unit,
    ) {
        val entries = keys.map { it to it }
        val file = temporaryFolder.newFile("dict-${keys.hashCode()}-${keys.size}.btree")
        file.writeBytes(SyntheticDictionary.encode(entries))
        MappedPageSource.open(file).use { source ->
            block(BTreeDictionary.open(source))
        }
    }

    private fun intBytes(value: Int) =
        byteArrayOf(
            (value and 0xff).toByte(),
            ((value ushr 8) and 0xff).toByte(),
            ((value ushr 16) and 0xff).toByte(),
            ((value ushr 24) and 0xff).toByte(),
        )
}
