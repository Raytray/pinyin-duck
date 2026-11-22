package dev.pinyinduck.android.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The scoring rules.
 *
 * These mirror `packages/core/src/index/ranking.test.ts`. The Android engine is a port
 * rather than a shared bundle, so the same expectations have to be asserted on both sides
 * or the two will drift apart on the rule that decides which character wins.
 */
class RankingTest {
    /**
     * The character whose surrogate-pair length caused the parity failure.
     *
     * U+2C90A is a single CJK ideograph outside the BMP, so it encodes as two UTF-16 units.
     * Counting units rather than characters called it a two-character word and awarded it
     * the multi-character boost, which ranked it third for `shi4` ahead of 事.
     */
    private val astralSingleCharacter = String(Character.toChars(0x2C90A))

    @Test
    fun countsCharactersRatherThanUtf16Units() {
        assertEquals(1, countCharacters("是"))
        assertEquals(2, countCharacters("你好"))
        // `.length` reports 2 here, which is the whole bug.
        assertEquals(2, astralSingleCharacter.length)
        assertEquals(1, countCharacters(astralSingleCharacter))
    }

    @Test
    fun aRareAstralCharacterDoesNotEarnTheMultiCharacterBoost() {
        val rare = entry(astralSingleCharacter)
        val common = entry("事")

        // Same reading, same tier, same frequency: only the word boost could separate them.
        // Without it they tie exactly.
        assertEquals(
            "an astral single character must not be scored as a two-character word",
            scoreEntry(common, "shi", emptyList()),
            scoreEntry(rare, "shi", emptyList()),
        )

        // A genuine two-character word with the same reading still earns the boost.
        val word = entry("试图", pinyinClean = "shit", pinyinNumbers = "shi4")
        assertTrue(
            "a real two-character word must still outrank a single character",
            scoreEntry(word, "shit", emptyList()) > scoreEntry(common, "shi", emptyList()),
        )
    }

    @Test
    fun aRareAstralCharacterIsNotPromotedOverACommonOne() {
        // The parity case, asserted directly: for `shi4` the rare character must not outrank
        // the common ones that share its reading.
        val rare = entry(astralSingleCharacter)
        val common = entry("事")

        assertTrue(
            "a rare astral character must not outrank a common one for the same reading",
            scoreEntry(rare, "shi", parseToneFilter("shi4")) <= scoreEntry(common, "shi", parseToneFilter("shi4")),
        )
    }

    @Test
    fun aToneConstrainsTheSyllableItWasTypedAfter() {
        val niHao4 = entry("你号", pinyinClean = "nihao", pinyinNumbers = "ni3 hao4")
        val niHao3 = entry("你好", pinyinClean = "nihao", pinyinNumbers = "ni3 hao3")
        assertTrue(scoreEntry(niHao4, "nihao", parseToneFilter("nihao4")) > 0)
        assertTrue(scoreEntry(niHao3, "nihao", parseToneFilter("nihao4")) < 0)
        assertTrue(scoreEntry(niHao4, "nihao", parseToneFilter("ni3hao")) > 0)
    }

    @Test
    fun aWordThatSplitsTheTypedSyllableDifferentlyIsRejected() {
        val bian = entry("扁", pinyinClean = "bian", pinyinNumbers = "bian3")
        val biAn = entry("彼岸", pinyinClean = "bian", pinyinNumbers = "bi3 an4", frequency = 90000)
        assertTrue(scoreEntry(bian, "bian", parseToneFilter("bian3")) > 0)
        assertTrue(scoreEntry(biAn, "bian", parseToneFilter("bian3")) < 0)
    }

    @Test
    fun aToneTypedPastTheEndOfAPrefixEntryIsIgnored() {
        val ni = entry("你", pinyinClean = "ni", pinyinNumbers = "ni3")
        assertEquals(
            scoreEntry(ni, "nihao", emptyList()),
            scoreEntry(ni, "nihao", parseToneFilter("nihao3")),
        )
    }

    @Test
    fun aWordThatCompletesTheQueryRanksAboveOneThatLeavesPinyinOver() {
        // Coverage first (#30): 你 is far more frequent and HSK 1, so it outscores 霓虹灯, but it
        // leaves "hong" to compose while 霓虹灯 completes "nihong".
        val hanzi =
            search(
                "nihong",
                row("ni", "你", 98770, hsk = 1),
                row("nihongdeng", "霓虹灯", 200),
            )
        assertEquals(listOf("霓虹灯", "你"), hanzi)
    }

    @Test
    fun aFullSentenceLeadsOnlyWhenItBeatsEveryWordCoveringTheQuery() {
        // 先 + 好 scores 68,327 + 87,105 − 2W = −84,440 against W = 119,936.
        val sentenceScore = 68327 + 87105 - 2 * WORD_COST
        val words = arrayOf(row("xian", "先", 68327), row("hao", "好", 87105))

        // No word covers xianhao, so the sentence leads, above the prefix word 先.
        assertEquals(listOf("先好", "先"), search("xianhao", *words))

        // A word covering the query that scores better as a one-word path keeps the lead, and
        // the sentence goes right after the words covering the query, above 先.
        val stronger = row("xianhao", "闲好", sentenceScore + WORD_COST + 1)
        assertEquals(listOf("闲好", "先好", "先"), search("xianhao", *words, stronger))

        // A tie goes to the word: the bias is toward fewer words.
        val tied = row("xianhao", "闲好", sentenceScore + WORD_COST)
        assertEquals(listOf("闲好", "先好", "先"), search("xianhao", *words, tied))

        // One that scores worse yields the lead.
        val weaker = row("xianhao", "闲好", sentenceScore + WORD_COST - 1)
        assertEquals(listOf("先好", "闲好", "先"), search("xianhao", *words, weaker))
    }

    @Test
    fun aPartialSentenceFallsBackToTheFurthestNodeAndRanksAboveWordsCoveringLess() {
        // Nothing reaches the end of woxiangqqq, so the best path to the furthest node (我 + 想,
        // two words) is offered as a partial sentence with qqq left to compose.
        val engine = engine(row("wo", "我", 99503, hsk = 1), row("wo", "卧", 30000), row("xiang", "想", 83385))
        val candidates = engine.search("woxiangqqq").candidates
        assertEquals(listOf("我想", "我", "卧"), candidates.map { it.hanzi })
        assertEquals("qqq", candidates[0].remainingPinyin)
        assertEquals(listOf("我", "想"), candidates[0].words?.map { it.hanzi })

        // A path of one word is not a sentence, partial or not.
        assertEquals(listOf("我", "卧"), engine.search("woqqq").candidates.map { it.hanzi })
    }

    @Test
    fun aSentenceShowingTheSameHanziAsAWordIsDropped() {
        // 中国人 is unlisted (frequency 0) but still a word candidate; 中国 + 人 would show the
        // same Hanzi, so the word wins and the sentence is not counted.
        val engine = engine(row("zhongguo", "中国", 58468), row("ren", "人", 83359), row("zhongguoren", "中国人", 0))
        val result = engine.search("zhongguoren")
        assertEquals(listOf("中国人"), result.candidates.map { it.hanzi })
        assertTrue(result.candidates.all { it.words == null })
        assertEquals(1, result.total)
    }

    private fun row(
        key: String,
        simplified: String,
        frequency: Int,
        hsk: Int = 0,
    ) = SyntheticDictionary.Row(key, simplified, frequency = frequency, hskLevel = hsk)

    private fun engine(vararg rows: SyntheticDictionary.Row) =
        PinyinDuckEngine(BTreeDictionary.open(ByteArrayPageSource(SyntheticDictionary.encodeRows(rows.toList(), WORD_COST))))

    private fun search(
        query: String,
        vararg rows: SyntheticDictionary.Row,
    ) = engine(*rows).search(query).candidates.map { it.hanzi }

    private fun entry(
        simplified: String,
        pinyinClean: String = "shi",
        pinyinNumbers: String = "shi4",
        frequency: Int = 0,
        hskLevel: Int? = null,
    ) = ScorableEntry(
        simplified = simplified,
        pinyinClean = pinyinClean,
        pinyinNumbers = pinyinNumbers,
        frequency = frequency,
        hskLevel = hskLevel,
    )

    private companion object {
        /** The shipped corpus's base word cost. */
        const val WORD_COST = 119936
    }
}
