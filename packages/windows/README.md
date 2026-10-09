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

This generates the Rime dictionaries under `packages/windows/rime/`.

## Install

After building, install the generated files into your Rime user directory:

```powershell
powershell -ExecutionPolicy Bypass -File packages\windows\scripts\install.ps1
```

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

The Windows package is generated from the shared core engine and Rime schema templates.

```bash
npm test -w @pinyinduck/windows
npm run build:rime
```

See the package source for the dictionary emitter and install script.

## Troubleshooting

- No tray menu item: reinstall and deploy the schema.
- No candidates: rebuild the dictionary and reinstall the generated files.
- Stale results: clear `%APPDATA%\Rime\build` and redeploy.
