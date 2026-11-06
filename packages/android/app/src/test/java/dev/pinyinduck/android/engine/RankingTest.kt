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
}
