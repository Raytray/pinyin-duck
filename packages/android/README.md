# PinyinDuck for Android

PinyinDuck for Android is an on-screen keyboard (an Android input method) for Mandarin learners. It ranks candidates with the same rules as the web app and reads the same `dictionary.btree` and Candidate detail file (`detail.bin`), both mapped straight out of the APK, so it works offline.

## Requirements

- Android 8.0+ (API 26) on the device
- JDK 17 or newer
- Android SDK with platform 36
- Node.js, to generate the dictionary from the repo root

## Build

From the repository root:

```bash
npm install
npm run build:dict
npm run build:bigrams   # optional, ~2 minutes: the bigram table Sentence candidates score with
cd packages/android
./gradlew assembleDebug
```

`npm run build:dict` writes `packages/web/public/dictionary.btree` and `detail.bin` beside it, from the same build. Both are gitignored, and the Android build copies them into the APK, so Gradle stops with an error naming that command if either file is missing. At runtime the keyboard refuses a `detail.bin` whose build id differs from the dictionary's, and says to rebuild both.

`npm run build:bigrams` writes `bigrams.bin` to the same folder, and the build copies it too when it is there. It is optional: without it the keyboard still offers Sentence candidates, scored on unigram frequencies alone. A `bigrams.bin` that is there but unreadable fails the load, and the message says to rerun that command.

The APK is written to:

```text
packages/android/app/build/outputs/apk/debug/app-debug.apk
```

If Gradle can't find the Android SDK, set `ANDROID_HOME` or add `sdk.dir` to `packages/android/local.properties`.

## Release signing

`./gradlew assembleRelease` signs the APK only when `packages/android/key.properties` exists and names a keystore that is on disk. Without one it produces `app-release-unsigned.apk`.

Keep the keystore outside the repository folder and give its absolute path:

```properties
storeFile=/home/you/.android/keystores/pinyinduck-release.jks
storePassword=...
keyAlias=pinyinduck
keyPassword=...
```

`key.properties*`, `*.jks` and `*.keystore` are gitignored as a backstop, but a keystore in the working tree is still one `git add -f` or a missing ignore away from being committed.

## Install

```bash
adb install -r packages/android/app/build/outputs/apk/debug/app-debug.apk
```

Or copy the APK to the device and install it from there.

## Enable the keyboard

1. Open Settings → System → Languages & input → On-screen keyboard (the exact path varies by manufacturer).
2. Enable PinyinDuck.
3. In a text field, switch to PinyinDuck with the keyboard switcher.

The app also installs a **PinyinDuck settings** launcher icon. It has a shortcut to the system keyboard settings, the default script (Simplified or Traditional), whether the dictionary loaded, and the dictionary credits.

## Use

- Type letters to build pinyin. Candidates update as you type.
- Tap a candidate to commit it, or press `Space` to commit the highlighted one. With no candidates, `Space` commits the pinyin as typed.
- Picking a shorter match keeps the rest buffered: choosing 你 from `nihao` leaves `hao` to finish.
- While composing, `1`–`5` add a tone, so `shi4` shows only shì. Any other digit, or a digit when you're not composing, is typed as-is. This differs from the web app, where digits select candidates.
- Type `'` to split syllables: `xi'an` is 西安, not `xian`.
- `Backspace` removes the last pinyin character, or deletes before the cursor when you're not composing.
- `↵` sends the field's action (Search, Send, Done) or a newline. It doesn't commit a candidate.
- The 简/繁 button switches between Simplified and Traditional without losing the composition. ▴ expands the candidate strip into a full list.
- `?123` and `?#+=` switch to the number and symbol pages.

The keyboard skips pinyin in fields where it would get in the way. Password, email and URL fields get letters typed directly, with no composition or candidates. Number, phone and date fields open on the number page.

With a hardware keyboard, the arrow keys move the highlighted candidate (up and down move by a page), `Esc` cancels the composition and `Enter` behaves like `↵`.

## Development

This is a Gradle project, not an npm package. The `package.json` only makes it a member of the root workspace.

Unit tests run on the JVM with Robolectric, so no device or emulator is needed. They read the real `dictionary.btree`, `detail.bin` and `bigrams.bin`, so run `npm run build:dict` and `npm run build:bigrams` first (the parity golden is generated with the bigram table loaded).

```bash
cd packages/android
./gradlew ktlintCheck          # lint (ktlintFormat fixes most issues)
./gradlew testDebugUnitTest    # unit tests
./gradlew jacocoTestReport     # coverage report
./gradlew check                # lint, Android lint, tests and the coverage gate
```

The coverage report is written to `app/build/reports/jacoco/jacocoTestReport/html/index.html`. `check` fails when either floor is missed:

- **80% instruction coverage** across the whole module.
- **85% instruction and branch coverage** for each class in the code that runs without Android: the pinyin parser, the B-tree reader, ranking, search, the composition session and the key layouts. The list is `gatedClasses` in `app/build.gradle.kts`.

### Parity with the web engine

The search engine in `engine/` is a Kotlin port of `packages/core/src/index/lazy-search.ts`. `PinyinEngineParityTest` compares it to the TypeScript engine's output, which is recorded in `app/src/test/resources/engine-parity.tsv`. If you change ranking, tie-breaking or search in core, regenerate that file and commit it with the change. The same command writes `detail-parity.tsv`, the Candidate detail view for every entry those queries reach, which the Kotlin detail view is pinned to; regenerate it when the detail file or the detail view in core changes:

```bash
npm run build:parity -w @pinyinduck/core
```

## Troubleshooting

- `Missing …/dictionary.btree` or `Missing …/detail.bin` during the build: run `npm run build:dict` at the repo root.
- PinyinDuck isn't in the keyboard list: reinstall the APK, then enable it again under On-screen keyboard.
- The candidate strip shows a dictionary error: the message names the cause and the fix. Usually the APK was built without the dictionary, so run `npm run build:dict` and rebuild.
- `check` fails on coverage: open the HTML report, find the class named in the error and add tests for its uncovered branches.
