/**
 * Re-export the Rime dictionary emitter from `@pinyinduck/windows`.
 *
 * The macOS package uses the same Rime dictionary format as Windows, since both
 * platforms run the same librime engine (Squirrel on macOS, Weasel on Windows).
 * The emitter is shared to avoid drift between the two platforms.
 */
export {
  RIME_SCRIPTS,
  RIME_COLUMNS,
  RIME_FIELD_SEPARATOR,
  RimeDictWriter,
  formatRow,
  renderDictHeader,
  DATA_CREDIT_LINES,
  renderDataCredit,
  sanitizeField,
  rimeCodes,
  rimeText,
  hskBonus,
  rimeWeight,
  rimeToneMarks,
  rimeComment,
  compareEntriesForMenu,
  rowsForCode,
  type RimeScript,
  type RimeRow,
  type RimeDictMeta,
  type RimeRowSink,
  type RimeCodeRows,
  type CodeEntry,
} from '../../windows/src/rime-dict.js';
