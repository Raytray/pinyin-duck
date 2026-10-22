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
| `packages/windows` | Windows IME via Rime/Weasel. |
| `packages/macos` | macOS IME via Rime/Squirrel. |

## Architecture

- `packages/core` builds a paged B+ tree dictionary from CC-CEDICT, frequency data, and
  HSK levels. Clients read only the pages a query touches through an LRU page cache.
- Search is available as an in-memory trie engine (tests and callers holding the data)
  and a lazy B-tree engine (web and Android). Both rank through the shared `scoreEntry`
  formula.
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
```

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
- [`packages/windows/README.md`](packages/windows/README.md)
- [`packages/macos/README.md`](packages/macos/README.md)
- [`docs/roadmap.md`](docs/roadmap.md)