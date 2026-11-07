# @pinyinduck/rime

The Rime files PinyinDuck installs on Windows (Weasel) and macOS (Squirrel). Both are frontends for the same librime, so they read the same schemas, the same dictionary format and the same Lua filter. This package holds one copy of each and renders it into each platform's `rime/` folder. The platform packages, [`packages/windows`](../windows/README.md) and [`packages/macos`](../macos/README.md), hold only their installers.

## Layout

| Path | What it is |
| --- | --- |
| `templates/` | The schemas, `default.custom.yaml` and the Lua gloss filter, with `{{HOST}}`, `{{OS}}`, `{{PLATFORM}}` and `{{INSTALL_COMMAND}}` placeholders. |
| `src/rime-platform.ts` | The platform table those placeholders are filled from. This is the only place the two platforms differ. |
| `src/rime-dict.ts` | The dictionary emitter: codes, weights, comments and row order. |
| `scripts/build-rime-dict.ts` | `npm run build:rime`. Renders the templates and writes the dictionaries and gloss sidecar into `packages/<platform>/rime/`. |
| `scripts/install-default-custom.ts` | Merges `default.custom.yaml` into the user's own. Both installers call it. |
| `scripts/verify-rime.ts`, `tools/` | `npm run setup:rime` builds librime and a small harness without sudo; `npm run test:rime` types into it for each platform. |

## Commands

From the repository root:

```bash
npm run build:dict                       # the dictionary asset everything reads
npm run build:rime                       # both platforms
npm run build:rime -- --platform macos   # one platform
npm test -w @pinyinduck/rime
npm run setup:rime                       # once
npm run test:rime
```

Everything under `packages/windows/rime/` and `packages/macos/rime/` is generated and gitignored. Edit the templates, not those files; `scripts/generated-dicts.test.ts` fails when a built folder no longer matches its template.

## Where the definition comes from

librime's dictionary format has no field for a definition. A `.dict.yaml` row is text, code and weight; `EntryCollector` never reads a comment column, so the definition column the emitter writes is dropped at compile time. It is still written, so a librime that grows a definition field would deliver it without a rebuild.

What actually puts the English on each candidate is the Lua filter. The build also writes `lua/pinyinduck_gloss.lua`, a table from candidate text and toneless code to definition, and the schema's `lua_filter@*pinyinduck_gloss_filter` looks every candidate up in it. Without librime-lua, or without the sidecar, the filter passes candidates through unchanged and each shows its spelling instead.
