/**
 * Corpus-wide regression sweep over the generated dictionaries.
 *
 * The unit tests in `src/rime-dict.test.ts` run on small fixtures, so nothing there
 * notices an invariant that only breaks at 122,000 rows: one home-group of a code emitted
 * after its higher-weight sibling, one duplicate slipping through because a code spans two
 * B-tree key blocks, one gloss that grew a tab. Each of those still produces a file Weasel
 * compiles, and each changes what a learner sees.
 *
 * So this reads the built files back — through `src/rime-format.ts`, which parses them the
 * way librime does rather than reusing the emitter's own idea of the layout — and checks
 * the properties that have to hold at full scale. It also re-runs the build and compares
 * byte for byte, which is what catches a hand-edited dictionary or a stale artifact.
 *
 * Every platform's files are generated and gitignored, so a fresh clone skips this file.
 * Run `npm run build:rime` first.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { RIME_COLUMNS, RIME_SCRIPTS, type RimeScript } from '../src/rime-dict';
import { iterateRimeRows, parseDictHeader } from '../src/rime-format';
import { TEMPLATE_FILES, renderTemplate, RIME_PLATFORMS } from '../src/rime-platform';
import {
  DICT_NAMES,
  DICT_VERSION,
  buildRimeDictionaries,
  platformRimeDir,
  type RimeBuildDeps,
} from './build-rime-dict';

/**
 * The sweep reads the Windows copy. The macOS copy is built from the same asset by the same
 * code, so it is only compared against this one byte for byte, below.
 */
const RIME_DIR = platformRimeDir('windows');
const BTREE = path.resolve(__dirname, '../../web/public/dictionary.btree');

/** A row that must be in the file exactly as written, with the reason it matters. */
interface SpotCheck {
  script: RimeScript;
  text: string;
  code: string;
  comment: string;
  weight: number;
  why: string;
}

/**
 * Rows worth pinning by exact value.
 *
 * Each one is here because it is something that would pass a unit test and still be wrong
 * on a user's desktop: the two `绿` rows share a weight and differ only in code, `an1` is
 * where the astral-plane length bug used to surface, and `lu4` versus `lü4` is the pair
 * that makes the `xlit/ü/v/` rule necessary.
 */
const SPOT_CHECKS: SpotCheck[] = [
  {
    script: 'simplified',
    text: '你好',
    code: 'ni hao',
    comment: 'nǐ hǎo · hello; hi',
    weight: 44262,
    why: 'the flagship entry, and a two-syllable code with a space in it',
  },
  {
    script: 'simplified',
    text: '是',
    code: 'shi',
    comment: 'shì · to be (followed by substantives only) / correct; right; true / (…',
    weight: 48865,
    why: 'the candidate the README leads with',
  },
  {
    script: 'simplified',
    text: '中国',
    code: 'zhong guo',
    comment: 'zhōng guó · China',
    weight: 41694,
    why: 'tone marks in the gloss, with both syllables marked',
  },
  {
    script: 'simplified',
    text: '安',
    code: 'an',
    comment: 'ān · (bound form) calm; peaceful / to calm; to set at ease / safe; se…',
    weight: 20978,
    why: 'must outrank the 205 astral-plane CC-CEDICT characters sharing an; surname weight reduced 10x to deprioritize vs regular vocab',
  },
  {
    script: 'simplified',
    text: '𩽾',
    code: 'an',
    comment: 'ān · used in 鮟鱇|𩽾𩾌 / Taiwan pr.',
    weight: 0,
    why: 'a zero weight is legal but sorts last, which is what the astral fix relies on',
  },
  {
    script: 'simplified',
    text: '绿',
    code: 'lü',
    comment: "lǜ · green / (slang) (derived from 綠帽子|绿帽子) to cheat on (one's spouse…",
    weight: 8772,
    why: 'the ü the schema xlit rule exists to let a user type as v',
  },
  {
    script: 'simplified',
    text: '绿',
    code: 'lu',
    comment: 'lù · used in names',
    weight: 8772,
    why: 'the same word read lu, which is why lü needs no OpenCC conversion at runtime',
  },
  {
    script: 'traditional',
    text: '中國',
    code: 'zhong guo',
    comment: 'zhōng guó · China',
    weight: 41694,
    why: 'the traditional script comes from CC-CEDICT, not from a conversion step',
  },
  {
    script: 'traditional',
    text: '後',
    code: 'hou',
    comment: 'hòu · back / behind / rear',
    weight: 43992,
    why: 'keyed by simplified form, the build used to drop 後 hòu for 后 hòu "empress" (ADR 0001)',
  },
  {
    script: 'traditional',
    text: '后',
    code: 'hou',
    comment: 'hòu · empress / queen / (archaic) monarch',
    weight: 43992,
    why: 'its own headword, so it keeps its own gloss beside 後',
  },
  {
    script: 'simplified',
    text: '后',
    code: 'hou',
    comment: 'hòu · back / empress',
    weight: 43992,
    why: 'one candidate standing for 後 and 后, glossed with the first sense of each',
  },
  {
    script: 'simplified',
    text: '书',
    code: 'shu',
    comment: 'shū · book / letter / document',
    weight: 41698,
    why: 'glossed from the common line; the proper-noun line used to win with "abbr. for 书经"',
  },
];

/** Every code that has to be typeable, with one entry to look for. */
const REQUIRED_CODES: Array<[code: string, text: string]> = [
  ['ni', '你'],
  ['shi', '是'],
  ['zhong guo', '中国'],
  ['an', '安'],
  ['lü', '绿'],
  // Spelled with ü, not v. The schema's `xlit/ü/v/` is what lets a user *type* it as `nv`;
  // the dictionary itself never contains a `v`, which is why OpenCC is not involved.
  ['nü', '女'],
  // 想 and 的 are the most common word and the most common grammatical particle. Both are
  // spelled the only way a user can type them now that the codes are toneless — see
  // SMOKE_CASES for why the digits are out of speller/alphabet.
  ['xiang', '想'],
  ['de', '的'],
];

/** What one pass over a dictionary established. */
interface CorpusFacts {
  rows: number;
  /** Per code: the last weight seen, and every text filed under it. */
  codes: Map<string, { weight: number; texts: Set<string> }>;
  textsWithWhitespace: string[];
  duplicateKeys: string[];
  orderViolations: string[];
  negativeWeights: string[];
  byKey: Map<string, { comment: string; weight: number }>;
}

/**
 * Reads a dictionary back and collects everything the assertions below need.
 *
 * Rows are checked as they stream past rather than collected: the file is 9MB, and holding
 * 122k parsed rows to assert on afterwards would cost far more than the parse.
 */
function sweep(text: string): CorpusFacts {
  const file = parseDictHeader(text);
  const codes = new Map<
    string,
    { weight: number; texts: Set<string>; runWeight: number | null }
  >();
  const seen = new Set<string>();
  const textsWithWhitespace: string[] = [];
  const duplicateKeys: string[] = [];
  const orderViolations: string[] = [];
  const negativeWeights: string[] = [];
  /** The code of the previous row, which is what makes a run detectable. */
  let previousCode: string | null = null;
  const byKey = new Map<string, { comment: string; weight: number }>();
  let rows = 0;

  for (const row of iterateRimeRows(text, file)) {
    rows += 1;
    const key = `${row.code} ${row.text}`;

    // librime compiles a duplicate and logs a warning while dropping it, so one surviving
    // means the emitter's dedup is scoped too narrowly to cover every case.
    if (seen.has(key)) duplicateKeys.push(`line ${row.line}: ${key}`);
    seen.add(key);
    byKey.set(key, { comment: row.comment, weight: row.weight });

    // `sanitizeField` collapses whitespace rather than removing it, so a word that ever
    // acquires a space is legal to the build and wrong in a candidate list.
    if (/\s/.test(row.text)) textsWithWhitespace.push(`line ${row.line}: ${row.text}`);

    // `rimeWeight` clamps at zero, so this should be unreachable. It is asserted anyway:
    // librime turns a non-positive weight into log(DBL_EPSILON) ≈ -36, which demotes the row
    // below every other candidate in its menu without logging anything, and a clamp that is
    // never questioned is a clamp that hides the data fault that caused it.
    if (row.weight < 0) negativeWeights.push(`line ${row.line}: ${row.text} (${row.weight})`);

    // A *run* is a maximal stretch of consecutive rows sharing a code. Only within a run is
    // the file ordered, and that is all that is required: librime calls
    // Vocabulary::SortHomophones at compile time, which sorts each code's entries by weight
    // whatever order they arrived in. Confirmed against librime 1.13.1 — a code split across
    // two runs still comes out with its heavy row first.
    //
    // One code can legitimately occupy two runs. Grouping is by B-tree key, and a source
    // entry with two readings contributes a row under each, so `阿尔法·罗密欧` emits
    // `luo2 mi4 ou1` from its own key block while the standalone `罗密欧` emits it from
    // another. Checking globally would flag 35 codes for something the engine already
    // handles, and the "fix" would be to weaken the file rather than repair a fault.
    const state = codes.get(row.code);
    if (!state) {
      codes.set(row.code, { weight: row.weight, texts: new Set([row.text]), runWeight: row.weight });
    } else {
      // A run is one code's consecutive rows. Within a run the file must descend, because
      // that is the order `SortHomophones` starts from; `runWeight` therefore tracks the
      // previous row of *this* run and resets whenever the code changes, which is what
      // makes the check per-run rather than per-code.
      const previousInRun = row.code === previousCode ? state.runWeight : null;
      if (previousInRun !== null && row.weight > previousInRun) {
        orderViolations.push(
          `line ${row.line}: ${row.text} (${row.weight}) follows a lighter ` +
            `${row.code} row (${previousInRun})`
        );
      }
      state.runWeight = row.weight;
      state.weight = row.weight;
      state.texts.add(row.text);
    }
    previousCode = row.code;
  }

  return {
    rows,
    codes,
    textsWithWhitespace,
    duplicateKeys,
    orderViolations,
    negativeWeights,
    byKey,
  };
}

const dictPath = (script: RimeScript) => path.join(RIME_DIR, `${DICT_NAMES[script]}.dict.yaml`);

/**
 * Mirrors `FLUSH_INTERVAL` in build-rime-dict.ts.
 *
 * Duplicated rather than imported because it is a property of the *writer's* buffering, and
 * the point of this file is to reimplement the write path independently. If the two drift,
 * the staleness check fails with a digest mismatch and this is the first place to look.
 */
const FLUSH_INTERVAL = 4096;

const missing = RIME_SCRIPTS.filter((script) => !fs.existsSync(dictPath(script)));

if (missing.length > 0) {
  // Vitest has no skip-with-a-reason that survives filtering, so say it once, loudly.
  console.warn(
    `[windows] skipping the generated-dictionary sweep: ${missing
      .map((s) => `${DICT_NAMES[s]}.dict.yaml`)
      .join(', ')} is not built. Run "npm run build:rime" first.`
  );
}

const describeBuilt = missing.length === 0 ? describe : describe.skip;

describeBuilt('the generated dictionaries', () => {
  const contents: Partial<Record<RimeScript, string>> = {};
  const facts: Partial<Record<RimeScript, CorpusFacts>> = {};
  const rebuilt = new Map<RimeScript, { digest: string; rows: number }>();

  beforeAll(async () => {
    for (const script of RIME_SCRIPTS) {
      const text = fs.readFileSync(dictPath(script), 'utf8');
      contents[script] = text;
      facts[script] = sweep(text);
    }

    // One extra build, captured through a hashing sink so the comparison needs no temp
    // copy of two 9MB files. It answers two questions at once: that the artifact matches
    // its source, and that the build is deterministic — a walk that depended on map or
    // page iteration order would produce a different digest on a second run.
    // The sink has to reproduce the real writer's buffering exactly: it joins with a newline
    // and writes a trailing one. Hashing each chunk as it arrives looks equivalent and is not
    // — it produces a different digest from the same rows, which reads as a stale artifact
    // when the artifact is fine.
    const captured = new Map<string, ReturnType<typeof createHash>>();
    const deps: RimeBuildDeps = {
      exists: () => true,
      readAsset: (p) => new Uint8Array(fs.readFileSync(p)),
      ensureDir: () => {},
      copyFile: () => {
        throw new Error('buildRimeDictionaries writes every file itself; it never copies');
      },
      openFile: (p) => {
        const hash = createHash('sha256');
        captured.set(p, hash);
        let buffered: string[] = [];
        return {
          write(chunk) {
            buffered.push(chunk);
            if (buffered.length >= FLUSH_INTERVAL) {
              hash.update(buffered.join('\n') + '\n');
              buffered = [];
            }
          },
          close() {
            if (buffered.length > 0) hash.update(buffered.join('\n') + '\n');
          },
        };
      },
    };
    const stats = await buildRimeDictionaries({ btreePath: BTREE, outDir: RIME_DIR }, deps);
    for (const script of RIME_SCRIPTS) {
      rebuilt.set(script, {
        digest: captured.get(stats.files[script])!.digest('hex'),
        rows: stats.scripts[script].rows,
      });
    }
  }, 180_000);

  for (const script of RIME_SCRIPTS) {
    describe(DICT_NAMES[script], () => {
      it('declares the header librime needs in order to read the body', () => {
        const { header, columns } = parseDictHeader(contents[script]!);
        expect(header.name).toBe(DICT_NAMES[script]);
        expect(header.version).toBe(DICT_VERSION);
        // `sort: by_weight` is what makes SortHomophones run at all; without it the
        // candidate order would be whatever order the compiler happened to produce.
        expect(header.sort).toBe('by_weight');
        expect(header.usePresetVocabulary).toBe(false);
        expect(header.entryCount).toBeGreaterThan(0);
        // The one that matters most: a lost `columns:` line still compiles, and quietly
        // drops every gloss, because librime's fallback has no comment column at all.
        expect(header.columns).toEqual([...RIME_COLUMNS]);
        expect(columns).toEqual({ text: 0, code: 1, comment: 2, weight: 3 });
      });

      it('holds every row to the format', () => {
        // iterateRimeRows throws on a short row, an empty text or code, or a weight that is
        // not a positive number, so reaching the end of 122k rows is itself the assertion.
        expect(facts[script]!.rows).toBeGreaterThan(100_000);
        expect(facts[script]!.duplicateKeys).toEqual([]);
        expect(facts[script]!.textsWithWhitespace).toEqual([]);
        // A weight librime would demote rather than reject: it becomes log(DBL_EPSILON) ≈ -36
        // and the row lands last in its own menu, with nothing in the log to say so.
        expect(facts[script]!.negativeWeights).toEqual([]);
      });

      it('orders every menu by descending weight, as SortHomophones needs', () => {
        expect(facts[script]!.orderViolations).toEqual([]);
      });

      it('has a candidate for every code a learner can type', () => {
        const codes = facts[script]!.codes;
        for (const [code, text] of REQUIRED_CODES) {
          const state = codes.get(code);
          expect(state, `${script} has no rows for ${code}`).toBeDefined();
          expect(
            state!.texts.has(text) || script === 'traditional',
            `${script} is missing ${text} under ${code}`
          ).toBe(true);
        }
      });

      it('is byte for byte what the generator produces', () => {
        // Catches a hand-edited dictionary, a stale artifact after the asset changed, and
        // any non-determinism in the B+ tree walk.
        //
        // This one fires more than you would expect, because neither the B-tree nor these
        // dictionaries are committed: both are derived, and a change to one does not
        // change the other on disk. The message says how to fix it, because "stale" on
        // its own sends people looking in the test.
        const onDisk = createHash('sha256').update(contents[script]!).digest('hex');
        expect(
          rebuilt.get(script)!.digest,
          `${DICT_NAMES[script]}.dict.yaml on disk is not what the generator produces ` +
            `from the current ${path.basename(BTREE)}. Either the dictionary is ` +
            `stale — run \`npm run build:rime\` — or the B-tree is, in which case ` +
            `\`npm run build:dict\` first, since it is rebuilt from three live ` +
            `upstream downloads and is not pinned to a revision.`
        ).toBe(onDisk);
        // And the build's own tally agrees with what a read-back of the file counted.
        expect(rebuilt.get(script)!.rows).toBe(facts[script]!.rows);
      });
    });
  }

  it('contains the rows the product promises, exactly', () => {
    for (const check of SPOT_CHECKS) {
      const found = facts[check.script]!.byKey.get(`${check.code} ${check.text}`);
      expect(found, `no row for ${check.text} (${check.code}) — ${check.why}`).toBeDefined();
      expect(
        found,
        `${check.text} (${check.code}) in ${check.script} changed — ${check.why}`
      ).toEqual({ comment: check.comment, weight: check.weight });
    }
  });
});

describe('every platform\'s rime folder', () => {
  const templatesDir = path.resolve(__dirname, '../templates');

  for (const platform of RIME_PLATFORMS) {
    const dir = platformRimeDir(platform);
    const built = fs.existsSync(path.join(dir, 'pinyinduck.schema.yaml'));
    const itBuilt = built ? it : it.skip;

    // A stale copy is what the templates exist to prevent: a schema edited in one platform
    // folder and not the other. Since the folders are generated, this catches a template
    // edited without a rebuild, or a platform file edited by hand.
    itBuilt(`${platform}: the rendered files match the templates`, () => {
      for (const name of TEMPLATE_FILES) {
        const template = fs.readFileSync(path.join(templatesDir, name), 'utf8');
        const onDisk = fs.readFileSync(path.join(dir, name), 'utf8');
        expect(onDisk, `${platform}/rime/${name}`).toBe(renderTemplate(name, template, platform));
      }
    });
  }

  // build:rime walks the asset once and copies the output to the second platform, so these
  // are the files that copy is responsible for.
  const generated = [
    ...RIME_SCRIPTS.map((script) => `${DICT_NAMES[script]}.dict.yaml`),
    'lua/pinyinduck_gloss.lua',
  ];
  const generatedIn = (platform: 'windows' | 'macos', name: string) =>
    path.join(platformRimeDir(platform), name);
  const bothBuilt = generated.every(
    (name) => fs.existsSync(generatedIn('windows', name)) && fs.existsSync(generatedIn('macos', name))
  );
  (bothBuilt ? it : it.skip)('macos: the generated files are byte for byte the Windows ones', () => {
    for (const name of generated) {
      const mac = fs.readFileSync(generatedIn('macos', name));
      expect(mac.equals(fs.readFileSync(generatedIn('windows', name))), name).toBe(true);
    }
  });
});
