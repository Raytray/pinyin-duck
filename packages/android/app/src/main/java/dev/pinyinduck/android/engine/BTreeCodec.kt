package dev.pinyinduck.android.engine

import java.nio.ByteBuffer

/**
 * Low-level wire format for the PinyinDuck B-tree, the asset shared with the web app.
 *
 * A direct port of `packages/core/src/data/btree-codec.ts`. The layout is
 *
 * ```
 * header (32 bytes) | page directory (pageCount * 8 bytes) | pages
 * ```
 *
 * so a reader opens the file by reading only the header and the directory, then touches
 * just the pages a single lookup needs. Every constant and every decode step here is
 * kept byte-for-byte compatible with the TypeScript, which is what lets both clients read
 * the one committed `dictionary.btree`.
 *
 * The header holds the build id (u32 at offset 24) that the Candidate detail file
 * built alongside must match, then the base word cost (u32 at offset 28) that Sentence
 * candidates score with. A leaf record is key, simplified, traditional, pinyinNumbers
 * and shortGloss (varint-length UTF-8 strings), a varint frequency, a u8 HSK level (0 for
 * none, 1-6, or 7 for the HSK 3.0 7-9 band), a varint count of entry ids followed by each
 * id as a varint, and a u8 script marker (0 both, 1 simplified only, 2 traditional only). Each id is stored as the zigzag-encoded
 * difference from the id before it in the same leaf (0 before the first), because ids
 * follow storage order and the deltas are almost all one byte.
 */

const val BTREE_MAGIC = "PDBT"

/**
 * Format 2 keys entries by headword and caseless reading (ADR 0001), so rows gained the
 * entry ids they stand for, a script marker and the header's build id (ADR 0002).
 * Format 3 adds the base word cost (u32 at offset 28) that Sentence candidates score with.
 */
const val BTREE_FORMAT_VERSION = 3
const val HEADER_SIZE = 32

/** Script markers on a leaf record. */
private const val SCRIPT_BOTH = 0
private const val SCRIPT_SIMPLIFIED = 1
private const val SCRIPT_TRADITIONAL = 2

const val INTERNAL_KIND = 0
const val LEAF_KIND = 1

/**
 * Sentinel page id meaning "no page", used by the last leaf's `nextLeaf`.
 * `0xffffffff` read as an unsigned 32-bit value, i.e. `-1` as a signed Int.
 */
const val NO_PAGE = -1

/**
 * Raised when an asset is not a readable PinyinDuck B-tree, or its Candidate detail file
 * cannot be read alongside it. Open so the detail file's build id mismatch can be told apart.
 */
open class DictionaryFormatException(
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
    /** The HSK 3.0 level of the word at this reading: 1-6, 7 for the 7-9 band, 0 for none. */
    val hskLevel: Int,
    /**
     * The entries this row stands for, in headword order. One for most rows; a simplified
     * candidate standing for several headwords (后 hòu for 後 and 后) lists each of them.
     */
    val entryIds: List<Int> = emptyList(),
    /** The only script this row is a candidate in, or null when it is one in both. */
    val onlyIn: ScriptType? = null,
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
    /** Identifies the build, so a Candidate detail file from another build is refused. */
    val buildId: Int,
    /** The scaled ln(corpus total) Sentence candidates charge per word (format 3). */
    val baseWordCost: Int = 0,
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

    /** A UTF-8 string ended by a zero byte, as the Candidate detail file writes them. */
    fun zeroTerminatedString(): String {
        var end = position
        while (end < buffer.limit() && buffer.get(end) != 0.toByte()) end++
        if (end >= buffer.limit()) throw DictionaryFormatException("a string has no end")
        val bytes = ByteArray(end - position)
        val view = buffer.duplicate()
        view.position(position)
        view.get(bytes)
        position = end + 1
        return String(bytes, Charsets.UTF_8)
    }
}

/** Reads one leaf record; its ids are deltas from [previousId], the leaf's last id so far. */
internal fun readStoredEntry(
    reader: ByteReader,
    previousId: Int = 0,
): StoredEntry {
    val key = reader.string()
    val simplified = reader.string()
    val traditional = reader.string()
    val pinyinNumbers = reader.string()
    val shortGloss = reader.string()
    val frequency = reader.varint()
    val hskLevel = reader.u8()
    var previous = previousId
    val entryIds =
        List(reader.varint()) {
            val zigzag = reader.varint()
            previous += (zigzag ushr 1) xor -(zigzag and 1)
            previous
        }
    val onlyIn =
        when (val script = reader.u8()) {
            SCRIPT_BOTH -> null
            SCRIPT_SIMPLIFIED -> ScriptType.SIMPLIFIED
            SCRIPT_TRADITIONAL -> ScriptType.TRADITIONAL
            else -> throw DictionaryFormatException("Unknown script marker $script on a B-tree record")
        }
    return StoredEntry(key, simplified, traditional, pinyinNumbers, shortGloss, frequency, hskLevel, entryIds, onlyIn)
}

internal fun decodeLeafPage(bytes: ByteBuffer): LeafPage {
    val reader = ByteReader(bytes)
    val kind = reader.u8()
    if (kind != LEAF_KIND) throw DictionaryFormatException("Expected a leaf page, found kind $kind")
    val entryCount = reader.u16()
    val nextLeaf = reader.u32()
    val entries = ArrayList<StoredEntry>(entryCount)
    var previousId = 0
    repeat(entryCount) {
        val entry = readStoredEntry(reader, previousId)
        entries.add(entry)
        previousId = entry.entryIds.lastOrNull() ?: previousId
    }
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
        buildId = reader.u32(),
        baseWordCost = reader.u32(),
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
