package dev.pinyinduck.android.engine

import dev.pinyinduck.android.data.DictionaryLoader
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test
import java.io.File

/**
 * The search options and the edge cases around them.
 *
 * The parity test pins the common path against the TypeScript engine. This covers the
 * branches that only a caller choosing unusual options reaches: paging, `exactOnly`, a
 * truncated scan budget, and the empty query.
 */
class PinyinDuckOptionsTest {
    companion object {
        private lateinit var dictionary: BTreeDictionary

        @BeforeClass
        @JvmStatic
        fun openDictionary() {
            val path =
                System.getProperty("pinyinduck.dictionary")
                    ?: error("The pinyinduck.dictionary system property is not set.")
            dictionary = DictionaryLoader.openFromFile(File(path)).dictionary
        }
    }

    private fun engine(maxMatches: Int = DEFAULT_MAX_MATCHES) = PinyinDuckEngine(dictionary, maxMatches)

    @Test
    fun anEmptyQueryReturnsNothing() {
        val result = engine().search("")
        assertEquals(emptyList<String>(), result.segments)
        assertEquals(emptyList<Candidate>(), result.candidates)
        assertEquals(0, result.total)

        // Whitespace is trimmed first, so it is the same case.
        assertEquals(0, engine().search("   ").total)
    }

    @Test
    fun pagingReturnsDisjointSlicesOfTheSameList() {
        val options = SearchOptions(limit = 5)
        val first = engine().search("zhongguo", options)
        val second = engine().search("zhongguo", options.copy(offset = 5))
        val third = engine().search("zhongguo", options.copy(offset = 10))

        assertEquals("paging must not change the total", first.total, second.total)
        assertEquals(first.total, third.total)

        val combined = first.candidates + second.candidates + third.candidates
        assertEquals(
            "pages must not overlap",
            combined.size,
            combined.map { it.id }.distinct().size,
        )
    }

    @Test
    fun anOffsetPastTheEndYieldsNoCandidatesButKeepsTheTotal() {
        val result = engine().search("nihao", SearchOptions(offset = 5000))
        assertEquals(emptyList<Candidate>(), result.candidates)
        assertTrue("the total is independent of the page", result.total > 0)
    }

    @Test
    fun exactOnlyDropsPrefixMatches() {
        val all = engine().search("shi", SearchOptions(limit = 50))
        val exact = engine().search("shi", SearchOptions(limit = 50, exactOnly = true))

        assertTrue("expected prefix matches without the flag", all.total > exact.total)
        // Everything kept must read exactly `shi`.
        assertTrue(exact.candidates.all { it.matchedPinyin == "shi" })
    }

    @Test
    fun aTruncatedScanBudgetStillFindsAnExactMatch() {
        // The budget caps prefix scanning only. Exact lookups and the first-syllable
        // fallback are not budgeted, so a key that genuinely exists is still found even at
        // the most restrictive budget.
        val result = engine(maxMatches = 1).search("nihao", SearchOptions(limit = 10))
        assertEquals("你好", result.candidates.first().hanzi)
    }

    @Test
    fun aTruncatedScanBudgetFindsFewerPrefixMatches() {
        // `ta` has no entry keyed on exactly `ta`, so its candidates come entirely from the
        // prefix scan, which is what makes the budget visible in the total.
        val full = engine().search("ta", SearchOptions(limit = 1))
        val truncated = engine(maxMatches = 1).search("ta", SearchOptions(limit = 1))

        assertTrue("expected a broad prefix", full.total > 1)
        assertTrue(
            "the budget must cut the prefix scan short, was ${truncated.total} of ${full.total}",
            truncated.total < full.total,
        )
    }

    @Test
    fun aPerSearchBudgetOverridesTheEngineDefault() {
        // `SearchOptions.maxMatches` wins over the constructor's budget for that one call, in
        // either direction: it can tighten a generous engine and loosen a strict one.
        val full = engine().search("ta", SearchOptions(limit = 1))
        val tightened = engine().search("ta", SearchOptions(limit = 1, maxMatches = 1))
        val loosened = engine(maxMatches = 1).search("ta", SearchOptions(limit = 1, maxMatches = DEFAULT_MAX_MATCHES))

        assertEquals(engine(maxMatches = 1).search("ta", SearchOptions(limit = 1)).total, tightened.total)
        assertTrue("the override must cut the scan short", tightened.total < full.total)
        assertEquals("the override must lift the engine's budget", full.total, loosened.total)
    }

    @Test
    fun aZeroLimitReturnsNoCandidatesButKeepsTheTotal() {
        // A caller that only wants the count, e.g. to label a "more" button.
        val result = engine().search("ta", SearchOptions(limit = 0))
        assertEquals(emptyList<Candidate>(), result.candidates)
        assertTrue("the total is independent of the page", result.total > 0)
    }

    @Test
    fun theScriptSelectsWhichCharactersAreShown() {
        val simplified = engine().search("zhongguo", SearchOptions(script = ScriptType.SIMPLIFIED))
        val traditional = engine().search("zhongguo", SearchOptions(script = ScriptType.TRADITIONAL))

        assertEquals("中国", simplified.candidates.first().hanzi)
        assertEquals("中國", traditional.candidates.first().hanzi)
        // Both scripts rank the same number of candidates; only the glyphs differ.
        assertEquals(simplified.total, traditional.total)
        assertEquals(
            simplified.candidates.map { it.id },
            traditional.candidates.map { it.id },
        )
    }

    @Test
    fun aToneFilterRemovesEntriesThatDisagree() {
        val filtered = engine().search("shi4", SearchOptions(limit = 50))

        // A query like `shi4` filters on the *first* syllable's tone, so a multi-syllable
        // entry only has to agree there. 事情 survives because its reading starts shi4.
        assertTrue(filtered.candidates.all { it.pinyinMarks.substringBefore(' ') == "shì" })
        assertEquals("是", filtered.candidates.first().hanzi)
    }

    @Test
    fun aToneFilterDropsEntriesThatDisagreeWithIt() {
        // `shi1` and `shi4` read the same letters, so the filter is what separates them.
        val tone1 = engine().search("shi1", SearchOptions(limit = 50))
        val tone4 = engine().search("shi4", SearchOptions(limit = 50))

        assertTrue(tone1.candidates.all { it.pinyinMarks.substringBefore(' ') == "shī" })
        assertTrue(tone4.candidates.all { it.pinyinMarks.substringBefore(' ') == "shì" })
        // The two lists must not overlap, which is the whole point of the filter.
        assertTrue(
            "tone 1 and tone 4 must not share a candidate",
            tone1.candidates.none { it.hanzi in tone4.candidates.map { other -> other.hanzi } },
        )
        assertEquals("是", tone4.candidates.first().hanzi)
    }

    @Test
    fun anIncompleteSyllableStillOffersTheFirstSyllable() {
        // `nihao` is a complete match for 你好, but a learner part-way through typing should
        // also be offered 你.
        val result = engine().search("nihao", SearchOptions(limit = 50))
        val hanzi = result.candidates.map { it.hanzi }
        assertTrue("expected 你你好", hanzi.contains("你"))
        assertEquals("你好", hanzi.first())
    }

    @Test
    fun remainingPinyinIsReportedForAPartialMatch() {
        val result = engine().search("nihao", SearchOptions(limit = 50))
        val ni = result.candidates.first { it.hanzi == "你" }

        assertEquals("ni", ni.matchedPinyin)
        assertEquals("hao", ni.remainingPinyin)
    }

    @Test
    fun theEntryCountComesFromTheHeaderWithoutReadingPages() {
        assertEquals(dictionary.entryCount, engine().entryCount)
        assertTrue("expected the full corpus", engine().entryCount > 100_000)
    }
}
