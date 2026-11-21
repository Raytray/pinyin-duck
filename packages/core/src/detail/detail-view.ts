/**
 * Turns the detail records of one candidate into what a Candidate detail UI draws.
 *
 * Shared by every UI so they agree: the web accordion and the Android bubble draw this
 * output, and the Kotlin port is pinned to it by `detail-parity.tsv`. Records are already
 * parsed, so rendering is choosing the active script and converting tone numbers to marks.
 */

import type { Candidate, ScriptType } from '../types.js';
import { VALID_PINYIN_SYLLABLES, toneNumberToMark } from '../parser/pinyin.js';
import type { CrossRef, DetailFile, DetailRecord, DetailTag, RichText, TagKind } from './detail-codec.js';

/** What the view needs to know about a candidate. */
export type DetailSubject = Pick<Candidate, 'entryIds' | 'simplified' | 'traditional'>;

export interface DetailViewSense {
  /** From 1 within its group. */
  number: number;
  text: string;
  /** A proper noun sense, which a UI marks as such. */
  proper: boolean;
}

/** One headword's part of the detail. */
export interface DetailGroup {
  /** The headword, when the candidate stands for several; absent otherwise. */
  heading?: string;
  /** The part-of-speech line ("noun · verb"), absent when the entry has none. */
  partOfSpeech?: string;
  tags: string[];
  senses: DetailViewSense[];
  /** In the active script with tone marks ("个 gè"). */
  measureWords: string[];
}

export interface DetailView {
  /**
   * The candidate in the other script, only when it differs from the displayed Hanzi and the
   * candidate stands for one headword (group headings take its place otherwise).
   */
  counterpart?: string;
  /** One per headword, in the candidate's order: most senses first, ties in file order. */
  groups: DetailGroup[];
}

const TAG_LABELS: Record<TagKind, string> = {
  surname: 'Surname',
  variant: 'Variant of',
  oldVariant: 'Old variant of',
  erhuaVariant: 'Erhua variant of',
  abbreviation: 'Abbreviation for',
  alsoWritten: 'Also written',
  alsoPronounced: 'Also pronounced',
  taiwanPronounced: 'Taiwan pronunciation',
};

/** A syllable with its tone number, as CC-CEDICT writes it: `Shu1`, `lu:4`, `r5`. */
const SYLLABLE = /^([A-Za-zÜü:]+)([1-5]?)$/;

/** The marked form of one syllable, or null when the token is not a pinyin syllable. */
function markSyllable(token: string): string | null {
  const match = SYLLABLE.exec(token);
  if (!match) return null;
  const letters = match[1].toLowerCase().replace(/u:/g, 'ü').replace(/v/g, 'ü');
  if (letters !== 'r' && !VALID_PINYIN_SYLLABLES.has(letters)) return null;
  const marked = toneNumberToMark(letters + match[2]);
  return /^\p{Lu}/u.test(token) ? marked.charAt(0).toUpperCase() + marked.slice(1) : marked;
}

/**
 * A tone-numbered reading as a learner reads it in running text: the syllables of a word
 * joined and tone-marked, capitals kept (`Shu1 jing1` is Shūjīng, `Xi1 an1` is Xī'ān).
 * Anything that is not a syllable (a Latin letter, `·`) is kept as written, spaced apart,
 * and a comma closes up to the word before it.
 */
export function readingWithMarks(pinyinNumbers: string): string {
  const tokens = pinyinNumbers
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((token) => token.split(/(?<=[1-5])(?=[A-Za-z])/));
  let out = '';
  let afterSyllable = false;
  for (const token of tokens) {
    const marked = markSyllable(token);
    if (marked !== null) {
      if (out && !afterSyllable) out += ' ';
      else if (out && /^[aeoāáǎàēéěèōóǒò]/i.test(marked)) out += "'";
      out += marked;
      afterSyllable = true;
    } else {
      if (out && !/^[,;]$/.test(token)) out += ' ';
      out += token;
      afterSyllable = false;
    }
  }
  return out;
}

function hanziIn(ref: CrossRef, script: ScriptType): string {
  return script === 'simplified' ? ref.simplified : ref.traditional;
}

/** A reference as Hanzi in the active script plus its marked reading ("书经 Shūjīng"). */
function renderRef(ref: CrossRef, script: ScriptType): string {
  return [hanziIn(ref, script), readingWithMarks(ref.pinyinNumbers)].filter(Boolean).join(' ');
}

function renderText(text: RichText, script: ScriptType): string {
  return text.map((part) => (typeof part === 'string' ? part : renderRef(part, script))).join('');
}

function renderTag(tag: DetailTag, script: ScriptType): string {
  const body = renderText(tag.text, script);
  return `${TAG_LABELS[tag.kind]} ${body}${tag.gloss ? `: ${tag.gloss}` : ''}`;
}

function renderGroup(record: DetailRecord, script: ScriptType, grouped: boolean): DetailGroup {
  const group: DetailGroup = {
    tags: record.tags.map((tag) => renderTag(tag, script)),
    senses: record.senses.map((sense, i) => ({
      number: i + 1,
      text: renderText(sense.text, script),
      proper: sense.proper,
    })),
    measureWords: record.measureWords.map((ref) => renderRef(ref, script)),
  };
  if (record.partsOfSpeech.length > 0) group.partOfSpeech = record.partsOfSpeech.join(' · ');
  return grouped ? { heading: record.heading, ...group } : group;
}

/** The Candidate detail of `subject` in `script`, from the records in `detail`. */
export function candidateDetail(subject: DetailSubject, script: ScriptType, detail: DetailFile): DetailView {
  const grouped = subject.entryIds.length > 1;
  const groups = subject.entryIds.map((id) => renderGroup(detail.record(id), script, grouped));
  if (grouped) return { groups };
  const [shown, other] =
    script === 'simplified' ? [subject.simplified, subject.traditional] : [subject.traditional, subject.simplified];
  return shown === other ? { groups } : { counterpart: other, groups };
}
