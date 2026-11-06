package dev.pinyinduck.android.engine

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The pinyin parser.
 *
 * These mirror the cases pinned by `packages/core/src/parser/pinyin.test.ts`. The Android
 * engine is a port rather than a shared bundle, so the same expectations have to be
 * asserted on both sides or the two will drift apart on the rules that decide where a
 * syllable boundary falls.
 */
class PinyinParserTest {
    @Test
    fun segmentsAnUnbrokenTonelessString() {
        assertEquals(listOf("ni", "hao"), segmentPinyin("nihao"))
        assertEquals(listOf("zhong", "guo"), segmentPinyin("zhongguo"))
    }

    @Test
    fun anApostropheSplitsSyllables() {
        assertEquals(listOf("xi", "an"), segmentPinyin("xi'an"))
    }

    @Test
    fun toneNumbersStayAttachedToTheirSyllable() {
        assertEquals(listOf("ni3", "hao3"), segmentPinyin("ni3hao3"))
        assertEquals(listOf("ni3", "hao3"), segmentPinyin("ni3 hao3"))
    }

    @Test
    fun unresolvableInputIsKeptVerbatim() {
        // The search engine still receives this so it can be committed as raw text.
        assertEquals(listOf("qqq"), segmentPinyin("qqq"))
        assertEquals(emptyList<String>(), segmentPinyin("   "))
    }

    @Test
    fun backtracksWhenTheLongestFirstSyllableStrandsTheRest() {
        assertEquals(listOf("jian", "guo"), segmentPinyin("jianguo"))
        assertEquals(listOf("fan", "guo"), segmentPinyin("fanguo"))
        assertEquals(listOf("zhu", "nian"), segmentPinyin("zhunian"))
        assertEquals(listOf("xian", "guo3"), segmentPinyin("xianguo3"))
    }

    @Test
    fun keepsTheLongestFirstSplitWhenItIsAlreadyValid() {
        assertEquals(listOf("xian"), segmentPinyin("xian"))
        assertEquals(listOf("lian", "ai"), segmentPinyin("lianai"))
        assertEquals(listOf("hen", "an"), segmentPinyin("henan"))
    }

    @Test
    fun splitsTheLongestValidPrefixAndKeepsTheRestVerbatim() {
        assertEquals(listOf("ni", "hqqq"), segmentPinyin("nihqqq"))
        assertEquals(listOf("jian", "guo", "qqq"), segmentPinyin("jianguoqqq"))
        assertEquals(listOf("zhong", "g"), segmentPinyin("zhongg"))
    }

    @Test
    fun umlautSpellingsAreNormalised() {
        assertEquals("lü", cleanPinyin("lv"))
        assertEquals("lü", cleanPinyin("lu:"))
    }

    @Test
    fun toneMarksFollowThePlacementRules() {
        // a takes the mark, then e, then the o of ou, then the last vowel.
        assertEquals("hǎo", toneNumberToMark("hao3"))
        assertEquals("mā", toneNumberToMark("ma1"))
        assertEquals("ér", toneNumberToMark("er2"))
        assertEquals("shuǐ", toneNumberToMark("shui3"))
        assertEquals("liú", toneNumberToMark("liu2"))
        assertEquals("ǒu", toneNumberToMark("ou3"))
        assertEquals("duō", toneNumberToMark("duo1"))
        assertEquals("zhuāng", toneNumberToMark("zhuang1"))
    }

    @Test
    fun theNeutralToneIsLeftUnmarked() {
        assertEquals("ma", toneNumberToMark("ma5"))
        assertEquals("ma", toneNumberToMark("ma"))
    }

    @Test
    fun umlautsTakeTheirMark() {
        assertEquals("lǜ", toneNumberToMark("lü4"))
        assertEquals("lǜ", toneNumberToMark("lv4"))
        assertEquals("nǚ", toneNumberToMark("nv3"))
    }

    @Test
    fun separatorsSurviveToneMarkConversion() {
        assertEquals("nǐ hǎo", pinyinNumbersToMarks("ni3 hao3"))
        assertEquals("tiān'ān", pinyinNumbersToMarks("tian1'an1"))
    }

    @Test
    fun toneMarksAndDigitsStripBackToTheKey() {
        assertEquals("nihao", cleanPinyin("nǐ hǎo"))
        assertEquals("nihao", cleanPinyin("ni3hao3"))
        // Separators are dropped too: this is the B-tree key, not a display string.
        assertEquals("xian", cleanPinyin("xī'ān"))
    }

    @Test
    fun toneDigitsAreAnchoredWhereTheyWereTyped() {
        assertEquals(listOf(ToneConstraint(2, 3), ToneConstraint(5, 3)), parseToneFilter("ni3hao3"))
        assertEquals(listOf(ToneConstraint(5, 4)), parseToneFilter("nihao4"))
        assertEquals(listOf(ToneConstraint(2, 4)), parseToneFilter("lv4"))
        assertEquals(emptyList<ToneConstraint>(), parseToneFilter("nihao"))
        assertEquals(emptyList<ToneConstraint>(), parseToneFilter("ni9"))
    }

    @Test
    fun storedSyllablesReportWhereTheyEnd() {
        assertEquals(listOf(ToneConstraint(2, 3), ToneConstraint(5, 3)), syllableToneEnds("ni3 hao3"))
        assertEquals(listOf(ToneConstraint(2, 4)), syllableToneEnds("lu:4"))
        assertEquals(listOf(ToneConstraint(2, 0)), syllableToneEnds("an"))
        assertEquals(
            listOf(ToneConstraint(2, 3), ToneConstraint(4, 3), ToneConstraint(6, 3)),
            syllableToneEnds("ka3 er3 · ma3"),
        )
    }
}
