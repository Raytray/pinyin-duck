package dev.pinyinduck.android.data

import android.content.res.AssetManager
import dev.pinyinduck.android.engine.BTreeDictionary
import dev.pinyinduck.android.engine.BigramTable
import dev.pinyinduck.android.engine.DetailFile
import dev.pinyinduck.android.engine.MappedPageSource
import dev.pinyinduck.android.engine.PageSource
import dev.pinyinduck.android.engine.PinyinDuckEngine
import java.io.Closeable
import java.io.File
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.io.IOException

/** The asset name the generated dictionary ships under. */
const val DICTIONARY_ASSET = "dictionary.btree"

/** The asset name the Candidate detail file built alongside the dictionary ships under. */
const val DETAIL_ASSET = "detail.bin"

/**
 * The asset name the bigram table ships under, when the build had one (`npm run build:bigrams`).
 * Optional: without it Sentence candidates are scored on unigram frequencies alone.
 */
const val BIGRAM_ASSET = "bigrams.bin"

/**
 * An opened dictionary and its Candidate detail file, together with the mappings backing
 * them, so closing it releases the file descriptors as well as the page cache.
 */
class OpenedDictionary(
    val dictionary: BTreeDictionary,
    val engine: PinyinDuckEngine,
    /** The Candidate detail source, already checked to come from the dictionary's build. */
    val detail: DetailFile,
    /** The bigram table the engine scores Sentence candidates with, or null when none shipped. */
    val bigrams: BigramTable?,
    private val sources: List<PageSource>,
) : Closeable {
    /** Entries in the dictionary, known without reading a single page. */
    val entryCount: Int get() = dictionary.entryCount

    /** Pages the asset is split into. */
    val pageCount: Int get() = dictionary.pageCount

    override fun close() = sources.forEach { runCatching { it.close() } }
}

/**
 * Opens the dictionary shared with the web app, with its Candidate detail file.
 *
 * Both assets are stored uncompressed (`noCompress` in the app build) precisely so this can
 * hand back a file descriptor and mmap them. The detail file must come from the same build
 * as the dictionary (ADR 0002); a mismatch fails the whole load with a
 * `DetailBuildMismatchException`, which `DictionaryErrors` reports. Reading it into the heap instead would
 * cost about 9MB of resident memory in a process the system is already tight on, which is
 * what the paged format exists to avoid.
 *
 * The bigram table (`bigrams.bin`) is mapped beside them when it shipped, and handed to the
 * engine for Sentence candidates. It is optional: a build without it searches on unigram
 * frequencies alone. One that shipped but cannot be read fails the load like the others,
 * with a `BigramFormatException` naming the command that rebuilds it.
 */
object DictionaryLoader {
    /**
     * Maps `dictionary.btree`, `detail.bin` and, when present, `bigrams.bin` out of the APK's assets.
     *
     * @throws IOException if an asset is missing or cannot be mapped.
     * @throws dev.pinyinduck.android.engine.DictionaryFormatException if either is unreadable,
     *   or they come from different builds.
     */
    @Throws(IOException::class)
    fun openFromAssets(
        assets: AssetManager,
        assetName: String = DICTIONARY_ASSET,
        detailAssetName: String = DETAIL_ASSET,
        bigramAssetName: String = BIGRAM_ASSET,
    ): OpenedDictionary =
        open(
            { mapAsset(assets, assetName) },
            { mapAsset(assets, detailAssetName) },
            {
                // `openFd` reports a missing asset this way; a table that is there but broken
                // still fails the load, through the existing dictionary error path.
                try {
                    mapAsset(assets, bigramAssetName)
                } catch (_: FileNotFoundException) {
                    null
                }
            },
        )

    /**
     * Maps a dictionary from a file on disk, with the detail file beside it unless another
     * is named, and the bigram table beside it when there is one. Used by the JVM unit tests.
     */
    @Throws(IOException::class)
    fun openFromFile(
        file: File,
        detailFile: File = File(file.absoluteFile.parentFile, DETAIL_ASSET),
        bigramFile: File = File(file.absoluteFile.parentFile, BIGRAM_ASSET),
    ): OpenedDictionary =
        open(
            { MappedPageSource.open(file) },
            { MappedPageSource.open(detailFile) },
            { if (bigramFile.isFile) MappedPageSource.open(bigramFile) else null },
        )

    private fun mapAsset(
        assets: AssetManager,
        name: String,
    ): PageSource {
        val descriptor = assets.openFd(name)
        val stream = FileInputStream(descriptor.fileDescriptor)
        return try {
            MappedPageSource.open(stream, descriptor.startOffset, descriptor.length)
        } catch (error: Throwable) {
            // The descriptor is only needed to reach the file; the mapping owns it after this.
            runCatching { descriptor.close() }
            runCatching { stream.close() }
            throw error
        }
    }

    /** Opens the files, closing whatever was mapped when any fails. */
    private fun open(
        mapDictionary: () -> PageSource,
        mapDetail: () -> PageSource,
        mapBigrams: () -> PageSource?,
    ): OpenedDictionary {
        val sources = ArrayList<PageSource>(3)
        try {
            val dictionarySource = mapDictionary().also { sources.add(it) }
            val dictionary = BTreeDictionary.open(dictionarySource)
            val detailSource = mapDetail().also { sources.add(it) }
            val detail = DetailFile.open(detailSource, dictionary.buildId)
            val bigrams = mapBigrams()?.also { sources.add(it) }?.let { BigramTable.open(it) }
            return OpenedDictionary(dictionary, PinyinDuckEngine(dictionary, bigrams = bigrams), detail, bigrams, sources)
        } catch (error: Throwable) {
            sources.forEach { runCatching { it.close() } }
            throw error
        }
    }
}
