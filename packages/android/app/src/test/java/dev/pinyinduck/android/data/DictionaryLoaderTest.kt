package dev.pinyinduck.android.data

import androidx.test.core.app.ApplicationProvider
import dev.pinyinduck.android.engine.BigramFormatException
import dev.pinyinduck.android.engine.DetailBuildMismatchException
import dev.pinyinduck.android.engine.DetailFileWriter
import dev.pinyinduck.android.engine.DetailSubject
import dev.pinyinduck.android.engine.ScriptType
import dev.pinyinduck.android.engine.TestDictionary
import dev.pinyinduck.android.engine.candidateDetail
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.io.FileNotFoundException

/**
 * Opening the dictionary out of the APK's assets.
 *
 * This is the one code path the keyboard cannot work without, and it only runs once per app
 * start. Robolectric can open the app's real merged assets, so it is exercised against the
 * same files the APK ships rather than stand-ins.
 */
@RunWith(RobolectricTestRunner::class)
class DictionaryLoaderTest {
    private val assets
        get() = ApplicationProvider.getApplicationContext<android.content.Context>().assets

    @Test
    fun itOpensTheShippedDictionary() {
        DictionaryLoader.openFromAssets(assets).use { opened ->
            // A floor, not the exact size, so a deliberate CC-CEDICT bump does not have to edit
            // this test. See TestDictionary.MIN_ENTRY_COUNT.
            assertTrue(
                "expected the full CC-CEDICT corpus, found ${opened.entryCount}",
                opened.entryCount >= TestDictionary.MIN_ENTRY_COUNT,
            )
            assertTrue("expected a paged asset", opened.pageCount > 100)
        }
    }

    @Test
    fun theOpenedDictionaryAnswersQueries() {
        // Opening is not the whole job: the engine has to work off the mapped asset too.
        DictionaryLoader.openFromAssets(assets).use { opened ->
            val result = opened.engine.search("nihao")
            assertEquals("你好", result.candidates.first().hanzi)
            assertEquals("nǐ hǎo", result.candidates.first().pinyinMarks)
        }
    }

    @Test
    fun openingIsCheapBecauseOnlyTheHeadersAreRead() {
        // The whole point of the paged format is that opening does not parse 124k entries, and
        // the detail file's offset table is what lets it skip every record too.
        //
        // Measured through the file loader, which maps both files the way a device maps the
        // APK's assets. Robolectric's `openFd` copies each asset into the heap first (about
        // 17MB for the pair), so measuring the asset path would weigh Robolectric, not this.
        val runtime = Runtime.getRuntime()
        System.gc()
        val before = runtime.totalMemory() - runtime.freeMemory()
        DictionaryLoader.openFromFile(dictionaryFile).use { opened ->
            opened.entryCount
            opened.detail.entryCount
            System.gc()
            val after = runtime.totalMemory() - runtime.freeMemory()
            assertTrue(
                "opening should not materialise the dictionary or its detail, used ${(after - before) / 1024}KB",
                (after - before) < 4L * 1024 * 1024,
            )
        }
    }

    @Test
    fun itOpensTheShippedDetailFileFromTheSameBuild() {
        DictionaryLoader.openFromAssets(assets).use { opened ->
            assertEquals(opened.dictionary.buildId, opened.detail.buildId)
            // The detail of the top candidate is reachable from the mapped asset.
            val candidate =
                opened.engine
                    .search("nihao")
                    .candidates
                    .first()
            val view = candidateDetail(DetailSubject.of(candidate), ScriptType.SIMPLIFIED, opened.detail)
            assertEquals("你好", candidate.hanzi)
            assertTrue(
                view.groups
                    .single()
                    .senses
                    .any { it.text == "hello; hi" },
            )
        }
    }

    @Test
    fun aDetailFileFromAnotherBuildFailsTheLoad() {
        // Entry ids mean nothing across builds (ADR 0002), so pairing them must fail loudly
        // rather than show the wrong word's senses.
        val dictionary = DictionaryLoader.openFromFile(dictionaryFile).use { it.dictionary.buildId }
        val stale = tempFile(DetailFileWriter.encode(emptyList(), dictionary + 1))
        val error =
            assertThrows(DetailBuildMismatchException::class.java) {
                DictionaryLoader.openFromFile(dictionaryFile, stale)
            }
        assertEquals(dictionary, error.dictionaryBuildId)
    }

    @Test
    fun itOpensTheShippedBigramTableAlongsideTheDictionary() {
        DictionaryLoader.openFromAssets(assets).use { opened ->
            val bigrams = checkNotNull(opened.bigrams) { "bigrams.bin was not bundled. Run \"npm run build:bigrams\"." }
            // A pair the #51 build measured, read through the mapped asset.
            assertEquals(85440, bigrams.score("想", "喝"))
            // And the engine scores with it: unigram alone would pick 和 over 喝.
            assertEquals(
                listOf("我", "想", "喝", "咖啡"),
                opened.engine
                    .search("woxianghekafei")
                    .candidates
                    .first()
                    .words
                    ?.map { it.hanzi },
            )
        }
    }

    @Test
    fun aMissingBigramTableIsNotAnErrorAndSearchStillWorks() {
        DictionaryLoader.openFromAssets(assets, bigramAssetName = "not-a-real-bigrams.bin").use { opened ->
            assertNull(opened.bigrams)
            assertEquals(
                "你好",
                opened.engine
                    .search("nihao")
                    .candidates
                    .first()
                    .hanzi,
            )
            assertNotNull(
                opened.engine
                    .search("woxianghekafei")
                    .candidates
                    .first()
                    .words,
            )
        }
        DictionaryLoader.openFromFile(dictionaryFile, bigramFile = File("/nonexistent/bigrams.bin")).use { opened ->
            assertNull(opened.bigrams)
        }
    }

    @Test
    fun aBrokenBigramTableFailsTheLoad() {
        val broken = tempFile("PDBX".toByteArray() + ByteArray(40))
        assertThrows(BigramFormatException::class.java) {
            DictionaryLoader.openFromFile(dictionaryFile, bigramFile = broken)
        }
    }

    @Test
    fun aMissingDetailAssetFailsTheLoad() {
        assertThrows(FileNotFoundException::class.java) {
            DictionaryLoader.openFromAssets(assets, detailAssetName = "not-a-real-detail.bin")
        }
    }

    private val dictionaryFile: File
        get() = File(System.getProperty("pinyinduck.dictionary") ?: error("The pinyinduck.dictionary system property is not set."))

    private fun tempFile(bytes: ByteArray): File =
        File.createTempFile("detail", ".bin").apply {
            deleteOnExit()
            writeBytes(bytes)
        }

    @Test
    fun aMissingAssetFailsRatherThanReturningAnEmptyDictionary() {
        // Silently opening an empty dictionary would look like "no candidates match" to a
        // learner, which is a far worse failure than an explicit error.
        val error =
            assertThrows(FileNotFoundException::class.java) {
                DictionaryLoader.openFromAssets(assets, "not-a-real-asset.btree")
            }
        assertNotNull(error)
    }

    // The corrupt-asset path is covered in `PageSourceTest`, which can write a bad file to
    // a temp directory; Robolectric does not merge `src/test/assets`, so it cannot be
    // reproduced through the APK asset manager here.

    @Test
    fun itOpensTheSameDictionaryFromDisk() {
        // The unit tests use this path, so the two loaders agreeing matters. Comparing them
        // to each other is a stronger check than comparing both to a constant, and it is the
        // one that keeps holding as CC-CEDICT grows.
        val path =
            System.getProperty("pinyinduck.dictionary")
                ?: error("The pinyinduck.dictionary system property is not set.")
        DictionaryLoader.openFromAssets(assets).use { fromAssets ->
            DictionaryLoader.openFromFile(File(path)).use { fromDisk ->
                assertEquals(fromAssets.entryCount, fromDisk.entryCount)
                assertEquals(fromAssets.pageCount, fromDisk.pageCount)
            }
        }
    }
}
