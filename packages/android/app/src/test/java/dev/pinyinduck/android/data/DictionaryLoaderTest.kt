package dev.pinyinduck.android.data

import androidx.test.core.app.ApplicationProvider
import dev.pinyinduck.android.engine.TestDictionary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
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
 * same 9.1MB file the APK ships rather than a stand-in.
 */
@RunWith(RobolectricTestRunner::class)
class DictionaryLoaderTest {
    private val assets
        get() = ApplicationProvider.getApplicationContext<android.content.Context>().assets

    @Test
    fun itOpensTheShippedDictionary() {
        DictionaryLoader.openFromAssets(assets).use { opened ->
            // A floor, not the exact size: the asset is rebuilt from a live CC-CEDICT download,
            // so the count moves whenever upstream publishes. See TestDictionary.MIN_ENTRY_COUNT.
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
    fun openingIsCheapBecauseOnlyTheHeaderIsRead() {
        // The whole point of the paged format is that opening does not parse 122k entries.
        val runtime = Runtime.getRuntime()
        System.gc()
        val before = runtime.totalMemory() - runtime.freeMemory()
        DictionaryLoader.openFromAssets(assets).use { opened ->
            opened.entryCount
            System.gc()
            val after = runtime.totalMemory() - runtime.freeMemory()
            assertTrue(
                "opening should not materialise the dictionary, used ${(after - before) / 1024}KB",
                (after - before) < 16L * 1024 * 1024,
            )
        }
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
