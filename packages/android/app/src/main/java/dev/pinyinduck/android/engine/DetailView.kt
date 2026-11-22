package dev.pinyinduck.android.engine

/*
 * Turns the detail records of one candidate into what the Candidate detail bubble draws.
 *
 * A port of `packages/core/src/detail/detail-view.ts`, pinned to it by `detail-parity.tsv`
 * (`DetailViewParityTest`). Records are already parsed, so rendering is choosing the active
 * script and converting tone numbers to marks.
 */

/** What the view needs to know about a candidate. */
data class DetailSubject(
    val entryIds: List<Int>,
    val simplified: String,
    val traditional: String,
) {
    companion object {
        fun of(candidate: Candidate) = DetailSubject(candidate.entryIds, candidate.simplified, candidate.traditional)

        fun of(row: StoredEntry) = DetailSubject(row.entryIds, row.simplified, row.traditional)
    }
}

data class DetailViewSense(
    /** From 1 within its group. */
    val number: Int,
    val text: String,
    /** A proper noun sense, which a UI marks as such. */
    val proper: Boolean,
)

/** One headword's part of the detail. */
data class DetailGroup(
    /** The headword, when the candidate stands for several; null otherwise. */
    val heading: String?,
    /** The part-of-speech line ("noun · verb"), null when the entry has none. */
    val partOfSpeech: String?,
    val tags: List<String>,
    val senses: List<DetailViewSense>,
    /** In the active script with tone marks ("个 gè"). */
    val measureWords: List<String>,
)

data class DetailView(
    /**
     * The candidate in the other script, only when it differs from the displayed Hanzi and
     * the candidate stands for one headword (group headings take its place otherwise).
     */
    val counterpart: String?,
    /** One per headword, in the candidate's order: most senses first, ties in file order. */
    val groups: List<DetailGroup>,
)

/** A syllable with its tone number, as CC-CEDICT writes it: `Shu1`, `lu:4`, `r5`. */
private val CEDICT_SYLLABLE = Regex("^([A-Za-zÜü:]+)([1-5]?)$")

/** Splits `xia4hai2` after each tone digit that a letter follows. */
private val AFTER_TONE_DIGIT = Regex("(?<=[1-5])(?=[A-Za-z])")

private val WHITESPACE = Regex("\\s+")

/** A syllable starting with one of these takes an apostrophe after another syllable. */
private const val APOSTROPHE_VOWELS = "aeoāáǎàēéěèōóǒò"

/** The marked form of one syllable, or null when the token is not a pinyin syllable. */
private fun markSyllable(token: String): String? {
    val match = CEDICT_SYLLABLE.matchEntire(token) ?: return null
    val letters =
        match.groupValues[1]
            .lowercase()
            .replace("u:", "ü")
            .replace('v', 'ü')
    if (letters != "r" && letters !in VALID_PINYIN_SYLLABLES) return null
    val marked = toneNumberToMark(letters + match.groupValues[2])
    return if (Character.getType(token.codePointAt(0)) == Character.UPPERCASE_LETTER.toInt()) {
        marked.substring(0, 1).uppercase() + marked.substring(1)
    } else {
        marked
    }
}

/**
 * A tone-numbered reading as a learner reads it in running text: the syllables of a word
 * joined and tone-marked, capitals kept (`Shu1 jing1` is Shūjīng, `Xi1 an1` is Xī'ān).
 * Anything that is not a syllable (a Latin letter, `·`) is kept as written, spaced apart,
 * and a comma closes up to the word before it.
 */
fun readingWithMarks(pinyinNumbers: String): String {
    val tokens =
        pinyinNumbers
            .split(WHITESPACE)
            .filter { it.isNotEmpty() }
            .flatMap { it.split(AFTER_TONE_DIGIT) }
    val out = StringBuilder()
    var afterSyllable = false
    for (token in tokens) {
        val marked = markSyllable(token)
        if (marked != null) {
            if (out.isNotEmpty() && !afterSyllable) {
                out.append(' ')
            } else if (out.isNotEmpty() && marked.first().lowercaseChar() in APOSTROPHE_VOWELS) {
                out.append('\'')
            }
            out.append(marked)
            afterSyllable = true
        } else {
            if (out.isNotEmpty() && token != "," && token != ";") out.append(' ')
            out.append(token)
            afterSyllable = false
        }
    }
    return out.toString()
}

private fun CrossRef.hanziIn(script: ScriptType) = if (script == ScriptType.SIMPLIFIED) simplified else traditional

/** A reference as Hanzi in the active script plus its marked reading ("书经 Shūjīng"). */
private fun CrossRef.render(script: ScriptType): String =
    listOf(hanziIn(script), readingWithMarks(pinyinNumbers)).filter { it.isNotEmpty() }.joinToString(" ")

private fun RichText.render(script: ScriptType): String =
    buildString {
        append(strings[0])
        refs.forEachIndexed { i, ref ->
            append(ref.render(script))
            append(strings[i + 1])
        }
    }

private fun DetailTag.render(script: ScriptType): String = "${kind.label} ${text.render(script)}" + (gloss?.let { ": $it" } ?: "")

private fun DetailRecord.render(
    script: ScriptType,
    grouped: Boolean,
) = DetailGroup(
    heading = if (grouped) heading else null,
    partOfSpeech = partsOfSpeech.takeIf { it.isNotEmpty() }?.joinToString(" · ") { it.label },
    tags = tags.map { it.render(script) },
    senses = senses.mapIndexed { i, sense -> DetailViewSense(i + 1, sense.text.render(script), sense.proper) },
    measureWords = measureWords.map { it.render(script) },
)

/** The Candidate detail of [subject] in [script], from the records in [detail]. */
fun candidateDetail(
    subject: DetailSubject,
    script: ScriptType,
    detail: DetailFile,
): DetailView {
    val grouped = subject.entryIds.size > 1
    val groups = subject.entryIds.map { detail.record(it).render(script, grouped) }
    if (grouped) return DetailView(counterpart = null, groups = groups)
    val (shown, other) =
        if (script == ScriptType.SIMPLIFIED) {
            subject.simplified to subject.traditional
        } else {
            subject.traditional to subject.simplified
        }
    return DetailView(counterpart = other.takeIf { it != shown }, groups = groups)
}
