# PinyinDuck for Windows

PinyinDuck for Windows uses Rime/Weasel to provide a real system IME with the same dictionary and ranking rules as the web app.

## Requirements

- Windows with Weasel (小狼毫) installed, with librime-lua from 2023 or later (current Weasel builds include it)
- Somewhere to build with Node.js and the repo's dependencies installed: WSL on the same machine, or Windows itself. Building in WSL and installing from WSL needs nothing on Windows except Weasel

## Build

From the repository root:

```bash
npm install
npm run build:dict
npm run build:rime                         # both platforms
npm run build:rime -- --platform windows   # Windows only
```

This generates everything under `packages/windows/rime/`: the schemas, `default.custom.yaml` and the Lua gloss filter, rendered from `packages/rime/templates/`, plus the two dictionaries and the `lua/pinyinduck_gloss.lua` sidecar. Nothing in that folder is committed.

## Install

If you built in WSL, install from WSL. Windows needs no Node and no copy of the repository:

```bash
bash packages/windows/scripts/install-from-wsl.sh
```

It asks Windows for `%APPDATA%` through `powershell.exe` and writes into `%APPDATA%\Rime` through `/mnt/c`. It merges `default.custom.yaml` with WSL's Node. Set `PINYINDUCK_RIME_DIR` to install into another folder instead.

If the repository and Node are on Windows, run this from the repository root, in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File packages\windows\scripts\install.ps1
```

This one runs `npx tsx` to merge `default.custom.yaml`, so it needs Node on the Windows `PATH` and `npm install` run on Windows. A `node_modules` installed from WSL holds Linux builds that Windows Node can't run.

Both installers do the same thing:

They copy the schemas, dictionaries and Lua files into `%APPDATA%\Rime`, creating that folder if needed. If any generated file is missing they stop and tell you to run the build.

They leave your own Rime setup in place:

- If you already have a `default.custom.yaml`, it adds the two PinyinDuck schemes to it and keeps a timestamped `.bak` copy of the original. Running it again changes nothing.
- They never touch `rime.lua`. The gloss filter is installed as `lua\pinyinduck_gloss_filter.lua`. If an older install left a `pinyinduck_gloss_filter` definition in `rime.lua`, they tell you so you can remove it.
- They delete `%APPDATA%\Rime\build`, so Weasel recompiles the dictionaries instead of reusing stale ones.

Then deploy: right-click the Weasel tray icon → 用户资料 → 重新部署 (User data → Deploy). The first deploy compiles about 122k rows and takes a few seconds. Pass `-Deploy` to `install.ps1` to have it try `rime_deployer.exe` itself. Only older Weasel builds ship it, so when it isn't found the installer prints the manual step.

Switch to PinyinDuck with `Win+Space`. It shows up as a Rime scheme under Weasel's input in Settings → Time & language → Language & region.

## Use

Type pinyin and choose candidates from the menu.

- `Space`: commit the selected candidate
- `1`–`9`, `0`: select a candidate
- `Backspace`: delete the last buffered character
- `Esc`: cancel composition
- `F4` or ``Ctrl+` ``: switch between the simplified and traditional schemes

The dictionary uses toneless syllable codes, so a typed number selects a candidate instead of entering a tone. Each candidate shows its English definition, from the Lua gloss filter.

## Development

This package holds only the two Windows installers. The schemas, the dictionary emitter, the Lua filter, the `default.custom.yaml` merge and the librime checks are shared with macOS in [`packages/rime`](../rime/README.md), so a change to any of them goes there.

```bash
npm test -w @pinyinduck/rime
npm run build:rime
npm run setup:rime   # once: builds librime and a test harness, no sudo
npm run test:rime
```

`npm run test:rime` drives a Linux build of librime, the same engine Weasel bundles.

CI also runs `install.ps1` on `windows-latest`, and `install-from-wsl.sh` on Ubuntu, through `scripts/check-rime-install.mjs`, which points each at a scratch Rime folder and checks three runs: a fresh install, a rerun that changes nothing, and an install over an existing `default.custom.yaml`. To run the same check on a Windows machine after building:

```powershell
node scripts\check-rime-install.mjs windows
```

or, for the WSL installer, `node scripts/check-rime-install.mjs wsl` in WSL.

That check doesn't deploy into Weasel. Deploying and typing into real Windows apps still need a Windows machine.

## Troubleshooting

- PinyinDuck isn't in the scheme list, or Weasel shows its default scheme: one of the files is missing, so the schema didn't compile. Rebuild, reinstall and redeploy.
- No English definitions: check that `lua\pinyinduck_gloss_filter.lua` and `lua\pinyinduck_gloss.lua` are in `%APPDATA%\Rime`, and that your Weasel includes librime-lua from 2023 or later.
- Stale results: reinstall, which clears `%APPDATA%\Rime\build`, then redeploy.
- `npx was not found`: put Node on `PATH` and run the installer again. From WSL, that means WSL's Node.
- `powershell.exe or wslpath was not found` (WSL installer): Windows interop is off in WSL. Turn it back on, or set `PINYINDUCK_RIME_DIR` to `/mnt/c/Users/<you>/AppData/Roaming/Rime`.
