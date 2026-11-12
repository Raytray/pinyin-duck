# PinyinDuck

PinyinDuck is a Mandarin input method for language learners. As you type pinyin, it shows
tone-marked candidates with concise English definitions, ranked by match quality, word
length, frequency, and HSK level.

## Packages

| Package | Description |
| --- | --- |
| `packages/core` | Dictionary engine, pinyin parser, search, ranking, and asset generation. |
| `packages/web` | Browser-based IME playground. |
| `packages/android` | Android keyboard app. |
| `packages/rime` | Shared Rime schema templates, dictionary emitter and librime checks for Windows and macOS. |
| `packages/windows` | Windows IME via Rime/Weasel: the installer. |
| `packages/macos` | macOS IME via Rime/Squirrel: the installer. |

## Architecture

- `packages/core` builds a paged B+ tree dictionary from CC-CEDICT, frequency data, and
  HSK levels. Clients read only the pages a query touches through an LRU page cache.
- `packages/core` ships TypeScript source, not build output: its `package.json` `exports`
  point at `src/index.ts`. Web and Rime both depend on it as `@pinyinduck/core` and import
  only that package name, so `tsc`, Vite, Vitest and `tsx` all read core's source directly
  and nothing has to build core first.
- Search is a lazy B-tree engine (web, with a Kotlin port on Android) that ranks through
  the shared `scoreEntry` formula and `compareScored` order.
- Pinyin is segmented into Mandarin syllables; tone numbers can filter readings at the
  engine level.
- Candidates are deduplicated by displayed Hanzi and ranked by exact/prefix match,
  multi-character word preference, frequency, and HSK level.

## Key behavior

- Number keys select candidates during composition; they do not enter tone numbers.
  Tone-number filtering remains available to direct callers of `@pinyinduck/core`.
- Web reports at most 50 candidates per query.
- Script can be toggled between Simplified and Traditional Chinese.

## Prerequisites

- Node.js with npm workspaces.
- Java 17 for the Android package.
- Rime tooling for Windows/macOS verification (see package READMEs).

## Quick start

```bash
npm install
npm run build:dict
npm run dev
```

The generated dictionary asset is not committed. Build it once per checkout.

## Common commands

```bash
npm run build          # build the dictionary and package assets
npm run lint           # repository lint checks
npm test               # unit tests
npm run test:e2e       # browser integration tests
npm run test:all       # unit + e2e tests
npm run test:coverage:all
npm run ci -w @pinyinduck/<core|web|android|rime>   # one package's CI checks
```

Each package's `ci` script runs exactly what that package's CI job runs. Build the
dictionary assets first (`npm run build:dict && npm run build:rime`). Android needs Java 17
and the Android SDK; Rime runs its librime check only after `npm run setup:rime`.

## Platform packages

- Web: `npm run dev`
- Android: `cd packages/android && ./gradlew assembleDebug`
- Windows: `npm run build:rime`, then follow `packages/windows/README.md`
- macOS: `npm run build:rime`, then follow `packages/macos/README.md`

## Testing

```bash
npm test
npm run test:e2e
```

Use `npx playwright install chromium` once if the browser binary is missing.

Android:

```bash
cd packages/android && ./gradlew test
cd packages/android && ./gradlew check
```

## Package docs

- [`packages/android/README.md`](packages/android/README.md)
- [`packages/rime/README.md`](packages/rime/README.md)
- [`packages/windows/README.md`](packages/windows/README.md)
- [`packages/macos/README.md`](packages/macos/README.md)
- [`docs/roadmap.md`](docs/roadmap.md)

## License

The code is under the [MIT License](LICENSE). The dictionary is built from CC-CEDICT,
FrequencyWords and an HSK word list, and the built dictionary files are under
CC BY-SA 4.0. [DATA_LICENSES.md](DATA_LICENSES.md) credits each source and lists the
files that license covers.
