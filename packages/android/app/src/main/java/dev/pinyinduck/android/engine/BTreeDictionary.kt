package dev.pinyinduck.android.engine

/**
 * Lazy B+ tree over dictionary entries keyed on toneless pinyin.
 *
 * A port of `packages/core/src/data/btree-dictionary.ts`, with the asynchronous page
 * reads replaced by synchronous ones: the asset is mmap'd, so a page read is a pointer
 * offset rather than I/O or a promise. That is the whole reason the keyboard can run the
 * full 122k-entry corpus without the memory cost that stops it in a browser.
 *
 * Opening reads only the 24-byte header and the page directory. Everything afterwards is
 * one root-to-leaf descent plus a bounded forward scan, held down to a fixed byte budget
 * by an LRU page cache.
 */
class BTreeDictionary private constructor(
    private val source: PageSource,
    val header: BTreeHeader,
    private val directory: Array<PageLocation>,
    private val pageCacheBytes: Int,
) {
    private class CacheSlot(
        val page: BTreePage,
        val bytes: Int,
    )

    /** Access-ordered so eviction from the front drops the coldest page first. */
    private val cache = LinkedHashMap<Int, CacheSlot>(64, 0.75f, true)
    private var cacheBytes = 0

    /** Number of entries in the asset, known without reading a single page. */
    val entryCount: Int get() = header.entryCount

    /** Number of pages the asset is split into. */
    val pageCount: Int get() = header.pageCount

    /** The build this asset came from, which its Candidate detail file must share. */
    val buildId: Int get() = header.buildId

    /**
     * Every entry whose key is exactly [key].
     *
     * One key can occupy more than one leaf, because the tree is packed by bytes rather
     * than by key runs, so this follows the leaf chain for as long as the key keeps going.
     */
    fun lookupExact(key: String): List<StoredEntry> {
        var leaf = findLeaf(key)
        val matches = ArrayList<StoredEntry>()
        while (true) {
            for (entry in leaf.entries) {
                if (entry.key == key) matches.add(entry)
            }
            // Only keep walking while the key is still running. `nextLeaf` is ordered, so
            // a leaf whose last key has moved past `key` means there is nothing left.
            val last = leaf.entries.lastOrNull() ?: return matches
            if (last.key != key || leaf.nextLeaf == NO_PAGE) return matches
            leaf = readLeaf(leaf.nextLeaf)
        }
    }

    /**
     * Visits every entry whose key starts with [prefix], in key order, stopping early when
     * [visit] returns false. The search engine uses that to enforce its scan budget.
     */
    fun scanPrefix(
        prefix: String,
        visit: (StoredEntry) -> Boolean,
    ) {
        var leaf = findLeaf(prefix)
        while (true) {
            for (entry in leaf.entries) {
                when {
                    entry.key.startsWith(prefix) -> if (!visit(entry)) return
                    // Keys are sorted, so once a non-matching key sorts after the prefix
                    // every later key does too.
                    entry.key > prefix -> return
                }
            }
            if (leaf.nextLeaf == NO_PAGE) return
            leaf = readLeaf(leaf.nextLeaf)
        }
    }

    /** Drops every cached page. The dictionary stays open and readable. */
    fun clearCache() {
        cache.clear()
        cacheBytes = 0
    }

    private fun findLeaf(key: String): LeafPage {
        var page = readPage(header.rootPageId)
        while (page is InternalPage) page = readPage(childFor(page, key))
        return page as LeafPage
    }

    private fun childFor(
        page: InternalPage,
        key: String,
    ): Int {
        if (page.children.size == 1) return page.children[0]
        // First child whose high key is >= `key`; the last child is unbounded.
        //
        // Picking the *first* match is what makes a key spanning several leaves resolve
        // correctly: a rightmost-match search would skip the earlier leaves.
        var low = 0
        var high = page.highKeys.size
        while (low < high) {
            val mid = (low + high) ushr 1
            if (key > page.highKeys[mid]) low = mid + 1 else high = mid
        }
        return page.children[low]
    }

    private fun readLeaf(id: Int): LeafPage {
        val page = readPage(id)
        if (page !is LeafPage) throw DictionaryFormatException("Page $id is not a leaf")
        return page
    }

    private fun readPage(id: Int): BTreePage {
        cache[id]?.let { return it.page }

        val location =
            directory.getOrNull(id)
                ?: throw DictionaryFormatException("Page $id is outside the directory")

        val bytes = source.read(location.offset, location.length)
        val kind = if (bytes.limit() > 0) bytes.get(0).toInt() else -1
        val page: BTreePage =
            when (kind) {
                INTERNAL_KIND -> decodeInternalPage(bytes)
                LEAF_KIND -> decodeLeafPage(bytes)
                else -> throw DictionaryFormatException("Unknown page kind $kind")
            }

        remember(id, page, bytes.limit())
        return page
    }

    private fun remember(
        id: Int,
        page: BTreePage,
        bytes: Int,
    ) {
        cache[id] = CacheSlot(page, bytes)
        cacheBytes += bytes
        while (cacheBytes > pageCacheBytes && cache.size > 1) {
            val oldest = cache.keys.first()
            cacheBytes -= cache.remove(oldest)!!.bytes
        }
    }

    companion object {
        /** Default resident page-cache budget. Roughly a hundred 8 KB pages. */
        const val DEFAULT_PAGE_CACHE_BYTES = 1024 * 1024

        /** Reads the header and directory, leaving the pages on disk. */
        fun open(
            source: PageSource,
            pageCacheBytes: Int = DEFAULT_PAGE_CACHE_BYTES,
        ): BTreeDictionary {
            val header = decodeHeader(source.read(0, HEADER_SIZE))
            val directory =
                decodeDirectory(
                    source.read(header.directoryOffset, header.pageCount * 8),
                    header.pageCount,
                )
            return BTreeDictionary(source, header, directory, pageCacheBytes)
        }
    }
}
