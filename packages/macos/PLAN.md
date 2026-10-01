# PinyinDuck for macOS — Implementation Plan

## Approach

The macOS version follows the **same Rime/Squirrel pattern** as the Windows package. Squirrel (鼠须管) is the macOS frontend for Rime, just as Weasel is the Windows frontend. They share the same schema format, dictionary format, and Lua filter mechanism.

- The **same core engine** (`@pinyinduck/core`) powers the macOS IME
- The **same B+ tree dictionary** is used
- The **same Rime schema format** is generated
- The **same Lua gloss filter** delivers English definitions
- Only the **installation, deployment, and some schema settings** differ

This approach can be **built and tested on Linux** (the schema generation is TypeScript), just like the Windows package.

## Package Structure

```
packages/macos/
├── package.json              # npm workspace package
├── tsconfig.json             # TypeScript config (same pattern as windows)
├── vitest.config.ts          # Coverage config (95% floor, same as windows)
├── PLAN.md                   # This file
├── README.md                 # macOS-specific documentation
├── src/
│   └── rime-dict.ts          # Re-export from @pinyinduck/windows (shared emitter)
├── scripts/
│   ├── build-rime-dict.ts    # Build script (adapted for macOS paths)
│   ├── install.sh            # macOS installation script (replaces install.ps1)
│   └── verify-rime.ts        # Verification script (same as windows)
├── rime/
│   ├── pinyinduck.schema.yaml       # Simplified schema (macOS-adapted)
│   ├── pinyinduck_trad.schema.yaml  # Traditional schema
│   ├── default.custom.yaml          # Squirrel user config patch
│   ├── rime.lua                     # Lua gloss filter (same as windows)
│   └── *.dict.yaml                  # Generated, not committed
└── tools/
    └── bootstrap-rime.sh            # Same as windows (builds librime for testing)
```

## Key Differences from Windows

| Aspect | Windows | macOS |
|--------|---------|-------|
| Rime frontend | Weasel (小狼毫) | Squirrel (鼠须管) |
| Install path | `%APPDATA%\Rime\` | `~/Library/Rime/` |
| Install script | `install.ps1` (PowerShell) | `install.sh` (bash) |
| Deploy command | Right-click tray → 重新部署 | Right-click tray → Deploy |
| Schema tweaks | Windows key bindings | macOS key bindings (Cmd vs Ctrl) |
| Switch key | `F4` / ``Ctrl+` `` | `Ctrl+Space` / `F4` |

## Implementation Steps

1. **Create `packages/macos/package.json`** — npm workspace package with build/test scripts
2. **Create `packages/macos/tsconfig.json`** — same pattern as windows
3. **Create `packages/macos/vitest.config.ts`** — 95% coverage floor
4. **Create `packages/macos/src/rime-dict.ts`** — re-export the emitter from `@pinyinduck/windows`
5. **Create `packages/macos/scripts/build-rime-dict.ts`** — adapted build script with macOS paths
6. **Create `packages/macos/rime/pinyinduck.schema.yaml`** — simplified schema with macOS-specific settings
7. **Create `packages/macos/rime/pinyinduck_trad.schema.yaml`** — traditional schema
8. **Create `packages/macos/rime/default.custom.yaml`** — Squirrel user config patch
9. **Create `packages/macos/rime/rime.lua`** — Lua gloss filter (same as windows)
10. **Create `packages/macos/scripts/install.sh`** — bash installation script
11. **Create `packages/macos/scripts/verify-rime.ts`** — verification script
12. **Create `packages/macos/tools/bootstrap-rime.sh`** — librime build script
13. **Create tests** — unit tests for the build script and schema verification
14. **Create `packages/macos/README.md`** — macOS-specific documentation
15. **Update root `package.json`** — add macOS workspace scripts
16. **Update `README.md`** — add macOS to the packages list
17. **Update `PLAN.md`** — add Milestone 4 (macOS)

## What Can Be Tested on Linux

- Schema generation (TypeScript)
- Dictionary building from the B+ tree
- Lua filter logic
- Install script logic (with mocked filesystem)
- Schema validation against librime (same as Windows)

## What Requires a Mac

- Actual installation and deployment
- Squirrel tray menu interaction
- Composing in macOS apps
- The deploy step

## Schema Adaptations for macOS

The schema will be largely the same as the Windows version, with these macOS-specific changes:

1. **Key bindings**: Use `Cmd` instead of `Ctrl` for some shortcuts
2. **Switch key**: `Ctrl+Space` is the standard macOS input source switch
3. **Punctuation**: macOS uses different punctuation conventions
4. **Deploy**: Squirrel's deploy mechanism differs from Weasel's
