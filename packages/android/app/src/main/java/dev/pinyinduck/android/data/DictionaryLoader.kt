package dev.pinyinduck.android.data

import android.content.res.AssetManager
import dev.pinyinduck.android.engine.BTreeDictionary
import dev.pinyinduck.android.engine.MappedPageSource
import dev.pinyinduck.android.engine.PageSource
import dev.pinyinduck.android.engine.PinyinDuckEngine
import java.io.Closeable
import java.io.File
import java.io.FileInputStream
import java.io.IOException

/** The asset name the generated dictionary ships under. */
const val DICTIONARY_ASSET = "dictionary.btree"

/**
 * An opened dictionary together with the mapping backing it, so closing the pair releases
 * the file descriptor as well as the page cache.
 */
class OpenedDictionary(
    val dictionary: BTreeDictionary,
    val engine: PinyinDuckEngine,
    private val source: PageSource,
) : Closeable {
    /** Entries in the dictionary, known without reading a single page. */
    val entryCount: Int get() = dictionary.entryCount

    /** Pages the asset is split into. */
    val pageCount: Int get() = dictionary.pageCount

    override fun close() = source.close()
}

/**
 * Opens the dictionary shared with the web app.
 *
 * The asset is stored uncompressed (`noCompress += "btree"` in the app build) precisely so
 * this can hand back a file descriptor and mmap it. Reading it into the heap instead would
 * cost about 9MB of resident memory in a process the system is already tight on, which is
 * what the paged format exists to avoid.
 */
object DictionaryLoader {

    /**
     * Maps `dictionary.btree` out of the APK's assets.
     *
     * @throws IOException if the asset is missing or cannot be mapped.
     */
    @Throws(IOException::class)
    fun openFromAssets(assets: AssetManager, assetName: String = DICTIONARY_ASSET): OpenedDictionary {
        val descriptor = assets.openFd(assetName)
        val stream = FileInputStream(descriptor.fileDescriptor)
        return try {
            val source = MappedPageSource.open(stream, descriptor.startOffset, descriptor.length.toLong())
            val dictionary = BTreeDictionary.open(source)
            OpenedDictionary(dictionary, PinyinDuckEngine(dictionary), source)
        } catch (error: Throwable) {
            // The descriptor is only needed to reach the file; the mapping owns it after this.
            runCatching { descriptor.close() }
            runCatching { stream.close() }
            throw error
        }
    }

    /** Maps a dictionary from a file on disk. Used by the JVM unit tests. */
    @Throws(IOException::class)
    fun openFromFile(file: File): OpenedDictionary {
        val source = MappedPageSource.open(file)
        val dictionary = BTreeDictionary.open(source)
        return OpenedDictionary(dictionary, PinyinDuckEngine(dictionary), source)
    }
}
