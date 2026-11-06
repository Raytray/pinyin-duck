package dev.pinyinduck.android.engine

/**
 * Pinyin parsing, segmentation and tone-mark conversion.
 *
 * This is a faithful port of `packages/core/src/parser/pinyin.ts`. The algorithms,
 * the syllable table and the tone-mark placement rules are identical, so a query the web
 * app segments one way is segmented the same way here. `packages/core`'s unit tests pin
 * the TypeScript behaviour; the Android parity test pins this port against the same cases.
 *
 * Valid Mandarin pinyin syllables, toneless and lowercased.
 */
val VALID_PINYIN_SYLLABLES: Set<String> =
    setOf(
        "a",
        "ai",
        "an",
        "ang",
        "ao",
        "ba",
        "bai",
        "ban",
        "bang",
        "bao",
        "bei",
        "ben",
        "beng",
        "bi",
        "bian",
        "biao",
        "bie",
        "bin",
        "bing",
        "bo",
        "bu",
        "ca",
        "cai",
        "can",
        "cang",
        "cao",
        "ce",
        "cen",
        "ceng",
        "cha",
        "chai",
        "chan",
        "chang",
        "chao",
        "che",
        "chen",
        "cheng",
        "chi",
        "chong",
        "chou",
        "chu",
        "chua",
        "chuai",
        "chuan",
        "chuang",
        "chui",
        "chun",
        "chuo",
        "ci",
        "cong",
        "cou",
        "cu",
        "cuan",
        "cui",
        "cun",
        "cuo",
        "da",
        "dai",
        "dan",
        "dang",
        "dao",
        "de",
        "dei",
        "den",
        "deng",
        "di",
        "dia",
        "dian",
        "diao",
        "die",
        "ding",
        "diu",
        "dong",
        "dou",
        "du",
        "duan",
        "dui",
        "dun",
        "duo",
        "e",
        "ei",
        "en",
        "eng",
        "er",
        "fa",
        "fan",
        "fang",
        "fei",
        "fen",
        "feng",
        "fo",
        "fou",
        "fu",
        "ga",
        "gai",
        "gan",
        "gang",
        "gao",
        "ge",
        "gei",
        "gen",
        "geng",
        "gong",
        "gou",
        "gu",
        "gua",
        "guai",
        "guan",
        "guang",
        "gui",
        "gun",
        "guo",
        "ha",
        "hai",
        "han",
        "hang",
        "hao",
        "he",
        "hei",
        "hen",
        "heng",
        "hm",
        "hng",
        "hong",
        "hou",
        "hu",
        "hua",
        "huai",
        "huan",
        "huang",
        "hui",
        "hun",
        "huo",
        "ji",
        "jia",
        "jian",
        "jiang",
        "jiao",
        "jie",
        "jin",
        "jing",
        "jiong",
        "jiu",
        "ju",
        "juan",
        "jue",
        "jun",
        "ka",
        "kai",
        "kan",
        "kang",
        "kao",
        "ke",
        "kei",
        "ken",
        "keng",
        "kong",
        "kou",
        "ku",
        "kua",
        "kuai",
        "kuan",
        "kuang",
        "kui",
        "kun",
        "kuo",
        "la",
        "lai",
        "lan",
        "lang",
        "lao",
        "le",
        "lei",
        "leng",
        "li",
        "lia",
        "lian",
        "liang",
        "liao",
        "lie",
        "lin",
        "ling",
        "liu",
        "lo",
        "long",
        "lou",
        "lu",
        "luan",
        "lun",
        "luo",
        "lv",
        "lü",
        "lve",
        "lüe",
        "ma",
        "mai",
        "man",
        "mang",
        "mao",
        "me",
        "mei",
        "men",
        "meng",
        "mi",
        "mian",
        "miao",
        "mie",
        "min",
        "ming",
        "miu",
        "mo",
        "mou",
        "mu",
        "na",
        "nai",
        "nan",
        "nang",
        "nao",
        "ne",
        "nei",
        "nen",
        "neng",
        "ng",
        "ni",
        "nian",
        "niang",
        "niao",
        "nie",
        "nin",
        "ning",
        "niu",
        "nong",
        "nou",
        "nu",
        "nuan",
        "nun",
        "nuo",
        "nv",
        "nü",
        "nve",
        "nüe",
        "o",
        "ou",
        "pa",
        "pai",
        "pan",
        "pang",
        "pao",
        "pei",
        "pen",
        "peng",
        "pi",
        "pian",
        "piao",
        "pie",
        "pin",
        "ping",
        "po",
        "pou",
        "pu",
        "qi",
        "qia",
        "qian",
        "qiang",
        "qiao",
        "qie",
        "qin",
        "qing",
        "qiong",
        "qiu",
        "qu",
        "quan",
        "que",
        "qun",
        "ran",
        "rang",
        "rao",
        "re",
        "ren",
        "reng",
        "ri",
        "rong",
        "rou",
        "ru",
        "rua",
        "ruan",
        "rui",
        "run",
        "ruo",
        "sa",
        "sai",
        "san",
        "sang",
        "sao",
        "se",
        "sen",
        "seng",
        "sha",
        "shai",
        "shan",
        "shang",
        "shao",
        "she",
        "shei",
        "shen",
        "sheng",
        "shi",
        "shou",
        "shu",
        "shua",
        "shuai",
        "shuan",
        "shuang",
        "shui",
        "shun",
        "shuo",
        "si",
        "song",
        "sou",
        "su",
        "suan",
        "sui",
        "sun",
        "suo",
        "ta",
        "tai",
        "tan",
        "tang",
        "tao",
        "te",
        "teng",
        "ti",
        "tian",
        "tiao",
        "tie",
        "ting",
        "tong",
        "tou",
        "tu",
        "tuan",
        "tui",
        "tun",
        "tuo",
        "wa",
        "wai",
        "wan",
        "wang",
        "wei",
        "wen",
        "weng",
        "wo",
        "wu",
        "xi",
        "xia",
        "xian",
        "xiang",
        "xiao",
        "xie",
        "xin",
        "xing",
        "xiong",
        "xiu",
        "xu",
        "xuan",
        "xue",
        "xun",
        "ya",
        "yan",
        "yang",
        "yao",
        "ye",
        "yi",
        "yin",
        "ying",
        "yo",
        "yong",
        "you",
        "yu",
        "yuan",
        "yue",
        "yun",
        "za",
        "zai",
        "zan",
        "zang",
        "zao",
        "ze",
        "zei",
        "zen",
        "zeng",
        "zha",
        "zhai",
        "zhan",
        "zhang",
        "zhao",
        "zhe",
        "zhei",
        "zhen",
        "zheng",
        "zhi",
        "zhong",
        "zhou",
        "zhu",
        "zhua",
        "zhuai",
        "zhuan",
        "zhuang",
        "zhui",
        "zhun",
        "zhuo",
        "zi",
        "zong",
        "zou",
        "zu",
        "zuan",
        "zui",
        "zun",
        "zuo",
    )

/** Tone marks indexed by `tone - 1`, for tones 1 to 5 (neutral). */
private val TONE_MARKS: Map<Char, Array<String>> =
    mapOf(
        'a' to arrayOf("ā", "á", "ǎ", "à", "a"),
        'e' to arrayOf("ē", "é", "ě", "è", "e"),
        'i' to arrayOf("ī", "í", "ǐ", "ì", "i"),
        'o' to arrayOf("ō", "ó", "ǒ", "ò", "o"),
        'u' to arrayOf("ū", "ú", "ǔ", "ù", "u"),
        'ü' to arrayOf("ǖ", "ǘ", "ǚ", "ǜ", "ü"),
    )

/** Precomposed marked vowels mapped back to their toneless letter. */
private val TONE_CHAR_MAP: Map<Char, Char> =
    buildMap {
        putAll("āáǎà".map { it to 'a' })
        putAll("ēéěè".map { it to 'e' })
        putAll("īíǐì".map { it to 'i' })
        putAll("ōóǒò".map { it to 'o' })
        putAll("ūúǔù".map { it to 'u' })
        putAll("ǖǘǚǜ".map { it to 'ü' })
    }

/** Letters a pinyin syllable may be spelled with: `a-z`, `ü`, and the marked `ü` vowels. */
private const val SYLLABLE_LETTERS = "a-züǗ-ǜ"

/** A syllable is letters followed by an optional tone digit 1-5. */
private val SYLLABLE_PATTERN = Regex("^([$SYLLABLE_LETTERS]+)([1-5]?)$")

/** Runs of whitespace, apostrophes and hyphens that separate syllables. */
private val SYLLABLE_SEPARATORS = Regex("[ \t'’-]")

/** Any digit, matching the `\d` the TypeScript ranker scans a query with. */
private val SYLLABLE_SEPARATORS_RUN = Regex("[\\s'’-]+")

/**
 * Normalizes pinyin text by converting umlaut variants (`u:` or `v`) to `ü`, collapsing
 * whitespace and trimming.
 */
fun normalizePinyin(input: String): String =
    input
        .lowercase()
        .replace("u:", "ü")
        .replace('v', 'ü')
        .replace(Regex("\\s+"), " ")
        .trim()

/**
 * Converts a single numbered syllable to marked pinyin, e.g. `hao3` to `hǎo` and `lv4`
 * to `lǜ`. Returns the input unchanged when it is not a syllable.
 */
fun toneNumberToMark(syllable: String): String {
    val normalized =
        syllable
            .trim()
            .lowercase()
            .replace("u:", "ü")
            .replace('v', 'ü')
    val match = SYLLABLE_PATTERN.matchEntire(normalized) ?: return syllable

    val letters = match.groupValues[1]
    val toneText = match.groupValues[2]
    val tone = if (toneText.isEmpty()) 5 else toneText.toInt()
    // Tone 5 is the neutral tone and is written without a mark, and an absent tone digit
    // leaves the syllable unmarked too.
    if (tone == 5 || tone == 0 || toneText.isEmpty()) return letters

    val toneIndex = tone - 1

    // Placement rules: a or e takes the mark, then the o of ou, then the last vowel.
    if ('a' in letters) return letters.replaceFirst("a", TONE_MARKS.getValue('a')[toneIndex])
    if ('e' in letters) return letters.replaceFirst("e", TONE_MARKS.getValue('e')[toneIndex])
    if ("ou" in letters) return letters.replaceFirst("o", TONE_MARKS.getValue('o')[toneIndex])

    for (i in letters.indices.reversed()) {
        val marks = TONE_MARKS[letters[i]] ?: continue
        return letters.substring(0, i) + marks[toneIndex] + letters.substring(i + 1)
    }

    return letters
}

/**
 * Converts a numbered multi-syllable string to tone marks, keeping the original
 * separators: `ni3 hao3` becomes `nǐ hǎo` and `tian1'an1` becomes `tiān'ān`.
 */
fun pinyinNumbersToMarks(pinyinWithNumbers: String): String {
    val out = StringBuilder(pinyinWithNumbers.length)
    var index = 0

    while (index < pinyinWithNumbers.length) {
        if (isSyllableSeparator(pinyinWithNumbers[index])) {
            out.append(pinyinWithNumbers[index])
            index++
        } else {
            val end =
                generateSequence(index) { it + 1 }
                    .first { it >= pinyinWithNumbers.length || isSyllableSeparator(pinyinWithNumbers[it]) }
            out.append(toneNumberToMark(pinyinWithNumbers.substring(index, end)))
            index = end
        }
    }

    return out.toString()
}

private fun isSyllableSeparator(char: Char): Boolean = char == ' ' || char == '\t' || char == '\'' || char == '’' || char == '-'

/**
 * Segments pinyin into valid Mandarin syllables.
 *
 * Handles an unbroken toneless string (`nihao` becomes `ni` + `hao`), explicit
 * separators (`xi'an` becomes `xi` + `an`), and tone numbers (`ni3hao3` becomes `ni3` +
 * `hao3`).
 */
fun segmentPinyin(input: String): List<String> {
    val cleaned =
        input
            .lowercase()
            .replace("u:", "ü")
            .replace('v', 'ü')
            .trim()
    if (cleaned.isEmpty()) return emptyList()

    if (SYLLABLE_SEPARATORS.containsMatchIn(cleaned)) {
        return SYLLABLE_SEPARATORS
            .split(cleaned)
            .filter { it.isNotEmpty() }
            .flatMap { segmentContinuousPinyin(it) }
    }

    return segmentContinuousPinyin(cleaned)
}

/**
 * Greedy forward segmentation, longest match first.
 *
 * Search never fails: when no syllable starts at the current index the remainder is
 * emitted verbatim, so unresolvable input such as `qqq` still reaches the search engine
 * and can be committed as raw text. That guarantee is what lets this be a single greedy
 * pass rather than a search with backtracking.
 */
private fun segmentContinuousPinyin(text: String): List<String> {
    val syllables = ArrayList<String>()
    var index = 0

    while (index < text.length) {
        // The longest Mandarin syllable is 7 letters, plus one tone digit.
        val maxLength = minOf(8, text.length - index)
        var matchedLength = -1

        for (length in maxLength downTo 1) {
            val chunk = text.substring(index, index + length)
            val match = SYLLABLE_PATTERN.matchEntire(chunk) ?: continue
            if (match.groupValues[1] in VALID_PINYIN_SYLLABLES) {
                matchedLength = length
                break
            }
        }

        if (matchedLength < 0) {
            syllables.add(text.substring(index))
            break
        }

        syllables.add(text.substring(index, index + matchedLength))
        index += matchedLength
    }

    return syllables
}

/** Strips tone numbers, diacritics and apostrophes to a toneless pinyin key. */
fun cleanPinyin(pinyin: String): String {
    val builder = StringBuilder(pinyin.length)
    for (char in pinyin.lowercase().replace("u:", "ü").replace('v', 'ü')) {
        // A marked vowel collapses to its base letter; digits and apostrophes drop out.
        val mapped = TONE_CHAR_MAP[char] ?: char
        if (mapped in 'a'..'z' || mapped == 'ü') builder.append(mapped)
    }
    return builder.toString()
}

/**
 * A tone typed in a query, anchored where its syllable ends.
 *
 * [offset] counts toneless pinyin letters before the digit, so in `nihao4` the 4 sits at
 * offset 5 and constrains the syllable ending there (`hao`), not the first one. The same
 * shape describes a stored syllable, with [tone] 0 when it carries no digit.
 */
data class ToneConstraint(
    val offset: Int,
    val tone: Int,
)

/** Same normalization as [cleanPinyin], one character at a time. */
private fun isTonelessLetter(char: Char): Boolean {
    val mapped = TONE_CHAR_MAP[char] ?: char
    return mapped in 'a'..'z' || mapped == 'ü'
}

/**
 * Reads the tone digits (1-5) typed in a query, each anchored at the toneless offset where
 * it was typed. Offsets line up with [cleanPinyin] of the query, the key the engine
 * searches on. Digits outside 1-5 are not tones and are ignored.
 */
fun parseToneFilter(input: String): List<ToneConstraint> {
    val normalized = input.lowercase().replace("u:", "ü").replace('v', 'ü')
    val constraints = ArrayList<ToneConstraint>()
    var offset = 0
    for (char in normalized) {
        if (char in '1'..'5') {
            constraints.add(ToneConstraint(offset, char - '0'))
        } else if (isTonelessLetter(char)) {
            offset++
        }
    }
    return constraints
}

/**
 * The syllables of a stored numbered reading (e.g. `ni3 hao3`), each as the toneless offset
 * where it ends plus its tone (0 when the syllable has no digit). Tokens with no pinyin
 * letters (CC-CEDICT's `·` and `,`) are not syllables and are skipped.
 */
fun syllableToneEnds(pinyinNumbers: String): List<ToneConstraint> {
    val ends = ArrayList<ToneConstraint>()
    var offset = 0
    for (token in SYLLABLE_SEPARATORS_RUN.split(pinyinNumbers)) {
        val letters = cleanPinyin(token).length
        if (letters == 0) continue
        offset += letters
        val last = token.lastOrNull()
        ends.add(ToneConstraint(offset, if (last != null && last in '1'..'5') last - '0' else 0))
    }
    return ends
}
