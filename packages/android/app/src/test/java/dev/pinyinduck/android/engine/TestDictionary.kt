package dev.pinyinduck.android.engine

import dev.pinyinduck.android.data.DictionaryLoader
import dev.pinyinduck.android.data.OpenedDictionary
import java.io.File

/**
 * Opens the real `dictionary.btree` for the JVM unit tests.
 *
 * Every test in this package runs against the same 9.1MB asset the APK ships and the web
 * app serves, rather than a hand-written fixture. The whole point of the ranked corpus is
 * which candidate wins, and a small fixture would let the ranking rules rot while every
 * assertion still passed.
 */
object TestDictionary {
    private val opened: OpenedDictionary by lazy {
        val path =
            System.getProperty("pinyinduck.dictionary")
                ?: error("The pinyinduck.dictionary system property is not set. Run the tests through Gradle.")
        val file = File(path)
        check(file.isFile) { "Missing dictionary at $path. Run \"npm run build:dict\" at the repository root." }
        DictionaryLoader.openFromFile(file).also {
            Runtime.getRuntime().addShutdownHook(Thread { runCatching { it.close() } })
        }
    }

    val engine: PinyinDuckEngine get() = opened.engine

    val dictionary: BTreeDictionary get() = opened.dictionary

    /** The real `detail.bin` built alongside the dictionary, opened from beside it. */
    val detail: DetailFile get() = opened.detail

    val entryCount: Int get() = opened.entryCount

    val pageCount: Int get() = opened.pageCount

    /**
     * The smallest entry count the corpus may legitimately have.
     *
     * The exact size is not pinned here. The CC-CEDICT edition is pinned in
     * `packages/core/scripts/sources.ts`, but every deliberate bump changes the count, and a
     * test that had to be edited alongside each bump would add nothing the parity golden
     * does not already check. A floor catches the failures that actually matter — a
     * truncated download, a wrong file copied into the assets, or a header misread so the
     * count comes back near zero — and survives a bump.
     */
    const val MIN_ENTRY_COUNT = 100_000
}
