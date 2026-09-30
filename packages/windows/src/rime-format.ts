/**
 * A second, independent reader for the Rime dictionary format.
 *
 * `src/rime-dict.ts` writes these files and its tests assert on what it wrote, so both
 * the writer and the test share one set of assumptions. This module exists to break that
 * circle: it parses the file *as librime would*, straight from the rules in
 * `DictSettings::LoadDictHeader`, `DictSettings::GetColumnIndex` and
 * `EntryCollector::Collect`, and is used by the corpus sweep to check the built file
 * rather than the emitter's own idea of it.
 *
 * It is deliberately not a YAML parser. Only the handful of shapes `renderDictHeader`
 * emits have to be understood, and anything outside them is an error rather than
 * something to guess at — the point is to notice when the header stops being the header
 * librime expects.
 *
 * What this reader is *not*: a substitute for running the engine. It can prove the file
 * is well formed and says what it should; only librime can prove it compiles, and
 * `scripts/verify-rime.ts` is what runs librime.
 */

/**
 * Columns librime falls back to when the header declares no `columns` list.
 *
 * This is the trap the emitter exists to avoid: `comment` is not in it, so a header that
 * loses its `columns:` line still compiles cleanly and every gloss silently disappears
 * from the candidate list.
 */
export const DEFAULT_RIME_COLUMNS: readonly string[] = ['text', 'code', 'weight'];

/** The columns the emitter declares, and therefore the order its body rows follow. */
export const REQUIRED_RIME_COLUMNS: readonly string[] = ['text', 'code', 'comment', 'weight'];

/** What `renderDictHeader` records about the asset a dictionary was built from. */
const ENTRY_COUNT_PATTERN = /^#?\s*Entries in the source asset: (\d+)\.?$/;

export class RimeFormatError extends Error {
  constructor(
    message: string,
    /** 1-based line in the file, when the problem has a position. */
    readonly line?: number
  ) {
    super(line === undefined ? message : `${message} (line ${line})`);
    this.name = 'RimeFormatError';
  }
}

/** The YAML header that introduces a dictionary body. */
export interface RimeDictHeader {
  name: string;
  version: string;
  /** `sort:`, which decides whether Rime re-orders a menu by weight. */
  sort: string;
  usePresetVocabulary: boolean;
  /** The declared `columns`, or the librime default when the header omits them. */
  columns: string[];
  /** Every line before `---`, verbatim. */
  preamble: string[];
  /** The source asset size the emitter recorded, when it wrote one. */
  entryCount: number | null;
}

/** Where each column this package depends on lives in a body row. */
export interface RimeColumnMap {
  text: number;
  code: number;
  comment: number;
  weight: number;
}

/** A parsed file, plus where its body starts. */
export interface RimeDictFile {
  header: RimeDictHeader;
  columns: RimeColumnMap;
  /** 1-based line number of the first body row. */
  bodyStartLine: number;
  /** Character offset of the first body row. */
  bodyOffset: number;
}

/** One body row, resolved through the header's column order. */
export interface ParsedRimeRow {
  line: number;
  /** The raw split, kept so a column-count mismatch can be reported rather than guessed. */
  fields: string[];
  text: string;
  code: string;
  comment: string;
  weight: number;
}

/** Unwraps a quoted YAML scalar; bare scalars are returned as they are. */
function parseScalar(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Resolves a column name to its index, exactly as `GetColumnIndex` does.
 *
 * Returns -1 for a name the header does not declare, which is how librime reports an
 * absent optional column and how an absent `text` column becomes a fatal error.
 */
export function getColumnIndex(columns: string[], label: string): number {
  return columns.indexOf(label);
}

/**
 * Parses the header and locates the body.
 *
 * The preamble is everything up to and including the `...` that closes the YAML block,
 * matching `LoadDictHeader`, which accumulates lines until it sees `...` and hands the lot
 * to the YAML parser. `name` and `version` are required for the same reason librime
 * requires them: a dictionary with neither is a build failure, not a warning.
 */
export function parseDictHeader(text: string): RimeDictFile {
  const lines = text.split('\n');
  const preamble: string[] = [];
  let start = -1;
  let end = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/\s+$/, '');
    if (line === '---') {
      start = i;
      continue;
    }
    if (start >= 0 && line === '...') {
      end = i;
      break;
    }
  }

  if (start < 0) {
    throw new RimeFormatError('The file has no `---` line, so it has no dict header.');
  }
  if (end < 0) {
    throw new RimeFormatError(
      'The dict header is never closed by `...`, so the rest of the file is not YAML.',
      start + 1
    );
  }
  for (let i = 0; i <= start; i += 1) preamble.push(lines[i]);

  const scalars = new Map<string, string>();
  let declaredColumns: string[] | null = null;
  let listKey: string | null = null;

  for (let i = start + 1; i < end; i += 1) {
    const raw = lines[i];
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;

    const listItem = /^\s+-\s+(.*)$/.exec(raw);
    if (listItem) {
      if (listKey === null) {
        throw new RimeFormatError(
          `List item outside any key: ${raw.trim()}`,
          i + 1
        );
      }
      const value = parseScalar(listItem[1]);
      if (declaredColumns === null) declaredColumns = [];
      declaredColumns.push(value);
      continue;
    }

    const pair = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(raw);
    if (!pair) {
      throw new RimeFormatError(`Unreadable header line: ${raw}`, i + 1);
    }
    const [, key, value] = pair;
    if (value.trim() === '') {
      listKey = key;
      continue;
    }
    listKey = null;
    scalars.set(key, parseScalar(value));
  }

  const name = scalars.get('name');
  const version = scalars.get('version');
  if (!name) throw new RimeFormatError('The dict header has no `name`.', start + 1);
  if (!version) throw new RimeFormatError('The dict header has no `version`.', start + 1);

  const columns = declaredColumns ?? [...DEFAULT_RIME_COLUMNS];
  const usePreset = scalars.get('use_preset_vocabulary') ?? 'false';
  if (usePreset !== 'false' && usePreset !== 'true') {
    throw new RimeFormatError(
      `\`use_preset_vocabulary\` must be true or false, found ${JSON.stringify(usePreset)}`,
      start + 1
    );
  }

  // `use_preset_vocabulary` is also implied by declaring a `vocabulary`, matching
  // DictSettings::use_preset_vocabulary, so a header that sets one cannot claim false.
  const header: RimeDictHeader = {
    name,
    version,
    sort: scalars.get('sort') ?? '',
    usePresetVocabulary: usePreset === 'true' || scalars.has('vocabulary'),
    columns,
    preamble,
    entryCount: readEntryCount(preamble),
  };

  const textIndex = getColumnIndex(columns, 'text');
  if (textIndex < 0) {
    throw new RimeFormatError(
      `The dict header declares no \`text\` column, so every row would be dropped.`,
      start + 1
    );
  }

  return {
    header,
    columns: {
      text: textIndex,
      code: getColumnIndex(columns, 'code'),
      comment: getColumnIndex(columns, 'comment'),
      weight: getColumnIndex(columns, 'weight'),
    },
    bodyStartLine: end + 2,
    bodyOffset: bodyOffsetOf(lines, end + 1),
  };
}

/** Finds the entry count the emitter records in its preamble, if it wrote one. */
function readEntryCount(preamble: string[]): number | null {
  for (const line of preamble) {
    const match = ENTRY_COUNT_PATTERN.exec(line.trim());
    if (match) return Number(match[1]);
  }
  return null;
}

/** Sums the length of the first `count` lines plus their newlines. */
function bodyOffsetOf(lines: string[], count: number): number {
  let offset = 0;
  for (let i = 0; i < count && i < lines.length; i += 1) offset += lines[i].length + 1;
  return offset;
}

/**
 * Splits one body row the way `strings::split(line, "\t")` does.
 *
 * `SplitBehavior::KeepToken` is the default, so empty fields survive — which is what lets
 * an entry with no gloss still occupy its `comment` column instead of shifting the weight
 * one place left.
 */
export function splitRimeRow(line: string): string[] {
  return line.split('\t');
}

/**
 * Parses the weight the way `CreateEntry` does.
 *
 * `std::stod` accepts anything a double does, including 0 and negatives, and only an
 * unparseable value is caught and replaced with 0.0 behind a warning. That is the failure
 * worth catching here: a weight librime cannot read is indistinguishable from a weight of
 * zero, so the entry quietly sorts to the bottom of its menu with nothing logged that
 * anyone reads. Whether a *parsed* weight is sensible is a policy question, and the corpus
 * sweep is where that belongs.
 */
function parseWeight(raw: string, line: number): number {
  if (raw === '') {
    throw new RimeFormatError('The weight column is empty; the row would rank last.', line);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new RimeFormatError(`The weight ${JSON.stringify(raw)} is not a number.`, line);
  }
  return value;
}

/** Parses one body line into its resolved columns. */
export function parseRimeRow(line: string, file: RimeDictFile, lineNumber: number): ParsedRimeRow {
  const fields = splitRimeRow(line);
  const { text, code, comment, weight } = file.columns;

  if (fields.length < file.header.columns.length) {
    throw new RimeFormatError(
      `A row has ${fields.length} field(s) but the header declares ` +
        `${file.header.columns.length} column(s): ${JSON.stringify(line)}`,
      lineNumber
    );
  }
  if (fields[text] === '') {
    throw new RimeFormatError('A row has no text; librime would drop it as a warning.', lineNumber);
  }
  if (code >= 0 && fields[code] === '') {
    throw new RimeFormatError(
      `A row has no code: ${JSON.stringify(fields[text])}; librime would try to spell it.`,
      lineNumber
    );
  }
  return {
    line: lineNumber,
    fields,
    text: fields[text],
    code: code >= 0 ? fields[code] : '',
    comment: comment >= 0 ? fields[comment] : '',
    weight: weight >= 0 ? parseWeight(fields[weight], lineNumber) : 0,
  };
}

/**
 * Walks every body row without materializing the file.
 *
 * `text` is the whole 9MB file, but the rows are handed out one at a time so a sweep over
 * 122k of them costs one line of memory rather than 122k strings. Blank lines and `#`
 * comments are skipped exactly as `EntryCollector::Collect` skips them.
 */
export function* iterateRimeRows(text: string, file: RimeDictFile): Generator<ParsedRimeRow> {
  let line = file.bodyStartLine;
  let offset = file.bodyOffset;
  let commentsEnabled = true;

  while (offset < text.length) {
    let end = text.indexOf('\n', offset);
    if (end < 0) end = text.length;
    const raw = text.slice(offset, end);
    const trimmed = raw.replace(/\s+$/, '');
    offset = end + 1;

    if (trimmed === '') continue;
    if (commentsEnabled && trimmed[0] === '#') {
      // `# no comment` is librime's own switch, and honouring it here keeps a body that
      // legitimately contains one from being misread as a comment on every later row.
      // After it, `#` lines are data again — which is why the check is gated on the flag
      // rather than on the character.
      if (trimmed === '# no comment') commentsEnabled = false;
      continue;
    }

    yield parseRimeRow(trimmed, file, line);
    line += 1;
  }
}
