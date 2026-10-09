# PinyinDuck 🦆

PinyinDuck is a Mandarin input method for language learners. As you type pinyin, it shows tone-marked candidates with English definitions and frequency-based ranking.

## Packages

- `packages/core`: dictionary engine, search, ranking, and asset generation.
- `packages/web`: browser-based IME playground.
- `packages/android`: Android keyboard app.
- `packages/windows`: Windows IME via Rime/Weasel.
- `packages/macos`: macOS IME via Rime/Squirrel.

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
npm run lint          # repository lint checks
npm test              # unit tests
npm run test:e2e      # browser integration tests
npm run test:all      # unit + e2e tests
```

## Platform packages

- Web: `npm run dev`
- Android: `cd packages/android && ./gradlew assembleDebug`
- Windows: `npm run build:rime` then follow `packages/windows/README.md`
- macOS: `npm run build:rime` then follow `packages/macos/README.md`

## Development notes

- The root workspace uses npm workspaces.
- `packages/core` generates the dictionary data used by the web, Android, Windows, and macOS packages.
- See the package READMEs for setup, installation, and key behavior.

## Testing

```bash
npm test
npm run test:e2e
```

Use `npx playwright install chromium` once if the browser binary is missing.

## Package docs

- [`packages/android/README.md`](packages/android/README.md)
- [`packages/windows/README.md`](packages/windows/README.md)
- [`packages/macos/README.md`](packages/macos/README.md)
