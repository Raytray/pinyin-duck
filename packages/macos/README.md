# PinyinDuck for macOS

PinyinDuck for macOS uses Rime/Squirrel to provide a real system IME with the same dictionary and ranking rules as the web app.

## Requirements

- macOS with Squirrel (鼠须管) installed, with librime-lua from 2023 or later (current Squirrel builds include it)
- Node.js on `PATH`, with the repo's dependencies installed. The installer runs `npx tsx` from the repo root to merge `default.custom.yaml`
- Optional: build tools for the librime checks (`npm run setup:rime`)

## Build

From the repository root:

```bash
npm install
npm run build:dict
npm run build:rime                       # both platforms
npm run build:rime -- --platform macos   # macOS only
```

This generates everything under `packages/macos/rime/`: the schemas, `default.custom.yaml` and the Lua gloss filter, rendered from `packages/rime/templates/`, plus the two dictionaries and the `lua/pinyinduck_gloss.lua` sidecar. Nothing in that folder is committed.

## Install

From the repository root:

```bash
bash packages/macos/scripts/install.sh
```

The installer copies the schemas, dictionaries and Lua files into `~/Library/Rime`, creating that folder if needed. If any generated file is missing it stops and tells you to run the build.

It leaves your own Rime setup in place:

- If you already have a `default.custom.yaml`, it adds the two PinyinDuck schemes to it and keeps a timestamped `.bak` copy of the original. Running it again changes nothing.
- It never touches `rime.lua`. The gloss filter is installed as `lua/pinyinduck_gloss_filter.lua`. If an older install left a `pinyinduck_gloss_filter` definition in `rime.lua`, the installer tells you so you can remove it.
- It deletes `~/Library/Rime/build`, so Squirrel recompiles the dictionaries instead of reusing stale ones.

Then deploy from the Squirrel menu bar icon → Deploy. The first deploy compiles about 122k rows and takes a few seconds. There is no automatic deploy option.

If Squirrel isn't an input source yet, add it under System Settings → Keyboard → Input Sources → + → Chinese, Simplified. Switch to it with `Ctrl+Space`.

## Use

Type pinyin and choose candidates from the menu.

- `Space`: commit the selected candidate
- `1`–`9`, `0`: select a candidate
- `Backspace`: delete the last buffered character
- `Esc`: cancel composition
- `F4` or ``Ctrl+` ``: switch between the simplified and traditional schemes

The dictionary uses toneless syllable codes, so a typed number selects a candidate instead of entering a tone. Each candidate shows its English definition, from the Lua gloss filter.

## Development

Squirrel (鼠须管) is the macOS frontend for librime, as Weasel (小狼毫) is on Windows, so both share the schema format, the dictionary format and the Lua gloss filter. All of that, plus the `default.custom.yaml` merge, lives in [`packages/rime`](../rime/README.md); this package holds only the macOS installer.

| | Windows | macOS |
|---|---|---|
| Rime frontend | Weasel (小狼毫) | Squirrel (鼠须管) |
| Install path | `%APPDATA%\Rime\` | `~/Library/Rime/` |
| Installer | `install.ps1` | `install.sh` |

Schema generation, the dictionary build, the Lua filter and schema validation against librime all run on Linux:

```bash
npm test -w @pinyinduck/rime
npm run build:rime
npm run setup:rime   # once: builds librime and a test harness, no sudo
npm run test:rime
```

CI also runs `install.sh` on `macos-latest` through `scripts/check-rime-install.mjs`, which points it at a scratch `HOME` and checks three runs: a fresh install, a rerun that changes nothing, and an install over an existing `default.custom.yaml`. To run the same check on a Mac after building:

```bash
node scripts/check-rime-install.mjs macos
```

That check doesn't deploy into Squirrel. Deploying and typing into real macOS apps still need a Mac.

## Troubleshooting

- PinyinDuck isn't in the scheme list, or Squirrel shows its default scheme: one of the files is missing, so the schema didn't compile. Rebuild, reinstall and redeploy.
- No English definitions: check that `lua/pinyinduck_gloss_filter.lua` and `lua/pinyinduck_gloss.lua` are in `~/Library/Rime`, and that your Squirrel includes librime-lua from 2023 or later.
- Stale results: reinstall, which clears `~/Library/Rime/build`, then redeploy.
- `npx was not found`: put Node on `PATH` and run the installer again.
