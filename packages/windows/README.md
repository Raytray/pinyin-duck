# PinyinDuck for Windows

PinyinDuck for Windows uses Rime/Weasel to provide a real system IME with the same dictionary and ranking rules as the web app.

## Requirements

- Windows host with Weasel installed
- WSL or a Linux/macOS environment for building the generated dictionary
- Node.js dependencies installed from the repo root

## Build

From the repository root:

```bash
npm install
npm run build:dict
npm run build:rime
```

This generates everything under `packages/windows/rime/`: the schemas, rendered from `packages/rime/templates/`, and the dictionaries. Nothing in that folder is committed.

## Install

After building, install the generated files into your Rime user directory:

```powershell
powershell -ExecutionPolicy Bypass -File packages\windows\scripts\install.ps1
```

The installer leaves your own Rime setup in place. If you already have a `default.custom.yaml`, it adds the two PinyinDuck schemes to it and keeps a timestamped `.bak` copy of the original. Running it again changes nothing. It never touches `rime.lua`: the gloss filter is installed as `lua\pinyinduck_gloss_filter.lua`, which needs librime-lua from 2023 or later.

Then deploy the schema in Weasel and switch to PinyinDuck with `Win+Space`.

## Use

Type pinyin and choose candidates from the menu.

- `Space`: commit the selected candidate
- `1`–`9`, `0`: select a candidate
- `Backspace`: delete the last buffered character
- `Esc`: cancel composition
- `F4` or ``Ctrl+` ``: switch between simplified and traditional dictionaries

The dictionary uses toneless syllable codes, so a typed number selects a candidate instead of entering a tone.

## Development

This package holds only the Windows installer. The schemas, the dictionary emitter, the Lua filter and the librime checks are shared with macOS in [`packages/rime`](../rime/README.md), so a change to any of them goes there.

```bash
npm test -w @pinyinduck/rime
npm run build:rime
npm run test:rime
```

`npm run test:rime` drives a Linux build of librime, the same engine Weasel bundles. Installing, deploying and typing into real Windows apps need a Windows machine.

## Troubleshooting

- No tray menu item: reinstall and deploy the schema.
- No candidates: rebuild the dictionary and reinstall the generated files.
- Stale results: clear `%APPDATA%\Rime\build` and redeploy.
