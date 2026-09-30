package dev.pinyinduck.android

import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Confirms Robolectric can build a context and load this app's real merged resources.
 *
 * Every other Robolectric test in the package depends on that working, so if the sandbox
 * cannot fetch the Android runtime jars, this is the one test that says so clearly instead
 * of a hundred failing for the same reason.
 */
@RunWith(RobolectricTestRunner::class)
class RobolectricSmokeTest {
    @Test
    fun theApplicationContextIsAvailable() {
        assertNotNull(ApplicationProvider.getApplicationContext())
    }

    @Test
    fun theImeIsDeclaredToTheSystem() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val info =
            context.packageManager.getServiceInfo(
                android.content.ComponentName(context, dev.pinyinduck.android.ime.PinyinDuckImeService::class.java),
                android.content.pm.PackageManager.GET_META_DATA,
            )
        // An input method is only reachable if it holds this permission; without it the
        // system will not list the keyboard at all.
        assertEqualsCompat(
            "android.permission.BIND_INPUT_METHOD",
            info.permission,
        )
    }

    @Test
    fun theDictionaryAssetIsPresentAndUncompressed() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        // `openFd` throws when an asset is compressed, which is why the build sets noCompress.
        val descriptor = context.assets.openFd("dictionary.btree")
        descriptor.use {
            assertNotNull("the mmapped dictionary must be openable as a file", it.fileDescriptor)
            assertNotNull("the asset must not be compressed", it.startOffset)
        }
    }

    private fun assertEqualsCompat(
        expected: String,
        actual: String?,
    ) {
        org.junit.Assert.assertEquals(expected, actual)
    }
}
