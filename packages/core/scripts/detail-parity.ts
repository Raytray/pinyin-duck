/**
 * The Candidate detail golden, `detail-parity.tsv`, that pins the Kotlin detail view to this
 * one (written by `generate-android-parity.ts`).
 *
 * It holds the detail view for every entry the engine parity cases reach, in both scripts,
 * and for every grouped candidate they reach (后 hòu standing for 後 and 后), in simplified
 * script, the only one such a candidate appears in.
 *
 * A record starts with a ">" line naming the subject: simplified, traditional, tone-numbered
 * reading, script and number of entries, tab-separated. That is the B+ tree row with those
 * forms, reading and entry count (an entry inside a group is its traditional-only row). Then:
 *
 *   counterpart <hanzi>          when the view shows one
 *   group [<heading>]            one per group, with its heading when grouped
 *   pos <labels>                 the group's part-of-speech line, when it has one
 *   tag <text>                   each tag
 *   sense|proper <n> <text>      each sense; "proper" marks a proper noun sense
 *   mw <text>                    each measure word
 *
 * and a blank line. Records are sorted by their ">" line, so a ranking change does not
 * reorder the file.
 */

import type { LazyPinyinSearchEngine } from '../src/index/lazy-search.js';
import type { DetailFile } from '../src/detail/detail-codec.js';
import { candidateDetail, type DetailSubject, type DetailView } from '../src/detail/detail-view.js';
import type { ScriptType } from '../src/types.js';
import type { ParityCase } from './parity-cases.js';

interface Subject extends DetailSubject {
  pinyinNumbers: string;
  script: ScriptType;
}

function header(subject: Subject): string {
  const { simplified, traditional, pinyinNumbers, script, entryIds } = subject;
  return `>${simplified}\t${traditional}\t${pinyinNumbers}\t${script}\t${entryIds.length}`;
}

function viewLines(view: DetailView): string[] {
  const lines: string[] = [];
  if (view.counterpart !== undefined) lines.push(`counterpart\t${view.counterpart}`);
  for (const group of view.groups) {
    lines.push(group.heading !== undefined ? `group\t${group.heading}` : 'group');
    if (group.partOfSpeech !== undefined) lines.push(`pos\t${group.partOfSpeech}`);
    for (const tag of group.tags) lines.push(`tag\t${tag}`);
    for (const sense of group.senses) lines.push(`${sense.proper ? 'proper' : 'sense'}\t${sense.number}\t${sense.text}`);
    for (const measureWord of group.measureWords) lines.push(`mw\t${measureWord}`);
  }
  return lines;
}

/** The golden's records for what `cases` reach in their top `depth` candidates. */
export function detailParityLines(
  engine: LazyPinyinSearchEngine,
  detail: DetailFile,
  cases: readonly ParityCase[],
  depth: number
): string[] {
  const subjects = new Map<string, Subject>();
  const add = (subject: Subject) => subjects.set(header(subject), subject);

  for (const testCase of cases) {
    const { candidates } = engine.search(testCase.query, { script: testCase.script, limit: depth });
    for (const candidate of candidates) {
      const { simplified, traditional, pinyinNumbers, entryIds } = candidate;
      if (entryIds.length > 1) add({ simplified, traditional, pinyinNumbers, entryIds, script: 'simplified' });
      for (const id of entryIds) {
        // An entry inside a group is headed by its own traditional form.
        const own = entryIds.length > 1 ? detail.record(id).heading : traditional;
        for (const script of ['simplified', 'traditional'] as const) {
          add({ simplified, traditional: own, pinyinNumbers, entryIds: [id], script });
        }
      }
    }
  }

  const lines: string[] = [];
  for (const key of [...subjects.keys()].sort()) {
    const subject = subjects.get(key)!;
    lines.push(key, ...viewLines(candidateDetail(subject, subject.script, detail)), '');
  }
  return lines;
}
