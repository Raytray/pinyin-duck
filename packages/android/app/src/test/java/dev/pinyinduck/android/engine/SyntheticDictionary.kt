package dev.pinyinduck.android.engine

/**
 * Builds a valid `dictionary.btree` in memory, for tests that need a known small tree.
 *
 * Written independently of the production reader on purpose: if it reused the builder from
 * `packages/core`, a mistake shared between writer and reader would cancel out and the
 * tests would pass against a format neither could actually read. The layout is the one
 * documented in `BTreeCodec.kt` and in `packages/core/src/data/btree-codec.ts`.
 *
 * A tree that fits in one leaf is emitted as header, directory and a single root leaf.
 * Anything larger is packed across leaves under an internal root, which is what makes
 * descent, leaf chaining and prefix scanning all exercised without pulling in the real
 * 9MB asset.
 */
object SyntheticDictionary {

    /** Entries per leaf. Small enough that a handful of keys fills a page. */
    private const val LEAF_ENTRIES = 8

    /**
     * Encodes `entries` as `key` to simplified-character pairs, sorted by key.
     *
     * A key is deliberately allowed to span more than one leaf: the packer starts a new leaf
     * whenever it sees a key it has already written. That is the case the tree's high-key
     * separator exists to handle, and what `lookupExact` has to follow `nextLeaf` for.
     */
    fun encode(entries: List<Pair<String, String>>): ByteArray {
        val groups = packIntoLeaves(entries.sortedBy { it.first })

        // Leaves are allocated first, so their ids are known before the internal root is
        // written and can name them.
        val leaves = groups.mapIndexed { index, group ->
            encodeLeaf(group, nextLeaf = if (index + 1 < groups.size) index + 1 else NO_PAGE)
        }

        val pages = leaves.toMutableList()
        val rootPageId = if (groups.size == 1) {
            0
        } else {
            // The root's separators are the *last* key of each leaf but the last, because a
            // key can span several leaves and a low-key separator would skip the earlier
            // ones. The final child is unbounded.
            val highKeys = groups.dropLast(1).map { it.last().first }
            pages.add(encodeInternal(children = groups.indices.toList(), highKeys = highKeys))
            pages.lastIndex
        }

        val directoryOffset = HEADER_SIZE
        var offset = directoryOffset + pages.size * 8
        val locations = pages.map { page ->
            (offset to page.size).also { offset += page.size }
        }

        val out = ByteWriter()
        // The magic is four raw bytes, not a length-prefixed string.
        BTREE_MAGIC.forEach { out.u8(it.code) }
        out.u8(BTREE_FORMAT_VERSION)
        out.u8(0)
        out.u16(0)
        out.u32(entries.size)
        out.u32(pages.size)
        out.u32(rootPageId)
        out.u32(directoryOffset)
        locations.forEach { (pageOffset, length) ->
            out.u32(pageOffset)
            out.u32(length)
        }
        pages.forEach { out.raw(it) }

        return out.toByteArray()
    }

    /**
     * Splits sorted entries into leaf-sized groups, one group per page.
     *
     * A new leaf is started whenever a key repeats, so one key can occupy several leaves.
     */
    private fun packIntoLeaves(sorted: List<Pair<String, String>>): List<List<Pair<String, String>>> {
        if (sorted.isEmpty()) return listOf(emptyList())

        val leaves = mutableListOf<List<Pair<String, String>>>()
        var current = mutableListOf<Pair<String, String>>()
        val writtenKeys = mutableSetOf<String>()

        for ((key, value) in sorted) {
            if (key in writtenKeys || current.size >= LEAF_ENTRIES) {
                leaves.add(current)
                current = mutableListOf()
                writtenKeys.clear()
            }
            current.add(key to value)
            writtenKeys.add(key)
        }
        leaves.add(current)

        return leaves
    }

    private fun encodeLeaf(entries: List<Pair<String, String>>, nextLeaf: Int): ByteArray {
        val out = ByteWriter()
        out.u8(LEAF_KIND)
        out.u16(entries.size)
        out.u32(nextLeaf)
        for ((key, simplified) in entries) {
            out.string(key)
            out.string(simplified) // simplified
            out.string(simplified) // traditional
            out.string("")         // pinyinNumbers, derived on read
            out.string("")         // shortGloss
            out.varint(0)           // frequency
            out.u8(0)               // hskLevel
        }
        return out.toByteArray()
    }

    private fun encodeInternal(children: List<Int>, highKeys: List<String>): ByteArray {
        val out = ByteWriter()
        out.u8(INTERNAL_KIND)
        out.u16(children.size)
        children.forEachIndexed { index, child ->
            out.u32(child)
            // One high key per child but the last, which is unbounded.
            highKeys.getOrNull(index)?.let { out.string(it) }
        }
        return out.toByteArray()
    }

    /**
     * A little-endian byte writer with LEB128 varints.
     *
     * Built here from the format description rather than shared with the reader, so a bug
     * cannot hide in common code and pass on both sides.
     */
    private class ByteWriter {
        private val bytes = mutableListOf<Byte>()

        fun u8(value: Int) {
            bytes.add((value and 0xff).toByte())
        }

        fun u16(value: Int) {
            bytes.add((value and 0xff).toByte())
            bytes.add(((value ushr 8) and 0xff).toByte())
        }

        fun u32(value: Int) {
            repeat(4) { shift -> bytes.add(((value ushr (shift * 8)) and 0xff).toByte()) }
        }

        fun varint(value: Int) {
            var remaining = value
            while (remaining >= 0x80) {
                u8((remaining and 0x7f) or 0x80)
                remaining = remaining ushr 7
            }
            u8(remaining)
        }

        fun string(value: String) {
            val encoded = value.toByteArray(Charsets.UTF_8)
            varint(encoded.size)
            raw(encoded)
        }

        fun raw(value: ByteArray) {
            value.forEach { bytes.add(it) }
        }

        fun toByteArray(): ByteArray = bytes.toByteArray()
    }
}
