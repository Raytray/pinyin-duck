package dev.pinyinduck.android.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
