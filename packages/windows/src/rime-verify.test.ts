/**
 * Pins the rules that decide whether a Rime deployment is healthy.
 *
 * These assertions exist because the interesting failures are quiet ones. A smoke test that
 * checks "librime ran and printed something" passes on an empty candidate list; a log scan
 * that matches every occurrence of "failed" flaps on librime's normal deploy chatter. Both
 * of those mistakes look exactly like success, so each rule below is exercised on input
 * that a real librime produced and on the specific way it goes wrong.
 */

import { describe, it, expect } from 'vitest';
import {
  SCHEMA_IDS,
  SMOKE_CASES,
  candidatesByQuery,
  commentByQuery,
  committedByQuery,
  evaluateSmoke,
  findRimeErrors,
  formatSmokeReport,
  parseSmokeOutput,
  preeditByQuery,
  type SmokeCase,
  type SmokeRecord,
  type SmokeReport,
} from './rime-verify';
import { RIME_SCRIPTS } from './rime-dict';

/** Builds harness output the way rime_smoke.cc prints it. */
function smoke(...lines: string[]): string {
  return lines.join('\n') + '\n';
}

/** A case, with the pieces a test does not care about defaulted. */
function testCase(overrides: Partial<SmokeCase> = {}): SmokeCase {
  return {
    query: 'shi4',
    schema: SCHEMA_IDS.simplified,
    expect: ['是', '试'],
    why: 'a test case',
    ...overrides,
  };
}

/** Candidate records for one query, with the comment the test wants. */
function candidates(query: string, texts: string[], comment = ''): SmokeRecord[] {
  return texts.map((text, index) => ({
    kind: 'candidate' as const,
    query,
    index,
    text,
    comment: index === 0 ? comment : '',
  }));
}

/** The two records every healthy run produces. */
function healthy(): SmokeRecord[] {
  return [
    { kind: 'schema-list', ids: [SCHEMA_IDS.simplified, SCHEMA_IDS.traditional] },
    { kind: 'schema', schema: SCHEMA_IDS.simplified, status: 'ok' },
  ];
}

describe('findRimeErrors', () => {
  it('finds the messages that mean a row or a schema was dropped', () => {
    const log = [
      'I20260101 prism.cc:106] found double array image of size 3840.',
      "E20260101 entry_collector.cc:99] dropping entry 'X' with invalid syllable",
      'E20260101 config_compiler.cc:534] unresolved dependency: Include(pinyinduck.schema://)',
      'E20260101 config_component.cc:250] error building config: pinyinduck_trad.schema',
    ].join('\n');
    expect(findRimeErrors(log)).toHaveLength(3);
  });

  it('ignores the INFO and WARNING noise a normal deploy produces', () => {
    // This matters more than it looks: librime logs several lines per dictionary at INFO,
    // and a filter broad enough to catch the failures above would match most of these.
    const log = [
      'I20260101 table.cc:323] num syllables: 1606',
      'I20260101 dictionary.cc:360] loading dictionary \'pinyinduck\'.',
      'W20260101 config_data.cc:69] nonexistent config file \'/x/build/pinyinduck.schema.yaml\'.',
      'W20260101 prism.cc:117] saving prism file',
    ].join('\n');
    expect(findRimeErrors(log)).toEqual([]);
  });

  it('finds a dropped row even when the log line carries a glog prefix', () => {
    expect(
      findRimeErrors(
        "E20260101 140107865476672 entry_collector.cc:99] dropping entry 'X' with invalid syllable"
      )
    ).toHaveLength(1);
  });

  it('trims the lines it reports, so a failure reads cleanly', () => {
    expect(findRimeErrors('   Encode failure   ')).toEqual(['Encode failure']);
  });

  it('catches the specific messages this build is known to produce', () => {
    // Each of these is a line copied out of a real librime 1.13.1 log while diagnosing this
    // package, so a pattern that stops matching one of them fails here rather than silently
    // ceasing to guard the failure it was added for.
    const observed = [
      "E20260101 140107865476672 entry_collector.cc:99] dropping entry 'X' with invalid syllable",
      'E20260101 entry_collector.cc:87] dropping entry with missing entry text',
      'W20260101 prism.cc:117] invalid syllable',
      'E20260101 config_compiler.cc:534] unresolved dependency: Include(pinyinduck.schema://)',
      'E20260101 config_component.cc:250] error building config: pinyinduck_trad.schema',
      'W20260101 dict_compiler.cc:210] resource could not be loaded',
      'W20260101 table.cc:150] Encode failure',
      'W20260101 dict_settings.cc:71] invalid entry definition',
      "W20260101 dict_settings.cc:71] cannot import 'pinyinduck' from itself.",
    ];
    for (const line of observed) {
      expect(findRimeErrors(line), line).toHaveLength(1);
    }
  });
});

describe('parseSmokeOutput', () => {
  it('decodes every record the harness emits', () => {
    const records = parseSmokeOutput(
      smoke(
        'SCHEMA_LIST\tpinyinduck,pinyinduck_trad',
        'SCHEMA\tpinyinduck\tok',
        'PREEDIT\tshi4\tshì',
        'CANDIDATE\tshi4\t0\t是\tshì · to be',
        'QUERY_ERROR\tlv4\tno session'
      )
    );
    expect(records).toEqual([
      { kind: 'schema-list', ids: ['pinyinduck', 'pinyinduck_trad'] },
      { kind: 'schema', schema: 'pinyinduck', status: 'ok' },
      { kind: 'preedit', query: 'shi4', preedit: 'shì' },
      { kind: 'candidate', query: 'shi4', index: 0, text: '是', comment: 'shì · to be' },
      { kind: 'query-error', query: 'lv4', detail: 'no session' },
    ]);
  });

  it('keeps an empty comment as an empty string rather than dropping the field', () => {
    // The gloss gap shows up as exactly this: a candidate line that ends in a tab. Reading
    // it as a missing field would make the gap look like a parse bug instead.
    const [record] = parseSmokeOutput(smoke('CANDIDATE\tshi4\t0\t是\t'));
    expect(record).toEqual({
      kind: 'candidate',
      query: 'shi4',
      index: 0,
      text: '是',
      comment: '',
    });
  });

  it('unescapes a field that contains the separator', () => {
    // The emitter sanitizes fields, so this should never fire — but a field that broke the
    // format would otherwise be indistinguishable from a record boundary.
    const [record] = parseSmokeOutput(smoke('CANDIDATE\tshi4\t0\t是\ta\\tb\\nc\\\\d'));
    expect(record).toMatchObject({ text: '是', comment: 'a\tb\nc\\d' });
  });

  it('reads a SCHEMA line with an unknown status as a failure, not a success', () => {
    const [record] = parseSmokeOutput(smoke('SCHEMA\tpinyinduck\tmaybe'));
    expect(record).toEqual({ kind: 'schema', schema: 'pinyinduck', status: 'fail' });
  });

  it('reports an unreadable record instead of skipping it', () => {
    // A protocol change must surface as a failure, not as a silently shorter candidate
    // list that happens to match a short expectation.
    const records = parseSmokeOutput(smoke('SOMETHING_NEW\tshi4'));
    expect(records).toEqual([
      { kind: 'query-error', query: 'SOMETHING_NEW\tshi4', detail: 'unreadable harness record' },
    ]);
  });

  it('yields nothing for empty output', () => {
    expect(parseSmokeOutput('')).toEqual([]);
    expect(parseSmokeOutput('\n\n')).toEqual([]);
  });

  it('keeps a SCHEMA_DETAIL line for diagnosis', () => {
    const records = parseSmokeOutput(smoke('SCHEMA_DETAIL\tpinyinduck\tcurrent='));
    expect(records[0]).toMatchObject({ kind: 'schema-detail', schema: 'pinyinduck' });
  });

  it('reads a line the harness was killed in the middle of', () => {
    // A deploy that runs out of memory or is interrupted leaves stdout ending mid-record.
    // Every field past the truncation reads as empty, which is the honest reading: the
    // engine said nothing, so the query shows no candidates and fails rather than
    // matching a short expectation on the strength of the fields that did arrive.
    expect(parseSmokeOutput(smoke('CANDIDATE'))).toEqual([
      { kind: 'candidate', query: '', index: Number(undefined), text: '', comment: '' },
    ]);
    expect(parseSmokeOutput(smoke('PREEDIT\tshi4'))).toEqual([
      { kind: 'preedit', query: 'shi4', preedit: '' },
    ]);
    expect(parseSmokeOutput(smoke('QUERY_ERROR\tlv4'))).toEqual([
      { kind: 'query-error', query: 'lv4', detail: '' },
    ]);
    expect(parseSmokeOutput(smoke('SCHEMA\tpinyinduck'))).toEqual([
      { kind: 'schema', schema: 'pinyinduck', status: 'fail' },
    ]);
    expect(parseSmokeOutput(smoke('SCHEMA_DETAIL'))).toEqual([
      { kind: 'schema-detail', schema: '', detail: 'SCHEMA_DETAIL' },
    ]);
    // A schema list truncated before its first id must not become one empty-named schema.
    expect(parseSmokeOutput(smoke('SCHEMA_LIST'))).toEqual([{ kind: 'schema-list', ids: [] }]);
    // A line with no separator at all, which is what a zero-byte write leaves behind.
    expect(parseSmokeOutput(smoke('PREEDIT'))).toEqual([{ kind: 'preedit', query: '', preedit: '' }]);
    expect(parseSmokeOutput(smoke('QUERY_ERROR'))).toEqual([
      { kind: 'query-error', query: '', detail: '' },
    ]);
    expect(parseSmokeOutput(smoke('SCHEMA'))).toEqual([
      { kind: 'schema', schema: '', status: 'fail' },
    ]);
  });

  it('keeps a carriage return, which librime emits for CRLF output', () => {
    // A harness built on Windows writes \r\n. Dropping the \r would leave a stray
    // character at the end of a comment; the escape reader is the one place that has to
    // know about it.
    const [record] = parseSmokeOutput(smoke('CANDIDATE\tshi4\t0\t是\tshì\\r'));
    expect(record).toMatchObject({ comment: 'shì\r' });
  });

  it('drops empty ids from a schema list rather than inventing a blank schema', () => {
    // `a,,b,` from a harness that pads its fields. A blank id would later be looked up in
    // the schema map and, not being there, reported as a missing schema.
    const [record] = parseSmokeOutput(smoke('SCHEMA_LIST\t,pinyinduck,,'));
    expect(record).toEqual({ kind: 'schema-list', ids: ['pinyinduck'] });
  });

  it('leaves a trailing escape as the character that followed it, or nothing', () => {
    // A transcript cut mid-escape loses the character the backslash stood for. Emitting the
    // bare backslash would be a candidate comment containing a character librime never
    // produced; emitting nothing is what the harness said.
    const [record] = parseSmokeOutput(smoke('CANDIDATE\tshi4\t0\t是\tshì\\'));
    expect(record).toMatchObject({ comment: 'shì' });
  });
});

describe('candidatesByQuery', () => {
  it('groups candidates by query in the order they were emitted', () => {
    const byQuery = candidatesByQuery([
      ...candidates('shi4', ['是', '试', '事']),
      ...candidates('lv4', ['绿']),
    ]);
    expect(byQuery.get('shi4')).toEqual(['是', '试', '事']);
    expect(byQuery.get('lv4')).toEqual(['绿']);
  });

  it('has no entry for a query that returned nothing', () => {
    expect(candidatesByQuery(healthy()).has('shi4')).toBe(false);
  });
});

describe('commentByQuery', () => {
  it('takes the comment of the first candidate only', () => {
    const comments = commentByQuery([
      { kind: 'candidate', query: 'shi4', index: 1, text: '试', comment: 'later' },
      { kind: 'candidate', query: 'shi4', index: 0, text: '是', comment: 'to be' },
    ]);
    expect(comments.get('shi4')).toBe('to be');
  });
});

describe('committedByQuery', () => {
  it('takes the committed text per query, ignoring queries that did not commit', () => {
    const committed = committedByQuery([
      { kind: 'candidate', query: 'shi', index: 0, text: '是', comment: '' },
      { kind: 'committed', query: 'shi2', text: '试' },
      { kind: 'committed', query: 'nihao2', text: '你' },
    ]);
    expect(committed.get('shi2')).toBe('试');
    expect(committed.get('nihao2')).toBe('你');
    expect(committed.has('shi')).toBe(false);
  });

  it('takes the first commit when a query committed more than once', () => {
    const committed = committedByQuery([
      { kind: 'committed', query: 'shi2', text: '试' },
      { kind: 'committed', query: 'shi2', text: '是' },
    ]);
    expect(committed.get('shi2')).toBe('试');
  });
});

describe('preeditByQuery', () => {
  it('takes the preedit of the first PREEDIT record per query', () => {
    const preedit = preeditByQuery([
      { kind: 'preedit', query: 'shi', preedit: 'shi' },
      { kind: 'preedit', query: 'shi', preedit: '是' },
      { kind: 'preedit', query: 'an', preedit: 'an' },
    ]);
    expect(preedit.get('shi')).toBe('shi');
    expect(preedit.get('an')).toBe('an');
  });

  it('has no entry for a query that produced no preedit', () => {
    expect(preeditByQuery(healthy()).has('shi')).toBe(false);
  });
});

describe('evaluateSmoke', () => {
  it('passes a healthy run', () => {
    const report = evaluateSmoke(
      [...healthy(), ...candidates('shi4', ['是', '试', '事', '室', '式'])],
      [testCase({ expect: ['是', '试'] })],
      ''
    );
    expect(report.failures).toEqual([]);
    expect(report.observed.shi4).toEqual(['是', '试', '事', '室', '式']);
  });

  it('fails when the harness reported no scheme list', () => {
    const report = evaluateSmoke([], [testCase()], '');
    expect(report.failures[0].message).toMatch(/no scheme list/);
  });

  it('fails when a scheme is missing from the list, naming the patch that adds it', () => {
    // This is what default.custom.yaml failing to apply looks like: F4 never reaches the
    // scheme, and nothing else in the run complains.
    const report = evaluateSmoke(
      [{ kind: 'schema-list', ids: ['luna_pinyin'] }],
      [testCase()],
      ''
    );
    expect(report.failures[0].subject).toBe(SCHEMA_IDS.simplified);
    expect(report.failures[0].message).toMatch(/default\.custom\.yaml did not apply/);
  });

  it('fails when a scheme parses but does not compile', () => {
    const report = evaluateSmoke(
      [
        ...healthy(),
        { kind: 'schema', schema: SCHEMA_IDS.traditional, status: 'fail' },
      ],
      [testCase()],
      ''
    );
    expect(report.failures[0].message).toMatch(/did not compile/);
  });

  it('fails when librime rejected a query outright', () => {
    const report = evaluateSmoke(
      [...healthy(), { kind: 'query-error', query: 'lv4', detail: 'keys not accepted' }],
      [testCase()],
      ''
    );
    expect(report.failures[0].message).toMatch(/rejected the query: keys not accepted/);
  });

  it('fails on an empty candidate list and says what usually causes it', () => {
    // This is the failure the whole harness was built for: the dictionary compiles, the
    // schema loads, and nothing is reachable.
    const report = evaluateSmoke(healthy(), [testCase()], '');
    expect(report.failures[0].message).toMatch(/no candidates at all/);
    expect(report.failures[0].message).toMatch(/speller\/alphabet/);
  });

  it('fails on a reordered menu and points at the position that moved', () => {
    const report = evaluateSmoke(
      [...healthy(), ...candidates('shi4', ['试', '是'])],
      [testCase({ expect: ['是', '试'] })],
      ''
    );
    expect(report.failures[0].message).toMatch(/position 1/);
    expect(report.failures[0].message).toMatch(/expected \[是, 试\] but got \[试, 是\]/);
  });

  it('does not fail for candidates beyond the ones pinned', () => {
    const report = evaluateSmoke(
      [...healthy(), ...candidates('shi4', ['是', '试', '事'])],
      [testCase({ expect: ['是', '试'] })],
      ''
    );
    expect(report.failures).toEqual([]);
  });

  it('fails when a pinned comment fragment is missing', () => {
    const report = evaluateSmoke(
      [...healthy(), ...candidates('shi4', ['是', '试'], '')],
      [testCase({ expectComment: ['to be'] })],
      ''
    );
    expect(report.failures[0].message).toMatch(/does not contain "to be"/);
  });

  it('passes when the committed text is the one pinned', () => {
    const report = evaluateSmoke(
      [...healthy(), { kind: 'committed', query: 'shi2', text: '试' }, ...candidates('shi2', ['是', '试'])],
      [testCase({ query: 'shi2', expect: ['是', '试'], expectCommit: '试' })],
      ''
    );
    expect(report.failures).toEqual([]);
  });

  it('fails when the committed text is not the one pinned', () => {
    const report = evaluateSmoke(
      [...healthy(), { kind: 'committed', query: 'shi2', text: '是' }, ...candidates('shi2', ['是', '试'])],
      [testCase({ query: 'shi2', expect: ['是', '试'], expectCommit: '试' })],
      ''
    );
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0].message).toMatch(/committed "是".*"试"/);
  });

  it('fails when a case pins a commit but the query didn\'t commit', () => {
    const report = evaluateSmoke(
      [...healthy(), ...candidates('shi', ['是', '试'])],
      [testCase({ query: 'shi', expect: ['是', '试'], expectCommit: '试' })],
      ''
    );
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0].message).toMatch(/committed null/);
  });

  it('passes when the preedit is the one pinned', () => {
    const report = evaluateSmoke(
      [...healthy(), { kind: 'preedit', query: 'nihao2', preedit: '你hao' }],
      [testCase({ query: 'nihao2', expect: undefined, expectPreedit: '你hao' })],
      ''
    );
    expect(report.failures).toEqual([]);
  });

  it('fails when the preedit is not the one pinned', () => {
    const report = evaluateSmoke(
      [...healthy(), { kind: 'preedit', query: 'nihao2', preedit: 'nihao' }],
      [testCase({ query: 'nihao2', expect: undefined, expectPreedit: '你hao' })],
      ''
    );
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0].message).toMatch(/ended on the preedit "nihao".*"你hao"/);
  });

  it('fails on a librime log line, naming the line', () => {
    const report = evaluateSmoke(
      [...healthy(), ...candidates('shi4', ['是', '试'])],
      [testCase({ expect: ['是', '试'] })],
      "E20260101 entry_collector.cc:99] dropping entry 'X' with invalid syllable"
    );
    expect(report.failures[0].subject).toBe('librime log');
  });

  it('reports a known gap as a gap rather than a failure', () => {
    const report = evaluateSmoke(
      [...healthy(), ...candidates('shi4', ['是', '试'], '')],
      [testCase({ expect: ['是', '试'], expectComment: ['to be'], knownGap: 'no gloss column' })],
      ''
    );
    expect(report.failures).toEqual([]);
    expect(report.gaps).toHaveLength(1);
    expect(report.gaps[0].message).toMatch(/Known gap: no gloss column/);
  });

  it('reports a known gap whose assertion now passes, so it can be retired', () => {
    const report = evaluateSmoke(
      [...healthy(), ...candidates('shi4', ['是', '试'], 'shì · to be')],
      [testCase({ expect: ['是', '试'], expectComment: ['to be'], knownGap: 'no gloss column' })],
      ''
    );
    expect(report.gaps).toEqual([]);
    expect(report.closed).toEqual([`${SCHEMA_IDS.simplified} / shi4`]);
  });

  it('keeps a known gap from hiding a regression in another case on the same query', () => {
    // The gloss case and the ordering case share the query `shi4` on purpose. If the gap
    // swallowed the whole query, an ordering regression would go unnoticed behind it.
    const report = evaluateSmoke(
      [...healthy(), ...candidates('shi4', ['试', '是'], '')],
      [
        testCase({ expect: ['是', '试'] }),
        testCase({ expect: ['是'], expectComment: ['to be'], knownGap: 'no gloss column' }),
      ],
      ''
    );
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0].message).toMatch(/position 1/);
    expect(report.gaps).toHaveLength(1);
  });

  it('does not let a librime log failure be excused by a known gap', () => {
    const report = evaluateSmoke(
      [...healthy(), ...candidates('shi4', ['是'], '')],
      [testCase({ expect: ['是'], knownGap: 'no gloss column' })],
      'E error building config: pinyinduck_trad.schema'
    );
    expect(report.failures[0].subject).toBe('librime log');
  });
});

describe('formatSmokeReport', () => {
  it('shows what was typed even when everything passed', () => {
    const report = evaluateSmoke(
      [...healthy(), ...candidates('shi4', ['是', '试', '事'])],
      [testCase()],
      ''
    );
    const text = formatSmokeReport(report, [testCase()]);
    expect(text).toContain('是 试 事');
    expect(text).toContain('1 of 1 queries behaved as pinned');
  });

  it('says (no candidates) rather than printing nothing', () => {
    const report = evaluateSmoke(healthy(), [testCase()], '');
    expect(formatSmokeReport(report, [testCase()])).toContain('(no candidates)');
  });

  it('handles a case the run never reached', () => {
    // `evaluateSmoke` records every case it judges, so a case with no entry at all means
    // the formatter was handed a report from somewhere else — a resumed run, or a case
    // added between the query list and the transcript. It must print the query rather
    // than throw, because the report's whole job is to show what was and was not tried.
    const report: SmokeReport = { failures: [], gaps: [], closed: [], observed: {} };
    const text = formatSmokeReport(report, [testCase({ query: 'lv4' })]);
    expect(text).toContain('lv4');
    expect(text).toContain('(no candidates)');
  });

  it('lists the problems and the known gaps separately', () => {
    const cases = [
      testCase({ query: 'lv4', expect: ['绿'] }),
      testCase({ expectComment: ['to be'], knownGap: 'no gloss column' }),
    ];
    const report = evaluateSmoke([...healthy(), ...candidates('lv4', [])], cases, '');
    const text = formatSmokeReport(report, cases);
    expect(text).toMatch(/1 problem\(s\):/);
    expect(text).toMatch(/1 known gap\(s\)/);
    expect(text).toContain('[known gap]');
  });

  it('nudges when a known gap has been closed', () => {
    const report = evaluateSmoke(
      [...healthy(), ...candidates('shi4', ['是', '试'], 'shì · to be')],
      [testCase({ expect: ['是', '试'], expectComment: ['to be'], knownGap: 'no gloss column' })],
      ''
    );
    expect(formatSmokeReport(report, [testCase()])).toMatch(/Remove its knownGap/);
  });
});

describe('SMOKE_CASES', () => {
  it('uses the scheme ids the generator writes dictionaries for', () => {
    // Keeping the ids in one place and asserting them against DICT_NAMES is what stops the
    // expectations from quietly testing a scheme that no longer exists.
    for (const script of RIME_SCRIPTS) {
      expect(Object.values(SCHEMA_IDS)).toContain(SCHEMA_IDS[script]);
    }
  });

  it('pins at least one case per scheme, so neither goes unverified', () => {
    for (const schema of Object.values(SCHEMA_IDS)) {
      expect(SMOKE_CASES.some((c) => c.schema === schema)).toBe(true);
    }
  });

  it('gives every case a reason and something to pin', () => {
    for (const testCase of SMOKE_CASES) {
      expect(testCase.why.length).toBeGreaterThan(20);
      // A case pins the candidate order, the committed text, or the resulting preedit.
      const pinsOrder = (testCase.expect?.length ?? 0) >= 2;
      const pinsCommit = testCase.expectCommit !== undefined;
      const pinsPreedit = testCase.expectPreedit !== undefined;
      expect(pinsOrder || pinsCommit || pinsPreedit, `${testCase.query} pins nothing`).toBe(true);
    }
  });

  it('types every query toneless, with a selector digit only where a case commits', () => {
    // The codes carry no tone digits and the alphabet has none either, so a query is the
    // plain spelling, optionally followed by one digit that selects a candidate. A query
    // with an internal digit would be spelling a tone the dictionary cannot match.
    for (const testCase of SMOKE_CASES) {
      expect(testCase.query, `${testCase.query} has an internal digit`).toMatch(/^[a-zü]+[0-9]?$/);
      if (testCase.expectCommit !== undefined) {
        expect(testCase.query, `${testCase.query} must end in the selector digit`).toMatch(/[0-9]$/);
      }
    }
  });

  it('delivers the gloss now that the Lua filter reads the sidecar', () => {
    // The gloss was the last known gap: librime has no definition field, so the comment
    // fell back to echoing the code. The Lua filter closes it, so no case is gapped and at
    // least one pins the definition.
    const gapped = SMOKE_CASES.filter((c) => c.knownGap);
    expect(gapped).toEqual([]);
    expect(SMOKE_CASES.some((c) => c.expectComment && !c.knownGap)).toBe(true);
  });
});
