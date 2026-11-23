package dev.pinyinduck.android.engine

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Reader for the bigram table that scores Sentence candidates (`bigrams.bin`, issue #51).
 *
 * A port of the reader in `packages/core/src/bigram/bigram-codec.ts`, whose module comment
 * documents the score and the layout:
 *
 * ```
 * header (32 bytes) | word offsets | word text | sorted ids | pair starts | second ids | steps
 * ```
 *
 * Unlike the TypeScript, which decodes every word into a map, this reads the mapped file in
 * place: a word's id is found by binary search over the sorted ids, comparing the stored
 * UTF-8 against the query word by UTF-16 code units (the order the file is sorted in, and
 * Kotlin's `String.compareTo`). So opening costs a header check, not 45,000 strings on the heap.
 *
 * Words are keyed by simplified form. Every lookup that has no answer returns [NO_BIGRAM]
 * rather than a nullable `Int`, so the Sentence search scores thousands of pairs per
 * keystroke without boxing.
 */
class BigramTable private constructor(
    private val bytes: ByteBuffer,
    /** How many distinct words the pairs use. */
    val wordCount: Int,
    val pairCount: Int,
    /** OFFSET from the score formula: no score is above it. */
    val scoreOffset: Int,
    /** STEP: the resolution scores are stored at. */
    val scoreStep: Int,
    private val wordOffsetsAt: Int,
    private val wordTextAt: Int,
    private val sortedIdsAt: Int,
    private val pairStartsAt: Int,
    private val secondsAt: Int,
    private val stepsAt: Int,
) {
    /** Per first word, the best score after it; [UNKNOWN] until first asked. */
    private val maxAfter = IntArray(wordCount) { UNKNOWN }

    /** The stored score of [second] right after [first], or null when no such pair is stored. */
    fun score(
        first: String,
        second: String,
    ): Int? {
        val a = wordId(first)
        val b = wordId(second)
        if (a == NO_BIGRAM || b == NO_BIGRAM) return null
        return scoreById(a, b).takeIf { it != NO_BIGRAM }
    }

    /** The id of a simplified form in this table, or [NO_BIGRAM] when no pair uses it. */
    fun wordId(word: String): Int {
        var low = 0
        var high = wordCount - 1
        while (low <= high) {
            val mid = (low + high) ushr 1
            val id = u32(sortedIdsAt + mid * 4)
            val order = compareWord(id, word)
            when {
                order < 0 -> low = mid + 1
                order > 0 -> high = mid - 1
                else -> return id
            }
        }
        return NO_BIGRAM
    }

    /** [score] for two ids from [wordId], or [NO_BIGRAM]. */
    fun scoreById(
        a: Int,
        b: Int,
    ): Int {
        var low = u32(pairStartsAt + a * 4)
        var high = u32(pairStartsAt + a * 4 + 4) - 1
        while (low <= high) {
            val mid = (low + high) ushr 1
            val id = second(mid)
            when {
                id < b -> low = mid + 1
                id > b -> high = mid - 1
                else -> return storedScore(mid)
            }
        }
        return NO_BIGRAM
    }

    /**
     * The best score any word reaches right after word [id], or [NO_BIGRAM] when no pair starts
     * with it. Worked out the first time each word is asked about and kept, so the search can
     * bound what a predecessor might still add without looking every pair up.
     */
    fun maxScoreAfter(id: Int): Int {
        var best = maxAfter[id]
        if (best == UNKNOWN) {
            best = NO_BIGRAM
            val end = u32(pairStartsAt + id * 4 + 4)
            for (i in u32(pairStartsAt + id * 4) until end) best = maxOf(best, storedScore(i))
            maxAfter[id] = best
        }
        return best
    }

    private fun u8(at: Int): Int = bytes.get(at).toInt() and 0xff

    private fun u32(at: Int): Int = bytes.getInt(at)

    private fun second(i: Int): Int =
        u8(secondsAt + i) or (u8(secondsAt + pairCount + i) shl 8) or (u8(secondsAt + 2 * pairCount + i) shl 16)

    private fun storedScore(i: Int): Int = scoreOffset - scoreStep * (u8(stepsAt + i) or (u8(stepsAt + pairCount + i) shl 8))

    /**
     * Compares word [id]'s stored UTF-8 with [word] by UTF-16 code units, decoding as it goes
     * so no string is allocated.
     */
    private fun compareWord(
        id: Int,
        word: String,
    ): Int {
        var at = wordTextAt + u32(wordOffsetsAt + id * 4)
        val end = wordTextAt + u32(wordOffsetsAt + id * 4 + 4)
        var index = 0
        // A supplementary character decodes to two units; the low one waits here.
        var pendingLow = -1
        while (true) {
            val unit: Int
            if (pendingLow >= 0) {
                unit = pendingLow
                pendingLow = -1
            } else if (at < end) {
                val lead = u8(at)
                val codePoint: Int
                when {
                    lead < 0x80 -> {
                        codePoint = lead
                        at += 1
                    }
                    lead < 0xe0 -> {
                        codePoint = ((lead and 0x1f) shl 6) or (u8(at + 1) and 0x3f)
                        at += 2
                    }
                    lead < 0xf0 -> {
                        codePoint = ((lead and 0x0f) shl 12) or ((u8(at + 1) and 0x3f) shl 6) or (u8(at + 2) and 0x3f)
                        at += 3
                    }
                    else -> {
                        codePoint =
                            ((lead and 0x07) shl 18) or ((u8(at + 1) and 0x3f) shl 12) or
                            ((u8(at + 2) and 0x3f) shl 6) or (u8(at + 3) and 0x3f)
                        at += 4
                    }
                }
                if (codePoint >= 0x10000) {
                    unit = Character.highSurrogate(codePoint).code
                    pendingLow = Character.lowSurrogate(codePoint).code
                } else {
                    unit = codePoint
                }
            } else {
                // The stored word ended: equal if the query did too, else it sorts first.
                return if (index == word.length) 0 else -1
            }
            if (index == word.length) return 1
            val other = word[index++].code
            if (unit != other) return unit - other
        }
    }

    companion object {
        private const val UNKNOWN = -2

        /** Reads the whole of [source], which is how the keyboard opens the mapped asset. */
        fun open(source: PageSource): BigramTable = open(source.read(0, source.size))

        /** Opens [buffer], refusing anything that is not a bigram file of this format version. */
        fun open(buffer: ByteBuffer): BigramTable {
            val bytes = buffer.slice().order(ByteOrder.LITTLE_ENDIAN)
            val size = bytes.limit()
            if (size < BIGRAM_HEADER_SIZE) throw malformed("the header is truncated")
            val magic = String(CharArray(4) { (bytes.get(it).toInt() and 0xff).toChar() })
            if (magic != BIGRAM_MAGIC) throw malformed("the payload is not a PinyinDuck bigram file")
            val version = bytes.get(4).toInt() and 0xff
            if (version != BIGRAM_FORMAT_VERSION) {
                throw BigramFormatException(
                    "The bigram file was built with format $version, but this reader expects " +
                        "$BIGRAM_FORMAT_VERSION. Run \"npm run build:bigrams\" to regenerate it.",
                )
            }

            // Every u32 is read unsigned and the sections are summed in Long, so a corrupt count
            // can neither wrap around nor pass as negative: it just fails the size check.
            fun u32(at: Long): Long = Integer.toUnsignedLong(bytes.getInt(at.toInt()))
            val wordCount = u32(8)
            val pairCount = u32(12)
            val wordTextLength = u32(16)
            val wordOffsets = BIGRAM_HEADER_SIZE.toLong()
            val wordText = wordOffsets + (wordCount + 1) * 4
            val sortedIds = wordText + wordTextLength
            val pairStarts = sortedIds + wordCount * 4
            val seconds = pairStarts + (wordCount + 1) * 4
            val steps = seconds + pairCount * 3
            val end = steps + pairCount * 2
            if (end != size.toLong()) throw malformed("expected $end bytes, found $size")

            for (id in 0 until wordCount) {
                val start = u32(wordOffsets + id * 4)
                val stop = u32(wordOffsets + id * 4 + 4)
                if (start > stop || stop > wordTextLength) throw malformed("word $id is out of bounds")
            }
            for (i in 0 until wordCount) {
                val id = u32(sortedIds + i * 4)
                if (id >= wordCount) throw malformed("the sorted word index names word $id")
            }
            if (u32(pairStarts + wordCount * 4) != pairCount) {
                throw malformed("the pair index does not end at the pair count")
            }
            return BigramTable(
                bytes = bytes,
                wordCount = wordCount.toInt(),
                pairCount = pairCount.toInt(),
                scoreOffset = bytes.getInt(20),
                scoreStep = bytes.getInt(24),
                wordOffsetsAt = wordOffsets.toInt(),
                wordTextAt = wordText.toInt(),
                sortedIdsAt = sortedIds.toInt(),
                pairStartsAt = pairStarts.toInt(),
                secondsAt = seconds.toInt(),
                stepsAt = steps.toInt(),
            )
        }

        private fun malformed(reason: String) =
            BigramFormatException(
                "The bigram file is malformed or truncated ($reason). Run \"npm run build:bigrams\" to regenerate it.",
            )
    }
}

/** The bigram file's magic number, format version and header size (`bigram-codec.ts`). */
const val BIGRAM_MAGIC = "PDBG"
const val BIGRAM_FORMAT_VERSION = 1
const val BIGRAM_HEADER_SIZE = 32

/** What a [BigramTable] lookup returns when it has no answer. Scores are never negative. */
const val NO_BIGRAM = -1

/**
 * Raised for a `bigrams.bin` that cannot be read. A [DictionaryFormatException], so a broken
 * bundled table fails the load through the existing dictionary error path.
 */
class BigramFormatException(
    message: String,
) : DictionaryFormatException(message)
