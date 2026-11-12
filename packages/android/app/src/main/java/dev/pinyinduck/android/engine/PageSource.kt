package dev.pinyinduck.android.engine

import java.io.Closeable
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.channels.FileChannel

/**
 * Byte-range source for the B-tree reader.
 *
 * [read] returns a buffer positioned over the requested range. An mmap-backed source
 * hands out a zero-copy view; only a source that cannot map has to copy. That is what
 * makes a lookup in a keyboard process cost a few page touches and no large allocation,
 * rather than the ~90MB object graph a full parse of the corpus needs.
 */
interface PageSource : Closeable {
    /** Total size of the asset in bytes. */
    val size: Int

    /** Returns a read-only buffer over `[offset, offset + length)`, clamped to the end. */
    fun read(
        offset: Int,
        length: Int,
    ): ByteBuffer
}

/**
 * A page source over an mmap of the whole dictionary.
 *
 * The mapping is opened once and every read is a view into it, so the kernel evicts pages
 * under memory pressure instead of the process growing to hold them. [hold] keeps the
 * channel alive for as long as the mapping is used.
 */
class MappedPageSource private constructor(
    private val hold: List<Closeable>,
    private val map: ByteBuffer,
) : PageSource {
    override val size: Int get() = map.capacity()

    override fun read(
        offset: Int,
        length: Int,
    ): ByteBuffer {
        if (offset < 0 || offset > size) {
            throw DictionaryFormatException("Read at $offset is outside the $size byte dictionary")
        }
        val end = minOf(offset + length, size)
        // `slice()` is what makes the range readable by absolute index: the readers index
        // from 0 without tracking a position, so they need a buffer whose index 0 is the
        // first byte of the page rather than the first byte of the file.
        val view = map.duplicate()
        view.position(offset)
        view.limit(end)
        return view.slice().asReadOnlyBuffer()
    }

    override fun close() {
        hold.forEach { runCatching { it.close() } }
    }

    companion object {
        /** Maps `file` for reading. */
        @Throws(IOException::class)
        fun open(file: File): MappedPageSource = open(FileInputStream(file), 0L, file.length())

        /**
         * Maps `[startOffset, startOffset + length)` of an already-open stream.
         *
         * An Android asset is opened through `AssetFileDescriptor`, whose `startOffset` is
         * only zero when the entry happens to sit at the front of the APK, so the offset
         * is passed in rather than assumed.
         */
        @Throws(IOException::class)
        fun open(
            stream: FileInputStream,
            startOffset: Long,
            length: Long,
        ): MappedPageSource {
            val channel: FileChannel = stream.channel
            val map = channel.map(FileChannel.MapMode.READ_ONLY, startOffset, length)
            return MappedPageSource(listOf(stream), map)
        }
    }
}

/**
 * A page source that reads from a heap buffer.
 *
 * Only used by tests and by the fallback path for a dictionary that could not be mapped;
 * [read] copies, so it is not the runtime source.
 */
class ByteArrayPageSource(
    private val bytes: ByteArray,
) : PageSource {
    override val size: Int get() = bytes.size

    override fun read(
        offset: Int,
        length: Int,
    ): ByteBuffer {
        val start = offset.coerceIn(0, bytes.size)
        val end = minOf(offset + length, bytes.size).coerceAtLeast(start)
        return ByteBuffer.wrap(bytes, start, end - start).slice().asReadOnlyBuffer()
    }

    override fun close() = Unit
}
