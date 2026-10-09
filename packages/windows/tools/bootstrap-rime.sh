#!/usr/bin/env bash
#
# Provisions a headless librime so `npm run test:rime` can prove the generated
# dictionaries and schemas really load, without installing anything system-wide.
#
# The unit tests in this package assert against a *reading* of librime's source: that
# the body is TSV, that `columns` must name `comment`, that `SortHomophones` is a
# stable sort by weight. If any of that reading is wrong, every test still passes and
# Weasel still fails at deploy time. This script builds the actual engine and
# `verify-rime.ts` runs the real thing, so a misreading fails here instead.
#
# Everything lands under tools/.local/ and tools/librime/, both gitignored. Nothing is
# installed, nothing is written outside the package, and no step needs sudo: cmake comes
# from a PyPI wheel and Boost and LuaJIT from .deb files fetched with `apt-get download`
# and unpacked with `dpkg-deb -x`.
#
# Usage:
#   npm run setup:rime        # from the repository root
#
# Overridable:
#   RIME_TAG       librime version to build. 1.11.2 is what Weasel 0.17.4 bundles, so
#                  the test runs against the same engine the Windows host will use.
#   BOOST_SERIES   Boost minor version to fetch, e.g. 1.74. Auto-detected on Ubuntu.
#   JOBS           parallel compile jobs. Defaults to nproc.

set -euo pipefail

RIME_TAG="${RIME_TAG:-1.13.1}"
JOBS="${JOBS:-$(nproc)}"

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${TOOLS_DIR}/.local"
LIBRIME_DIR="${TOOLS_DIR}/librime"
LIBRIME_BUILD="${LIBRIME_DIR}/build"
# The shared library lands in build/lib, not build/src, because the src subdirectory sets
# LIBRARY_OUTPUT_PATH for it.
LIBRIME_LIB="${LIBRIME_BUILD}/lib"
HARNESS="${PREFIX}/bin/rime_smoke"
DEB_DIR="${PREFIX}/debs"
BOOST_DIR="${PREFIX}/boost"
# LuaJIT and its pkg-config, unpacked from .deb files like Boost. The schema's
# `lua_filter@pinyinduck_gloss_filter` needs librime's lua plugin, which links against
# LuaJIT; this is what makes pkg-config find it.
LUAJIT_DIR="${PREFIX}/luajit"
LUAJIT_LIB="${LUAJIT_DIR}/usr/lib/x86_64-linux-gnu"

# librime's own dependency build shells out to `cmake` by name, so the wheel's copy has
# to be on PATH before it runs.
export PATH="${PREFIX}/bin:${PATH}"

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die() { printf '\n\033[31merror: %s\033[0m\n\n' "$*" >&2; exit 1; }

# --------------------------------------------------------------------------------------
# cmake, from a PyPI wheel so nothing is installed
# --------------------------------------------------------------------------------------
ensure_cmake() {
  # Two things have to hold for the cached copy to be usable: it needs its Modules tree
  # (the binary runs fine without it and only fails once it configures a project), and it
  # has to be the 3.x line (see below).
  local modules
  modules="$(compgen -G "${PREFIX}/share/cmake-*/Modules/CMake.cmake" || true)"
  if [[ -x "${PREFIX}/bin/cmake" && -n "${modules}" ]]; then
    local cached_version
    cached_version="$("${PREFIX}/bin/cmake" --version | head -1)"
    if [[ "${cached_version}" == "cmake version 3."* ]]; then
      info "cmake: ${PREFIX}/bin/cmake (${cached_version}, cached)"
      return
    fi
  fi
  rm -rf "${PREFIX}/bin" "${PREFIX}/share"
  command -v python3 >/dev/null || die "python3 is required to fetch cmake without sudo."

  step "Fetching cmake"
  local wheel
  wheel="$(mktemp -d)"
  # Deliberately the 3.x line. librime 1.11.2 is a 2023 release and its bundled
  # yaml-cpp 0.8.0 still declares `cmake_minimum_required(VERSION 3.4)`, which CMake 4
  # refuses outright. Staying on 3.x keeps the pinned upstream source untouched instead of
  # patching a submodule to accommodate a build tool.
  python3 -m pip download 'cmake>=3.20,<4' --no-deps --quiet --dest "${wheel}" \
    || die "Could not download a cmake wheel. Check the network, or install cmake 3.x and put it on PATH."
  python3 - "${wheel}" "${PREFIX}" <<'PY'
import os, sys, zipfile, glob
wheel_dir, prefix = sys.argv[1], sys.argv[2]
whl = glob.glob(os.path.join(wheel_dir, 'cmake-*.whl'))
if not whl:
    raise SystemExit('no cmake wheel was downloaded')
with zipfile.ZipFile(whl[0]) as z:
    for name in z.namelist():
        # The wheel stores the install tree under cmake/data/: the executables in bin/
        # and, just as importantly, the share/cmake-<ver>/Modules tree that cmake needs
        # to find its own modules. Extracting bin/ alone yields a binary that exits with
        # "Could not find CMAKE_ROOT".
        if not name.startswith('cmake/data/') or name.endswith('/'):
            continue
        rel = name[len('cmake/data/'):]
        target = os.path.join(prefix, rel)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with z.open(name) as src, open(target, 'wb') as dst:
            dst.write(src.read())
        if rel.startswith('bin/'):
            os.chmod(target, 0o755)
PY
  rm -rf "${wheel}"
  compgen -G "${PREFIX}/share/cmake-*/Modules/CMake.cmake" >/dev/null \
    || die "The cmake wheel unpacked without its Modules tree; delete ${PREFIX} and retry."
  info "cmake: $("${PREFIX}/bin/cmake" --version | head -1)"
}

# --------------------------------------------------------------------------------------
# Boost, from .deb files downloaded but never installed
# --------------------------------------------------------------------------------------
ensure_boost() {
  if [[ -f "${BOOST_DIR}/usr/include/boost/version.hpp" && -n "$(ls "${BOOST_DIR}"/usr/lib/*/libboost_regex.so* 2>/dev/null)" ]]; then
    info "boost: cached in ${BOOST_DIR}"
    return
  fi

  local series="${BOOST_SERIES:-}"
  if [[ -z "${series}" ]]; then
    series="$(apt-cache policy libboost-dev 2>/dev/null | awk '/Candidate:/{print $2}' | cut -d. -f1,2)"
  fi
  [[ -n "${series}" ]] || die "Could not detect a Boost version. Re-run with BOOST_SERIES=1.74 (or your distro's)."

  step "Fetching Boost ${series} headers and regex library"
  mkdir -p "${DEB_DIR}" "${BOOST_DIR}"
  (
    cd "${DEB_DIR}"
    # The runtime package supplies the real .so that the -dev package symlinks to; both
    # are needed to link and then to load the harness.
    apt-get download -q \
      "libboost${series}-dev" \
      "libboost-regex${series}-dev" \
      "libboost-regex${series}.0" \
      || die "Could not download the Boost ${series} packages. Override BOOST_SERIES and retry."
    for deb in ./*.deb; do dpkg-deb -x "${deb}" "${BOOST_DIR}"; done
  )

  local libdir
  libdir="$(dirname "$(ls "${BOOST_DIR}"/usr/lib/*/libboost_regex.so 2>/dev/null | head -1)")"
  [[ -n "${libdir}" ]] || die "Boost was unpacked but libboost_regex.so is missing from it."
  echo "${libdir}" >"${PREFIX}/boost-libdir"
  info "boost: ${libdir}"
}

# --------------------------------------------------------------------------------------
# LuaJIT and pkg-config, from .deb files, for librime's lua plugin
# --------------------------------------------------------------------------------------
ensure_luajit() {
  if [[ -f "${LUAJIT_LIB}/libluajit-5.1.so.2" && -x "${LUAJIT_DIR}/usr/bin/pkg-config" ]]; then
    info "luajit + pkg-config: cached in ${LUAJIT_DIR}"
    return
  fi

  step "Fetching LuaJIT and pkg-config"
  mkdir -p "${DEB_DIR}" "${LUAJIT_DIR}"
  (
    cd "${DEB_DIR}"
    # The runtime package supplies the real .so that the -dev package symlinks to; both
    # are needed to link and then to load the harness.
    #
    # Never fetch `pkg-config` itself: on Ubuntu 24.04 it is a 7 kB transitional package
    # that ships no binary, and `apt-get download` resolves no `Depends:` the way
    # `apt-get install` does, so it unpacks to nothing usable.
    #
    # The real implementation is split across three packages, and which one holds the
    # executable depends on the release:
    #   22.04  `pkgconf` carries the binary; `pkgconf-bin` does not exist.
    #   24.04  `pkgconf` carries only `pkg-config -> pkgconf`; `pkgconf-bin` has the binary.
    # Both need `libpkgconf3`, and neither binary is static, so an unpacked pkg-config
    # that cannot locate libpkgconf.so.3 exits 127 on `--version` and FindPkgConfig then
    # reports that as a missing PKG_CONFIG_EXECUTABLE. Fetch all three, tolerating only
    # `pkgconf-bin` being absent, which is the 22.04 case.
    apt-get download -q \
      "luajit" \
      "libluajit-5.1-2" \
      "libluajit-5.1-dev" \
      "libpkgconf3" \
      "pkgconf" \
      || die "Could not download the LuaJIT and pkg-config packages."
    apt-get download -q "pkgconf-bin" 2>/dev/null \
      || info "no pkgconf-bin package here; pkgconf carries the binary itself"
    for deb in ./*.deb; do dpkg-deb -x "${deb}" "${LUAJIT_DIR}"; done
  )

  # libpkgconf.so.3 unpacked into usr/lib/x86_64-linux-gnu, which is not searched by
  # default for an executable run out of the build tree. Exported here, outside the
  # subshell, so it also covers the cmake configure in build_librime and the harness.
  export LD_LIBRARY_PATH="${LUAJIT_DIR}/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"

  # The .deb files record /usr as their install prefix; rewrite luajit.pc to the local one
  # so pkg-config reports the headers and library under ${LUAJIT_DIR}.
  local pc="${LUAJIT_LIB}/pkgconfig/luajit.pc"
  [[ -f "${pc}" ]] || die "luajit.pc is missing from ${LUAJIT_DIR}."
  sed -i "s|^prefix=.*|prefix=${LUAJIT_DIR}/usr|" "${pc}"

  # `-x` is not enough: on 24.04 `pkgconf` alone leaves `pkg-config` a dangling symlink,
  # and a pkg-config that cannot load its shared library still passes `-x` yet exits
  # non-zero on `--version`. Actually run it, which is the only check that distinguishes
  # all of these from a working pkg-config.
  local pkgconf_version
  pkgconf_version="$("${LUAJIT_DIR}/usr/bin/pkg-config" --version 2>/dev/null)" \
    || die "pkg-config at ${LUAJIT_DIR}/usr/bin/pkg-config is present but not runnable. Check that pkgconf (and pkgconf-bin on 24.04) plus libpkgconf3 were fetched, and that LD_LIBRARY_PATH reaches the unpacked library."
  info "pkg-config: ${pkgconf_version}"
  info "luajit: ${LUAJIT_LIB}"
}

# --------------------------------------------------------------------------------------
# librime's lua plugin, which is a separate repo and not part of its tree
# --------------------------------------------------------------------------------------
ensure_librime_lua() {
  # The plugin is what makes the schema's `lua_filter@pinyinduck_gloss_filter`
  # constructible. It is not a submodule of librime, so `--recursive` does not fetch it.
  if [[ -d "${LIBRIME_DIR}/plugins/lua/src" ]]; then
    info "librime-lua plugin: ${LIBRIME_DIR}/plugins/lua (cached)"
    return
  fi
  step "Cloning the librime-lua plugin"
  command -v git >/dev/null || die "git is required to fetch the lua plugin."
  git clone --quiet --depth 1 \
    https://github.com/hchunhui/librime-lua.git "${LIBRIME_DIR}/plugins/lua"
  info "librime-lua plugin: ${LIBRIME_DIR}/plugins/lua"
}

# --------------------------------------------------------------------------------------
# librime itself, at the tag Weasel bundles
# --------------------------------------------------------------------------------------
ensure_librime() {
  # The tag is recorded rather than inferred from the directory existing, so that bumping
  # RIME_TAG re-clones instead of quietly testing against the previous version.
  local stamp="${LIBRIME_DIR}/.rime-tag"
  if [[ -d "${LIBRIME_DIR}/.git" && -f "${stamp}" && "$(cat "${stamp}")" == "${RIME_TAG}" ]]; then
    info "librime ${RIME_TAG}: ${LIBRIME_DIR} (cached)"
    return
  fi
  step "Cloning librime ${RIME_TAG} with its submodules"
  command -v git >/dev/null || die "git is required to fetch librime."
  rm -rf "${LIBRIME_DIR}"
  git clone --quiet --recursive --depth 1 --branch "${RIME_TAG}" \
    https://github.com/rime/librime.git "${LIBRIME_DIR}"
  echo "${RIME_TAG}" >"${stamp}"
  info "$(du -sh "${LIBRIME_DIR}" | cut -f1) in ${LIBRIME_DIR}"
}

# --------------------------------------------------------------------------------------
# The third-party libraries librime expects to find under its own prefix
# --------------------------------------------------------------------------------------
build_librime_deps() {
  # deps.mk configures the dependencies without -fPIC, and librime then links them into a
  # shared librime.so, so the link fails with "relocation R_X86_64_PC32 ... can not be used
  # when making a shared object". CMake seeds CMAKE_CXX_FLAGS from CXXFLAGS on first
  # configure, so exporting it here is enough — and it leaves deps.mk untouched.
  export CXXFLAGS="${CXXFLAGS:-} -fPIC"

  # The stamp records the flags it was built with, not just that a build happened. A bare
  # marker goes stale the moment the flags change, and the symptom is a link error in a
  # later step that has nothing to do with the flags.
  local stamp="${LIBRIME_DIR}/.deps-built"
  if [[ -f "${stamp}" && "$(cat "${stamp}")" == "cxxflags=${CXXFLAGS}" ]]; then
    info "librime dependencies: cached"
    return
  fi
  step "Building librime's bundled dependencies (glog, yaml-cpp, leveldb, marisa, opencc)"
  # The dependencies cache their flag lists, so a changed CXXFLAGS only takes effect in a
  # fresh configure.
  for dep in glog googletest leveldb marisa-trie opencc yaml-cpp; do
    rm -rf "${LIBRIME_DIR}/deps/${dep:?}/build"
  done
  # deps.mk, not the top-level Makefile: the latter is the build wrapper and would
  # configure librime itself before its dependencies exist.
  make -C "${LIBRIME_DIR}" -f deps.mk -j"${JOBS}" >"${PREFIX}/deps-build.log" 2>&1 \
    || { tail -30 "${PREFIX}/deps-build.log"; die "dependency build failed; see ${PREFIX}/deps-build.log"; }
  echo "cxxflags=${CXXFLAGS}" >"${stamp}"
}

build_librime() {
  if [[ -f "${LIBRIME_LIB}/librime.so" ]]; then
    info "librime: ${LIBRIME_LIB}/librime.so (cached)"
    return
  fi
  step "Building librime ${RIME_TAG}"
  local boost_libdir
  boost_libdir="$(cat "${PREFIX}/boost-libdir")"
  # The lua plugin's CMakeLists does `pkg_check_modules(LUA ...)`, trying `lua lua54 lua53
  # lua52 luajit lua51` in turn. Point pkg-config at the unpacked LuaJIT so `luajit` resolves;
  # without this the plugin silently skips building and the schema's lua_filter is absent.
  export PKG_CONFIG_EXECUTABLE="${LUAJIT_DIR}/usr/bin/pkg-config"
  export PKG_CONFIG_PATH="${LUAJIT_LIB}/pkgconfig${PKG_CONFIG_PATH:+:${PKG_CONFIG_PATH}}"
  "${PREFIX}/bin/cmake" -S "${LIBRIME_DIR}" -B "${LIBRIME_BUILD}" \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=ON \
    -DBUILD_TEST=OFF \
    -DBUILD_SAMPLE=OFF \
    -DBUILD_STATIC=OFF \
    -DBUILD_MERGED_PLUGINS=ON \
    -DENABLE_LOGGING=ON \
    -DPKG_CONFIG_EXECUTABLE="${PKG_CONFIG_EXECUTABLE}" \
    -DBOOST_ROOT="${BOOST_DIR}/usr" \
    -DBOOST_LIBRARYDIR="${boost_libdir}" \
    -DBoost_NO_SYSTEM_PATHS=ON \
    >"${PREFIX}/cmake-configure.log" 2>&1 \
    || { tail -30 "${PREFIX}/cmake-configure.log"; die "cmake configure failed; see ${PREFIX}/cmake-configure.log"; }
  "${PREFIX}/bin/cmake" --build "${LIBRIME_BUILD}" -j"${JOBS}" --target rime \
    >"${PREFIX}/cmake-build.log" 2>&1 \
    || { tail -30 "${PREFIX}/cmake-build.log"; die "librime build failed; see ${PREFIX}/cmake-build.log"; }
  info "librime: ${LIBRIME_LIB}/librime.so"
}

# --------------------------------------------------------------------------------------
# The harness: a few dozen lines of C++ against librime's C API
# --------------------------------------------------------------------------------------
build_harness() {
  # Rebuilt when the source *or the library* is newer. Comparing against librime.so matters
  # because a librime version bump produces a new library at the same path, and a harness
  # linked against the previous headers would keep answering with the old behaviour.
  if [[ -x "${HARNESS}" && "${HARNESS}" -nt "${TOOLS_DIR}/rime_smoke.cc" && "${HARNESS}" -nt "${LIBRIME_LIB}/librime.so" ]]; then
    info "harness: ${HARNESS} (cached)"
    return
  fi
  step "Building the rime_smoke harness"
  local boost_libdir
  boost_libdir="$(cat "${PREFIX}/boost-libdir")"
  mkdir -p "${PREFIX}/bin"
  # -Wno-missing-field-initializers: RIME_STRUCT expands to `Type var = {0}`, which warns
  # about every field the macro cannot know about. It is librime's idiom, not our mistake.
  g++ -std=c++17 -O2 -Wall -Wextra -Wno-missing-field-initializers \
    -o "${HARNESS}" "${TOOLS_DIR}/rime_smoke.cc" \
    -I "${LIBRIME_DIR}/src" \
    -L "${LIBRIME_LIB}" -lrime \
    -Wl,-rpath,"${LIBRIME_LIB}" \
    -Wl,-rpath,"${boost_libdir}" \
    -Wl,-rpath,"${LUAJIT_LIB}"
  info "harness: ${HARNESS}"
}

step "Bootstrapping a headless librime ${RIME_TAG} (no sudo, nothing installed)"
ensure_cmake
ensure_boost
ensure_luajit
ensure_librime
ensure_librime_lua
build_librime_deps
build_librime
build_harness

printf '\n\033[32mlibrime is ready.\033[0m Run the smoke test with:\n\n    npm run test:rime\n\n'
