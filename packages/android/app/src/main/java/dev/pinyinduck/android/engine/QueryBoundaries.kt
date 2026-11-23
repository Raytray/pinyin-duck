package dev.pinyinduck.android.engine

/**
 * Where a Sentence candidate's words may start and end in a query.
 *
 * A port of `packages/core/src/sentence/lattice.ts`. The lattice's nodes are positions in the
 * toneless query (the key the B+ tree searches on). A word may only span two nodes that are
 * both syllable boundaries in at least one valid split of the query, not only the split
 * [segmentPinyin] picks: `xian` is xian or xi + an, so 先 and 西安 both get an edge. An
 * apostrophe, a space, a hyphen or a tone digit forces a boundary where it was typed, so
 * `xi'an` never offers 先.
 *
 * When the whole query cannot be split (`woxianghekafe`), the splits are of its longest
 * splittable prefix, and everything after that prefix is the tail: reached only by a prefix
 * completion of the last word, or left to compose.
 */
internal class QueryBoundaries(
    /** The query without tones or separators, as [cleanPinyin] gives it. */
    val toneless: String,
    /** `nodes[i]`: offset `i` is a syllable boundary on some valid split. Size n + 1. */
    val nodes: BooleanArray,
    /** The end of the longest splittable prefix; `toneless.length` when the whole query splits. */
    val end: Int,
)

/** The longest syllable (`zhuang`, `chuang`, `shuang`). */
private const val MAX_SYLLABLE = 6

/**
 * Finds the syllable boundaries of [query] (lowercased, trimmed). Offsets line up with
 * [cleanPinyin] and [parseToneFilter] of the same query.
 */
internal fun queryBoundaries(query: String): QueryBoundaries {
    val normalized = query.lowercase().replace("u:", "ü").replace('v', 'ü')
    val builder = StringBuilder(normalized.length)
    // forced[i]: something other than a letter was typed at offset i, so no syllable may run
    // across it.
    val forced = BooleanArray(normalized.length + 1)
    for (char in normalized) {
        val letter = tonelessLetter(char)
        if (letter != null) builder.append(letter) else forced[builder.length] = true
    }
    val toneless = builder.toString()
    val n = toneless.length

    fun isSyllable(
        i: Int,
        j: Int,
    ): Boolean {
        for (k in i + 1 until j) if (forced[k]) return false
        return toneless.substring(i, j) in VALID_PINYIN_SYLLABLES
    }

    val reach = BooleanArray(n + 1)
    reach[0] = true
    var end = 0
    for (j in 1..n) {
        for (i in maxOf(0, j - MAX_SYLLABLE) until j) {
            if (reach[i] && isSyllable(i, j)) {
                reach[j] = true
                end = j
                break
            }
        }
    }

    // Keep only the boundaries a split of [0, end) passes through.
    val nodes = BooleanArray(n + 1)
    nodes[end] = true
    for (i in end - 1 downTo 0) {
        if (!reach[i]) continue
        for (j in i + 1..minOf(end, i + MAX_SYLLABLE)) {
            if (nodes[j] && isSyllable(i, j)) {
                nodes[i] = true
                break
            }
        }
    }
    return QueryBoundaries(toneless, nodes, end)
}
