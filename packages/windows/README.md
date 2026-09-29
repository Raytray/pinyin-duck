# PinyinDuck for Windows

The Windows half of PinyinDuck: the same `@pinyinduck/core` engine the web playground
uses, delivered as a real system input method through [Rime][rime] / [Weasel][weasel]
(小狼毫), so it works in Notepad, Word, browsers, Discord and anything else that accepts
text.

Every candidate carries its tone marks and a short English definition, and candidates
are ranked by corpus frequency rather than by sentence probability:

```text
是   shì · to be (followed by substantives only) / correct; right; true
试   shì · to test / to try / experiment
事   shì · matter / thing / item
室   shì · surname Shi
式   shì · type / form / pattern
```

## How it works

Windows gets the schema, not a runtime. The engine runs at build time and emits Rime's
dictionary format; from then on Rime's own TSF text service does the typing.

```text
packages/web/public/dictionary.btree        the shared paged CC-CEDICT asset
        │  scanPrefix, one key block at a time
        ▼
packages/windows/scripts/build-rime-dict.ts
        ▼
packages/windows/rime/pinyinduck.dict.yaml       122,746 rows, ~9.3 MB
packages/windows/rime/pinyinduck_trad.dict.yaml  122,734 rows, traditional forms
        │  copied by scripts/install.ps1
        ▼
%APPDATA%\Rime\  ── deployed by Weasel ──▶  the PinyinDuck input method
```

The candidate list, the glosses, the ranking and the pinyin parser are the shared
`@pinyinduck/core` code. The only Windows-specific parts are the dictionary emitter
(`src/rime-dict.ts`) and the two schemas in `rime/`.

| Path | What it is |
| :--- | :--- |
| `src/rime-dict.ts` | Formats entries into Rime's `.dict.yaml`. No `fs`, no CLI. |
| `scripts/build-rime-dict.ts` | Walks the B+ tree and writes both dictionaries. |
| `scripts/install.ps1` | Copies the schemas and dictionaries into `%APPDATA%\Rime`. |
| `rime/*.schema.yaml` | The Rime schema: engine, speller, switches. Hand-written. |
| `rime/default.custom.yaml` | Adds both schemes to the Rime scheme switcher. |
| `rime/*.dict.yaml` | **Generated.** ~9.3 MB each, not committed. |

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
npm run build:dict     # packages/web/public/dictionary.btree (committed; rarely needed)
npm run build:rime     # packages/windows/rime/*.dict.yaml  (~1s)
```

`npm run build` runs both. The two dictionaries are ~9.3 MB each and are gitignored;
regenerate them after any dictionary change.

```
  source  .../packages/web/public/dictionary.btree (122746 entries)
  wrote   .../rime/pinyinduck.dict.yaml (122746 rows, 0 duplicates dropped, 0 unusable)
  wrote   .../rime/pinyinduck_trad.dict.yaml (122734 rows, 12 duplicates dropped, 0 unusable)
```

Nothing is materialized: the tree is walked in key order and each homophone cluster is
emitted as soon as the scan leaves it.

To write somewhere else:

```bash
npm run build:rime -- --out /tmp/rime
npm run build:rime -- --btree path/to/other.btree
```

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
   → Deploy). The first deploy compiles 122k rows and takes a few seconds; later ones are
   fast. `install.ps1 -Deploy` runs Rime's command line deployer automatically when the
   installed Weasel ships one.
5. Switch to PinyinDuck with **Win+Space**. The tray menu also lists it directly.

### If Weasel is not installed yet

The script creates `%APPDATA%\Rime` and copies the files, but nothing compiles them until
Weasel is installed. Install Weasel, then re-run the script and deploy.

## Using it

Type pinyin; the candidate list shows tone marks and a definition on every entry.

| Key | Action |
| :--- | :--- |
| `Space` | Commit the selected candidate |
| `1`–`9` | Select a candidate by number |
| `,` / `.` (or `-` / `=`) | Previous / next page |
| `Up` / `Down` | Move the selection |
| `Tab` / `Shift+Tab` | Next / previous candidate |
| `Enter` | Commit the raw pinyin as English text |
| `Backspace` | Delete the last buffered letter |
| `Esc` | Cancel the composition |
| `` ` `` | Look up the characters before the caret |
| `Ctrl+.` | Toggle Chinese / Western punctuation |
| `F4` or ``Ctrl+` `` | Switch between 拼音鸭·简 and 拼音鸭·繁 |

Things that are deliberately configured:

- **Dictionary lookup only, one word at a time.** `enable_sentence: false`. A sentence
  model would offer phrases that cannot be explained, which defeats the point, and would
  rank them above the word you were reaching for.
- **No user dictionary.** `enable_user_dict: false`. The dictionary already ranks by
  corpus frequency and HSK level; letting your own words rewrite that order is how a
  learner types their own bad habits back.
- **Definitions on every candidate.** `always_show_comments: true`, so the gloss is not
  hidden behind the selection.
- **Partial matches.** `enable_completion: true`, so `niha` still offers 你好.
- **`ü` is typed as `v`.** `speller/algebra` has `xlit/ü/v/`, matching
  `@pinyinduck/core`, which normalizes `v` and `u:` to `ü`. `lv4` gives 绿.
- **Tone numbers are not reachable from the keyboard.** Number keys select candidates
  for the whole duration of a composition, exactly as in the web app
  ([PLAN.md §3.2](../../PLAN.md)); `@pinyinduck/core` still filters by tone for direct
  callers.

### Simplified and traditional

Two dictionaries and two schemes, switched with `F4` / ``Ctrl+` ``. CC-CEDICT carries both
forms for every entry, so the traditional dictionary is generated from the same rows with
no OpenCC conversion at runtime — 中国 is offered as 中國 because that is what
CC-CEDICT says, not because it was translated after the fact.

## Testing

### Unit tests and coverage

The formatter is pinned against what librime actually does, because a drift still
compiles and silently changes what you see.

```bash
npm test -w @pinyinduck/windows          # 43 tests
npm run test:coverage -w @pinyinduck/windows
```

| Suite | Covers |
| :--- | :--- |
| `src/rime-dict.test.ts` | Column order, the weight formula against `scoreEntry`, tie order against `compareScored`, tone marks and gloss formatting, duplicate collapsing, and a whole dictionary built and read back through a real B+ tree |
| `scripts/build-rime-dict-io.test.ts` | Flag handling, both output files, header and body shape, a missing asset, a corrupt asset, and the CLI output |

Coverage is gated at 95% on all four metrics (`packages/windows/vitest.config.ts`), the
same bar `packages/core` holds its build scripts to.

The cases worth knowing about, because they pin a format rule rather than our code:

- the header must declare `columns`, because librime's default layout is
  `text/code/weight` **with no comment column** — an undeclared gloss column is dropped
  silently and every candidate loses its definition;
- the body is TSV, not the YAML block form older tutorials show;
- rows for one reading are ordered by weight descending, and librime's
  `SortHomophones` is a *stable* sort, so the emitted order is also the tiebreak.

Run everything:

```bash
npm test               # core + windows unit tests
npm run test:coverage  # both, with gates
npm run test:e2e       # the web app, unchanged
npm run lint
```

### Verifying on Windows

The dictionary format cannot be executed in this repository, so the last mile is manual.
After installing, type these into Notepad. The expectations are taken from the generated
dictionary, not from memory.

| Type | Expect | Why it is the interesting case |
| :--- | :--- | :--- |
| `nihao` → `Space` | 你好 — *nǐ hǎo · hello; hi* | The multi-character word must beat the far more frequent 你. |
| `shi4` → `Space` | 是 — *shì · to be …* | Fourth tone, and four homophones must all be visible with glosses. |
| `shi` | 是, 十, 使, 试, 诗 | Five tones merged into one menu, ordered by frequency across tones. |
| `ta` | 他, 她, 它, then 塔 and 塌 | Pronouns before the rare homophones — the frequency ranking working. |
| `lv4` → `Space` | 绿 — *lǜ · green* | `v` is accepted for `ü` and the tone still filters. |
| `zhongguo` → `Space` | 中国 — *zhōng guó · China* | Two-syllable word, tone marks in the comment. |
| `niha` then `Space` | 你好 | Partial syllable still completes the word. |
| `F4`, then `zhongguo` | 中國 | The traditional dictionary. |
| `` ` `` after 你好 | 你好 in the lookup window | Reverse lookup uses the same dictionary. |

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

## Troubleshooting

**The tray menu has no 拼音鸭.** `%APPDATA%\Rime\default.custom.yaml` was not copied, or
the deploy has not run. Re-run `install.ps1`, then deploy.

**Every candidate is empty or the dictionary failed to compile.** Weasel logs to
`%APPDATA%\Rime\rime.weasel.log.txt`; look for `invalid syllable` or `missing entry
text`. Regenerate with `npm run build:rime` and reinstall.

**`Failed to load` / `npm run build:dict` hint.** The generator could not find
`packages/web/public/dictionary.btree`. Run `npm run build:dict` first.

**Green squiggles or a stale dictionary.** Weasel caches compiled tables by checksum.
`install.ps1` deletes `%APPDATA%\Rime\build` for exactly this reason; if you copied the
files by hand, delete it yourself.

**The traditional scheme is missing.** `pinyinduck_trad.dict.yaml` must be in
`%APPDATA%\Rime` — a schema whose dictionary is missing fails to compile.

## Notes

- The generated dictionaries contain the whole CC-CEDICT corpus, 122,746 rows in ~9.3 MB.
  Rime compiles them once; lookups are then served from the compiled `.table.bin`.
- Candidate ranking is the shared `scoreEntry`. This milestone fixed two defects in it
  that the real corpus exposed: `String.length` counted UTF-16 units, so the 205
  single characters outside the BMP were treated as multi-character words and given the
  word boost (typing `an1` offered 𩽾 above 安); and one typed tone number awarded the
  full tone bonus to any longer word whose *first* syllable matched (typing `bian3`
  offered 彼岸 above 扁). Both are pinned by `packages/core/src/index/ranking.test.ts`.
- Milestone 3 (Android) reuses the same B+ tree and the same ranking through
  `MemoryPageSource`, so nothing here is desktop-specific.

[rime]: https://rime.im/
[weasel]: https://github.com/rime/weasel/releases
