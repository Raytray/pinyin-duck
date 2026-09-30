package dev.pinyinduck.android.engine

import java.nio.ByteBuffer

/**
 * Low-level wire format for the PinyinDuck B-tree, the asset shared with the web app.
 *
 * A direct port of `packages/core/src/data/btree-codec.ts`. The layout is
 *
 * ```
 * header (24 bytes) | page directory (pageCount * 8 bytes) | pages
 * ```
 *
 * so a reader opens the file by reading only the header and the directory, then touches
 * just the pages a single lookup needs. Every constant and every decode step here is
 * kept byte-for-byte compatible with the TypeScript, which is what lets both clients read
 * the one committed `dictionary.btree`.
 */

const val BTREE_MAGIC = "PDBT"
const val BTREE_FORMAT_VERSION = 1
const val HEADER_SIZE = 24

const val INTERNAL_KIND = 0
const val LEAF_KIND = 1

/**
 * Sentinel page id meaning "no page", used by the last leaf's `nextLeaf`.
 * `0xffffffff` read as an unsigned 32-bit value, i.e. `-1` as a signed Int.
 */
const val NO_PAGE = -1

/** Raised when the asset is not a readable PinyinDuck B-tree. */
class DictionaryFormatException(
    message: String,
) : RuntimeException(message)

/** A dictionary row as stored in a leaf, before tone marks are derived. */
data class StoredEntry(
    /** Toneless, lowercased, space-free pinyin. The B-tree key. */
    val key: String,
    val simplified: String,
    val traditional: String,
    val pinyinNumbers: String,
    val shortGloss: String,
    val frequency: Int,
    val hskLevel: Int,
)

/** A decoded B-tree node: either records or child pointers. */
sealed interface BTreePage

/** A leaf page: the records themselves, plus a link to the next leaf in key order. */
class LeafPage(
    val nextLeaf: Int,
    val entries: List<StoredEntry>,
) : BTreePage

/**
 * An internal page. `highKeys[i]` is the *last* key held by `children[i]`, so
 * `children[i]` covers `(highKeys[i-1], highKeys[i]]` and the last child is unbounded.
 *
 * High keys rather than low keys are what a duplicate-heavy key space needs: one pinyin
 * reading can span several leaves, and a low-key separator would send the lookup past
 * the first of them and silently drop its higher-ranked entries.
 */
class InternalPage(
    val children: IntArray,
    val highKeys: List<String>,
) : BTreePage

data class BTreeHeader(
    val entryCount: Int,
    val pageCount: Int,
    val rootPageId: Int,
    val directoryOffset: Int,
)

data class PageLocation(
    val offset: Int,
    val length: Int,
)

/**
 * Little-endian reader with LEB128 varints, reading from a [ByteBuffer] without moving
 * the buffer's own position, so the caller can hand out views over the same mapping.
 */
internal class ByteReader(
    private val buffer: ByteBuffer,
) {
    private var position = 0

    val offset: Int get() = position

    val remaining: Int get() = buffer.limit() - position

    fun u8(): Int = buffer.get(position++).toInt() and 0xff

    fun u16(): Int {
        val value =
            (buffer.get(position).toInt() and 0xff) or
                ((buffer.get(position + 1).toInt() and 0xff) shl 8)
        position += 2
        return value
    }

    fun u32(): Int {
        val value =
            (buffer.get(position).toInt() and 0xff) or
                ((buffer.get(position + 1).toInt() and 0xff) shl 8) or
                ((buffer.get(position + 2).toInt() and 0xff) shl 16) or
                ((buffer.get(position + 3).toInt() and 0xff) shl 24)
        position += 4
        return value
    }

    fun varint(): Int {
        var result = 0L
        var shift = 0
        while (true) {
            val byte = u8()
            result = result or ((byte and 0x7f).toLong() shl shift)
            if (byte and 0x80 == 0) break
            shift += 7
            // Frequencies and lengths never approach 2^32, so five groups is already a
            // corrupt stream rather than a value this format can represent.
            if (shift > 35) throw DictionaryFormatException("B-tree varint is longer than the format allows")
        }
        return (result and 0xFFFFFFFFL).toInt()
    }

    fun string(): String {
        val length = varint()
        if (length < 0 || position + length > buffer.limit()) {
            throw DictionaryFormatException("B-tree page is truncated")
        }
        val bytes = ByteArray(length)
        val view = buffer.duplicate()
        view.position(position)
        view.get(bytes)
        position += length
        return String(bytes, Charsets.UTF_8)
    }
}

/** Reads one leaf record. */
internal fun readStoredEntry(reader: ByteReader) =
    StoredEntry(
        key = reader.string(),
        simplified = reader.string(),
        traditional = reader.string(),
        pinyinNumbers = reader.string(),
        shortGloss = reader.string(),
        frequency = reader.varint(),
        hskLevel = reader.u8(),
    )

internal fun decodeLeafPage(bytes: ByteBuffer): LeafPage {
    val reader = ByteReader(bytes)
    val kind = reader.u8()
    if (kind != LEAF_KIND) throw DictionaryFormatException("Expected a leaf page, found kind $kind")
    val entryCount = reader.u16()
    val nextLeaf = reader.u32()
    val entries = ArrayList<StoredEntry>(entryCount)
    repeat(entryCount) { entries.add(readStoredEntry(reader)) }
    return LeafPage(nextLeaf, entries)
}

internal fun decodeInternalPage(bytes: ByteBuffer): InternalPage {
    val reader = ByteReader(bytes)
    val kind = reader.u8()
    if (kind != INTERNAL_KIND) throw DictionaryFormatException("Expected an internal page, found kind $kind")
    val childCount = reader.u16()
    if (childCount == 0) throw DictionaryFormatException("An internal page needs at least one child")

    val children = IntArray(childCount)
    val highKeys = ArrayList<String>(maxOf(0, childCount - 1))
    for (i in 0 until childCount) {
        children[i] = reader.u32()
        if (i < childCount - 1) highKeys.add(reader.string())
    }
    return InternalPage(children, highKeys)
}

internal fun decodeHeader(bytes: ByteBuffer): BTreeHeader {
    if (bytes.limit() < HEADER_SIZE) throw DictionaryFormatException("The dictionary header is truncated")
    val reader = ByteReader(bytes)
    val magic = buildString(BTREE_MAGIC.length) { repeat(BTREE_MAGIC.length) { append(reader.u8().toChar()) } }
    if (magic != BTREE_MAGIC) {
        throw DictionaryFormatException("The dictionary payload is not a PinyinDuck B-tree asset")
    }
    val version = reader.u8()
    if (version != BTREE_FORMAT_VERSION) {
        throw DictionaryFormatException(
            "The dictionary was built with B-tree format $version, but this reader expects $BTREE_FORMAT_VERSION",
        )
    }
    reader.u8()
    reader.u16()
    return BTreeHeader(
        entryCount = reader.u32(),
        pageCount = reader.u32(),
        rootPageId = reader.u32(),
        directoryOffset = reader.u32(),
    )
}

internal fun decodeDirectory(
    bytes: ByteBuffer,
    pageCount: Int,
): Array<PageLocation> {
    val reader = ByteReader(bytes)
    val locations = arrayOfNulls<PageLocation>(pageCount)
    for (i in 0 until pageCount) {
        locations[i] = PageLocation(reader.u32(), reader.u32())
    }
    return Array(pageCount) { locations[it] ?: PageLocation(0, 0) }
}
