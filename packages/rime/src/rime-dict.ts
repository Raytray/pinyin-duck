/**
 * Emitter for the Rime dictionary files behind the PinyinDuck Windows and macOS input methods.
 *
 * Both get PinyinDuck through Rime (Weasel on Windows, Squirrel on macOS), so the dictionary
 * has to be re-expressed
 * in the format librime compiles. A `.dict.yaml` file is a YAML header followed by a
 * TSV body, one row per entry:
 *
 *     你好<TAB>ni3 hao3<TAB>nǐ hǎo · hello / how are you?<TAB>21000
 *
 * Three details of that format drive the design here:
 *
 * 1. **The body is TSV, not the YAML block form** older tutorials show. Since librime
 *    1.9 `EntryCollector` splits each line on tabs and looks columns up by name, so
 *    `comment` only reaches the candidate list if `columns` declares it — the built-in
 *    default is text/code/weight with no comment column at all. Dropping the gloss is
 *    the one thing this schema cannot do.
 * 2. **A weight orders the entries sharing one code.** `sort: by_weight` makes
 *    `Vocabulary::SortHomophones` stable-sort each menu by weight, descending, so a
 *    static weight can carry exactly the part of our ranking that does not depend on
 *    the query.
 * 3. **Rows are streamed, never collected.** The tree is ordered by toneless pinyin and
 *    then by frequency, so one homophone cluster arrives as a single contiguous block.
 *    Buffering that block and splitting it by code is enough to order every menu, which
 *    keeps peak memory at the largest cluster rather than at the corpus.
 *
 * The module is deliberately free of `fs` and of the command line so the whole format
 * can be pinned by tests; `scripts/build-rime-dict.ts` supplies the file sink.
 */

import { pinyinNumbersToMarks, type StoredEntry } from '@pinyinduck/core';

/** Which of CC-CEDICT's two forms a dictionary emits as candidate text. */
export type RimeScript = 'simplified' | 'traditional';

/** Both scripts, in the order the build writes them. */
export const RIME_SCRIPTS: readonly RimeScript[] = ['simplified', 'traditional'];

/**
 * Column order declared in the header, which is what gives the TSV body its meaning.
 *
 * The list has to be written out because `DictSettings::GetColumnIndex` falls back to
 * text/code/weight when `columns` is absent, and this emitter writes a fourth field.
 *
 * The `comment` column is the source of the English definition. librime's `EntryCollector`
 * does not read it, so it never reaches the candidate list on its own — but the build also
 * emits `lua/pinyinduck_gloss.lua` from it, and the schema's `lua_filter` looks the
 * definition up from there. The column stays in the dictionary so the file stays
 * self-describing and the sidecar can be regenerated from it.
 */
export const RIME_COLUMNS = ['text', 'code', 'comment', 'weight'] as const;

/** Separator between the columns of one body row. */
export const RIME_FIELD_SEPARATOR = '\t';

/** One emitted dictionary row. */
export interface RimeRow {
  text: string;
  code: string;
  comment: string;
  weight: number;
}

/** What the header needs to say about the dictionary it introduces. */
export interface RimeDictMeta {
  /** Must equal the `translator/dictionary` of the schema that reads it. */
  name: string;
  version: string;
  /** Total entries in the source asset, known from its header without reading pages. */
  entryCount: number;
}

/** Receives body rows in the order they should appear in the file. */
export type RimeRowSink = (row: RimeRow) => void;

/**
 * Collapses a value to something a TSV field can hold.
 *
 * A tab or newline in a gloss would silently split one row into two and corrupt every
 * row after it, and `Collect` treats a line starting with `#` as a comment, so the
 * surrounding whitespace is normalized rather than trusted.
 */
export function sanitizeField(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** A syllable once its tone digit is gone: one or more letters, `ü` included. */
const RIME_SYLLABLE = /^[a-zü]+$/;

/**
 * The toneless Rime codes one source reading can produce: sometimes none, sometimes two.
 *
 * The codes are toneless on purpose. A tone digit in the code would make the digit a *spelling*
 * key, so typing `shi2` would be the only way to reach `是` — and a learner who types `shi`
 * and presses `2` to pick the second candidate would instead be spelling a tone. Dropping the
 * digits makes every code reachable by its plain spelling and turns the digit keys into
 * candidate selectors, which is the behaviour the rest of PinyinDuck already has.
 *
 * CC-CEDICT is not a clean single-reading source, and both irregularities cost rows in the
 * deployed dictionary unless they are handled here rather than left to librime:
 *
 * - Some entries carry two alternative readings, separated by a comma or a middot
 *   (`ai1 de2 hua2 · da2 la1 di4`). They are one word, so the right answer is two rows, one
 *   per reading — not one row with both, which librime cannot encode at all.
 * - Some readings are not readings. They are romanised English and abbreviations that leaked
 *   into the pinyin column: `coser`, `bai3ke4`, `pua`, `t o n y`, a bare `11`. librime drops
 *   these with an `Encode failure` warning at deploy time, so passing them through buys
 *   nothing and costs a warning per row in Weasel's log.
 *
 * The validation is deliberately lenient — letters only, no syllable-set check. The web app's
 * `cleanPinyin` keeps any run of letters (`r5` → `r`, `aa` → `aa`), so a stricter rule here
 * would make Windows *less* capable than the web for the same corpus, dropping 儿化 words
 * (`ai1 bian1 r5`), `AA制`, and `ACG` that are all reachable today. Only genuinely untypeable
 * readings are rejected: squashed codes with an internal digit (`bai3ke4`) and bare numbers.
 */
export function rimeCodes(pinyinNumbers: string): string[] {
  const codes: string[] = [];
  const seen = new Set<string>();
  for (const variant of pinyinNumbers.split(/[,·]/)) {
    const code = sanitizeField(variant);
    if (code === '') continue;
    // sanitizeField leaves no empty or doubled spaces, so a split on ' ' is exact. Strip the
    // trailing tone digit from each syllable; what remains is the code the schema matches on.
    const syllables = code.split(' ').map((syllable) => syllable.replace(/[1-5]$/, ''));
    if (!syllables.every((syllable) => RIME_SYLLABLE.test(syllable))) continue;
    const toneless = syllables.join(' ');
    // A row that is its own duplicate would be dropped by the dictionary as a duplicate, but
    // counting it here is what keeps the reported row total equal to the rows written.
    if (seen.has(toneless)) continue;
    seen.add(toneless);
    codes.push(toneless);
  }
  return codes;
}

/** The candidate text an entry contributes under a script. */
export function rimeText(entry: StoredEntry, script: RimeScript): string {
  return sanitizeField(script === 'traditional' ? entry.traditional : entry.simplified);
}

/**
 * The HSK difficulty bonus, mirroring the term in `scoreEntry`.
 *
 * Held separately so the relationship to the ranker is one edit, not two.
 */
export function hskBonus(hskLevel: number): number {
  return hskLevel > 0 ? (7 - hskLevel) * 5000 : 0;
}

/**
 * The static half of `scoreEntry`: corpus popularity plus the HSK bonus.
 *
 * A Rime menu only ever compares entries that share a code, and inside one code both
 * of `scoreEntry`'s other terms are constant — the match tier is an exact match for
 * every entry there, and so is the syllable count, because one code is one word
 * length. So those constants cancel within a menu and only these two decide the order,
 * which is exactly what a fixed dictionary weight is able to carry. Rime stores
 * `log(weight)`, so only the ordering matters, not the scale.
 */
export function rimeWeight(entry: StoredEntry): number {
  // Non-negative by construction. `hskLevel` is a `u8` in the asset, so it can carry 255,
  // and `(7 - 255) * 5000` is a large negative bonus that outweighs any frequency. librime
  // would not reject it: `dict_compiler.cc` computes `log(weight > 0 ? weight :
  // DBL_EPSILON)`, so a non-positive weight becomes log(2.2e-16) ≈ -36 and the row sorts
  // below every other candidate in its own menu, silently and permanently. Clamping here
  // keeps the file valid; the corpus sweep asserts the clamp never engages, so a bad asset
  // value is still reported rather than quietly absorbed.
  return Math.max(0, Math.round(entry.frequency / 5) + hskBonus(entry.hskLevel));
}

/** Tone marks derived from the code, or `''` when the code is not typeable pinyin. */
export function rimeToneMarks(entry: StoredEntry): string {
  const marks = pinyinNumbersToMarks(entry.pinyinNumbers).trim();
  // CC-CEDICT transliterations and a handful of punctuation rows produce codes that
  // are not pinyin at all (`bai3ke4`, `·`). Those must not decorate a gloss.
  return /^[\p{Letter}\s'’-]+$/u.test(marks) ? marks : '';
}

/**
 * The comment column: tone marks plus the definition, or `''` when there is no gloss.
 *
 * Tone marks and the definition travel together because they answer the same question:
 * which of these homophones did I mean.
 *
 * This value is written to the dictionary and is also what `lua/pinyinduck_gloss.lua` is
 * generated from, so the Lua filter can put the definition on the candidate. librime's
 * `RawDictEntry` is text/code/weight and `EntryCollector` never reads a fourth field, so
 * the column is discarded at compile time; what `always_show_comments` would otherwise show
 * is the candidate's own code, spelled out. Building it correctly anyway is the point: the
 * file is the artifact, and the artifact should be right even where the consumer is not.
 */
export function rimeComment(entry: StoredEntry): string {
  const gloss = sanitizeField(entry.shortGloss);
  if (!gloss) return '';
  const marks = rimeToneMarks(entry);
  return marks ? `${marks} · ${gloss}` : gloss;
}

/** Renders one body row. */
export function formatRow(row: RimeRow): string {
  return [row.text, row.code, row.comment, String(row.weight)].join(RIME_FIELD_SEPARATOR);
}

/**
 * Orders the entries of one code the way a Rime menu will show them.
 *
 * Mirrors `compareScored` in the lazy search engine: weight first, then the same
 * tiebreakers, so the Windows client ranks candidates exactly as the web app does.
 * The trailing comparisons matter because `SortHomophones` is a *stable* sort — Rime
 * keeps equal-weight rows in file order, which makes this comparison the tiebreak
 * rather than something Rime resolves on its own.
 */
export function compareEntriesForMenu(a: StoredEntry, b: StoredEntry): number {
  const weightA = rimeWeight(a);
  const weightB = rimeWeight(b);
  if (weightA !== weightB) return weightB - weightA;
  if (a.frequency !== b.frequency) return b.frequency - a.frequency;
  if (a.simplified !== b.simplified) return a.simplified < b.simplified ? -1 : 1;
  if (a.traditional !== b.traditional) return a.traditional < b.traditional ? -1 : 1;
  return a.pinyinNumbers < b.pinyinNumbers ? -1 : a.pinyinNumbers > b.pinyinNumbers ? 1 : 0;
}

/** A code's rows, plus how many duplicate rows were dropped to produce them. */
export interface RimeCodeRows {
  rows: RimeRow[];
  duplicates: number;
}

/** One entry pinned to the specific reading it is being emitted under. */
export interface CodeEntry {
  entry: StoredEntry;
  code: string;
}

/**
 * Builds the rows for one code, dropping duplicates.
 *
 * The simplified dictionary arrives already deduplicated on `(word, reading)`, but the
 * traditional one does not: distinct simplified words collapse onto one traditional
 * form (`干` and `乾` are both `乾`), and librime discards such a duplicate with a
 * warning while still compiling it. Deduplicating here keeps the file honest.
 *
 * The code arrives with each entry rather than being read back off it, because an entry
 * with two readings contributes one row per reading and the two differ only in the code.
 */
export function rowsForCode(items: CodeEntry[], script: RimeScript): RimeCodeRows {
  const sorted = [...items].sort((a, b) => compareEntriesForMenu(a.entry, b.entry));
  const rows: RimeRow[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  for (const { entry, code } of sorted) {
    const text = rimeText(entry, script);
    if (!text) continue;
    const key = `${text}${RIME_FIELD_SEPARATOR}${code}`;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    rows.push({ text, code, comment: rimeComment(entry), weight: rimeWeight(entry) });
  }

  return { rows, duplicates };
}

/**
 * The license and credits every generated Rime file carries, one line per entry.
 *
 * The dictionary and the gloss sidecar are adaptations of CC-CEDICT and FrequencyWords,
 * both CC BY-SA 4.0, and they are copied into a user's Rime folder on their own: the
 * header is the only place someone holding the file sees where it came from and what they
 * may do with it. DATA_LICENSES.md at the repository root has the full notices.
 */
export const DATA_CREDIT_LINES: readonly string[] = [
  'License: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). This file is',
  'an adaptation of the sources below; see DATA_LICENSES.md in the PinyinDuck repository.',
  '  CC-CEDICT, by MDBG, CC BY-SA 4.0: https://www.mdbg.net/chinese/dictionary?page=cc-cedict',
  '  FrequencyWords zh_cn 2018 (OpenSubtitles), by Hermit Dave, CC BY-SA 4.0:',
  '    https://github.com/hermitdave/FrequencyWords',
  '  HSK 2012 word list, Copyright (c) 2018 gigacool, MIT:',
  '    https://github.com/gigacool/hanyu-shuiping-kaoshi',
];

/** {@link DATA_CREDIT_LINES} as comment lines, behind the given comment marker. */
export function renderDataCredit(marker: string): string[] {
  return DATA_CREDIT_LINES.map((line) => `${marker} ${line}`);
}

/** Renders the YAML header that introduces the body. */
export function renderDictHeader(meta: RimeDictMeta): string {
  return [
    '# PinyinDuck dictionary, generated from @pinyinduck/core by `npm run build:rime`.',
    '# Edit the generator, not this file: it is overwritten on every build.',
    '#',
    '# Source: the CC-CEDICT B+ tree at packages/web/public/dictionary.btree, joined with',
    '# the OpenSubtitles frequency list and the HSK 2012 word list.',
    `# Entries in the source asset: ${meta.entryCount}.`,
    '#',
    ...renderDataCredit('#'),
    '#',
    '# encoding: utf-8',
    '',
    '---',
    `name: ${meta.name}`,
    `version: "${meta.version}"`,
    'sort: by_weight',
    'use_preset_vocabulary: false',
    'columns:',
    ...RIME_COLUMNS.map((column) => `  - ${column}`),
    '...',
    '',
  ].join('\n');
}

/**
 * Streams one dictionary file, one B-tree key block at a time.
 *
 * Entries must arrive in the order the tree stores them, which is how `scanPrefix`
 * walks the asset. That is what makes a bounded buffer enough: a key never reappears
 * once the scan has moved past it, so nothing needs to be held for the whole corpus.
 */
export class RimeDictWriter {
  /** Rows written, after duplicates within a code were dropped. */
  rowCount = 0;
  /** Entries with no text for the script being written, which no dictionary can hold. */
  skippedCount = 0;
  /** Entries whose reading is not encodable pinyin, so nothing can look them up. */
  unencodableCount = 0;
  /** Duplicate `(text, code)` rows dropped. */
  duplicateCount = 0;

  private block: CodeEntry[] = [];
  private blockKey: string | null = null;

  constructor(
    private readonly meta: RimeDictMeta,
    private readonly script: RimeScript,
    private readonly sink: RimeRowSink
  ) {}

  /**
   * Adds one entry, flushing the previous key when the key changes.
   *
   * Grouping is by B-tree key, not by code. The tree is ordered on toneless pinyin and
   * then by descending frequency, so a key's readings arrive as one contiguous block —
   * but its tones are interleaved within it, and one Rime menu is per *code*. Buffering
   * the key block and splitting it by code is what keeps peak memory to the largest
   * homophone cluster while still ordering each menu correctly.
   */
  add(entry: StoredEntry): void {
    if (!rimeText(entry, this.script)) {
      this.skippedCount++;
      return;
    }
    const codes = rimeCodes(entry.pinyinNumbers);
    if (codes.length === 0) {
      this.unencodableCount++;
      return;
    }
    if (entry.key !== this.blockKey) {
      this.flush();
      this.blockKey = entry.key;
    }
    // One entry can legitimately contribute a row per reading, so the code is carried
    // alongside the entry rather than recomputed from it at flush time.
    for (const code of codes) this.block.push({ entry, code });
  }

  /** Flushes the last key block. Safe to call more than once. */
  finish(): void {
    this.flush();
    this.blockKey = null;
  }

  private flush(): void {
    if (this.block.length === 0) return;
    const byCode = new Map<string, CodeEntry[]>();
    for (const item of this.block) {
      const group = byCode.get(item.code);
      if (group) group.push(item);
      else byCode.set(item.code, [item]);
    }
    this.block = [];

    // Ascending code keeps the file reproducible; Rime only cares about the order
    // within one code, which rowsForCode settles.
    for (const code of [...byCode.keys()].sort()) {
      const { rows, duplicates } = rowsForCode(byCode.get(code)!, this.script);
      this.rowCount += rows.length;
      this.duplicateCount += duplicates;
      for (const row of rows) this.sink(row);
    }
  }
}
