package dev.pinyinduck.android.engine

import java.io.ByteArrayOutputStream
import kotlin.math.roundToInt

/**
 * A test-only port of `encodeBigramFile` from `packages/core/src/bigram/bigram-codec.ts`, so the
 * reader's tests can build small tables and corrupt them. The app never writes a bigram file;
 * `npm run build:bigrams` does.
 *
 * Written from the format description rather than shared with [BigramTable], so a mistake
 * cannot hide in common code and pass on both sides.
 */
object BigramFileWriter {
    data class Pair(
        val first: String,
        val second: String,
        val score: Int,
    )

    fun encode(
        pairs: List<Pair>,
        scoreOffset: Int,
        scoreStep: Int = 64,
        version: Int = BIGRAM_FORMAT_VERSION,
    ): ByteArray {
        val uses = HashMap<String, Int>()
        for (pair in pairs) {
            uses.merge(pair.first, 1, Int::plus)
            uses.merge(pair.second, 1, Int::plus)
        }
        val sortedWords = uses.keys.sorted()
        // Most-used first, ties in sorted order, as the TypeScript numbers them.
        val words = sortedWords.sortedWith(compareByDescending<String> { uses.getValue(it) }.thenBy { it })
        val ids = words.withIndex().associate { (id, word) -> word to id }
        val sorted =
            pairs
                .map { Triple(ids.getValue(it.first), ids.getValue(it.second), it) }
                .sortedWith(compareBy<Triple<Int, Int, Pair>> { it.first }.thenBy { it.second })

        val texts = words.map { it.toByteArray(Charsets.UTF_8) }
        val out = ByteArrayOutputStream()
        BIGRAM_MAGIC.forEach { out.write(it.code) }
        out.write(version)
        out.write(0)
        out.u16(0)
        out.u32(words.size)
        out.u32(sorted.size)
        out.u32(texts.sumOf { it.size })
        out.u32(scoreOffset)
        out.u32(scoreStep)
        out.u32(0)

        var textOffset = 0
        for (text in texts) {
            out.u32(textOffset)
            textOffset += text.size
        }
        out.u32(textOffset)
        texts.forEach { out.write(it) }
        sortedWords.forEach { out.u32(ids.getValue(it)) }

        var pairIndex = 0
        for (id in 0..words.size) {
            while (pairIndex < sorted.size && sorted[pairIndex].first < id) pairIndex++
            out.u32(pairIndex)
        }
        // Byte planes: every value's low byte, then every value's next byte.
        for (shift in 0 until 24 step 8) sorted.forEach { out.write((it.second ushr shift) and 0xff) }
        val steps = sorted.map { ((scoreOffset - it.third.score).toDouble() / scoreStep).roundToInt() }
        for (shift in 0 until 16 step 8) steps.forEach { out.write((it ushr shift) and 0xff) }
        return out.toByteArray()
    }

    private fun ByteArrayOutputStream.u16(value: Int) {
        write(value and 0xff)
        write((value ushr 8) and 0xff)
    }

    private fun ByteArrayOutputStream.u32(value: Int) {
        for (shift in 0 until 32 step 8) write((value ushr shift) and 0xff)
    }
}
