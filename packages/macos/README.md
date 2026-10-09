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

The macOS package reuses the same dictionary generator and Rime schema logic as the Windows package.

```bash
npm test -w @pinyinduck/macos
npm run build:rime
```

See `packages/macos/scripts` for generation and install logic.

## Troubleshooting

- No tray menu item: reinstall and redeploy the schema.
- Empty candidate list: rebuild the dictionary and reinstall the generated files.
- Stale predictions: clear `~/Library/Rime/build` and redeploy.
