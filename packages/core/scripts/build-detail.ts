/**
 * Parses each dictionary entry's CC-CEDICT lines into its Candidate detail record.
 *
 * This is the only place CC-CEDICT definition syntax is read for the detail: the records
 * hold typed senses, tags, measure words and structured cross-references, so the readers on
 * web and Android only decode and render them (ADR 0002).
 *
 * The rules are the ones decided for the Candidate detail data model (#6):
 *
 * - Senses: common lines first, then proper noun senses from capitalised lines, each in file
 *   order, with exact duplicates dropped.
 * - Tags pulled out of the senses: `surname X`; `variant of` / `old variant of` /
 *   `erhua variant of X`; `abbr. for X`; `also written X`; `also pr.` / `Taiwan pr. [..]`.
 *   The union, without duplicates, in file order.
 * - `CL:` definitions become measure words: the union, in first-seen order.
 * - `see X`, `used in X`, `classifier for …` and register labels stay in the sense text.
 * - Every embedded `trad|simp[pinyin]` is stored structured, in senses and tags alike.
 * - A variant-only entry's variant tags carry the target's short gloss.
 * - Part of speech comes from Wiktionary and HanDeDict (`part-of-speech.ts`, #8), not from
 *   CC-CEDICT, which has none.
 */

import type {
  CrossRef,
  DetailRecord,
  DetailSense,
  DetailTag,
  PartOfSpeech,
  RichText,
  TagKind,
} from '../src/detail/detail-codec.js';
import { normalizePinyin } from '../src/parser/pinyin.js';
import type { DictionaryEntry, RawCedictLine } from './build-dictionary.js';

/** A line written with lowercase pinyin, which CC-CEDICT uses for common (not proper noun) senses. */
export function isCommonLine(line: RawCedictLine): boolean {
  return line.pinyin === line.pinyin.toLowerCase();
}

/**
 * One run of Hanzi in a cross-reference, possibly with Latin letters or digits joined to it
 * (95後, B超, 珍·奧斯汀). Punctuation and spaces end it, so the words around it stay text.
 */
const WORD_CHAR = String.raw`[^\s|\[\](){}<>,;:.!?"'/\-、。，；：！？（）《》〈〉「」『』【】〔〕…]`;
const HANZI_WORD = String.raw`${WORD_CHAR}*\p{Script=Han}${WORD_CHAR}*`;

/**
 * A cross-reference: `trad|simp[pinyin]`, `hanzi[pinyin]`, `trad|simp`, or a reading alone,
 * `[pinyin]`. Bare Hanzi with neither a pipe nor a reading is ordinary text.
 */
const CROSS_REF = new RegExp(
  String.raw`(${HANZI_WORD})(?:\|(${HANZI_WORD}))?\[([^\]]*)\]|(${HANZI_WORD})\|(${HANZI_WORD})|\[([^\]]*)\]`,
  'gu'
);

/** Bracket contents that are a reading rather than, say, `[ ]` written out. */
function isReading(text: string): boolean {
  return /[A-Za-z]/.test(text);
}

/** CC-CEDICT's reading as stored: tone numbers and capitals kept, `lu : 3` closed up to `lu:3`. */
function cleanReading(text: string): string {
  return text.replace(/\s*:\s*/g, ':').replace(/\s+/g, ' ').trim();
}

/** Splits CC-CEDICT text into text and structured cross-references. */
export function parseRichText(text: string): RichText {
  const parts: RichText = [];
  let pending = '';
  let last = 0;
  for (const match of text.matchAll(CROSS_REF)) {
    const [whole, trad, simp, reading, pipedTrad, pipedSimp, readingOnly] = match;
    let ref: CrossRef | null = null;
    if (trad !== undefined && isReading(reading)) {
      ref = { traditional: trad, simplified: simp ?? trad, pinyinNumbers: cleanReading(reading) };
    } else if (pipedTrad !== undefined) {
      ref = { traditional: pipedTrad, simplified: pipedSimp, pinyinNumbers: '' };
    } else if (readingOnly !== undefined && isReading(readingOnly)) {
      ref = { traditional: '', simplified: '', pinyinNumbers: cleanReading(readingOnly) };
    }
    if (!ref) continue;
    pending += text.slice(last, match.index);
    parts.push(pending, ref);
    pending = '';
    last = match.index + whole.length;
  }
  parts.push(pending + text.slice(last));
  return parts;
}

/**
 * The tag prefixes, each with a check on what follows it, so a sense that only begins like a
 * tag stays a sense: `surname and given name` (姓名) and `also written as` (亦作).
 */
const TAG_PREFIXES: ReadonlyArray<{ kind: TagKind; prefix: RegExp; body?: RegExp }> = [
  { kind: 'surname', prefix: /^surname\s+/i, body: /^\p{Lu}/u },
  { kind: 'variant', prefix: /^variant of\s+/i },
  { kind: 'oldVariant', prefix: /^old variant of\s+/i },
  { kind: 'erhuaVariant', prefix: /^erhua variant of\s+/i },
  { kind: 'abbreviation', prefix: /^abbr\. for\s+/i },
  { kind: 'alsoWritten', prefix: /^also written\s+/i, body: /\p{Script=Han}/u },
  { kind: 'alsoPronounced', prefix: /^also pr\.\s*/i },
  { kind: 'taiwanPronounced', prefix: /^taiwan pr\.\s*/i },
];

const VARIANT_KINDS: ReadonlySet<TagKind> = new Set(['variant', 'oldVariant', 'erhuaVariant']);

/** A `CL:` definition, which lists measure words rather than a sense. */
const MEASURE_WORDS = /^CL:/i;

/** What one CC-CEDICT definition is. */
export type Definition =
  | { type: 'sense'; text: RichText }
  | { type: 'tag'; tag: DetailTag }
  | { type: 'measureWords'; measureWords: CrossRef[] };

/** Classifies one trimmed, non-empty definition. */
export function classifyDefinition(definition: string): Definition {
  if (MEASURE_WORDS.test(definition)) {
    const measureWords = parseRichText(definition.slice(3)).filter(
      (part): part is CrossRef => typeof part !== 'string'
    );
    return { type: 'measureWords', measureWords };
  }
  for (const { kind, prefix, body } of TAG_PREFIXES) {
    const match = prefix.exec(definition);
    if (!match) continue;
    const rest = definition.slice(match[0].length);
    if (body && !body.test(rest)) continue;
    return { type: 'tag', tag: variantNote({ kind, text: parseRichText(rest) }) };
  }
  return { type: 'sense', text: parseRichText(definition) };
}

/**
 * Moves the note CC-CEDICT writes after a variant target (`variant of 念[nian4], to read
 * aloud`) into the tag's gloss, when the note has no reference of its own.
 */
function variantNote(tag: DetailTag): DetailTag {
  const { text } = tag;
  if (!VARIANT_KINDS.has(tag.kind) || text.length !== 3 || text[0] !== '') return tag;
  const note = /^,\s*(.+)$/.exec(text[2] as string);
  if (!note) return tag;
  return { ...tag, text: ['', text[1], ''], gloss: note[1].trim() };
}

/** The only reference in a tag that is nothing but a reference (`variant of 念[nian4]`). */
function soleTarget(tag: DetailTag): CrossRef | null {
  const { text } = tag;
  return text.length === 3 && text[0] === '' && text[2] === '' ? (text[1] as CrossRef) : null;
}

function sameRef(a: CrossRef, b: CrossRef): boolean {
  return a.traditional === b.traditional && a.simplified === b.simplified && a.pinyinNumbers === b.pinyinNumbers;
}

function sameTag(a: DetailTag, b: DetailTag): boolean {
  return (
    a.kind === b.kind &&
    a.gloss === b.gloss &&
    a.text.length === b.text.length &&
    a.text.every((part, i) => {
      const other = b.text[i];
      return typeof part === 'string' ? part === other : typeof other !== 'string' && sameRef(part, other);
    })
  );
}

/** One entry's record, without the glosses that depend on other entries. */
function parseEntry(entry: DictionaryEntry, partsOfSpeech: PartOfSpeech[]): DetailRecord {
  const senses: DetailSense[] = [];
  const tags: DetailTag[] = [];
  const measureWords: CrossRef[] = [];
  const seenSenses = new Set<string>();

  // Tags and measure words in file order; senses common lines first.
  for (const line of entry.lines) {
    for (const raw of line.definitions) {
      const definition = raw.trim();
      if (!definition) continue;
      const parsed = classifyDefinition(definition);
      if (parsed.type === 'tag') {
        if (!tags.some((tag) => sameTag(tag, parsed.tag))) tags.push(parsed.tag);
      } else if (parsed.type === 'measureWords') {
        for (const ref of parsed.measureWords) {
          if (!measureWords.some((other) => sameRef(other, ref))) measureWords.push(ref);
        }
      }
    }
  }
  const ordered = [...entry.lines.filter(isCommonLine), ...entry.lines.filter((l) => !isCommonLine(l))];
  for (const line of ordered) {
    const proper = !isCommonLine(line);
    for (const raw of line.definitions) {
      const definition = raw.trim();
      if (!definition || seenSenses.has(definition)) continue;
      const parsed = classifyDefinition(definition);
      if (parsed.type !== 'sense') continue;
      seenSenses.add(definition);
      senses.push({ proper, text: parsed.text });
    }
  }
  return { heading: '', senses, tags, measureWords, partsOfSpeech };
}

/**
 * The detail records of `entries`, indexed by entry id.
 *
 * `shortGloss` is the short gloss the dictionary gives an entry, which a variant-only
 * entry's variant tags carry for their target ("Variant of 念 niàn: to read aloud").
 * `partsOfSpeech` gives an entry's part-of-speech labels (see `partOfSpeechLookup`).
 */
export function detailRecords(
  entries: DictionaryEntry[],
  shortGloss: (entry: DictionaryEntry) => string,
  partsOfSpeech: (entry: DictionaryEntry) => PartOfSpeech[] = () => []
): DetailRecord[] {
  const records: DetailRecord[] = new Array(entries.length);
  const byReading = new Map<string, DictionaryEntry>();
  const byHanzi = new Map<string, DictionaryEntry>();
  const groupSizes = new Map<string, number>();
  const inFileOrder = [...entries].sort((a, b) => a.fileOrder - b.fileOrder);
  for (const entry of inFileOrder) {
    records[entry.id] = parseEntry(entry, partsOfSpeech(entry));
    const hanzi = `${entry.traditional}|${entry.simplified}`;
    byReading.set(`${hanzi}|${entry.pinyinNumbers}`, entry);
    if (!byHanzi.has(hanzi)) byHanzi.set(hanzi, entry);
    const group = `${entry.simplified}|${entry.pinyinNumbers}`;
    groupSizes.set(group, (groupSizes.get(group) ?? 0) + 1);
  }

  for (const entry of entries) {
    const record = records[entry.id];
    if (groupSizes.get(`${entry.simplified}|${entry.pinyinNumbers}`)! > 1) record.heading = entry.traditional;
    if (record.senses.length > 0) continue;
    for (const tag of record.tags) {
      if (!VARIANT_KINDS.has(tag.kind) || tag.gloss) continue;
      const ref = soleTarget(tag);
      if (!ref) continue;
      const hanzi = `${ref.traditional}|${ref.simplified}`;
      const target = ref.pinyinNumbers
        ? byReading.get(`${hanzi}|${normalizePinyin(ref.pinyinNumbers)}`)
        : byHanzi.get(hanzi);
      // A target that is itself only a pointer has no meaning of its own to show.
      if (target && records[target.id].senses.length > 0) tag.gloss = shortGloss(target);
    }
  }
  return records;
}
