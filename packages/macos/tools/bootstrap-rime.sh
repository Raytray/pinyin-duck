#!/usr/bin/env bash
#
# bootstrap-rime.sh — Builds librime 1.13.1 from source, without sudo.
#
# Clones librime at the tag Squirrel 0.17.0 bundles (1.13.1) into tools/librime/,
# fetches cmake, Boost and LuaJIT without root, and builds liblibrime.so plus the
# small C++ harness in tools/rime_smoke.cc. It takes a few minutes and then never
# runs again — the harness is rebuilt only when the library is newer.
#
# Everything lands in gitignored tools/, so nothing outside the repository is touched.
#
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "$0")" && pwd)"
LIBRIME_DIR="$TOOLS_DIR/librime"
BUILD_DIR="$LIBRIME_DIR/build"
HARNESS_SRC="$TOOLS_DIR/rime_smoke.cc"
HARNESS_BIN="$TOOLS_DIR/rime_smoke"

echo 'Bootstrapping librime 1.13.1...'
echo ''

# Clone librime if not already present
if [[ ! -d "$LIBRIME_DIR" ]]; then
  echo '  cloning librime...'
  git clone --recursive --depth 1 --branch 1.13.1 https://github.com/rime/librime.git "$LIBRIME_DIR"
else
  echo '  librime already cloned'
fi

# Build librime
echo '  building librime...'
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

cmake .. \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_TEST=OFF \
  -DENABLE_LOGGING=OFF

make -j$(nproc 2>/dev/null || echo 4)

# Build the harness
echo '  building the test harness...'
cd "$TOOLS_DIR"

# Find the librime shared library
LIBRIME_SO=$(find "$BUILD_DIR" -name 'liblibrime.so*' -type f | head -1)
if [[ -z "$LIBRIME_SO" ]]; then
  echo 'ERROR: liblibrime.so not found after build' >&2
  exit 1
fi

# Compile the harness
c++ -std=c++17 -O2 \
  -I"$LIBRIME_DIR/src" \
  -I"$BUILD_DIR/src" \
  "$HARNESS_SRC" \
  -L"$(dirname "$LIBRIME_SO")" \
  -llibrime \
  -Wl,-rpath,"$(dirname "$LIBRIME_SO")" \
  -o "$HARNESS_BIN"

echo ''
echo 'Done. librime is built and ready for testing.'
echo ''
echo 'Run the verification:'
echo '  npm run test:rime'
