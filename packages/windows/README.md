# PinyinDuck for Windows

The Windows half of PinyinDuck: the same `@pinyinduck/core` engine the web playground
uses, delivered as a real system input method through [Rime][rime] / [Weasel][weasel]
(小狼毫), so it works in Notepad, Word, browsers, Discord and anything else that accepts
text.

Candidates are ranked by corpus frequency rather than by sentence probability, so the
wrong homophone is never a guess:

```text
shi4  →  是  试  事  室  式
lv4   →  绿  律  率  氯  卛
```

Three things about that line are not what the web app does, and all three are load-bearing:

- **A syllable can be typed with or without its tone digit.** `shi` gives 是 十 使 试 诗 —
  every tone, merged, ordered by frequency. `shi4` narrows it to the fourth. What does
  not work is a *multi-syllable* word typed tone-lessly: `nihao` returns nothing, because
  the code is `ni3 hao3` and a tone-less `nihao` is not a prefix of it. `ni3hao3` works.
- **No candidate carries a definition.** librime's dictionary format has nowhere to put
  one. See [What Rime cannot show](#what-rime-cannot-show) — this is a known, verified
  gap with a decision attached, not a bug to be filed.
- **`v` stands in for `ü`, but `u:` does not.** `@pinyinduck/core` normalizes both;
  Rime's `xlit/ü/v/` covers only the first. `lv4` gives 绿, `lu:4` gives nothing.

## How it works

Windows gets the schema, not a runtime. The engine runs at build time and emits Rime's
dictionary format; from then on Rime's own TSF text service does the typing.

```text
packages/web/public/dictionary.btree        the shared paged CC-CEDICT asset
        │  scanPrefix, one key block at a time
        ▼
packages/windows/scripts/build-rime-dict.ts
        ▼
packages/windows/rime/pinyinduck.dict.yaml       123,203 rows, ~9.6 MB
packages/windows/rime/pinyinduck_trad.dict.yaml  123,191 rows, traditional forms
        │  copied by scripts/install.ps1
        ▼
%APPDATA%\Rime\  ── deployed by Weasel ──▶  the PinyinDuck input method
```

123,203 rows from a 122,746-entry source: CC-CEDICT gives some words more than one
reading, and each reading gets its own row, because a Rime code is a single reading and a
row with two would be two words under one key.

The candidate ranking and the pinyin parser are the shared `@pinyinduck/core` code. The
only Windows-specific parts are the dictionary emitter (`src/rime-dict.ts`) and the two
schemas in `rime/`.

| Path | What it is |
| :--- | :--- |
| `src/rime-dict.ts` | Formats entries into Rime's `.dict.yaml`. No `fs`, no CLI. |
| `src/rime-format.ts` | Reads a `.dict.yaml` back the way librime does. Used by the sweep. |
| `scripts/build-rime-dict.ts` | Walks the B+ tree and writes both dictionaries. |
| `scripts/verify-rime.ts` | Types into a real librime and checks what comes back. |
| `scripts/generated-dicts.test.ts` | Sweeps all 246k emitted rows for format faults. |
| `tools/bootstrap-rime.sh` | Builds librime 1.13.1 locally, without sudo. |
| `tools/rime_smoke.cc` | The harness that drives a real session. |
| `scripts/install.ps1` | Copies the schemas and dictionaries into `%APPDATA%\Rime`. |
| `rime/*.schema.yaml` | The Rime schema: engine, speller, switches. Hand-written. |
| `rime/default.custom.yaml` | Adds both schemes to the Rime scheme switcher. |
| `rime/*.dict.yaml` | **Generated.** ~9.6 MB each, not committed. |

### Why Rime rather than a global keyboard hook

The alternative was a tray app with a `WH_KEYBOARD_LL` hook that injects text with
`SendInput`. That needs a Rust toolchain and MSVC on the Windows host, ships an extra
always-on-top process, and has to re-implement candidate windows, composing strings and
input-method registration. Rime gives a real, registered IME that the OS already knows
how to activate, focus and compose — so the work here is the part that is actually
PinyinDuck's: the dictionary and the ranking. See `docs/roadmap.md` §2 for the
trade-offs.

## Build

From the repository root (this checkout is a WSL copy of the Windows machine, so build
in WSL and run the IME on the Windows host):

```bash
npm install
npm run build:dict     # packages/web/public/dictionary.btree (not committed)
npm run build:rime     # packages/windows/rime/*.dict.yaml  (~1s)
```

`npm run build` runs both. Neither the 9.6 MB B-tree nor the two Rime dictionaries is
committed — all three are derived data — so a fresh clone needs `build:dict` once before
`build:rime` has anything to read. The sources are cached in `packages/core/.cache/`.

```
  source  .../packages/web/public/dictionary.btree (122746 entries)
  wrote   .../rime/pinyinduck.dict.yaml (123203 rows, 0 duplicates dropped, 157 unreadable readings, 0 missing text)
  wrote   .../rime/pinyinduck_trad.dict.yaml (123191 rows, 12 duplicates dropped, 157 unreadable readings, 0 missing text)
```

`157 unreadable readings` is a real count, not noise. CC-CEDICT's pinyin column contains
rows like `pua` (romanised English), `a b zhi4` and `bai3ke4`, which are not typeable
pinyin; librime would drop every one of them with an `Encode failure` in the log. They are
rejected at build time instead, so that string in the log stays a signal rather than
background.

Nothing is materialized: the tree is walked in key order and each homophone cluster is
emitted as soon as the scan leaves it.

To write somewhere else:

```bash
npm run build:rime -- --out /tmp/rime
npm run build:rime -- --btree path/to/other.btree
```

## Verify before installing

Building the dictionary and installing it are different risks. The build can be wrong —
a bad column order, a weight formula that disagrees with the web app — and the install is
where you find out, on a Windows machine, by typing into Notepad. This step removes the
first risk: it runs the generated files through the actual Rime engine, on this machine,
before anything is copied anywhere.

```bash
npm run setup:rime     # one-off: builds librime 1.13.1 from source, no sudo
npm run test:rime      # types into it and checks the answers
```

`setup:rime` clones librime at the tag Weasel 0.17.0 bundles (1.13.1) into
`tools/librime/`, fetches cmake and Boost without root, and builds `liblibrime.so` plus
the small C++ harness in `tools/rime_smoke.cc`. It takes a few minutes and then never
runs again — the harness is rebuilt only when the library is newer.

`test:rime` deploys the real schemas against the real 9.6 MB dictionaries in a temporary
user directory, types seven queries, and compares the candidate lists:

```
  typed into librime
    pinyinduck       shi4         是 试 事 室 式
    pinyinduck       an1          安 氨 鞍 媕 庵
    pinyinduck       lv4          绿 律 率 氯 卛
    pinyinduck       nv3          女 籹 钕
    pinyinduck       ni3hao3      你好 你 祢 拟 伱
    pinyinduck       shi4         是 试 事 室 式   [known gap]
    pinyinduck_trad  zhong1guo2   中國 鍾 中 終 忠

  6 of 7 queries behaved as pinned.
```

It also fails on anything librime logged, which is how a schema that does not compile, a
dictionary with a malformed row, or an unencodable code is caught without a Windows host.
The seventh entry is the known gap, declared in `src/rime-verify.ts` next to the
assertion it fails; if it ever starts passing, the run says so and tells you to delete the
declaration.

`npm test -w @pinyinduck/windows` additionally sweeps all 246,394 emitted rows for the
invariants a real engine would only reveal one crash at a time: a duplicate
text/code pair, a weight librime would demote, a menu out of descending weight order, a
candidate that carries whitespace, and a byte-for-byte rebuild of the file against a
second independent run of the writer.

## Install on Windows

1. Install Weasel (小狼毫) if you have not already. The installer is
   [rime/weasel releases][weasel]; Rime is installed as the "Rime 输入法" language.
2. Generate the dictionaries (`npm run build:rime`) so `rime/*.dict.yaml` exist.
3. Copy them into place:

   ```powershell
   powershell -ExecutionPolicy Bypass -File packages\windows\scripts\install.ps1
   ```

   The script verifies all five files are present before copying anything, prints what
   it wrote, clears `%APPDATA%\Rime\build` so Weasel cannot reuse a stale compiled
   table, and prints the remaining manual step.
4. Tell Weasel to rebuild: **right-click the tray icon → 用户资料 → 重新部署** (User data
   → Deploy). The first deploy compiles 123k rows and takes a few seconds; later ones are
   fast. `install.ps1 -Deploy` runs Rime's command line deployer automatically when the
   installed Weasel ships one.
5. Switch to PinyinDuck with **Win+Space**. The tray menu also lists it directly.

### If Weasel is not installed yet

The script creates `%APPDATA%\Rime` and copies the files, but nothing compiles them until
Weasel is installed. Install Weasel, then re-run the script and deploy.

## Using it

Type pinyin. The tone digit is optional for one syllable and required for the first of
several: `shi` or `shi4`, but `ni3hao3`.

| Key | Action |
| :--- | :--- |
| `Space` | Commit the selected candidate |
| `-` / `=` (or `,` / `.`) | Previous / next page |
| `Up` / `Down` | Move the selection |
| `Tab` / `Shift+Tab` | Next / previous candidate |
| `Enter` | Commit the selected candidate |
| `Backspace` | Delete the last buffered character |
| `Esc` | Cancel the composition |
| `` ` `` | Look up the characters before the caret |
| `Ctrl+.` | Toggle Chinese / Western punctuation |
| `F4` or ``Ctrl+` `` | Switch between 拼音鸭·简 and 拼音鸭·繁 |

**Digits extend the syllable, they do not pick a candidate.** `4` in `shi4` is the fourth
tone and has to reach the speller, so a number typed while composing extends the word
rather than selecting from the menu. Selection is done with the paging and navigation
keys. This is the sharpest usability cost of the design — see
[Why the digits are in the alphabet](#why-the-digits-are-in-the-alphabet).

What the speller accepts, measured against librime 1.13.1 with the shipped schema:

| Type | Candidates | Note |
| :--- | :--- | :--- |
| `shi` | 是 十 使 试 诗 | Completion across tones, ordered by frequency. |
| `shi4` | 是 试 事 室 式 | The tone narrows the menu. |
| `sh` | 是 上 谁 水 书 | The syllable need not be finished. |
| `lv` | 绿 驴 旅 律 略 | `v` for `ü`; the preedit reads `lü`. |
| `lv4` | 绿 律 率 氯 卛 | Preedit reads `lü4`. |
| `ta1` | 他 她 它 塌 祂 | |
| `shi4r` | 事儿 世人 示弱 释然 是日 | Completion crosses the syllable delimiter. |
| `ni3hao3` | 你好 你 祢 拟 伱 | The delimiter is optional. |
| `ni3'hao3` | 你好 你 祢 拟 伱 | Or the apostrophe. |
| `nihao` | *nothing* | Not a prefix of `ni3 hao3`. |
| `nihao3` | *nothing* | Still not. |
| `lu:4` | *nothing* | The colon is not in the alphabet and no rule maps it. |

Things that are deliberately configured:

- **Dictionary lookup only, one word at a time.** `enable_sentence: false`. A sentence
  model would offer phrases that cannot be explained, which defeats the point, and would
  rank them above the word you were reaching for.
- **No user dictionary.** `enable_user_dict: false`. The dictionary already ranks by
  corpus frequency and HSK level; letting your own words rewrite that order is how a
  learner types their own bad habits back.
- **Partial matches.** `enable_completion: true`, so `sh` and `shi4r` both work.
- **`ü` is typed as `v`.** `speller/algebra` has `xlit/ü/v/`, matching
  `@pinyinduck/core`, which normalizes `v` *and* `u:` to `ü`. Only the first half of
  that is reproduced here; see the table above.
- **Tone marks shown on the preedit.** `preedit_format` rewrites the buffered text so
  `lv4` reads `lü4` while you type, and `always_show_comments: true` shows the selected
  candidate's spelling beside it. Neither is the English definition — see
  [What Rime cannot show](#what-rime-cannot-show).

### Why the digits are in the alphabet

This is the one change in the schema that looks like a mistake and is not, so it is worth
stating plainly.

The speller only reaches a code whose every character is in `speller/alphabet`. The
generated dictionary spells every reading with its tone digit — `shi4`, `ni3 hao3`,
`zhong1 guo2`. With a digit-free alphabet, that schema deploys cleanly, reports no
errors, and returns an **empty candidate list for every query**, because the `4` in
`shi4` is swallowed as a candidate-selection key before the speller ever sees it.

Verified against librime 1.13.1 — the digit-free schema types `shi4` into a preedit
reading `shi` and returns nothing:

| Query | Digit-free alphabet | With digits |
| :--- | :--- | :--- |
| `shi4` | preedit `shi`, no candidates | 是 试 事 室 式 |
| `lv4` | — | 绿 律 率 氯 卛, preedit `lü4` |
| `an1` | — | 安 氨 鞍 媕 庵 |
| `ni3hao3` | — | 你好 你 祢 拟 伱 |

Completion means a tone digit is not *typed* at every keystroke — `shi` still works,
because `shi` is a prefix of `shi4`. What the digit is for is being *in* the code, and
`nihao` shows the cost: a two-syllable word whose first syllable lacks its tone is not a
prefix of anything, because the space delimiter cannot appear mid-word.

The alternative — emitting toneless codes — would let digits select candidates again, and
would throw away the tone, which is most of what a learner's dictionary has to teach. A
code Rime cannot reach is worth nothing; a code that omits the tone is a worse answer than
the web app's. So the digits stay, and the menu is navigated with the keys above.

If this trade turns out to be wrong in practice, the fix is not a different `alphabet` but
a different dictionary: toneless codes, tone filtering in a Lua filter, and the gloss
rendered by the same filter. That is a larger change and it is written down under the open
question below rather than made here.

### What Rime cannot show

**The English definition is not in the candidate list, and cannot be made to be.** This is
a property of librime, not of this package, and it was checked against the source rather
than inferred from behaviour:

- `RawDictEntry` is `text` / `code` / `weight`. There is no comment field.
- `EntryCollector` (`src/rime/dict/entry_collector.cc`) reads those three and nothing
  else, at 1.11.2, 1.12.0, 1.13.0, 1.13.1 and master.
- Rime's only comment source is `script_translator.cc`, which sets the comment to the
  candidate's **original spelling** — and only when `cand.code().size() <=
  spelling_hints()`, which defaults to 0.

So `always_show_comments: true` shows `shi4` back to you: identical for all five of
是 试 事 室 式, and carrying none of the definition. Turning `spelling_hints` up to 10 does
not help — it produces the same string, just for more candidates.

The emitter still writes the gloss, into a declared `comment` column, and
`src/rime-dict.ts` still formats it correctly. That is deliberate: the file is the
artifact, and the artifact should be right even where the consumer cannot use it yet. It
also means the fix, when there is one, is not a regeneration.

Delivering the definition on Windows needs a decision, not a tweak. The two candidates:

1. **A Lua filter.** Weasel bundles `librime-lua` and `librime-octagram`. A filter can read
   the emitted `comment` column out of the dictionary and attach it to the candidate as it
   reaches the menu — which is the only hook in the pipeline that has both the data and
   the candidate. Cost: a `lua` filter in the schema, a plugin dependency Weasel happens
   to ship, and the gloss column stops being decorative.
2. **Drop the gloss from the Windows client** and deliver only the tone marks, through
   `preedit_format` and `always_show_comments`, which already work. Cost: the Windows
   build is then a different product from the web one, and the `columns:` premise
   throughout this package has to go.

The `knownGap` in `src/rime-verify.ts` is where this decision gets its answer: the check
asserts the first candidate's comment contains `to be`, and reports the gap on every run
until it passes. Whichever way it goes, that gap entry is the thing to delete.


### Simplified and traditional

Two dictionaries and two schemes, switched with `F4` / ``Ctrl+` ``. CC-CEDICT carries both
forms for every entry, so the traditional dictionary is generated from the same rows with
no OpenCC conversion at runtime — 中国 is offered as 中國 because that is what
CC-CEDICT says, not because it was translated after the fact.

## Testing

There are three layers, and they answer three different questions.

| Layer | Question | Needs a toolchain? |
| :--- | :--- | :--- |
| Unit tests | Does the emitter produce the format, and are the rules still true? | No |
| Corpus sweep | Is every one of the 246,394 emitted rows well-formed? | No |
| Real librime | Does the engine accept the file and return the right candidates? | Yes, once |

```bash
npm test -w @pinyinduck/windows   # 198 tests: unit + sweep, ~3s
npm run test:rime                 # the real engine, needs `setup:rime` first
```

| Suite | Covers |
| :--- | :--- |
| `src/rime-dict.test.ts` | Column order, the weight formula against `scoreEntry`, the tie order against `compareScored`, tone marks and gloss formatting, multi-variant readings split into one row each, unreadable readings rejected, duplicate collapsing, and a whole dictionary built and read back through a real B+ tree |
| `src/rime-format.ts` + `.test.ts` | An independent reader for the emitted format, written against librime's `GetColumnIndex` and `LoadDictEntry` rather than against our own writer — so a mistake in the writer cannot make the reader agree with it |
| `src/rime-verify.ts` + `.test.ts` | The harness transcript parser, the smoke-case evaluation, the `knownGap` mechanism, and the report format |
| `scripts/build-rime-dict-io.test.ts` | Flag handling, both output files, header and body shape, a missing asset, a corrupt asset, the `unencodable` statistic, and the CLI output |
| `scripts/generated-dicts.test.ts` | The whole corpus, read through the independent reader: no duplicate text/code pair, no whitespace in a candidate, no weight librime would demote, every menu in descending weight, a candidate for every code a learner can type, and a byte-for-byte rebuild against a second run of the writer |
| `scripts/verify-rime-io.test.ts` | Staging (including the `essay.txt` filter that keeps 880 warnings out of the log), the harness protocol, timeout detection, and the CLI's four exit paths against a stub harness |

Coverage is gated at 95% on all four metrics (`packages/windows/vitest.config.ts`), the
same bar `packages/core` holds its build scripts to.

> The gate is written flat — `thresholds: { branches: 95 }`, not `thresholds: { global:
> { branches: 95 } }`. On vitest 3.2.7 the documented nested shape checks nothing: `global`
> is not a threshold name, so it is matched as a per-glob pattern against file paths as the
> string `"global"`, which matches none, while the real global entry is built from the
> `branches` key that is then undefined. The run prints its percentages, reports no error
> and exits 0 at any coverage. Both packages' configs were in that state until this was
> found; the comment in each config is what keeps it fixed.

The cases worth knowing about, because they pin a format rule rather than our code:

- the body is TSV, not the YAML block form older tutorials show;
- rows for one reading are ordered by weight descending, and librime's `SortHomophones`
  is a *stable* sort, so the emitted order is also the tiebreak. It is called at compile
  time (`dict_compiler.cc`), which means a code whose rows are split across two runs in
  the file still comes out correctly ordered — checked with `luo2mi4ou1`, where 罗密欧
  (weight 8486) outranks the same reading inside 阿尔法·罗密欧 (weight 0);
- a weight librime cannot use is not rejected, it is *demoted*: `log(weight > 0 ? weight
  : DBL_EPSILON)` turns a non-positive weight into −36, which sorts last in that row's own
  menu with nothing in the log to say so. The emitter clamps at zero and the sweep asserts
  the clamp never engages, so a bad `hskLevel` in the asset is reported rather than
  absorbed;
- a reading that is not typeable pinyin is dropped at build time, for the same reason —
  157 rows of `pua` and `a b zhi4` would otherwise be 157 `Encode failure` lines, and a
  log that has to be read past is a log that stops being read.

Run everything:

```bash
npm test               # core + windows unit tests and the corpus sweep
npm run test:coverage  # both, with gates
npm run test:e2e       # the web app, unchanged
npm run lint
```

### Verifying on Windows

Everything above runs on any machine with a C++ compiler. The last mile cannot: tray
menu, `Win+Space`, composing inside Notepad and Word, and `F4` switching are the TSF
integration, and nothing in this repository can exercise them. After installing, type
these into Notepad. The expectations are the same ones `npm run test:rime` just
confirmed, so a difference between this table and what appears is a Windows-side fault.

| Type | Expect | Why it is the interesting case |
| :--- | :--- | :--- |
| `shi4` → `Space` | 是 | Four homophones, ordered by corpus frequency. |
| `shi` | 是, 十, 使, 试, 诗 | Completion across tones. If this is empty, the digits are not in the alphabet. |
| `ni3hao3` → `Space` | 你好 | The multi-character word must beat the far more frequent 你. |
| `an1` | 安, 氨, 鞍, 媕, 庵 | 安 outranks the astral-plane CC-CEDICT characters sharing `an1`. |
| `lv4` → `Space` | 绿, preedit reading `lü4` | `v` is accepted for `ü`, and the preedit shows the real spelling. |
| `nv3` | 女, 籹, 钕 | `nüe`, the other `ü` syllable after a nasal. |
| `F4`, then `zhong1guo2` | 中國, 鍾, 中, 終, 忠 | The traditional scheme, and `F4` switching at all. |
| `shi4r`, then `Down` `Down` `Down` `Down`, `Space` | 是日 | Completion crosses the syllable delimiter; fifth, not first. |
| `` ` `` after 你好 | 你好 in the lookup window | Reverse lookup uses the same dictionary. |
| `` ` `` after 你好, then `F4` | 繁體字 in the lookup | Reverse lookup against the traditional dictionary. |
| `nihao` | *nothing*, and the preedit still reads `nihao` | Expected. Not a prefix of `ni3 hao3`. |

Also check the two things only Windows can show: the tray icon's right-click menu lists
拼音鸭·简 and 拼音鸭·繁, and `Win+Space` reaches them. Everything else in this table is
about the dictionary, which `npm run test:rime` has already confirmed.


If the candidate list is empty or the tray menu does not list 拼音鸭, the deploy did not
pick up the schemas: re-run `install.ps1` and deploy again, and check that
`%APPDATA%\Rime\build` contains `pinyinduck.table.bin` and `pinyinduck.prism.bin`.

### Parity with the web app

The Windows menu and the web candidate list are ranked by the same rules. Measured over
the real asset, comparing each Rime menu against the engine's results for the same
reading:

> 103,521 typeable readings, 121,304 rows compared, **3 orderings differ**.

The three are CC-CEDICT's own syllable-abbreviation rows — `ㄏㄤ`, `PO`, `TA` — which
carry no frequency. The web engine treats a two-symbol abbreviation as a two-character
word and ranks it above the real character; the Rime file ranks the character first.
That difference is the Rime file behaving as intended.

The web app is not affected by the tone-digit decision: `@pinyinduck/core` filters by tone
directly, and a caller that types `shi` gets every `shi` in the corpus. Only the Rime
speller, which matches whole syllables against a fixed alphabet, forces the digit to be
part of the input.

## Troubleshooting

**The tray menu has no 拼音鸭.** `%APPDATA%\Rime\default.custom.yaml` was not copied, or
the deploy has not run. Re-run `install.ps1`, then deploy.

**Every candidate is empty, or the same query works in `npm run test:rime` but not in
Notepad.** The dictionary is fine and the deploy is not: Weasel caches compiled tables by
checksum, and `install.ps1` deletes `%APPDATA%\Rime\build` for exactly that reason. If
you copied the files by hand, delete it yourself, then deploy again.

**`Encode failure` in the log after a fresh install.** That is librime seeding its user
dictionary from its own `data/minimal/essay.txt`, whose 880 rows are number readings
(`二〇〇九`, `七〇`) that no pinyin encoder can turn into a syllable. It is not our
dictionary, and it does not affect what is typed. `scripts/verify-rime.ts` filters that
file out precisely so the string stays meaningful — 157 of them *would* have been ours,
and the build now rejects those instead.

**`Every candidate is empty` and `%APPDATA%\Rime\rime.weasel.log.txt` mentions an invalid
syllable.** The log names the row. Regenerate with `npm run build:rime`, reinstall, and
run `npm run test:rime` — it reads the same log and will quote the line.

**`Failed to load` / `npm run build:dict` hint.** The generator could not find
`packages/web/public/dictionary.btree`. Run `npm run build:dict` first.

**The traditional scheme is missing.** `pinyinduck_trad.dict.yaml` must be in
`%APPDATA%\Rime` — a schema whose dictionary is missing fails to compile. It is also the
one file that has to be *compiled* to exist: `pinyinduck_trad.schema.yaml` includes
`pinyinduck.schema.yaml:/`, which resolves against a built schema rather than a file, so
both schemes are compiled in the same pass.

## Notes

- The generated dictionaries contain the whole CC-CEDICT corpus: 123,203 rows in ~9.6 MB
  from 122,746 source entries, the difference being words with more than one reading.
  Rime compiles them once; lookups are then served from the compiled `.table.bin`.
- Candidate ranking is the shared `scoreEntry`. This milestone fixed two defects in it
  that the real corpus exposed: `String.length` counted UTF-16 units, so the 205
  single characters outside the BMP were treated as multi-character words and given the
  word boost (typing `an1` offered 𩽾 above 安); and one typed tone number awarded the
  full tone bonus to any longer word whose *first* syllable matched (typing `bian3`
  offered 彼岸 above 扁). Both are pinned by `packages/core/src/index/ranking.test.ts`.
- Running the real engine found four defects that no amount of reading the format spec
  would have: a digit-free `alphabet` that made every code unreachable, a traditional
  schema whose `Include` never resolved, the 157 unencodable readings, and the gloss
  column that librime discards. Three are fixed; the fourth is written down above.
- Milestone 3 (Android) reuses the same B+ tree and the same ranking through
  `MemoryPageSource`, so nothing here is desktop-specific.

[rime]: https://rime.im/
[weasel]: https://github.com/rime/weasel/releases
