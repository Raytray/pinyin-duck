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
 * Normalizes pinyin text by converting umlaut variants (u: or v) to standard ü
 * and removing stray punctuation.
 */
export function normalizePinyin(input: string): string {
  return input
    .toLowerCase()
    .replace(/u:/g, 'ü')
    .replace(/v/g, 'ü')
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
    .split(/([ \t'’\-]+)/)
    .map((part) => {
      if (/^[ \t'’\-]+$/.test(part)) return part;
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
  if (/[\s'’\-]/.test(cleaned)) {
    const parts = cleaned.split(/[\s'’\-]+/).filter(Boolean);
    const result: string[] = [];
    for (const part of parts) {
      result.push(...segmentContinuousPinyin(part));
    }
    return result;
  }

  return segmentContinuousPinyin(cleaned);
}

/**
 * Greedy forward segmentation with backtracking for continuous syllables.
 */
function segmentContinuousPinyin(text: string): string[] {
  if (!text) return [];

  const memo = new Map<number, string[] | null>();

  function search(index: number): string[] | null {
    if (index === text.length) return [];
    if (memo.has(index)) return memo.get(index)!;

    // Maximum pinyin syllable length is ~7 chars (e.g. "zhuang4")
    const maxLen = Math.min(8, text.length - index);

    for (let len = maxLen; len >= 1; len--) {
      const chunk = text.slice(index, index + len);
      // Check if chunk is valid syllable (optionally with trailing tone number 1-5)
      const syllableMatch = chunk.match(/^([a-z\u00FC\u01D7-\u01DC]+)([1-5]?)$/);
      if (syllableMatch) {
        const base = syllableMatch[1];
        if (VALID_PINYIN_SYLLABLES.has(base)) {
          const rest = search(index + len);
          if (rest !== null) {
            const result = [chunk, ...rest];
            memo.set(index, result);
            return result;
          }
        }
      }
    }

    // Fallback: If no valid syllable partition covers the whole string,
    // take the best prefix match so incomplete input can still be searched.
    for (let len = maxLen; len >= 1; len--) {
      const chunk = text.slice(index, index + len);
      const syllableMatch = chunk.match(/^([a-z\u00FC\u01D7-\u01DC]+)([1-5]?)$/);
      if (syllableMatch && VALID_PINYIN_SYLLABLES.has(syllableMatch[1])) {
        const remaining = text.slice(index + len);
        const result = [chunk, ...(remaining ? [remaining] : [])];
        memo.set(index, result);
        return result;
      }
    }

    memo.set(index, [text.slice(index)]);
    return [text.slice(index)];
  }

  return search(0) || [text];
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

