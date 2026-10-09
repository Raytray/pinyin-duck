# PinyinDuck for Android

PinyinDuck for Android is a real keyboard input method for Mandarin learners. It uses the same dictionary and ranking logic as the web app, but runs as an Android IME with offline access.

## Requirements

- Android 8.0+ (API 26)
- JDK 17+
- Android SDK with platform 35 and build-tools 35.0.0

## Build

From the repo root:

```bash
npm install
cd packages/android
./gradlew assembleDebug
```

The APK is written to:

```text
packages/android/app/build/outputs/apk/debug/app-debug.apk
```

If Android SDK is not found, either set `ANDROID_HOME` or add `sdk.dir` in `packages/android/local.properties`.

## Install

```bash
adb install -r packages/android/app/build/outputs/apk/debug/app-debug.apk
```

Or copy the APK to the device and install it manually.

## Enable the keyboard

1. Open Settings → System → Languages & input → On-screen keyboard.
2. Enable PinyinDuck.
3. Set it as the active keyboard.

## Use

- Tap letters to build a pinyin syllable.
- Candidate suggestions update as you type.
- Tap a candidate to commit it.
- Use the number keys while composing to choose candidates, or enter tone numbers when not in composition.
- `Space` commits the selected candidate; `Backspace` deletes the current buffer.

For more detail, see the full input behavior in the app and the shared project docs.

## Development

This is a Gradle project, not an npm package. The root workspace is mainly for shared tooling and dictionary generation.

```bash
npm install
cd packages/android
./gradlew test
./gradlew check
```

## Troubleshooting

- Keyboard does not appear: reinstall the APK and enable it again.
- No candidates: rebuild the dictionary with `npm run build:dict` from the repo root.
- Dictionary load fails: ensure the generated `dictionary.btree` asset is present.
