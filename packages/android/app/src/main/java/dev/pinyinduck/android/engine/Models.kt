package dev.pinyinduck.android.engine

/** Which character set candidates are displayed in. */
enum class ScriptType { SIMPLIFIED, TRADITIONAL;

/** Cycles between the two scripts, for the keyboard's toggle. */
    fun toggled(): ScriptType = if (this == SIMPLIFIED) TRADITIONAL else SIMPLIFIED
}

/** A ranked, renderable candidate. */
data class Candidate(
    val id: String,
    /** The characters as displayed under the active [ScriptType]. */
    val hanzi: String,
    val simplified: String,
    val traditional: String,
    val pinyinMarks: String,
    val pinyinNumbers: String,
    val shortGloss: String,
    val frequency: Int,
    val matchedPinyin: String,
    /** Pinyin left over after this candidate, to keep buffered for the next one. */
    val remainingPinyin: String,
    val hskLevel: Int? = null,
)

data class SearchResult(
    val query: String,
    val segments: List<String>,
    val candidates: List<Candidate>,
    /** Candidates available before [SearchOptions.offset] and [SearchOptions.limit]. */
    val total: Int,
)

data class SearchOptions(
    val script: ScriptType = ScriptType.SIMPLIFIED,
    val limit: Int = 10,
    val offset: Int = 0,
    val exactOnly: Boolean = false,
    val maxMatches: Int? = null,
)
