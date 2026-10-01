#!/usr/bin/env bash
#
# install.sh — Installs the PinyinDuck Rime schemas into the Squirrel user folder.
#
# Copies the two schemas, the default.yaml patch and the generated dictionaries into
# ~/Library/Rime, then makes Squirrel rebuild them. Everything is copied from this
# repository's packages/macos/rime folder, so run `npm run build:rime` first: the
# dictionaries are generated from the shared CC-CEDICT asset and are not committed.
#
# Squirrel recompiles a dictionary whenever the .dict.yaml file changes, so reinstalling
# after a rebuild is just this script again.
#
# Usage:
#   bash packages/macos/scripts/install.sh
#
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "$0")/../rime" && pwd)"
RIME_DIR="${HOME}/Library/Rime"

# Both dictionaries and both schemas have to be present together: a schema naming a
# dictionary that is missing fails to compile, and Squirrel then silently falls back to
# its own default scheme, which looks like the install did nothing. The Lua gloss filter
# and its sidecar are required too: without them the schema still works but shows no
# definitions.
REQUIRED_FILES=(
  'pinyinduck.schema.yaml'
  'pinyinduck_trad.schema.yaml'
  'default.custom.yaml'
  'pinyinduck.dict.yaml'
  'pinyinduck_trad.dict.yaml'
  'rime.lua'
  'lua/pinyinduck_gloss.lua'
)

format_size() {
  local bytes=$1
  echo "$(echo "scale=1; $bytes / 1048576" | bc) MB"
}

echo ''
echo 'PinyinDuck -> Rime (Squirrel)'
echo ''

missing=()
for name in "${REQUIRED_FILES[@]}"; do
  if [[ ! -f "$SOURCE_DIR/$name" ]]; then
    missing+=("$name")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  # The dictionaries and the Lua sidecar are generated together, so this is almost always
  # the cause.
  generated_missing=()
  for name in "${missing[@]}"; do
    if [[ "$name" == *.dict.yaml ]] || [[ "$name" == lua/* ]]; then
      generated_missing+=("$name")
    fi
  done

  if [[ ${#generated_missing[@]} -gt 0 ]]; then
    echo "The generated files are missing from $SOURCE_DIR." >&2
    echo '' >&2
    echo 'Run this from the repository root first:' >&2
    echo '' >&2
    echo '    npm run build:dict' >&2
    echo '    npm run build:rime' >&2
    echo '' >&2
  fi
  echo "Missing file(s): ${missing[*]}" >&2
  exit 1
fi

echo "  source  $SOURCE_DIR"
echo "  target  $RIME_DIR"
echo ''

if [[ ! -d "$RIME_DIR" ]]; then
  mkdir -p "$RIME_DIR"
  echo '  created the Rime user folder (Squirrel may not be installed yet)'
fi

# The Lua gloss sidecar lives in a subdirectory, which has to exist before it is copied.
lua_dir="$RIME_DIR/lua"
if [[ ! -d "$lua_dir" ]]; then
  mkdir -p "$lua_dir"
fi

for name in "${REQUIRED_FILES[@]}"; do
  source="$SOURCE_DIR/$name"
  cp -f "$source" "$RIME_DIR/$name"
  size=$(format_size $(stat -f%z "$source"))
  printf '  copied  %-28s %10s\n' "$name" "$size"
done

# Rime keeps compiled output in a build subfolder. Its checksums would otherwise make
# Squirrel reuse a stale table if a dictionary were regenerated with the same name.
build_dir="$RIME_DIR/build"
if [[ -d "$build_dir" ]]; then
  echo '  cleared the previous build so the dictionaries are recompiled'
  rm -rf "$build_dir"
fi

echo ''
echo 'Installed.'
echo ''
echo 'Make Squirrel rebuild the dictionaries:'
echo '  Right-click the Squirrel tray icon -> Deploy'
echo ''
echo 'Then add it to macOS:'
echo '  1. System Settings -> Keyboard -> Input Sources'
echo '  2. Click + and add "PinyinDuck" under Chinese'
echo '  3. Switch to it with Ctrl+Space, and between the simplified and traditional'
echo '     schemes with F4 or Ctrl+`'
echo ''
echo 'The first deploy compiles 122k rows and takes a few seconds. The second'
echo 'scheme switch is instant.'
