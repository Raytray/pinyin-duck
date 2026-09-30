/**
 * Reads what `tools/rime_smoke.cc` reports and decides whether it is healthy.
 *
 * The harness itself only runs librime and prints records; everything about deciding
 * whether those records are *right* lives here, in pure functions, so the rules can be
 * tested without a C++ toolchain and so a failure produces a message that says which
 * promise broke rather than just a non-zero exit.
 *
 * This is the only place in the project that knows what a healthy Rime deployment looks
 * like, which is why the expectations are written out longhand with the reason each one
 * exists. The alternative — asserting that "something was returned" — would pass just as
 * happily on an empty candidate list, which is exactly the failure it was built to catch.
 */

/** The scheme ids, matching `rime/*.schema.yaml`. Kept as literals so this module has no
 * dependency on the generator; `verify-rime.test.ts` asserts they stay in step. */
export const SCHEMA_IDS = {
  simplified: 'pinyinduck',
  traditional: 'pinyinduck_trad',
} as const;

/** One line of harness output, decoded. */
export type SmokeRecord =
  | { kind: 'schema-list'; ids: string[] }
  | { kind: 'schema'; schema: string; status: 'ok' | 'fail' }
  | { kind: 'preedit'; query: string; preedit: string }
  | { kind: 'candidate'; query: string; index: number; text: string; comment: string }
  | { kind: 'query-error'; query: string; detail: string }
  | { kind: 'schema-detail'; schema: string; detail: string };

/** A query whose candidate list is pinned, with the reason it is in the list. */
export interface SmokeCase {
  query: string;
  /** Which scheme the query was typed into. */
  schema: string;
  /**
   * The candidates the list must start with, in order.
   *
   * Short is deliberate. The point is to pin the top of the menu, which is what a learner
   * acts on; pinning all nine candidates Weasel shows would turn a frequency reordering
   * into a test failure without telling anyone anything a top-five pin would not.
   */
  expect: string[];
  /** Fragments the first candidate's comment must contain. */
  expectComment?: string[];
  /**
   * A promise this deployment cannot keep yet, and why.
   *
   * A case with a known gap still runs. If it fails, that is reported as a gap rather than
   * a failure, so the suite stays green and the shortfall is written down next to the
   * assertion that would catch it — instead of living only in a README, where it quietly
   * becomes a design decision nobody remembers making. If a gapped case ever *passes*, that
   * is reported too, so the gap gets retired rather than lingering.
   */
  knownGap?: string;
  /** What this case is here to catch. */
  why: string;
}

/** One thing that is wrong, phrased as what broke. */
export interface SmokeFailure {
  /** The query or record the failure is about. */
  subject: string;
  message: string;
}

export interface SmokeReport {
  failures: SmokeFailure[];
  /** Promises known not to be kept, with what actually happened. */
  gaps: SmokeFailure[];
  /** Known gaps whose assertion now passes, so the gap can be retired. */
  closed: string[];
  /** Candidates per query, so a passing run still shows what was actually typed. */
  observed: Record<string, string[]>;
}

/**
 * The queries to type, and what each one is here to catch.
 *
 * Every expectation in this table was read out of a real librime 1.13.1 run and then
 * checked against the ranking the shared engine produces for the same reading, so a
 * divergence means the two clients disagree rather than that a number was typed in wrong.
 *
 * Note that every query spells out its tone digits. That is not a stylistic choice: the
 * generated dictionary's codes carry them, and a code is unreachable unless every character
 * in it is in `speller/alphabet`. It is the sharpest remaining usability cost of the design.
 */
export const SMOKE_CASES: SmokeCase[] = [
  {
    query: 'shi4',
    schema: SCHEMA_IDS.simplified,
    expect: ['是', '试', '事', '室', '式'],
    why: 'the candidate list the README leads with, in the order corpus frequency implies',
  },
  {
    query: 'an1',
    schema: SCHEMA_IDS.simplified,
    expect: ['安', '氨', '鞍', '媕', '庵'],
    why: '安 must outrank the astral-plane CC-CEDICT characters that share an1; before the ' +
      'code-point counting fix, 𩽾 was offered first because String.length called it two characters',
  },
  {
    query: 'lv4',
    schema: SCHEMA_IDS.simplified,
    expect: ['绿', '律', '率', '氯', '卛'],
    why: 'proves speller/algebra xlit/ü/v/ points the right way: a learner types v, the ' +
      'engine finds the lü4 code, and nothing reaches for OpenCC to convert it',
  },
  {
    query: 'nv3',
    schema: SCHEMA_IDS.simplified,
    expect: ['女', '籹', '钕'],
    why: 'nüe spelled nv, the other half of the same xlit rule',
  },
  {
    query: 'ni3hao3',
    schema: SCHEMA_IDS.simplified,
    expect: ['你好', '你', '祢', '拟', '伱'],
    why: 'a two-syllable code with the delimiter omitted, which is how a learner types it; ' +
      'if the emitter ever emitted syllables in the wrong order this is what catches it',
  },
  {
    query: 'shi4',
    schema: SCHEMA_IDS.simplified,
    expect: ['是', '试'],
    expectComment: ['to be'],
    knownGap:
      'librime has no field for a definition. RawDictEntry is text/code/weight and ' +
      'EntryCollector never reads a comment column, at any version including master, so ' +
      'the emitted gloss column is discarded at compile time and always_show_comments ' +
      'falls back to echoing the code. Delivering the gloss needs a decision, not a tweak.',
    why: 'the English definition is the product, and it is the one thing Rime cannot show',
  },
  {
    query: 'zhong1guo2',
    schema: SCHEMA_IDS.traditional,
    expect: ['中國', '鍾', '中', '終', '忠'],
    why: 'proves the traditional dictionary and the __include of the simplified schema; ' +
      'before the include was fixed to filename:/, this scheme failed to build entirely',
  },
];

/**
 * Log lines that mean a dictionary row or a schema was rejected.
 *
 * Deliberately narrow. librime logs plenty at INFO and WARNING during a normal deploy, and
 * a filter broad enough to catch every "failed" would make the check flap. These are the
 * messages that correspond to a real, silent loss of candidates.
 */
export const RIME_ERROR_PATTERNS: readonly RegExp[] = [
  /dropping entry/,
  /invalid syllable/,
  /Missing entry text/,
  /Encode failure/,
  /error building config/,
  /unresolved dependency/,
  /resource could not be loaded/,
  /invalid entry definition/,
  /cannot import/,
];

/** Finds the lines in librime's log that mean something was dropped or failed to build. */
export function findRimeErrors(stderr: string): string[] {
  return stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => RIME_ERROR_PATTERNS.some((pattern) => pattern.test(line)));
}

/** Reverses the escaping `rime_smoke.cc` applies to each field. */
function unescapeField(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] !== '\\') {
      out += value[i];
      continue;
    }
    const next = value[i + 1];
    i += 1;
    if (next === 't') out += '\t';
    else if (next === 'n') out += '\n';
    else if (next === 'r') out += '\r';
    else if (next === '\\') out += '\\';
    else out += next ?? '';
  }
  return out;
}

/**
 * Decodes the harness's tab-separated output.
 *
 * A line that cannot be understood becomes a `query-error` rather than being dropped, so a
 * change to the harness's protocol shows up as a failure instead of as a silently shorter
 * candidate list.
 */
export function parseSmokeOutput(stdout: string): SmokeRecord[] {
  const records: SmokeRecord[] = [];

  for (const line of stdout.split('\n')) {
    if (line === '') continue;
    const fields = line.split('\t').map(unescapeField);

    switch (fields[0]) {
      case 'SCHEMA_LIST':
        records.push({
          kind: 'schema-list',
          ids: (fields[1] ?? '').split(',').filter((id) => id !== ''),
        });
        break;
      case 'SCHEMA':
        records.push({
          kind: 'schema',
          schema: fields[1] ?? '',
          status: fields[2] === 'ok' ? 'ok' : 'fail',
        });
        break;
      case 'SCHEMA_DETAIL':
        records.push({ kind: 'schema-detail', schema: fields[1] ?? '', detail: line });
        break;
      case 'PREEDIT':
        records.push({ kind: 'preedit', query: fields[1] ?? '', preedit: fields[2] ?? '' });
        break;
      case 'CANDIDATE':
        records.push({
          kind: 'candidate',
          query: fields[1] ?? '',
          index: Number(fields[2]),
          text: fields[3] ?? '',
          comment: fields[4] ?? '',
        });
        break;
      case 'QUERY_ERROR':
        records.push({ kind: 'query-error', query: fields[1] ?? '', detail: fields[2] ?? '' });
        break;
      default:
        records.push({ kind: 'query-error', query: line, detail: 'unreadable harness record' });
    }
  }

  return records;
}

/** Groups the candidate records by query, in the order the harness emitted them. */
export function candidatesByQuery(records: SmokeRecord[]): Map<string, string[]> {
  const byQuery = new Map<string, string[]>();
  for (const record of records) {
    if (record.kind !== 'candidate') continue;
    const list = byQuery.get(record.query);
    if (list) list.push(record.text);
    else byQuery.set(record.query, [record.text]);
  }
  return byQuery;
}

/** The comment the first candidate carried, keyed by query. */
export function commentByQuery(records: SmokeRecord[]): Map<string, string> {
  const byQuery = new Map<string, string>();
  for (const record of records) {
    if (record.kind === 'candidate' && record.index === 0 && !byQuery.has(record.query)) {
      byQuery.set(record.query, record.comment);
    }
  }
  return byQuery;
}

/** Element-wise comparison, so a one-character diff reports which position moved. */
function listMismatch(want: string[], got: string[]): string | null {
  for (let i = 0; i < want.length; i += 1) {
    if (want[i] !== got[i]) {
      return `expected [${want.join(', ')}] but got [${got.join(', ')}] (position ${i + 1})`;
    }
  }
  return null;
}

/**
 * Checks the records against the cases.
 *
 * Beyond the individual cases, three whole-deployment properties are asserted, because each
 * is a way for everything to be broken while every individual query still looks plausible:
 * both schemes must appear in the scheme list (that is `default.custom.yaml` applying), each
 * scheme must be selectable, and no query may have been rejected outright.
 */
export function evaluateSmoke(
  records: SmokeRecord[],
  cases: SmokeCase[],
  stderr: string
): SmokeReport {
  const failures: SmokeFailure[] = [];
  const gaps: SmokeFailure[] = [];
  const closed: string[] = [];
  const observed: Record<string, string[]> = {};

  const requiredSchemas = [...new Set(cases.map((c) => c.schema))];
  const listed = records.find(
    (r): r is Extract<SmokeRecord, { kind: 'schema-list' }> => r.kind === 'schema-list'
  );

  if (!listed) {
    failures.push({
      subject: 'scheme list',
      message: 'The harness reported no scheme list at all.',
    });
  } else {
    for (const schema of requiredSchemas) {
      if (!listed.ids.includes(schema)) {
        failures.push({
          subject: schema,
          message:
            `${schema} is missing from the scheme list (${listed.ids.join(', ')}). ` +
            'rime/default.custom.yaml did not apply, so F4 would never reach it.',
        });
      }
    }
  }

  for (const record of records) {
    if (record.kind === 'schema' && record.status === 'fail') {
      failures.push({
        subject: record.schema,
        message:
          `librime could not select ${record.schema}. It parsed but did not compile, so ` +
          'Weasel would fall back to whatever scheme is first in the list.',
      });
    }
    if (record.kind === 'query-error') {
      failures.push({
        subject: record.query,
        message: `librime rejected the query: ${record.detail}`,
      });
    }
  }

  const byQuery = candidatesByQuery(records);
  const comments = commentByQuery(records);
  for (const testCase of cases) {
    const actual = byQuery.get(testCase.query) ?? [];
    observed[testCase.query] = actual;

    // Each case is judged entirely on its own merits, which is why the gloss case below
    // is a separate entry that reuses the `shi4` query: the ungated `shi4` case still
    // pins the candidate order, so a known gap on the comment column cannot be the reason
    // an ordering regression stays green.
    const problems: SmokeFailure[] = [];
    const subject = `${testCase.schema} / ${testCase.query}`;

    if (actual.length === 0) {
      problems.push({
        subject,
        message:
          `${testCase.query} produced no candidates at all — ${testCase.why}. An empty ` +
          'list usually means nothing in the dictionary is reachable: check the code ' +
          'format against speller/alphabet.',
      });
    } else {
      const mismatch = listMismatch(testCase.expect, actual.slice(0, testCase.expect.length));
      if (mismatch) problems.push({ subject, message: `${mismatch} — ${testCase.why}` });
    }

    for (const fragment of testCase.expectComment ?? []) {
      const comment = comments.get(testCase.query) ?? '';
      if (!comment.includes(fragment)) {
        problems.push({
          subject,
          message:
            `the first candidate's comment ${JSON.stringify(comment)} does not contain ` +
            `${JSON.stringify(fragment)} — ${testCase.why}`,
        });
      }
    }

    if (problems.length === 0) {
      if (testCase.knownGap) closed.push(subject);
      continue;
    }
    if (testCase.knownGap) {
      gaps.push({
        subject,
        message: `${problems.map((p) => p.message).join(' ')}\n      Known gap: ${testCase.knownGap}`,
      });
      continue;
    }
    failures.push(...problems);
  }

  for (const line of findRimeErrors(stderr)) {
    failures.push({ subject: 'librime log', message: line });
  }

  return { failures, gaps, closed, observed };
}

/** Formats a report for a terminal, listing what broke and what was actually typed. */
export function formatSmokeReport(report: SmokeReport, cases: SmokeCase[]): string {
  const lines: string[] = [];

  lines.push('  typed into librime');
  for (const testCase of cases) {
    const found = report.observed[testCase.query] ?? [];
    const shown = found.length > 0 ? found.slice(0, 5).join(' ') : '(no candidates)';
    lines.push(
      `    ${testCase.schema.padEnd(16)} ${testCase.query.padEnd(12)} ${shown}${
        testCase.knownGap ? '   [known gap]' : ''
      }`
    );
  }

  if (report.failures.length === 0) {
    const held = cases.length - report.gaps.length;
    lines.push('');
    lines.push(`  ${held} of ${cases.length} queries behaved as pinned.`);
  } else {
    lines.push('');
    lines.push(`  ${report.failures.length} problem(s):`);
    for (const failure of report.failures) {
      lines.push(`    [${failure.subject}]`);
      lines.push(`      ${failure.message}`);
    }
  }

  if (report.gaps.length > 0) {
    lines.push('');
    lines.push(`  ${report.gaps.length} known gap(s) — promises this build does not keep:`);
    for (const gap of report.gaps) {
      lines.push(`    [${gap.subject}]`);
      lines.push(`      ${gap.message}`);
    }
  }

  for (const subject of report.closed) {
    lines.push('');
    lines.push(`  [${subject}] now passes. Remove its knownGap to record the fix.`);
  }

  return lines.join('\n');
}
