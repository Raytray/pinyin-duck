# PinyinDuck for macOS

PinyinDuck for macOS uses Rime/Squirrel to provide a real system IME with the same dictionary and ranking rules as the web app.

## Requirements

- macOS with Squirrel installed
- Node.js dependencies installed from the repo root
- Optional: build tools for librime validation

## Build

From the repository root:

```bash
npm install
npm run build:dict
npm run build:rime
```

This generates the Rime dictionaries under `packages/macos/rime/`.

## Install

```bash
bash packages/macos/scripts/install.sh
```

The installer leaves your own Rime setup in place. If you already have a `default.custom.yaml`, it adds the two PinyinDuck schemes to it and keeps a timestamped `.bak` copy of the original. Running it again changes nothing. It never touches `rime.lua`: the gloss filter is installed as `lua/pinyinduck_gloss_filter.lua`, which needs librime-lua from 2023 or later.

Then deploy the schema in Squirrel and switch to PinyinDuck with `Ctrl+Space`.

## Use

Type pinyin and choose candidates from the menu.

- `Space`: commit the selected candidate
- `1`–`9`, `0`: select a candidate
- `Backspace`: delete the last buffered character
- `Esc`: cancel composition
- `Ctrl+Space` or `F4`: switch input sources / script mode

The dictionary uses toneless syllable codes, so a typed number selects a candidate instead of entering a tone.

## Development

The macOS package follows the same Rime pattern as the Windows package. Squirrel (鼠须管) is the macOS frontend for librime, as Weasel (小狼毫) is on Windows, so both share the schema format, the dictionary format and the Lua gloss filter. `src/rime-dict.ts` re-exports the dictionary emitter from `@pinyinduck/windows`; only installation and deployment differ.

| | Windows | macOS |
|---|---|---|
| Rime frontend | Weasel (小狼毫) | Squirrel (鼠须管) |
| Install path | `%APPDATA%\Rime\` | `~/Library/Rime/` |
| Installer | `install.ps1` | `install.sh` |

Schema generation, the dictionary build, the Lua filter and schema validation against librime all run on Linux. Installing, deploying and composing in real macOS apps need a Mac.

```bash
npm test -w @pinyinduck/macos
npm run build:rime
```

See `packages/macos/scripts` for generation and install logic.

## Troubleshooting

- No tray menu item: reinstall and redeploy the schema.
- Empty candidate list: rebuild the dictionary and reinstall the generated files.
- Stale predictions: clear `~/Library/Rime/build` and redeploy.
