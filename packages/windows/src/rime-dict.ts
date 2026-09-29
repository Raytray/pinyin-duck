/**
 * Emitter for the Rime dictionary files behind the PinyinDuck Windows input method.
 *
 * Windows gets PinyinDuck through Rime/Weasel, so the dictionary has to be re-expressed
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

import type { StoredEntry } from '../../core/src/data/btree-codec.js';
import { pinyinNumbersToMarks } from '../../core/src/parser/pinyin.js';

/** Which of CC-CEDICT's two forms a dictionary emits as candidate text. */
export type RimeScript = 'simplified' | 'traditional';

/** Both scripts, in the order the build writes them. */
export const RIME_SCRIPTS: readonly RimeScript[] = ['simplified', 'traditional'];

/**
 * Column order declared in the header, which is what gives the TSV body its meaning.
 *
 * This has to be written out: `DictSettings::GetColumnIndex` falls back to
 * text/code/weight when `columns` is absent, and `comment` is not part of that default.
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
  return Math.round(entry.frequency / 5) + hskBonus(entry.hskLevel);
}

/** Tone marks derived from the code, or `''` when the code is not typeable pinyin. */
export function rimeToneMarks(entry: StoredEntry): string {
  const marks = pinyinNumbersToMarks(entry.pinyinNumbers).trim();
  // CC-CEDICT transliterations and a handful of punctuation rows produce codes that
  // are not pinyin at all (`bai3ke4`, `·`). Those must not decorate a gloss.
  return /^[\p{Letter}\s'’-]+$/u.test(marks) ? marks : '';
}

/**
 * The comment Rime shows next to a candidate.
 *
 * Tone marks and the definition travel together because they answer the same question:
 * which of these homophones did I mean. `always_show_comments` in the schema puts this
 * on every candidate, not just the selected one.
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

/**
 * Builds the rows for one code, dropping duplicates.
 *
 * The simplified dictionary arrives already deduplicated on `(word, reading)`, but the
 * traditional one does not: distinct simplified words collapse onto one traditional
 * form (`干` and `乾` are both `乾`), and librime discards such a duplicate with a
 * warning while still compiling it. Deduplicating here keeps the file honest.
 */
export function rowsForCode(entries: StoredEntry[], script: RimeScript): RimeCodeRows {
  const sorted = [...entries].sort(compareEntriesForMenu);
  const rows: RimeRow[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  for (const entry of sorted) {
    const text = rimeText(entry, script);
    const code = sanitizeField(entry.pinyinNumbers);
    if (!text || !code) continue;
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

/** Renders the YAML header that introduces the body. */
export function renderDictHeader(meta: RimeDictMeta): string {
  return [
    '# PinyinDuck dictionary, generated from @pinyinduck/core by `npm run build:rime`.',
    '# Edit the generator, not this file: it is overwritten on every build.',
    '#',
    '# Source: the CC-CEDICT B+ tree at packages/web/public/dictionary.btree, joined with',
    '# the OpenSubtitles frequency list and the HSK 2012 word list.',
    `# Entries in the source asset: ${meta.entryCount}.`,
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
  /** Entries with no text or no code, which no dictionary can hold. */
  skippedCount = 0;
  /** Duplicate `(text, code)` rows dropped. */
  duplicateCount = 0;

  private block: StoredEntry[] = [];
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
    const code = sanitizeField(entry.pinyinNumbers);
    if (!rimeText(entry, this.script) || !code) {
      this.skippedCount++;
      return;
    }
    if (entry.key !== this.blockKey) {
      this.flush();
      this.blockKey = entry.key;
    }
    this.block.push(entry);
  }

  /** Flushes the last key block. Safe to call more than once. */
  finish(): void {
    this.flush();
    this.blockKey = null;
  }

  private flush(): void {
    if (this.block.length === 0) return;
    const byCode = new Map<string, StoredEntry[]>();
    for (const entry of this.block) {
      const code = sanitizeField(entry.pinyinNumbers);
      const group = byCode.get(code);
      if (group) group.push(entry);
      else byCode.set(code, [entry]);
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
