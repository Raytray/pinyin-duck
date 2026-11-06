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
private val DIGIT = Regex("\\d")

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

/** Longest chunk to try: a 6-letter syllable ("zhuang") plus a tone digit, with headroom. */
private const val MAX_SYLLABLE_CHUNK = 8

private fun isSyllableChunk(chunk: String): Boolean {
    val match = SYLLABLE_PATTERN.matchEntire(chunk) ?: return false
    return match.groupValues[1] in VALID_PINYIN_SYLLABLES
}

/**
 * Segments an unbroken run into syllables, longest match first, backtracking when a
 * choice strands the rest of the input.
 *
 * A plain greedy pass split `jianguo` into `jiang` + `uo`, leaving a non-syllable behind
 * even though `jian` + `guo` exists. The longest syllable is still tried first, so any
 * input the greedy pass split validly is split the same way; a shorter syllable is tried
 * only when the longer one leaves a remainder that cannot be split. Failed positions are
 * memoized, so the search stays linear in the input length.
 *
 * When no split covers the whole input, the longest splittable prefix is split and the
 * remainder is emitted verbatim, so unresolvable input such as `qqq` still reaches the
 * search engine and can be committed as raw text.
 */
private fun segmentContinuousPinyin(text: String): List<String> {
    val n = text.length

    // reachable[j]: text[0, j) splits into valid syllables. `end` is the furthest such j.
    val reachable = BooleanArray(n + 1)
    reachable[0] = true
    var end = 0
    for (j in 1..n) {
        for (i in maxOf(0, j - MAX_SYLLABLE_CHUNK) until j) {
            if (reachable[i] && isSyllableChunk(text.substring(i, j))) {
                reachable[j] = true
                end = j
                break
            }
        }
    }

    val result = ArrayList<String>()
    val dead = HashSet<Int>()

    fun split(index: Int): Boolean {
        if (index == end) return true
        if (index in dead) return false
        for (length in minOf(MAX_SYLLABLE_CHUNK, end - index) downTo 1) {
            val chunk = text.substring(index, index + length)
            if (!isSyllableChunk(chunk)) continue
            result.add(chunk)
            if (split(index + length)) return true
            result.removeAt(result.lastIndex)
        }
        dead.add(index)
        return false
    }

    // text[0, end) is splittable by construction, so this always succeeds.
    split(0)
    if (end < n) result.add(text.substring(end))
    return result
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

/** The tone digits present in a query, in order, e.g. `ni3hao3` yields `[3, 3]`. */
internal fun toneDigitsOf(input: String): IntArray =
    DIGIT
        .findAll(input)
        .map { it.value.toInt() }
        .toList()
        .toIntArray()
