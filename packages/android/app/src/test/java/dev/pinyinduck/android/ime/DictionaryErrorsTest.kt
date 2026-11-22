package dev.pinyinduck.android.ime

import dev.pinyinduck.android.engine.DetailBuildMismatchException
import dev.pinyinduck.android.engine.DictionaryFormatException
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.FileNotFoundException
import java.io.IOException

/**
 * The user-facing failure messages.
 *
 * A keyboard cannot show a stack trace, so these strings are the app's only error reporting.
 * Each has to name what is actually wrong and the command that fixes it, because the person
 * reading it is on a phone with no access to the source.
 */
class DictionaryErrorsTest {
    @Test
    fun aMissingAssetSaysHowToRegenerateIt() {
        val message = DictionaryErrors.describe(FileNotFoundException("dictionary.btree"))
        assertTrue(message, message.contains("missing"))
        assertTrue(message, message.contains("build:dict"))
    }

    @Test
    fun aCompressedAssetNamesTheSettingThatBrokeIt() {
        // `openFd` reports a compressed asset this way, and it is a build mistake rather than
        // a missing file, so telling the user to rebuild the dictionary would be wrong.
        val compressed =
            FileNotFoundException(
                "This file can not be opened as a file descriptor; it is probably compressed",
            )
        val message = DictionaryErrors.describe(compressed)

        assertTrue(message, message.contains("compressed"))
        assertTrue(message, message.contains("noCompress"))
        assertTrue("must not send the user down the wrong path", !message.contains("build:dict"))
    }

    @Test
    fun aMalformedAssetRepeatsTheFormatProblem() {
        val message =
            DictionaryErrors.describe(
                DictionaryFormatException("The dictionary payload is not a PinyinDuck B-tree asset"),
            )
        assertTrue(message, message.contains("unreadable"))
        assertTrue(message, message.contains("not a PinyinDuck B-tree"))
        assertTrue(message, message.contains("build:dict"))
    }

    @Test
    fun aDetailFileFromAnotherBuildSaysToRebuildBoth() {
        // The pair is built together, so a mismatch means stale assets, not a corrupt one.
        val message = DictionaryErrors.describe(DetailBuildMismatchException(0x07, 0x08))
        assertTrue(message, message.contains("detail.bin"))
        assertTrue(message, message.contains("different builds"))
        assertTrue(message, message.contains("00000007"))
        assertTrue(message, message.contains("build:dict"))
    }

    @Test
    fun aMissingDetailAssetIsNamed() {
        // `openFd` names the asset it could not find, and blaming dictionary.btree would
        // send the reader looking at the wrong file.
        val message = DictionaryErrors.describe(FileNotFoundException("detail.bin"))
        assertTrue(message, message.contains("detail.bin is missing"))
        assertTrue(message, message.contains("build:dict"))
    }

    @Test
    fun anUnknownFailureStillReportsSomethingUseful() {
        val message = DictionaryErrors.describe(IOException("device went away"))
        assertTrue(message, message.contains("could not be opened"))
        assertTrue(message, message.contains("device went away"))
    }

    @Test
    fun aFailureWithNoMessageStillNamesTheException() {
        val message = DictionaryErrors.describe(IOException())
        assertTrue(message, message.contains("IOException"))
    }

    @Test
    fun everyMessageNamesTheCommandThatFixesIt() {
        // Whatever went wrong, the user needs a next step.
        val failures =
            listOf(
                FileNotFoundException("dictionary.btree"),
                FileNotFoundException("... probably compressed"),
                DictionaryFormatException("bad magic"),
                IOException("io"),
                IOException(),
            )
        failures.forEach { failure ->
            val message = DictionaryErrors.describe(failure)
            assertTrue(
                "no next step for ${failure.javaClass.simpleName}: $message",
                message.contains("build:dict") || message.contains("noCompress"),
            )
        }
    }

    @Test
    fun theFallbackMessagePointsAtTheDictionary() {
        val message = DictionaryErrors.forUnreadableAsset()
        assertTrue(message, message.contains("unreadable"))
        assertTrue(message, message.contains("build:dict"))
    }
}
