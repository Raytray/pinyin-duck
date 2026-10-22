package dev.pinyinduck.android.engine

/**
 * Candidate scoring and projection.
 *
 * A port of `packages/core/src/index/ranking.ts`. The constants are unchanged, so the
 * keyboard ranks exactly what the web app ranks: a shared formula is what stops the two
 * clients from disagreeing about which character is the better answer.
 *
 * How many prefix entries one query may consider before the scan stops.
 *
 * A one-letter query such as `n` prefixes more than ten thousand entries, so the scan
 * needs a ceiling to stay bounded. It sits above the widest prefix in the shipped
 * CC-CEDICT corpus (10,266 entries, for `s`) so the default path never truncates and
 * `total` stays the same number the web app reports.
 */
const val DEFAULT_MAX_MATCHES = 16384

/**
 * Counts characters rather than UTF-16 units.
 *
 * The counterpart of `countCharacters` in `packages/core/src/index/ranking.ts`, and it must
 * stay a separate function rather than an inline `.length` because the two disagree
 * whenever a string holds a character outside the BMP.
 */
fun countCharacters(text: String): Int = text.codePointCount(0, text.length)

/** The fields that participate in scoring. */
data class ScorableEntry(
    val simplified: String,
    /** Toneless pinyin, which is the B-tree key. */
    val pinyinClean: String,
    val pinyinNumbers: String,
    val frequency: Int,
    val hskLevel: Int? = null,
    /** Cached code-point count of [simplified], computed once per entry. */
    val characterCount: Int = countCharacters(simplified),
    /** Cached tone digits of [pinyinNumbers], computed once per entry. */
    val toneDigits: IntArray = toneDigitsOf(pinyinNumbers),
)

/**
 * Scores an entry against a toneless query.
 *
 * Match quality dominates. The tiers are spaced 50000 apart and the largest popularity
 * contribution below is 20000, so a very common character can never outrank a better
 * match: typing `nihao` must offer 你好, not the far more frequent 你.
 */
fun scoreEntry(
    entry: ScorableEntry,
    tonelessQuery: String,
    toneFilterNumbers: IntArray,
): Int {
    var score = 0
    val isExactPinyin = entry.pinyinClean == tonelessQuery
    val startsWithPinyin = entry.pinyinClean.startsWith(tonelessQuery)
    val isPrefixQuery = tonelessQuery.startsWith(entry.pinyinClean)

    if (isExactPinyin) {
        score += 100000
    } else if (startsWithPinyin) {
        score += 50000
    } else if (isPrefixQuery) {
        // e.g. the entry is "ni" while the query is "nihao".
        score += 20000
    }

    // Prefer a multi-character word over a single character with the same reading. The
    // boost is capped rather than scaled by length, or an 8-character exact match such as
    // 中国中央电视台 would bury the common 2-character word inside it.
    //
    // Length is counted in code points. `String.length` counts UTF-16 units, and CC-CEDICT
    // holds single characters outside the BMP (CJK extension B and later), which encode as
    // a surrogate pair. The naive length calls every one of them a multi-character word and
    // hands a rare 𬤊 the boost that should go to 你好 — enough to rank it above a common
    // character with the same reading, which is exactly the divergence
    // PinyinEngineParityTest exists to catch.
    if (isExactPinyin && entry.characterCount > 1) {
        score += 20000
    }

    // Popularity and difficulty are tiebreakers within a tier. Frequency is compressed
    // to at most 20000 so it orders candidates but cannot promote a weaker match.
    // This is `(frequency / 5)` rounded half up, in integer arithmetic.
    score += (2 * entry.frequency + 5) / 10

    // HSK 1 words are the ones a learner meets first, so they win inside a tier.
    val hsk = entry.hskLevel?.takeIf { it != 0 }
    if (hsk != null) score += (7 - hsk) * 5000

    if (toneFilterNumbers.isNotEmpty()) {
        val entryTones = entry.toneDigits
        var toneMatches = 0
        for (i in 0 until minOf(toneFilterNumbers.size, entryTones.size)) {
            if (toneFilterNumbers[i] == entryTones[i]) toneMatches++
        }
        if (toneMatches > 0) {
            score += toneMatches * 200000
        } else {
            score -= 500000
        }
    }

    return score
}

/** Projects a ranked entry into the candidate the UI renders. */
fun entryToCandidate(
    entry: ScorableEntry,
    traditional: String,
    pinyinMarks: String,
    shortGloss: String,
    script: ScriptType,
    tonelessQuery: String,
): Candidate {
    val hanzi = if (script == ScriptType.TRADITIONAL) traditional else entry.simplified
    val remainingPinyin =
        if (tonelessQuery.startsWith(entry.pinyinClean)) {
            tonelessQuery.substring(entry.pinyinClean.length)
        } else {
            ""
        }

    return Candidate(
        id = "${entry.simplified}-${entry.pinyinNumbers}",
        hanzi = hanzi,
        simplified = entry.simplified,
        traditional = traditional,
        pinyinMarks = pinyinMarks,
        pinyinNumbers = entry.pinyinNumbers,
        shortGloss = shortGloss,
        frequency = entry.frequency,
        matchedPinyin = entry.pinyinClean,
        remainingPinyin = remainingPinyin,
        hskLevel = entry.hskLevel?.takeIf { it != 0 },
    )
}
