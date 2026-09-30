# PinyinDuck 🦆

A TypeDuck-inspired Mandarin Pinyin input method designed for learners. As you type Pinyin, suggestions are shown with tone marks, frequency-weighted ranking, and concise English definitions so you never select the wrong character.

## Monorepo Packages

- **`packages/core`**: Pinyin syllable segmenter, CC-CEDICT asset generator and loader, Trie-based candidate search engine, and ranking algorithm.
- **`packages/web`**: Web application featuring an interactive IME composition playground with inline candidate definition cards.
- **`packages/android`**: Android input method (Milestone 3). An `InputMethodService` with a Jetpack Compose keyboard over the same mmap'd `dictionary.btree`. Build, install and usage: [`packages/android/README.md`](packages/android/README.md).
- **`packages/windows`**: Windows input method, delivered as a Rime/Weasel schema generated from the same engine. See [packages/windows/README.md](packages/windows/README.md).

## Getting Started

```bash
npm install
npm run dev
```

### Linting

```bash
npm run lint       # static analysis across both packages, the e2e suite and configs
npm run lint:fix   # same, applying safe autofixes
```

A single flat config at the repo root (`.oxlintrc.json`) covers the whole
monorepo: `packages/core`, `packages/web`, the Playwright suite in `e2e/` and the
tool config files. It enables oxlint's `correctness` category with the `typescript` and
`react` plugins.

oxlint is deliberately **not** type-aware by default, so linting stays a fast static
pass that does not need a program or a `tsconfig` per folder. `tsc` already runs in
`strict` mode separately, so the two tools do not overlap. The experimental
`--type-aware` flag would enable promise-safety rules such as `no-floating-promises`,
at the cost of a slower run.

The `react` plugin ships oxlint's implementation of the React Rules of Hooks and the
React Compiler lint set, under a `react/` prefix rather than ESLint's `react-hooks/`.
Two scoping decisions are worth knowing about:

- The `react/*` rules are applied only under `packages/web/src`. Run repo-wide they
  flag Playwright's fixture callback, which is also called `use`, in `e2e/`.
- `react/set-state-in-effect` is off for `usePinyinDuck.ts` only. Loading the
  dictionary is a real external-system sync whose status reset is load-bearing when
  `dictionaryUrl` changes. Everywhere else the rule stays on, and it is what caught a
  genuinely redundant `setState` in `Editor.tsx`.

### Dictionary

Candidate data comes from the full [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict)
corpus, joined with an OpenSubtitles frequency list and the HSK 2012 word list. The
generated asset is **not committed** — it is 9.12MB of data derived from three upstream
downloads, and a commit carrying one is a 9MB diff that changes whenever an upstream
source does. Build it once per clone:

```bash
npm run build:dict                       # writes packages/web/public/dictionary.btree
npm run build:dict -w @pinyinduck/core -- --no-cache   # re-downloads the sources
npm run build:dict -w @pinyinduck/core -- --format json # whole dictionary as JSON tuples
```

Pass `--` before the flags when running the workspace script directly, or npm will read
them as its own.

`npm run build` runs this automatically. Downloads are cached in `packages/core/.cache/`,
so it is a one-time cost per clone. `npm run dev` and `npm run test:e2e` check for the
asset first and name it if it is missing, rather than leaving the app on "failed to load"
or timing out 40 Playwright tests on a file nobody mentioned.

Current output: 125,132 lines parsed into 122,746 unique word/reading pairs
(26,811 with frequency data, 5,247 on the HSK list), 9.12MB raw and 4.27MB gzipped.

> The builder downloads from live URLs rather than pinning revisions, so a rebuild can
> legitimately produce a slightly different asset than the one a given clone was last
> built against — CC-CEDICT and the frequency list both move. The output is deterministic
> given the same three inputs, but the inputs are not pinned, so a row count in a test and
> a row count on disk can disagree by a handful. Anything asserting an exact corpus size
> should say so, or assert a relationship instead.

The same asset also feeds the Windows input method:

```bash
npm run build:rime                   # regenerates packages/windows/rime/*.dict.yaml
npm run build:rime -- --out /tmp/rime   # writes the dictionaries somewhere else
npm run build:rime -- --btree <path>    # reads a different asset
```

The Rime dictionaries are ~9.3MB each and gitignored, so `npm run build` regenerates
them. Installing them on Windows is one PowerShell script; see
[packages/windows/README.md](packages/windows/README.md).

**The asset is a paged B+ tree, not a blob.** It is keyed on toneless pinyin and split
into ~1,200 byte-ranged pages, so a client opens it by reading only the 24-byte header
and the page directory and then fetches just the pages a query touches. Resident memory
is bounded by a 256KB LRU page cache instead of the ~90MB object graph a full parse
costs, which is what makes the same corpus viable in a low-memory process such as an
Android keyboard.

- `LazyPinyinSearchEngine` walks the tree per query; `PinyinSearchEngine` (the in-memory
  trie) is kept for tests and for callers that already hold the dictionary.
- Both engines rank through the same `scoreEntry` in `src/index/ranking.ts` and share one
  scan budget, so they return the same candidates and the same `total` for the same
  query. The lazy engine breaks score ties deterministically (frequency, then key, then
  form) because trie insertion order is not reproducible from a page scan.
- `PageSource` abstracts where pages come from: `HttpPageSource` uses HTTP `Range`
  requests and falls back to one whole-file read if a server ignores `Range`;
  `MemoryPageSource` serves an `mmap` or an in-memory buffer.
- `--format json` still emits the legacy tuple array (`dictionary.json`) for callers that
  want the whole dictionary in a single parse.

The status bar shows the load state; if the asset is missing you get a `Failed to load`
indicator and a banner telling you to run `npm run build:dict`.

## Typing Behavior

Type romanized pinyin into the editor and the candidate list re-ranks on every keystroke.
While a composition is active:

| Key | Action |
| --- | --- |
| `1`–`9` | Select the candidate in that position |
| `Space` | Commit the highlighted candidate |
| `Enter` | Commit the raw pinyin as English text |
| `Backspace` | Delete the last buffered letter, or the character before the cursor when not composing |
| `PageUp` / `PageDown`, `[` / `]` | Flip candidate pages |
| Arrow keys | Move the selection, rolling onto the next page at the end of a list |
| `Escape` | Cancel the composition |

### Number Keys Select Candidates

Number keys pick a candidate for the whole duration of a composition. They are never
appended to the pinyin buffer, so a number key does not type a tone number: typing `shi4`
selects candidate #4 rather than filtering to the fourth tone, and out-of-range digits
(and `0`) are simply ignored. Keeping digits on candidate selection means the key always
does the same predictable thing, instead of changing meaning depending on how many
candidates happen to be on screen.

Tone-number filtering still exists in `@pinyinduck/core` for direct callers — and is used by
the Android keyboard, where candidates are picked by tapping so the digit row is free to
carry tone numbers (`shi` then `4` narrows to shì) — and is covered by the unit tests. Once
no composition is active, number keys are ordinary text input again.

## Android

`packages/android` is a real Android input method, not a wrapper around the web app. It
inherits `InputMethodService`, draws a Jetpack Compose keyboard, and maps the same
`dictionary.btree` the web app serves straight out of the APK, so it works offline and
needs no network permission.

`packages/android` is a Gradle project, so it is built with Gradle rather than npm. From
the repository root:

```bash
npm install                  # once, for the workspace
cd packages/android
./gradlew assembleDebug      # app/build/outputs/apk/debug/app-debug.apk
```

It needs `ANDROID_HOME` set, or `sdk.dir` in `packages/android/local.properties`.

Then enable it under **Settings → System → Languages & input → On-screen keyboard**.
Full instructions, key bindings and troubleshooting are in
[`packages/android/README.md`](packages/android/README.md).

The engine is a Kotlin port of `@pinyinduck/core` rather than a bundled copy of it, so that
a lookup is a synchronous call and `onKeyDown` can rank and commit in one pass with no
bridge and no promise-ordering hazard. The seam that creates is guarded by a parity test:
`npm run build:parity` regenerates a golden file from the TypeScript engine, and
`PinyinEngineParityTest` asserts the Kotlin engine reproduces it exactly.

## Testing

The repository has three test layers:

| Layer | Command | Covers |
| --- | --- | --- |
| Unit (`packages/core`) | `npm test` | Pinyin parsing, syllable segmentation, tone-mark conversion, trie search, ranking, dictionary generation and loading |
| Unit (`packages/windows`) | `npm test` | The Rime dictionary emitter: column order, weights, candidate ordering, duplicate collapsing, and the file writing |
| End-to-end (Playwright) | `npm run test:e2e` | The full IME loop in a real browser: composition, candidate ranking, paging, keyboard shortcuts, text editing, script toggle, dictionary loading |
| Android (`packages/android`) | `./gradlew test` | The Kotlin engine against the real dictionary, its parity with the TypeScript engine, and the composition rules against a fake editor |

Run the browser and unit suites with `npm run test:all`. The Android package is built and
tested with Gradle, so it is not part of the npm workspace scripts; see
[`packages/android/README.md`](packages/android/README.md).

The Playwright suite lives in `e2e/` and is configured by `playwright.config.ts` at the
repo root. It starts the Vite dev server automatically, so no server needs to be running
first. On first use, install the browser binary:

```bash
npx playwright install chromium
```

Useful variations:

```bash
npm run test:e2e -- --ui          # interactive debugger with time-travel
npm run test:e2e -- --headed      # watch the browser drive the IME
npm run test:e2e -- --grep paging # run one area
E2E_HEADLESS=1 npm run test:e2e   # force headless (see below)
```

`CI=1` switches to a single worker with retries and emits a GitHub Actions friendly
report. Traces, screenshots and video are captured on first-retry failures only, and
`playwright-report/` holds the HTML report after a local run.

#### Why the suite runs headed

Chromium's headless mode never schedules animation frames in this environment:
`requestAnimationFrame` never fires, even while the app's infinite CSS animations
(`cursorBlink`, `statusPulse`) are running, and no launch flag changes that
(`--disable-gpu`, swiftshader, `--enable-begin-frame-control` and
`channel: 'chromium'` were all tried).

Playwright's actionability checks implement their "stable" step on top of rAF, so in
headless mode every `click()` and `hover()` blocks until the test times out — while
keyboard-driven tests pass, which makes the failure look like an app bug when it is
not one. A headed browser has a real compositor and produces frames normally.

`playwright.config.ts` therefore runs headed whenever a display is present and falls
back to headless when there is none, so the suite still works on a machine (or CI
image) without an X server. `E2E_HEADLESS=1` forces headless and `E2E_HEADLESS=0`
forces headed, for environments where the default is not what you want.

### Code coverage

| Package | Command | Report | Current |
| --- | --- | --- | --- |
| `@pinyinduck/core` | `npm run test:coverage` | `packages/core/coverage/` | 100% statements, 100% branches, 100% functions |
| `@pinyinduck/web` | `npm run test:e2e` | `coverage/web/` | 99.8% statements, 99% branches, 100% functions |
| `packages/android` | `cd packages/android && ./gradlew check` | `app/build/reports/jacoco/jacocoTestReport/html/` | 92% instructions, 186 tests |
| `@pinyinduck/windows` | `npm run test:coverage -w @pinyinduck/windows` | `packages/windows/coverage/` | 97.94% statements, 96.66% branches, 100% functions |

Run the first two with `npm run test:coverage:all`; the Android one is Gradle and needs no npm.

Every file in both npm packages is above 80% on all four metrics, and both suites enforce
that as a build gate rather than only reporting it. The Android app is gated at 80%
instructions module-wide, plus 85% instruction and branch coverage per class on the portable
half of the code. Its Compose and activity tests run under Robolectric, so the UI and the
`InputMethodService` are covered from the JVM without a device.

Core uses the Vitest V8 provider, configured in `packages/core/vitest.config.ts` with
per-glob thresholds (plus an 80% global floor) so a regression in the engine or the
dictionary pipeline fails the run. Re-export barrels and type-only modules are excluded,
since they compile to no runnable statements and would otherwise report a misleading
zero.

The dictionary builder's download, cache and file-writing paths are covered in
`scripts/build-dictionary-io.test.ts` against a stubbed `fetch` and an in-memory `fs`,
so the build script is held to the same threshold as the runtime engine rather than
being exempt as a build-time tool.

`packages/windows` is held to a 95% floor on all four metrics, for the same reason: a
drift in the Rime dictionary format still compiles and still deploys, and silently drops
every definition or reorders the candidate list. Its file writing is exercised twice —
once against injected fakes and once against a real temporary directory, so the real
`fs` adapter's row buffering is covered too.

The web package has no unit tests: its behaviour is verified through the browser, so its
coverage is measured from the Playwright run instead of duplicating that suite as unit
tests. A fixture starts Chromium's V8 profiler for the duration of each test, and
`e2e/web-coverage-reporter.ts` merges the per-test fragments into an Istanbul report at
the end of the run. The reporter also enforces a coverage floor, setting a non-zero
exit code if the package drops below it even when every test passed. Keeping the
profiler on for every page has a real cost, so set `PW_SKIP_WEB_COVERAGE=1` when
iterating on a single spec.

The one branch still reported as uncovered is Vite's dev-only CJS interop shim in
`main.tsx`; it is not in the production bundle, so there is no runtime behaviour behind
it to test.

### Number key coverage

The number-while-composing behavior documented in [Number Keys Select Candidates](#number-keys-select-candidates)
is pinned by `e2e/number-keys.spec.ts`.