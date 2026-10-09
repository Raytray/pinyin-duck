#!/usr/bin/env bash
#
# bootstrap-rime.sh — Builds librime 1.13.1 from source, without sudo.
#
# Clones librime at the tag Squirrel 0.17.0 bundles (1.13.1) into tools/librime/ and
# builds librime.so plus the small C++ harness in tools/rime_smoke.cc. It takes a few
# minutes and then never runs again — the harness is rebuilt only when the library is newer.
#
# Unlike the Windows package's copy of this script, the build dependencies here are the
# system ones (Boost, yaml-cpp, leveldb, marisa, opencc), installed by CI. On a machine
# without them, cmake configure fails with "Could not find yaml-cpp library" and the like.
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
  -DBUILD_SHARED_LIBS=ON \
  -DBUILD_TEST=OFF \
  -DENABLE_LOGGING=OFF

make -j$(nproc 2>/dev/null || echo 4)

# Build the harness
echo '  building the test harness...'
cd "$TOOLS_DIR"

# Find the librime shared library.
#
# The CMake target is named `rime`, not `librime`, so the output is `librime.so` with no
# `lib` prefix, and `LIBRARY_OUTPUT_DIRECTORY` in src/CMakeLists.txt puts it in build/lib/.
# Globbing for `liblibrime.so*` matches nothing and fails the build with a misleading
# "not found after build" even when the library was produced.
LIBRIME_LIB="$BUILD_DIR/lib"
if [[ ! -f "$LIBRIME_LIB/librime.so" ]]; then
  echo 'ERROR: librime.so not found after build' >&2
  echo "  expected it at: $LIBRIME_LIB/librime.so" >&2
  echo '  found instead:' >&2
  find "$BUILD_DIR" -name '*.so*' >&2 || true
  exit 1
fi
LIBRIME_SO="$LIBRIME_LIB/librime.so"

# Compile the harness.
#
# -Wno-missing-field-initializers: RIME_STRUCT expands to `Type var = {0}`, which warns about
# every member the macro cannot name. It is librime's idiom, not ours — the same suppression
# the Windows package's copy of this script uses.
c++ -std=c++17 -O2 -Wall -Wextra -Wno-missing-field-initializers \
  -I"$LIBRIME_DIR/src" \
  -I"$BUILD_DIR/src" \
  "$HARNESS_SRC" \
  -L"$(dirname "$LIBRIME_SO")" \
  -lrime \
  -Wl,-rpath,"$(dirname "$LIBRIME_SO")" \
  -o "$HARNESS_BIN"

echo ''
echo 'Done. librime is built and ready for testing.'
echo ''
echo 'Run the verification:'
echo '  npm run test:rime'
