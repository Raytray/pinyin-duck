// Valid Mandarin pinyin syllables (toneless, lowercased)
export const VALID_PINYIN_SYLLABLES: ReadonlySet<string> = new Set([
  'a', 'ai', 'an', 'ang', 'ao',
  'ba', 'bai', 'ban', 'bang', 'bao', 'bei', 'ben', 'beng', 'bi', 'bian', 'biao', 'bie', 'bin', 'bing', 'bo', 'bu',
  'ca', 'cai', 'can', 'cang', 'cao', 'ce', 'cen', 'ceng', 'cha', 'chai', 'chan', 'chang', 'chao', 'che', 'chen', 'cheng',
  'chi', 'chong', 'chou', 'chu', 'chua', 'chuai', 'chuan', 'chuang', 'chui', 'chun', 'chuo', 'ci', 'cong', 'cou', 'cu',
  'cuan', 'cui', 'cun', 'cuo',
  'da', 'dai', 'dan', 'dang', 'dao', 'de', 'dei', 'den', 'deng', 'di', 'dia', 'dian', 'diao', 'die', 'ding', 'diu',
  'dong', 'dou', 'du', 'duan', 'dui', 'dun', 'duo',
  'e', 'ei', 'en', 'eng', 'er',
  'fa', 'fan', 'fang', 'fei', 'fen', 'feng', 'fo', 'fou', 'fu',
  'ga', 'gai', 'gan', 'gang', 'gao', 'ge', 'gei', 'gen', 'geng', 'gong', 'gou', 'gu', 'gua', 'guai', 'guan', 'guang',
  'gui', 'gun', 'guo',
  'ha', 'hai', 'han', 'hang', 'hao', 'he', 'hei', 'hen', 'heng', 'hm', 'hng', 'hong', 'hou', 'hu', 'hua', 'huai',
  'huan', 'huang', 'hui', 'hun', 'huo',
  'ji', 'jia', 'jian', 'jiang', 'jiao', 'jie', 'jin', 'jing', 'jiong', 'jiu', 'ju', 'juan', 'jue', 'jun',
  'ka', 'kai', 'kan', 'kang', 'kao', 'ke', 'kei', 'ken', 'keng', 'kong', 'kou', 'ku', 'kua', 'kuai', 'kuan', 'kuang',
  'kui', 'kun', 'kuo',
  'la', 'lai', 'lan', 'lang', 'lao', 'le', 'lei', 'leng', 'li', 'lia', 'lian', 'liang', 'liao', 'lie', 'lin', 'ling',
  'liu', 'lo', 'long', 'lou', 'lu', 'luan', 'lun', 'luo', 'lv', 'lü', 'lve', 'lüe',
  'ma', 'mai', 'man', 'mang', 'mao', 'me', 'mei', 'men', 'meng', 'mi', 'mian', 'miao', 'mie', 'min', 'ming', 'miu',
  'mo', 'mou', 'mu',
  'na', 'nai', 'nan', 'nang', 'nao', 'ne', 'nei', 'nen', 'neng', 'ng', 'ni', 'nian', 'niang', 'niao', 'nie', 'nin',
  'ning', 'niu', 'nong', 'nou', 'nu', 'nuan', 'nun', 'nuo', 'nv', 'nü', 'nve', 'nüe',
  'o', 'ou',
  'pa', 'pai', 'pan', 'pang', 'pao', 'pei', 'pen', 'peng', 'pi', 'pian', 'piao', 'pie', 'pin', 'ping', 'po', 'pou', 'pu',
  'qi', 'qia', 'qian', 'qiang', 'qiao', 'qie', 'qin', 'qing', 'qiong', 'qiu', 'qu', 'quan', 'que', 'qun',
  'ran', 'rang', 'rao', 're', 'ren', 'reng', 'ri', 'rong', 'rou', 'ru', 'rua', 'ruan', 'rui', 'run', 'ruo',
  'sa', 'sai', 'san', 'sang', 'sao', 'se', 'sen', 'seng', 'sha', 'shai', 'shan', 'shang', 'shao', 'she', 'shei',
  'shen', 'sheng', 'shi', 'shou', 'shu', 'shua', 'shuai', 'shuan', 'shuang', 'shui', 'shun', 'shuo', 'si', 'song',
  'sou', 'su', 'suan', 'sui', 'sun', 'suo',
  'ta', 'tai', 'tan', 'tang', 'tao', 'te', 'teng', 'ti', 'tian', 'tiao', 'tie', 'ting', 'tong', 'tou', 'tu', 'tuan',
  'tui', 'tun', 'tuo',
  'wa', 'wai', 'wan', 'wang', 'wei', 'wen', 'weng', 'wo', 'wu',
  'xi', 'xia', 'xian', 'xiang', 'xiao', 'xie', 'xin', 'xing', 'xiong', 'xiu', 'xu', 'xuan', 'xue', 'xun',
  'ya', 'yan', 'yang', 'yao', 'ye', 'yi', 'yin', 'ying', 'yo', 'yong', 'you', 'yu', 'yuan', 'yue', 'yun',
  'za', 'zai', 'zan', 'zang', 'zao', 'ze', 'zei', 'zen', 'zeng', 'zha', 'zhai', 'zhan', 'zhang', 'zhao', 'zhe',
  'zhei', 'zhen', 'zheng', 'zhi', 'zhong', 'zhou', 'zhu', 'zhua', 'zhuai', 'zhuan', 'zhuang', 'zhui', 'zhun', 'zhuo',
  'zi', 'zong', 'zou', 'zu', 'zuan', 'zui', 'zun', 'zuo',
]);

const TONE_MARKS: Record<string, [string, string, string, string, string]> = {
  a: ['ā', 'á', 'ǎ', 'à', 'a'],
  e: ['ē', 'é', 'ě', 'è', 'e'],
  i: ['ī', 'í', 'ǐ', 'ì', 'i'],
  o: ['ō', 'ó', 'ǒ', 'ò', 'o'],
  u: ['ū', 'ú', 'ǔ', 'ù', 'u'],
  v: ['ǖ', 'ǘ', 'ǚ', 'ǜ', 'ü'],
  'ü': ['ǖ', 'ǘ', 'ǚ', 'ǜ', 'ü'],
};

/**
 * Normalizes pinyin text by converting umlaut variants (u: or v) to standard ü,
 * collapsing internal whitespace and removing stray punctuation.
 */
export function normalizePinyin(input: string): string {
  return input
    .toLowerCase()
    .replace(/u:/g, 'ü')
    .replace(/v/g, 'ü')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Converts a single numbered syllable (e.g. "hao3", "lü4", "lv4") into marked pinyin (e.g. "hǎo", "lǜ").
 */
export function toneNumberToMark(syllable: string): string {
  const normalized = syllable.trim().toLowerCase().replace(/u:/g, 'ü').replace(/v/g, 'ü');
  const match = normalized.match(/^([a-z\u00FC\u01D7-\u01DC]+)([1-5]?)$/);
  if (!match) return syllable;

  const [, letters, toneStr] = match;
  const tone = toneStr ? parseInt(toneStr, 10) : 5;
  if (tone === 5 || tone === 0 || !toneStr) {
    return letters;
  }

  const toneIndex = tone - 1;

  // Tone mark placement rules:
  // 1. If 'a' or 'e' is present, it takes the tone mark.
  if (letters.includes('a')) {
    return letters.replace('a', TONE_MARKS.a[toneIndex]);
  }
  if (letters.includes('e')) {
    return letters.replace('e', TONE_MARKS.e[toneIndex]);
  }
  // 2. If 'ou' is present, 'o' takes the tone mark.
  if (letters.includes('ou')) {
    return letters.replace('o', TONE_MARKS.o[toneIndex]);
  }
  // 3. Otherwise, the last vowel takes the tone mark.
  for (let i = letters.length - 1; i >= 0; i--) {
    const char = letters[i];
    if (TONE_MARKS[char]) {
      return (
        letters.substring(0, i) +
        TONE_MARKS[char][toneIndex] +
        letters.substring(i + 1)
      );
    }
  }

  return letters;
}

/**
 * Converts a multi-syllable numbered string (e.g. "ni3 hao3", "tian1'an1'men2") to tone marks ("nǐ hǎo", "tiān'ān'mén").
 */
export function pinyinNumbersToMarks(pinyinWithNumbers: string): string {
  return pinyinWithNumbers
    .split(/([ \t'’-]+)/)
    .map((part) => {
      if (/^[ \t'’-]+$/.test(part)) return part;
      return toneNumberToMark(part);
    })
    .join('');
}

/**
 * Segments an unbroken or formatted pinyin string into valid Mandarin syllables.
 * Handles:
 * - Toneless unbroken string: "nihao" -> ["ni", "hao"]
 * - With apostrophes: "xi'an" -> ["xi", "an"]
 * - With tone numbers: "ni3hao3" -> ["ni3", "hao3"]
 * - Mixed spaces and numbers: "ni3 hao3" -> ["ni3", "hao3"]
 */
export function segmentPinyin(input: string): string[] {
  const cleaned = input.toLowerCase().replace(/u:/g, 'ü').replace(/v/g, 'ü').trim();
  if (!cleaned) return [];

  // If input contains explicit separators (spaces or apostrophes), split by them first
  if (/[\s'’-]/.test(cleaned)) {
    const parts = cleaned.split(/[\s'’-]+/).filter(Boolean);
    const result: string[] = [];
    for (const part of parts) {
      result.push(...segmentContinuousPinyin(part));
    }
    return result;
  }

  return segmentContinuousPinyin(cleaned);
}

const SYLLABLE_CHUNK = /^([a-z\u00FC\u01D7-\u01DC]+)([1-5]?)$/;

/** Longest chunk to try: a 6-letter syllable ("zhuang") plus a tone digit, with headroom. */
const MAX_SYLLABLE_CHUNK = 8;

function isSyllableChunk(chunk: string): boolean {
  const match = chunk.match(SYLLABLE_CHUNK);
  return match !== null && VALID_PINYIN_SYLLABLES.has(match[1]);
}

/**
 * Segments an unbroken run into syllables, longest match first, backtracking when a
 * choice strands the rest of the input.
 *
 * A plain greedy pass cannot back out of a choice, so it split "jianguo" into
 * jiang + "uo" and "fanguo" into fang + "uo", leaving a non-syllable behind even though
 * jian + guo and fan + guo exist. Here the first syllable tried is still the longest,
 * so any input the greedy pass split validly is split exactly the same way; a shorter
 * syllable is tried only when the longer one leaves a remainder that cannot be split.
 * Failed positions are memoized, so the search stays linear in the input length.
 *
 * When no split covers the whole input, the longest prefix that can be split is split
 * that way and the remainder is emitted verbatim, so unresolvable input ("qqq",
 * "nihqqq") still reaches the search engine and can be committed as raw text.
 */
function segmentContinuousPinyin(text: string): string[] {
  const n = text.length;

  // reachable[j]: text[0, j) splits into valid syllables. `end` is the furthest such j.
  const reachable: boolean[] = new Array(n + 1).fill(false);
  reachable[0] = true;
  let end = 0;
  for (let j = 1; j <= n; j++) {
    for (let i = Math.max(0, j - MAX_SYLLABLE_CHUNK); i < j; i++) {
      if (reachable[i] && isSyllableChunk(text.slice(i, j))) {
        reachable[j] = true;
        end = j;
        break;
      }
    }
  }

  const result: string[] = [];
  const dead = new Set<number>();
  const split = (index: number): boolean => {
    if (index === end) return true;
    if (dead.has(index)) return false;
    for (let len = Math.min(MAX_SYLLABLE_CHUNK, end - index); len >= 1; len--) {
      const chunk = text.slice(index, index + len);
      if (!isSyllableChunk(chunk)) continue;
      result.push(chunk);
      if (split(index + len)) return true;
      result.pop();
    }
    dead.add(index);
    return false;
  };

  // text[0, end) is splittable by construction, so this always succeeds.
  split(0);
  if (end < n) result.push(text.slice(end));
  return result;
}

const TONE_CHAR_MAP: Record<string, string> = {
  'ā': 'a', 'á': 'a', 'ǎ': 'a', 'à': 'a',
  'ē': 'e', 'é': 'e', 'ě': 'e', 'è': 'e',
  'ī': 'i', 'í': 'i', 'ǐ': 'i', 'ì': 'i',
  'ō': 'o', 'ó': 'o', 'ǒ': 'o', 'ò': 'o',
  'ū': 'u', 'ú': 'u', 'ǔ': 'u', 'ù': 'u',
  'ǖ': 'ü', 'ǘ': 'ü', 'ǚ': 'ü', 'ǜ': 'ü',
};

/**
 * Strips tone numbers, diacritics, and apostrophes to get a clean toneless pinyin string.
 */
export function cleanPinyin(pinyin: string): string {
  let normalized = pinyin
    .toLowerCase()
    .replace(/u:/g, 'ü')
    .replace(/v/g, 'ü');

  for (const [char, replacement] of Object.entries(TONE_CHAR_MAP)) {
    if (normalized.includes(char)) {
      normalized = normalized.replaceAll(char, replacement);
    }
  }

  return normalized
    .replace(/[0-5]/g, '')
    .replace(/[^a-z\u00FC]/g, '');
}


/**
 * A tone typed in a query, anchored where its syllable ends.
 *
 * `offset` counts toneless pinyin letters before the digit, so in `nihao4` the 4 sits
 * at offset 5 and constrains the syllable ending there (`hao`), not the first one.
 */
export interface ToneConstraint {
  offset: number;
  tone: number;
}

/**
 * Same normalization as `cleanPinyin`, one character at a time: the toneless letter `char`
 * contributes to the search key, or null when it is not a pinyin letter.
 */
export function tonelessLetter(char: string): string | null {
  const base = TONE_CHAR_MAP[char] ?? char;
  return /^[a-z\u00FC]$/.test(base) ? base : null;
}

/**
 * Reads the tone digits (1-5) typed in a query, each anchored at the toneless offset
 * where it was typed. Offsets line up with `cleanPinyin(query)`, which is the key the
 * engines search on. Digits outside 1-5 are not tones and are ignored.
 */
export function parseToneFilter(query: string): ToneConstraint[] {
  const normalized = query.toLowerCase().replace(/u:/g, 'ü').replace(/v/g, 'ü');
  const constraints: ToneConstraint[] = [];
  let offset = 0;
  for (const char of normalized) {
    if (char >= '1' && char <= '5') {
      constraints.push({ offset, tone: Number(char) });
    } else if (tonelessLetter(char) !== null) {
      offset++;
    }
  }
  return constraints;
}

/**
 * The syllables of a stored numbered reading (e.g. `ni3 hao3`), each as the toneless
 * offset where it ends plus its tone (0 when the syllable carries no digit). Offsets
 * line up with `cleanPinyin(pinyinNumbers)`, the entry's search key. Tokens with no
 * pinyin letters (CC-CEDICT's `·` and `,`) are not syllables and are skipped.
 */
export function syllableToneEnds(pinyinNumbers: string): ToneConstraint[] {
  const ends: ToneConstraint[] = [];
  let offset = 0;
  for (const token of pinyinNumbers.split(/[\s'’-]+/)) {
    const letters = cleanPinyin(token).length;
    if (letters === 0) continue;
    offset += letters;
    const digit = token.match(/([1-5])$/);
    ends.push({ offset, tone: digit ? Number(digit[1]) : 0 });
  }
  return ends;
}
