package dev.pinyinduck.android.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer

/**
 * Sentence candidates on a small dictionary with the shipped corpus's frequencies.
 *
 * A port of `packages/core/src/index/sentence-candidates.test.ts`, so the arithmetic in each
 * case is the real one and both engines are held to the same expectations. The parity test
 * pins the two engines against each other on the real dictionary; this pins the rules.
 */
class SentenceCandidatesTest {
    private val rows =
        listOf(
            row("wo", "我", "我", "wo3", "I; me", 99503, 1, 1),
            row("wo", "卧", "臥", "wo4", "to lie down", 30000, 0, 2),
            row("shi", "是", "是", "shi4", "to be", 94324, 1, 3),
            row("woshi", "卧室", "臥室", "wo4 shi4", "bedroom", 50182, 0, 4),
            row("woshi", "卧式", "臥式", "wo4 shi4", "horizontal", 0, 0, 5),
            row("ni", "你", "你", "ni3", "you", 98770, 1, 6),
            row("hao", "好", "好", "hao3", "good", 87105, 1, 7),
            row("nihao", "你好", "你好", "ni3 hao3", "hello", 71309, 1, 8),
            row("xiang", "想", "想", "xiang3", "to want", 83385, 1, 9),
            row("he", "和", "和", "he2", "and", 83526, 1, 10),
            row("he", "喝", "喝", "he1", "to drink", 65923, 1, 11),
            row("kafei", "咖啡", "咖啡", "ka1 fei1", "coffee", 59813, 1, 12),
            row("fan", "反", "反", "fan3", "reverse", 60000, 0, 13),
            row("gan", "感", "感", "gan3", "to feel", 60000, 0, 14),
            row("xi", "西", "西", "xi1", "west", 53376, 1, 15),
            row("an", "安", "安", "an1", "calm", 54888, 0, 16),
            row("xian", "先", "先", "xian1", "first", 68327, 1, 17),
            row("zhongguo", "中国", "中國", "zhong1 guo2", "China", 58468, 1, 18),
            row("ren", "人", "人", "ren2", "person", 83359, 1, 19),
            row("zhongguoren", "中国人", "中國人", "zhong1 guo2 ren2", "Chinese person", 0, 0, 20),
            row("nihongdeng", "霓虹灯", "霓虹燈", "ni2 hong2 deng1", "neon light", 200, 0, 21),
            // More words on `he`, for Fixed words and span alternatives.
            row("he", "和", "和", "he4", "to reply in verse", 83526, 0, 22),
            row("he", "喝", "喝", "he4", "to shout", 65923, 0, 23),
            row("he", "河", "河", "he2", "river", 47964, 0, 24),
            row("he", "贺", "賀", "he4", "to congratulate", 44917, 0, 25),
            row("he", "涸", "涸", "he2", "to dry up", 0, 0, 26),
            row("xiang", "像", "像", "xiang4", "to resemble", 75964, 0, 27),
        )

    /** The pairs a bigram table holds, scored as `build-bigrams.ts` would. */
    private val pairs =
        listOf(
            BigramFileWriter.Pair("我", "想", 97088),
            BigramFileWriter.Pair("想", "喝", 85440),
            BigramFileWriter.Pair("想", "和", 93632),
            BigramFileWriter.Pair("喝", "咖啡", 98368),
            BigramFileWriter.Pair("和", "咖啡", 67968),
            BigramFileWriter.Pair("我", "是", 98048),
            // Only a path through a fixed 河 can use this, so it shows a neighbour changing.
            BigramFileWriter.Pair("像", "河", 99008),
        )

    private fun engine(withBigrams: Boolean = true): PinyinDuckEngine {
        val dictionary = BTreeDictionary.open(ByteArrayPageSource(SyntheticDictionary.encodeRows(rows, WORD_COST)))
        val bigrams =
            if (withBigrams) BigramTable.open(ByteBuffer.wrap(BigramFileWriter.encode(pairs, scoreOffset = WORD_COST))) else null
        return PinyinDuckEngine(dictionary, bigrams = bigrams)
    }

    private fun search(
        query: String,
        options: SearchOptions = SearchOptions(),
        withBigrams: Boolean = true,
    ) = engine(withBigrams).search(query, options.copy(limit = 50)).candidates

    private fun List<Candidate>.sentence() = firstOrNull { it.words != null }

    private fun Candidate?.wordHanzi() = this?.words?.map { it.hanzi }

    @Test
    fun buildsTheSentenceABigramTablePrefersOverTheMoreFrequentWord() {
        // Unigram alone takes 和 (83,526) over 喝 (65,923); the pairs 想→喝→咖啡 outscore 想→和→咖啡.
        assertEquals(listOf("我", "想", "喝", "咖啡"), search("woxianghekafei")[0].wordHanzi())
    }

    @Test
    fun worksWithNoBigramTableScoringEveryPairAsAUnigramMissWithNoPenalty() {
        assertEquals(listOf("我", "想", "和", "咖啡"), search("woxianghekafei", withBigrams = false)[0].wordHanzi())
        assertEquals("我是", search("woshi", withBigrams = false)[0].hanzi)
    }

    @Test
    fun putsASentenceAboveARarerWordThatCoversTheWholeQuery() {
        val hanzi = search("woshi").map { it.hanzi }
        assertEquals("我是", hanzi[0])
        assertTrue(hanzi.indexOf("卧室") > 0)
        // A word with no frequency still ranks as a word, but is never inside a sentence.
        assertTrue(hanzi.contains("卧式"))
    }

    @Test
    fun keepsACommonWordFirstAndOffersNoSentenceRepeatingIt() {
        // 你好 (71,309 − W) beats 你 + 好 (98,770 + 87,105 − 2W), and 你 + 好 would repeat it anyway.
        val candidates = search("nihao")
        assertEquals("你好", candidates[0].hanzi)
        assertNull(candidates.sentence())

        // 先 + 好 covers the query and no word does, so the sentence is first.
        assertEquals(listOf("先", "好"), search("xianhao")[0].wordHanzi())
    }

    @Test
    fun findsWordsOnASplitOtherThanTheOneSegmentPinyinPicks() {
        // segmentPinyin reads fangan as fang + an; 反 + 感 sits on fan + gan.
        assertEquals(listOf("反", "感"), search("fangan")[0].wordHanzi())
    }

    @Test
    fun neverLetsAWordRunAcrossAnApostropheSpaceOrToneDigit() {
        assertEquals(listOf("西", "安"), search("xi'an").sentence().wordHanzi())
        assertEquals(listOf("西", "安"), search("xi an").sentence().wordHanzi())
        assertEquals(listOf("西", "安"), search("xi1an").sentence().wordHanzi())
    }

    @Test
    fun filtersEdgesOnTypedTonesAndOffersNoSentenceWhenNoneSurvives() {
        // 我 is third tone, so the sentence takes 卧; 卧室 fits both tones and still ranks first.
        val toned = search("wo4shi")
        assertEquals("卧室", toned[0].hanzi)
        assertEquals(listOf("卧", "是"), toned.sentence().wordHanzi())
        assertNull(search("wo2shi").sentence())
    }

    @Test
    fun completesTheLastWordUnlessTheSearchIsExactOnly() {
        val first = search("woxianghekaf")[0]
        assertEquals(listOf("我", "想", "喝", "咖啡"), first.wordHanzi())
        assertEquals("", first.remainingPinyin)

        val exact = search("woxianghekaf", SearchOptions(exactOnly = true)).sentence()
        // Without 咖啡 to follow, 想→和 outscores 想→喝.
        assertEquals(listOf("我", "想", "和"), exact.wordHanzi())
        assertEquals("kaf", exact?.remainingPinyin)
    }

    @Test
    fun doesNotCompleteALastWordThatIsOnlyAConsonantInitialSoFar() {
        // "h" could start 和 or 喝, but a bare initial says too little, so it is left to compose.
        val sentence = search("woxiangh").sentence()
        assertEquals(listOf("我", "想"), sentence.wordHanzi())
        assertEquals("h", sentence?.remainingPinyin)
    }

    @Test
    fun offersTheBestPathToTheFurthestNodeAsAPartialSentenceAboveShorterPrefixWords() {
        val candidates = search("woxianghekafeiqqq")
        assertEquals(listOf("我", "想", "喝", "咖啡"), candidates[0].wordHanzi())
        assertEquals("woxianghekafei", candidates[0].matchedPinyin)
        assertEquals("qqq", candidates[0].remainingPinyin)
        assertTrue(candidates.map { it.hanzi }.contains("我"))
    }

    @Test
    fun offersNoPartialSentenceOfASingleWord() {
        assertNull(search("woqqq").sentence())
    }

    @Test
    fun dropsASentenceThatShowsTheSameHanziAsAWordCandidate() {
        val candidates = search("zhongguoren")
        assertEquals("中国人", candidates[0].hanzi)
        assertNull(candidates[0].words)
        assertNull(candidates.sentence())
    }

    @Test
    fun carriesEachWordWithItsOwnReadingGlossAndEntryIdsAndJoinsThemOutside() {
        val sentence = search("woshi")[0]
        assertEquals("我是", sentence.hanzi)
        assertEquals("我是", sentence.simplified)
        assertEquals("我是", sentence.traditional)
        assertEquals("wǒ shì", sentence.pinyinMarks)
        assertEquals("wo3 shi4", sentence.pinyinNumbers)
        assertEquals("I; me · to be", sentence.shortGloss)
        assertEquals("我是-wo3 shi4", sentence.id)
        assertEquals(0, sentence.frequency)
        assertEquals("woshi", sentence.matchedPinyin)
        assertEquals("", sentence.remainingPinyin)
        assertEquals(emptyList<Int>(), sentence.entryIds)
        val words = checkNotNull(sentence.words)
        assertEquals(listOf("我", "是"), words.map { it.hanzi })
        assertEquals(listOf("wǒ", "shì"), words.map { it.pinyinMarks })
        assertEquals(listOf("I; me", "to be"), words.map { it.shortGloss })
        assertEquals(listOf(listOf(1), listOf(3)), words.map { it.entryIds })
        assertEquals(listOf("wo", "shi"), words.map { it.matchedPinyin })
        assertTrue(search("wo").all { it.words == null })
    }

    @Test
    fun aCompletedLastWordMatchesItsWholeKey() {
        val sentence = search("woxianghekaf")[0]
        assertEquals("woxianghekafei", sentence.matchedPinyin)
        assertEquals("kafei", sentence.words!!.last().matchedPinyin)
    }

    @Test
    fun showsTheWordsInTheActiveScript() {
        val traditional = SearchOptions(script = ScriptType.TRADITIONAL)
        assertEquals("我是", search("woshi", traditional)[0].hanzi)
        assertEquals("臥是", search("wo4shi", traditional).sentence()?.hanzi)
    }

    @Test
    fun countsTheSentenceInTheTotalAndPagesOverIt() {
        val engine = engine()
        val all = engine.search("woshi", SearchOptions(limit = 50))
        assertEquals(all.candidates.size, all.total)
        assertEquals(all.candidates[1].hanzi, engine.search("woshi", SearchOptions(limit = 1, offset = 1)).candidates[0].hanzi)
        // A page that stops before the sentence's slot holds only words.
        val partial = engine.search("woxianghekafeiqqq", SearchOptions(limit = 50))
        val past = engine.search("woxianghekafeiqqq", SearchOptions(limit = 2, offset = 1)).candidates
        assertEquals(partial.candidates.subList(1, 3).map { it.hanzi }, past.map { it.hanzi })
    }

    @Test
    fun aCompletionCanEndTheQueryWhenTheWholeQueryIsAlreadySplit() {
        // `kaf` is not a syllable, so 先 + 咖啡 is full only through the completion. Exact only,
        // the furthest path is 先 alone, one word, which is not a sentence.
        assertEquals(listOf("先", "咖啡"), search("xiankaf")[0].wordHanzi())
        assertNull(search("xiankaf", SearchOptions(exactOnly = true)).sentence())
    }

    @Test
    fun aQueryWithNoLettersOffersNoSentence() {
        assertNull(search("'").sentence())
    }

    @Test
    fun givesEachWordItsOwnSpanAndMatchedPinyinSoTheUiCanCommitThroughOneWord() {
        val words = checkNotNull(search("woxianghekafe")[0].words)
        assertEquals(
            listOf(
                Triple("我", "wo", Span(0, 2)),
                Triple("想", "xiang", Span(2, 7)),
                Triple("喝", "he", Span(7, 9)),
                // A completed last word matches its whole key; its span stops at the end of the query.
                Triple("咖啡", "kafei", Span(9, 13)),
            ),
            words.map { Triple(it.hanzi, it.matchedPinyin, it.span) },
        )
    }

    @Test
    fun rebuildsTheSentenceAroundAFixedWordAndPutsItFirst() {
        // 贺 never wins on its own (和 and 喝 both outscore it), but the learner chose it.
        val candidates = search("woxianghekafei", SearchOptions(fixedWords = listOf(fix(7, 9, "贺", "he4", "賀"))))
        assertEquals(listOf("我", "想", "贺", "咖啡"), candidates[0].wordHanzi())
        assertEquals("", candidates[0].remainingPinyin)
    }

    @Test
    fun letsTheNeighboursOfAFixedWordChange() {
        // With 河 fixed, 像 → 河 is a bigram hit, so 像 takes the place of 想.
        assertEquals(listOf("我", "像", "河", "咖啡"), searchFixed("woxianghekafei", fix(7, 9, "河", "he2"))[0].wordHanzi())
    }

    @Test
    fun holdsSeveralFixedWordsAtOnce() {
        val fixedWords = listOf(fix(7, 9, "贺", "he4", "賀"), fix(2, 7, "想", "xiang3"))
        assertEquals(listOf("我", "想", "贺", "咖啡"), search("woxianghekafei", SearchOptions(fixedWords = fixedWords))[0].wordHanzi())
        val traditional = SearchOptions(fixedWords = fixedWords, script = ScriptType.TRADITIONAL)
        assertEquals("我想賀咖啡", search("woxianghekafei", traditional)[0].hanzi)
    }

    @Test
    fun usesAFixedWordRarerThanMinSentenceWordFrequency() {
        // 涸 has no frequency, so it is never inside a sentence on its own.
        assertTrue("涸" !in search("woxianghekafei")[0].wordHanzi().orEmpty())
        assertEquals(listOf("我", "想", "涸", "咖啡"), searchFixed("woxianghekafei", fix(7, 9, "涸", "he2"))[0].wordHanzi())
    }

    @Test
    fun holdsAFixedWordInsideAPartialSentence() {
        val first = searchFixed("woxianghekafeiqqq", fix(7, 9, "河", "he2"))[0]
        assertEquals(listOf("我", "像", "河", "咖啡"), first.wordHanzi())
        assertEquals("qqq", first.remainingPinyin)
    }

    @Test
    fun putsTheEditedSentenceAheadOfTheWordsThatCoverTheQuery() {
        // 卧 + 是 scores below the word 卧室, but the learner chose 卧.
        val hanzi = searchFixed("woshi", fix(0, 2, "卧", "wo4", "臥")).map { it.hanzi }
        assertEquals("卧是", hanzi[0])
        assertTrue(hanzi.contains("卧室"))
    }

    @Test
    fun dropsTheWordNotTheEditedSentenceWhenBothShowTheSameHanzi() {
        val candidates = searchFixed("zhongguoren", fix(0, 8, "中国", "zhong1 guo2", "中國"))
        assertEquals(listOf("中国", "人"), candidates[0].wordHanzi())
        assertEquals(1, candidates.count { it.hanzi == "中国人" })
        // The dropped word no longer counts in the total either.
        val result = engine().search("zhongguoren", SearchOptions(limit = 50, fixedWords = listOf(fix(0, 8, "中国", "zhong1 guo2", "中國"))))
        assertEquals(result.candidates.size, result.total)
    }

    @Test
    fun keepsAnEditedSentenceOfASingleWord() {
        // 卧室 alone is a word candidate, not a sentence, until the learner fixes it.
        assertNull(search("woshi").firstOrNull { it.hanzi == "卧室" }?.words)
        val first = searchFixed("woshi", fix(0, 5, "卧室", "wo4 shi4", "臥室"))[0]
        assertEquals(listOf("卧室"), first.wordHanzi())
        assertEquals(1, searchFixed("woshi", fix(0, 5, "卧室", "wo4 shi4", "臥室")).count { it.hanzi == "卧室" })
    }

    @Test
    fun ignoresAFixedWordTheQueryCannotHold() {
        val plain = search("woxianghekafei")[0].wordHanzi()
        for (fixed in listOf(
            fix(6, 9, "河", "he2"), // not the word's span
            fix(7, 9, "想", "xiang3"), // not an entry under the span
            fix(7, 9, "河", "he4"), // not this entry's reading
            fix(7, 30, "河", "he2"), // past the end of the query
            fix(-1, 2, "我", "wo3"), // before the start of the query
            fix(9, 7, "河", "he2"), // an empty span
        )) {
            assertEquals("$fixed", plain, searchFixed("woxianghekafei", fixed)[0].wordHanzi())
        }
        // A typed tone rules 河 (hé) out on "he4".
        assertTrue("河" !in searchFixed("woxianghe4kafei", fix(7, 9, "河", "he2"))[0].wordHanzi().orEmpty())
        // An overlapping one: the first in the list wins.
        val overlapping = listOf(fix(7, 9, "河", "he2"), fix(2, 9, "想", "xiang3"))
        assertEquals(listOf("我", "像", "河", "咖啡"), search("woxianghekafei", SearchOptions(fixedWords = overlapping))[0].wordHanzi())
    }

    @Test
    fun ignoresAFixedWordStartingPastTheLastWordBoundary() {
        // `qqq` is past the last word boundary, where no word can start.
        val plain = search("woxianghekafeiqqq")[0].wordHanzi()
        assertEquals(plain, searchFixed("woxianghekafeiqqq", fix(15, 17, "河", "he2"))[0].wordHanzi())
    }

    @Test
    fun ignoresAFixedWordAPartialSentenceCannotReach() {
        // 想 sits after a stray letter, past where words reach, so it is not held: no sentence.
        assertNull(searchFixed("woqxiang", fix(3, 8, "想", "xiang3")).sentence())
    }

    @Test
    fun fixesACompletedLastWordWhileItsSpanEndsTheQuery() {
        val fixedWords = listOf(fix(9, 13, "咖啡", "ka1 fei1"), fix(7, 9, "河", "he2"))
        assertEquals(listOf("我", "像", "河", "咖啡"), search("woxianghekafe", SearchOptions(fixedWords = fixedWords))[0].wordHanzi())
        val exact = search("woxianghekafe", SearchOptions(fixedWords = fixedWords, exactOnly = true)).sentence()
        assertEquals(listOf("我", "像", "河"), exact.wordHanzi())
    }

    @Test
    fun turnsASpanAlternativeIntoAFixedWord() {
        val alternative = checkNotNull(search("woxianghekafei")[0].words)[2]
        assertEquals(fix(7, 9, "喝", "he1"), alternative.toFixedWord())
        // A word candidate has no span to fix it on.
        assertThrows(IllegalArgumentException::class.java) { search("he")[0].toFixedWord() }
    }

    private fun alternatives(
        query: String,
        start: Int,
        end: Int,
        script: ScriptType = ScriptType.SIMPLIFIED,
        exactOnly: Boolean = false,
    ) = engine().alternativesForSpan(query, Span(start, end), script, exactOnly).map { "${it.hanzi} ${it.pinyinNumbers}" }

    @Test
    fun listsEveryEntryForTheSpanOnePerHanziRareWordsIncludedInWordCandidateOrder() {
        assertEquals(listOf("和 he2", "喝 he1", "河 he2", "贺 he4", "涸 he2"), alternatives("woxianghekafei", 7, 9))
    }

    @Test
    fun keepsOnlyTheReadingsAToneTypedInTheSpanAllows() {
        assertEquals(listOf("和 he4", "喝 he4", "贺 he4"), alternatives("woxiang he4 kafei", 7, 9))
        // A tone typed on the next word says nothing about this one.
        assertEquals(listOf("和 he2", "喝 he1", "河 he2", "贺 he4", "涸 he2"), alternatives("woxianghe kafei1", 7, 9))
    }

    @Test
    fun neverChangesWordBoundaries() {
        // No entry is keyed "xianghe", so there is nothing to offer: 想 + 喝 stay two words.
        assertEquals(emptyList<String>(), alternatives("woxianghekafei", 2, 9))
    }

    @Test
    fun offersNothingForASpanOutsideTheQuery() {
        assertEquals(emptyList<String>(), alternatives("woxianghekafei", 7, 30))
        assertEquals(emptyList<String>(), alternatives("woxianghekafei", -1, 2))
        assertEquals(emptyList<String>(), alternatives("woxianghekafei", 9, 7))
    }

    @Test
    fun offersCompletionsForALastWordThatRunsPastTheEndOfTheQuery() {
        assertEquals(listOf("咖啡 ka1 fei1"), alternatives("woxianghekafe", 9, 13))
        assertEquals(emptyList<String>(), alternatives("woxianghekafe", 9, 13, exactOnly = true))
    }

    @Test
    fun showsTheActiveScriptAndCarriesTheSpanReadyToBecomeAFixedWord() {
        val engine = engine()
        val all = engine.alternativesForSpan("woxianghekafei", Span(7, 9), ScriptType.TRADITIONAL)
        assertTrue(all.drop(1).map { it.hanzi }.contains("賀"))
        assertEquals(Span(7, 9), all[0].span)
        val he = all.first { it.hanzi == "賀" }
        val traditional = SearchOptions(script = ScriptType.TRADITIONAL, fixedWords = listOf(he.toFixedWord()))
        assertEquals("我想賀咖啡", engine.search("woxianghekafei", traditional).candidates[0].hanzi)
    }

    private fun searchFixed(
        query: String,
        fixed: FixedWord,
    ) = search(query, SearchOptions(fixedWords = listOf(fixed)))

    /** The fixed word for an entry, as an alternative from `alternativesForSpan` gives it, on [start, end). */
    private fun fix(
        start: Int,
        end: Int,
        simplified: String,
        pinyinNumbers: String,
        traditional: String = simplified,
    ) = FixedWord(start, end, simplified, traditional, pinyinNumbers)

    private fun row(
        key: String,
        simplified: String,
        traditional: String,
        pinyinNumbers: String,
        gloss: String,
        frequency: Int,
        hsk: Int,
        id: Int,
    ) = SyntheticDictionary.Row(key, simplified, traditional, pinyinNumbers, gloss, frequency, hsk, listOf(id))

    private companion object {
        /** The shipped corpus's base word cost, so the toy scores behave like the real ones. */
        const val WORD_COST = 119936
    }
}
