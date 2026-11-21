/**
 * Wire format and reader for the Candidate detail file (ADR 0002).
 *
 * The file sits beside `dictionary.btree` and is byte-identical on web and Android. The
 * dictionary build parses every entry's CC-CEDICT lines into a record here, so neither this
 * reader nor the detail view ever sees CC-CEDICT syntax. B+ tree rows carry the ids of the
 * entries they stand for, and a record is found by id in O(1) through the offset table.
 *
 * Layout:
 *
 *   header (16 bytes) | offset table ((entryCount + 1) * u32) | records
 *
 * Header:
 *   0  4 bytes  magic "PDDT"
 *   4  u8       format version
 *   5  u8, u16  reserved (0)
 *   8  u32      entryCount
 *  12  u32      buildId, the same as the `dictionary.btree` built alongside
 *
 * Offset table: entry `i`'s record runs from `offset[i]` to `offset[i + 1]`, both absolute
 * byte offsets into the file. The extra last offset is the end of the last record.
 *
 * Record:
 *   string heading
 *   varint senseCount, senseCount * (u8 senseKind, richText)
 *   varint tagCount, tagCount * (u8 tagKind, richText, string gloss)
 *   varint measureWordCount, measureWordCount * crossRef
 *   varint partOfSpeechCount, partOfSpeechCount * u8 partOfSpeech
 *
 *   richText = varint refCount, string text0, refCount * (crossRef, string text)
 *   crossRef = string traditional, string simplified, string pinyinNumbers
 *
 * Strings are a varint byte length followed by UTF-8; varints are LEB128, as in the B+ tree.
 * The code tables for sense kinds, tag kinds and parts of speech are below, and a code a
 * reader does not know is a malformed file.
 */

import { ByteReader, ByteWriter } from '../data/btree-codec.js';

export const DETAIL_MAGIC = 'PDDT';
export const DETAIL_FORMAT_VERSION = 1;
export const DETAIL_HEADER_SIZE = 16;

/**
 * A reference to another headword, stored structured so it renders in the active script
 * (书经 Shūjīng in simplified, 書經 Shūjīng in traditional).
 *
 * A pronunciation alone (`also pr. [pou1]`) has empty Hanzi; a reference CC-CEDICT gives no
 * reading for has empty `pinyinNumbers`. `pinyinNumbers` keeps CC-CEDICT's capitalisation.
 */
export interface CrossRef {
  traditional: string;
  simplified: string;
  pinyinNumbers: string;
}

/**
 * Text with embedded cross-references: strings at even indices and references at odd ones,
 * always starting and ending with a (possibly empty) string. `['see ', ref, '']`.
 */
export type RichText = Array<string | CrossRef>;

/** One sense of an entry. A proper noun sense comes from a capitalised CC-CEDICT line. */
export interface DetailSense {
  proper: boolean;
  text: RichText;
}

/** The tags pulled out of CC-CEDICT senses, in code order. */
export const TAG_KINDS = [
  'surname',
  'variant',
  'oldVariant',
  'erhuaVariant',
  'abbreviation',
  'alsoWritten',
  'alsoPronounced',
  'taiwanPronounced',
] as const;
export type TagKind = (typeof TAG_KINDS)[number];

export interface DetailTag {
  kind: TagKind;
  /** What follows the tag's prefix: `念[nian4]` in `variant of 念[nian4]`. */
  text: RichText;
  /**
   * For a variant tag, a gloss of the target: the note CC-CEDICT wrote after it
   * (`variant of 念[nian4], to read aloud`), or, on a variant-only entry, the target's own
   * short gloss. Absent otherwise.
   */
  gloss?: string;
}

/**
 * The learner labels a part of speech maps to (decided in #8), in code order. New labels
 * go on the end, so existing codes keep their meaning.
 */
export const PARTS_OF_SPEECH = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'pronoun',
  'numeral',
  'measure word',
  'preposition',
  'conjunction',
  'particle',
  'interjection',
  'idiom',
] as const;
export type PartOfSpeech = (typeof PARTS_OF_SPEECH)[number];

/** Everything the Candidate detail shows about one entry. */
export interface DetailRecord {
  /**
   * The entry's traditional form when its simplified candidate stands for several headwords
   * (後 and 后 for 后 hòu), where it heads the entry's group; empty otherwise, when the
   * candidate itself names the headword.
   */
  heading: string;
  /** Common senses first, then proper noun senses, each in file order. */
  senses: DetailSense[];
  tags: DetailTag[];
  /** In first-seen order. */
  measureWords: CrossRef[];
  /** Empty until the part-of-speech data is joined in; the field is reserved for it. */
  partsOfSpeech: PartOfSpeech[];
}

/** The error for a detail file that cannot be decoded, which a rebuild fixes. */
export function malformedDetailFile(reason: string): Error {
  return new Error(
    `The Candidate detail file is malformed or truncated (${reason}). ` +
      `Run "npm run build:dict" to regenerate it.`
  );
}

function writeCrossRef(writer: ByteWriter, ref: CrossRef): void {
  writer.string(ref.traditional);
  writer.string(ref.simplified);
  writer.string(ref.pinyinNumbers);
}

function writeRichText(writer: ByteWriter, text: RichText): void {
  writer.varint((text.length - 1) / 2);
  writer.string(text[0] as string);
  for (let i = 1; i < text.length; i += 2) {
    writeCrossRef(writer, text[i] as CrossRef);
    writer.string(text[i + 1] as string);
  }
}

function writeRecord(writer: ByteWriter, record: DetailRecord): void {
  writer.string(record.heading);
  writer.varint(record.senses.length);
  for (const sense of record.senses) {
    writer.u8(sense.proper ? 1 : 0);
    writeRichText(writer, sense.text);
  }
  writer.varint(record.tags.length);
  for (const tag of record.tags) {
    writer.u8(TAG_KINDS.indexOf(tag.kind));
    writeRichText(writer, tag.text);
    writer.string(tag.gloss ?? '');
  }
  writer.varint(record.measureWords.length);
  for (const ref of record.measureWords) writeCrossRef(writer, ref);
  writer.varint(record.partsOfSpeech.length);
  for (const pos of record.partsOfSpeech) writer.u8(PARTS_OF_SPEECH.indexOf(pos));
}

/** Encodes the records, indexed by entry id, as a detail file stamped with `buildId`. */
export function encodeDetailFile(records: DetailRecord[], buildId: number): Uint8Array {
  const body = new ByteWriter(records.length * 64 + 64);
  const offsets: number[] = [];
  const recordsStart = DETAIL_HEADER_SIZE + (records.length + 1) * 4;
  for (const record of records) {
    offsets.push(recordsStart + body.size);
    writeRecord(body, record);
  }
  offsets.push(recordsStart + body.size);

  const writer = new ByteWriter(recordsStart + body.size);
  for (const char of DETAIL_MAGIC) writer.u8(char.charCodeAt(0));
  writer.u8(DETAIL_FORMAT_VERSION);
  writer.u8(0);
  writer.u16(0);
  writer.u32(records.length);
  writer.u32(buildId);
  for (const offset of offsets) writer.u32(offset);
  writer.raw(body.toUint8Array());
  return writer.toUint8Array();
}

function readCrossRef(reader: ByteReader): CrossRef {
  return { traditional: reader.string(), simplified: reader.string(), pinyinNumbers: reader.string() };
}

function readRichText(reader: ByteReader): RichText {
  const refCount = reader.varint();
  const text: RichText = [reader.string()];
  for (let i = 0; i < refCount; i++) text.push(readCrossRef(reader), reader.string());
  return text;
}

function readRecord(reader: ByteReader): DetailRecord {
  const heading = reader.string();
  const senses: DetailSense[] = [];
  for (let i = reader.varint(); i > 0; i--) {
    const kind = reader.u8();
    if (kind > 1) throw malformedDetailFile(`unknown sense kind ${kind}`);
    senses.push({ proper: kind === 1, text: readRichText(reader) });
  }
  const tags: DetailTag[] = [];
  for (let i = reader.varint(); i > 0; i--) {
    const code = reader.u8();
    const kind = TAG_KINDS[code];
    if (kind === undefined) throw malformedDetailFile(`unknown tag kind ${code}`);
    const text = readRichText(reader);
    const gloss = reader.string();
    tags.push(gloss ? { kind, text, gloss } : { kind, text });
  }
  const measureWords: CrossRef[] = [];
  for (let i = reader.varint(); i > 0; i--) measureWords.push(readCrossRef(reader));
  const partsOfSpeech: PartOfSpeech[] = [];
  for (let i = reader.varint(); i > 0; i--) {
    const code = reader.u8();
    const pos = PARTS_OF_SPEECH[code];
    if (pos === undefined) throw malformedDetailFile(`unknown part of speech ${code}`);
    partsOfSpeech.push(pos);
  }
  return { heading, senses, tags, measureWords, partsOfSpeech };
}

/** A read-only Candidate detail file in memory, checked against its dictionary's build id. */
export class DetailFile {
  private constructor(
    private readonly bytes: Uint8Array,
    private readonly offsets: DataView,
    readonly entryCount: number,
    readonly buildId: number
  ) {}

  /**
   * Opens `bytes`, refusing them unless they were built with the dictionary whose build id
   * is `expectedBuildId`: entry ids mean nothing across builds.
   */
  static open(bytes: Uint8Array, expectedBuildId: number): DetailFile {
    if (bytes.byteLength < DETAIL_HEADER_SIZE) throw malformedDetailFile('the header is truncated');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = String.fromCharCode(...bytes.subarray(0, 4));
    if (magic !== DETAIL_MAGIC) {
      throw malformedDetailFile('the payload is not a PinyinDuck Candidate detail file');
    }
    const version = view.getUint8(4);
    if (version !== DETAIL_FORMAT_VERSION) {
      throw new Error(
        `The Candidate detail file was built with format ${version}, but this reader expects ` +
          `${DETAIL_FORMAT_VERSION}. Run "npm run build:dict" to regenerate it.`
      );
    }
    const entryCount = view.getUint32(8, true);
    const buildId = view.getUint32(12, true);
    if (buildId !== expectedBuildId) {
      throw new Error(
        `The Candidate detail file comes from build ${hex(buildId)}, but the dictionary from ` +
          `build ${hex(expectedBuildId)}. Rebuild both with "npm run build:dict".`
      );
    }
    const tableEnd = DETAIL_HEADER_SIZE + (entryCount + 1) * 4;
    if (tableEnd > bytes.byteLength) throw malformedDetailFile('the offset table is truncated');
    const offsets = new DataView(bytes.buffer, bytes.byteOffset + DETAIL_HEADER_SIZE, (entryCount + 1) * 4);
    // Records are written in id order, so the last offset bounds them all.
    if (offsets.getUint32(entryCount * 4, true) > bytes.byteLength) {
      throw malformedDetailFile('the records are truncated');
    }
    return new DetailFile(bytes, offsets, entryCount, buildId);
  }

  /** The record of entry `id`. */
  record(id: number): DetailRecord {
    if (!Number.isInteger(id) || id < 0 || id >= this.entryCount) {
      throw new Error(`The Candidate detail file holds no entry ${id}`);
    }
    const start = this.offsets.getUint32(id * 4, true);
    const end = this.offsets.getUint32(id * 4 + 4, true);
    if (start > end) throw malformedDetailFile(`entry ${id} ends before it starts`);
    try {
      return readRecord(new ByteReader(this.bytes.subarray(start, end)));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('The Candidate detail file')) throw error;
      throw malformedDetailFile(error instanceof Error ? error.message : String(error));
    }
  }
}

function hex(id: number): string {
  return id.toString(16).padStart(8, '0');
}
