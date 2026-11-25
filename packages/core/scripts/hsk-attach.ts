/**
 * Attaching the HSK 3.0 levels to CC-CEDICT: each row of `data/hsk3-levels.tsv` names a word
 * at a reading as the syllabus prints it, tone marks and tone sandhi included, and gets the
 * CC-CEDICT groups (`simplified|pinyinNumbers`) for that word at that reading.
 */

/** One row of the HSK 3.0 levels file: a word at a reading, as the syllabus prints it. */
export interface HskRow {
  word: string;
  /** Tone-marked pinyin exactly as printed, tone sandhi included: `yíxià`, `bú kèqi`. */
  reading: string;
  /** 1-6, or 7 for the 7-9 band. */
  level: number;
}

/** Parses `data/hsk3-levels.tsv` (word, reading, level), skipping its `#` header. */
export function parseHskLevels(content: string): HskRow[] {
  const rows: HskRow[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.startsWith('#')) continue;
    const [word, reading, levelText] = line.split('\t');
    const level = Number(levelText);
    if (!word || !reading || !Number.isInteger(level) || level < 1 || level > 7) {
      throw new Error(`Unreadable HSK row: ${line}`);
    }
    rows.push({ word, reading, level });
  }
  return rows;
}

/**
 * The steps of the matching ladder, from strictest to loosest (see `matchesAtStep`): the
 * exact reading, then with 一 and 不 sandhi undone, then also ignoring a neutral tone, then
 * ignoring tones.
 */
export const LADDER = ['exact', 'sandhi', 'neutralTone', 'toneless'] as const;
export type LadderStep = (typeof LADDER)[number];

/** What attaching the HSK rows to CC-CEDICT groups did, for the build to report. */
export interface HskAttachment {
  /** Rows whose level went to at least one group. */
  attached: number;
  /** Rows that matched no group, in file order. */
  unattached: HskRow[];
  /** Rows attached at each step of the ladder. */
  steps: Record<LadderStep, number>;
}

/** What the matching reads of a CC-CEDICT entry. */
export interface CedictEntry {
  simplified: string;
  /** Lowercased, tone-numbered pinyin. */
  pinyinNumbers: string;
  /** The entry's lines, whose pinyin keeps CC-CEDICT's capitals. */
  lines: readonly { pinyin: string }[];
}

/** One syllable of a reading: its letters without tone, and its tone, 5 for neutral. */
interface Syllable {
  letters: string;
  tone: number;
}

/** A CC-CEDICT group (`simplified|pinyinNumbers`) as the HSK matching sees it. */
interface HskTarget {
  key: string;
  syllables: Syllable[];
  /** Every line is capitalised: a proper noun or surname reading only. */
  capitalised: boolean;
}

/**
 * A printed reading reduced to its toneless letters, lowercased, with spaces, hyphens and
 * apostrophes removed, and the tone marked on each letter (0 for none).
 */
interface PrintedReading {
  letters: string;
  tones: number[];
}

/** Each tone-marked letter, as its plain letter and tone. ń ň ǹ are the n of 嗯 ńg, ňg, ǹg. */
const TONE_MARKS: ReadonlyMap<string, [string, number]> = new Map(
  (
    [
      ['a', 'āáǎà', 1],
      ['e', 'ēéěè', 1],
      ['i', 'īíǐì', 1],
      ['o', 'ōóǒò', 1],
      ['u', 'ūúǔù', 1],
      ['ü', 'ǖǘǚǜ', 1],
      ['n', 'ńňǹ', 2],
    ] as const
  ).flatMap(([letter, marks, firstTone]) =>
    [...marks].map((mark, i): [string, [string, number]] => [mark, [letter, firstTone + i]])
  )
);

/** Splits a numbered CC-CEDICT reading into syllables, dropping punctuation tokens. */
function cedictSyllables(pinyinNumbers: string): Syllable[] {
  const syllables: Syllable[] = [];
  for (const token of pinyinNumbers.split(' ')) {
    const letters = token.replace(/[^a-zü]/g, '');
    if (!letters) continue;
    const tone = token.match(/([1-5])$/);
    syllables.push({ letters, tone: tone ? Number(tone[1]) : 5 });
  }
  return syllables;
}

/** Reads a reading as the syllabus prints it. */
function printedReading(reading: string): PrintedReading {
  let letters = '';
  const tones: number[] = [];
  for (const char of reading.normalize('NFC').toLowerCase().replace(/[\s\-'’]/g, '')) {
    const marked = TONE_MARKS.get(char);
    letters += marked ? marked[0] : char;
    tones.push(marked ? marked[1] : 0);
  }
  return { letters, tones };
}

/** The reading without its final erhua r, or null when it does not end in one. */
function withoutErhua(printed: PrintedReading): PrintedReading | null {
  if (!printed.letters.endsWith('r')) return null;
  return { letters: printed.letters.slice(0, -1), tones: printed.tones.slice(0, -1) };
}

/**
 * The printed reading cut into the target's syllables, each with the tone marked on it
 * (5 when none is), or null when the letters differ.
 */
function printedTones(printed: PrintedReading, target: Syllable[]): number[] | null {
  if (target.map((syllable) => syllable.letters).join('') !== printed.letters) return null;
  const tones: number[] = [];
  let start = 0;
  for (const { letters } of target) {
    const marks = printed.tones.slice(start, start + letters.length).filter((tone) => tone > 0);
    tones.push(marks[0] ?? 5);
    start += letters.length;
  }
  return tones;
}

/**
 * Whether a printed reading matches a target at a step of the ladder:
 *   - `exact`: the exact reading;
 *   - `sandhi`: with 一 yí/yì and 不 bú read back as yī and bù;
 *   - `neutralTone`: as `sandhi`, ignoring a neutral tone on either side;
 *   - `toneless`: ignoring tones.
 * Sandhi is undone only on the syllable of 一 or 不 itself, so only when the word has one
 * syllable per character.
 */
function matchesAtStep(step: LadderStep, word: string[], tones: number[], target: Syllable[]): boolean {
  if (step === 'toneless') return true;
  const undoSandhi = step !== 'exact' && word.length === target.length;
  return target.every(({ tone }, i) => {
    let printed = tones[i];
    if (undoSandhi) {
      if (word[i] === '一' && (printed === 2 || printed === 4)) printed = 1;
      if (word[i] === '不' && printed === 2) printed = 4;
    }
    return printed === tone || (step === 'neutralTone' && (printed === 5 || tone === 5));
  });
}

/**
 * Attaches each HSK row's level to the CC-CEDICT groups for its word at its reading.
 *
 * A row tries the ladder in `matchesAtStep` and stops at the first step that matches any
 * group, attaching to every group matched there. Lowercase groups go through the whole
 * ladder first; capitalised ones (proper nouns, surnames) only when no lowercase group
 * matches, so 中国 Zhōngguó still finds `Zhong1 guo2`. A word CC-CEDICT lacks that ends in
 * 儿 tries its base form at the reading without the final r. A row that matches nothing is
 * dropped and reported, never given to "any reading". When several rows land on one group,
 * the lowest level wins.
 */
export function attachHskLevels(
  groups: Map<string, readonly CedictEntry[]>,
  rows: HskRow[]
): { levels: Map<string, number>; report: HskAttachment } {
  const bySimplified = new Map<string, HskTarget[]>();
  for (const [key, group] of groups) {
    const target: HskTarget = {
      key,
      syllables: cedictSyllables(group[0].pinyinNumbers),
      capitalised: group.every((entry) => entry.lines.every((line) => /^[A-Z]/.test(line.pinyin))),
    };
    const targets = bySimplified.get(group[0].simplified);
    if (targets) targets.push(target);
    else bySimplified.set(group[0].simplified, [target]);
  }

  const levels = new Map<string, number>();
  const report: HskAttachment = {
    attached: 0,
    unattached: [],
    steps: { exact: 0, sandhi: 0, neutralTone: 0, toneless: 0 },
  };
  for (const row of rows) {
    let word = row.word;
    let printed = printedReading(row.reading);
    const base = !bySimplified.has(word) && word.endsWith('儿') ? withoutErhua(printed) : null;
    if (base) {
      word = word.slice(0, -1);
      printed = base;
    }
    const match = matchRow([...word], printed, bySimplified.get(word) ?? []);
    if (!match) {
      report.unattached.push(row);
      continue;
    }
    report.attached++;
    report.steps[match.step]++;
    for (const key of match.keys) levels.set(key, Math.min(row.level, levels.get(key) ?? row.level));
  }
  return { levels, report };
}

/** The first step at which a printed reading matches any target, and the targets it matches there. */
function matchRow(
  word: string[],
  printed: PrintedReading,
  targets: HskTarget[]
): { step: LadderStep; keys: string[] } | null {
  for (const capitalised of [false, true]) {
    // The targets with the printed reading's letters, each with the printed tones cut to its syllables.
    const sameLetters = targets
      .filter((target) => target.capitalised === capitalised)
      .map((target) => ({ target, tones: printedTones(printed, target.syllables) }))
      .filter((aligned): aligned is { target: HskTarget; tones: number[] } => aligned.tones !== null);
    for (const step of LADDER) {
      const keys = sameLetters
        .filter(({ target, tones }) => matchesAtStep(step, word, tones, target.syllables))
        .map(({ target }) => target.key);
      if (keys.length > 0) return { step, keys };
    }
  }
  return null;
}
