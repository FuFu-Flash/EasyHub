#!/usr/bin/env bash
# Rebuild the Android native decompiler from pinned public sources.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_DIR=$(cd "$SCRIPT_DIR/../../.." && pwd)
WORK_DIR=${EASYHUB_NATIVE_BUILD_DIR:-/tmp/easyhub-native-decompiler}
MODULE_STAGING="$WORK_DIR/framework-source/main"
FRAMEWORK_OUTPUT=${EASYHUB_NATIVE_FRAMEWORK_OUTPUT:-"$REPO_DIR/artifacts/analysis-frameworks/easyhub-radare2-6.2.2-android-arm64-v1.zip"}
ANDROID_SDK=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}
NDK=${EASYHUB_ANDROID_NDK:-$ANDROID_SDK/ndk/27.1.12297006}
JOBS=${EASYHUB_BUILD_JOBS:-4}

# radare2's Makefiles contain unquoted build paths. Keep the intermediate build
# separate from workspaces whose names contain spaces; final copies are quoted.
case "$WORK_DIR" in *[[:space:]]*) echo 'EASYHUB_NATIVE_BUILD_DIR must not contain spaces.' >&2; exit 1;; esac
case "$JOBS" in ''|*[!0-9]*) echo 'EASYHUB_BUILD_JOBS must be a positive integer.' >&2; exit 1;; esac
[ "$JOBS" -gt 0 ] || exit 1
case $(uname -s) in
  Darwin) HOST_TAG=darwin-x86_64 ;;
  Linux) HOST_TAG=linux-x86_64 ;;
  *) echo 'Build on macOS or Linux with Android NDK 27.1.' >&2; exit 1 ;;
esac
TOOLCHAIN="$NDK/toolchains/llvm/prebuilt/$HOST_TAG"
[ -x "$TOOLCHAIN/bin/aarch64-linux-android24-clang" ] || { echo "NDK not found: $NDK" >&2; exit 1; }
mkdir -p "$WORK_DIR/bin" "$WORK_DIR/install"

# A release's corresponding-source archive supplies the complete already-patched
# source trees, including Meson overlays. Verify every file before restoring it.
if [ -n "${EASYHUB_NATIVE_SOURCE_ROOT:-}" ]; then
  python3 "$SCRIPT_DIR/restore-sources.py" "$EASYHUB_NATIVE_SOURCE_ROOT" "$WORK_DIR"
fi

fetch_source() {
  local name=$1 url=$2 revision=$3 dir="$WORK_DIR/$1"
  if [ -n "${EASYHUB_NATIVE_SOURCE_ROOT:-}" ] && [ -f "$dir/.easyhub-source-revision" ]; then
    [ "$(cat "$dir/.easyhub-source-revision")" = "$revision" ] || {
      echo "Unexpected $name source revision." >&2; exit 1;
    }
    return
  fi
  if [ ! -d "$dir/.git" ]; then
    git init "$dir"
    git -C "$dir" remote add origin "$url"
    git -C "$dir" fetch --depth=1 origin "$revision"
    git -C "$dir" checkout --detach FETCH_HEAD
  fi
  [ "$(git -C "$dir" rev-parse HEAD)" = "$revision" ] || {
    echo "Unexpected $name checkout. Use a fresh EASYHUB_NATIVE_BUILD_DIR." >&2; exit 1;
  }
}
fetch_source radare2 https://github.com/radareorg/radare2.git ad27058877024389292fddf12e1db6e13824ba34
fetch_source r2ghidra https://github.com/radareorg/r2ghidra.git 1b5cba403c4c8751db8434f6790d5e0f132038f4

if [ ! -x "$WORK_DIR/tools/bin/meson" ]; then
  python3 -m venv "$WORK_DIR/tools"
  "$WORK_DIR/tools/bin/pip" install meson==1.11.2 ninja==1.13.2
fi
export PATH="$WORK_DIR/bin:$WORK_DIR/tools/bin:$TOOLCHAIN/bin:$PATH"
if ! command -v pkg-config >/dev/null 2>&1; then
  # pkgconf is a host build tool only, and is never packaged in the app.
  fetch_source pkgconf https://github.com/pkgconf/pkgconf.git a88c0d962a987c62d98ede5a738e37ec71005cbd
  meson setup "$WORK_DIR/pkgconf-build" "$WORK_DIR/pkgconf" --prefix="$WORK_DIR/host"
  ninja -C "$WORK_DIR/pkgconf-build" -j "$JOBS" install
  ln -sf pkgconf "$WORK_DIR/host/bin/pkg-config"
  export PATH="$WORK_DIR/host/bin:$PATH"
fi
PKG_CONFIG=$(command -v pkg-config)

# Use forwarding scripts rather than symlinks: NDK compiler launchers resolve
# clang relative to their own path.
printf '#!/bin/sh\nexec "%s" "$@"\n' "$TOOLCHAIN/bin/aarch64-linux-android24-clang" > "$WORK_DIR/bin/ndk-gcc"
printf '#!/bin/sh\nexec "%s" "$@"\n' "$TOOLCHAIN/bin/aarch64-linux-android24-clang++" > "$WORK_DIR/bin/ndk-g++"
chmod +x "$WORK_DIR/bin/ndk-gcc" "$WORK_DIR/bin/ndk-g++"
export ANDROID=1 NDK_ARCH=aarch64 CC=ndk-gcc CXX=ndk-g++ AR=llvm-ar RANLIB=llvm-ranlib
export CFLAGS='-fPIC -Oz -DNDEBUG' LDFLAGS='-Wl,-z,max-page-size=16384'
if [ -n "${EASYHUB_NATIVE_SOURCE_ROOT:-}" ]; then
  export SOURCE_DATE_EPOCH=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sourceDateEpoch"])' "$EASYHUB_NATIVE_SOURCE_ROOT/sources.json")
else
  export SOURCE_DATE_EPOCH=$(git -C "$WORK_DIR/radare2" log -1 --format=%ct)
fi
(
  cd "$WORK_DIR/radare2"
  cp dist/plugins-cfg/plugins.android.cfg plugins.cfg
  ./configure --with-compiler=android --with-ostype=android \
    --target=aarch64-linux-android --prefix=/usr/local --with-libr \
    --with-bundle-prefix --without-gpl --without-sqsh --with-checks-level=0
  # r2r is a development test runner and needs posix_spawn (API 28). It is not
  # part of this API 24 app engine. Build libraries and the required CLI only.
  make -s -j "$JOBS" libs
  make -C binr/radare2 -s -j "$JOBS"
  make -s install DESTDIR="$WORK_DIR/install" BINS=radare2
)
unset ANDROID NDK_ARCH CC CXX AR RANLIB CFLAGS LDFLAGS

(
  cd "$WORK_DIR/r2ghidra"
  # ghidra-native and zlib revisions, patch sets, and sources are locked by the
  # pinned r2ghidra subproject wraps, not by floating branch names.
  meson subprojects download
)
meson setup "$WORK_DIR/sleigh-host" "$WORK_DIR/r2ghidra/subprojects/ghidra-native" \
  -Dcpp_std=c++20 -Ddefault_library=static
ninja -C "$WORK_DIR/sleigh-host" -j "$JOBS" sleighc

python3 "$SCRIPT_DIR/prepare-cross-build.py" "$WORK_DIR" "$TOOLCHAIN" "$PKG_CONFIG"
# This host resolver serves only Meson's install-directory query. Actual
# decompilation is always performed by the cross-compiled Android executable.
cat > "$WORK_DIR/bin/radare2" <<'EOF'
#!/bin/sh
[ "$1" = '-HR2_LIBR_PLUGINS' ] || exit 1
printf '%s\n' '/usr/local/lib/radare2/plugins'
EOF
chmod +x "$WORK_DIR/bin/radare2"
meson setup "$WORK_DIR/r2ghidra-android" "$WORK_DIR/r2ghidra" \
  --cross-file "$WORK_DIR/android-arm64.ini" --buildtype=minsize
ninja -C "$WORK_DIR/r2ghidra-android" -j "$JOBS" libcore_r2ghidra.so
python3 "$SCRIPT_DIR/package-runtime.py" "$WORK_DIR" "$TOOLCHAIN" "$MODULE_STAGING" "$SCRIPT_DIR"
python3 "$SCRIPT_DIR/pack-framework.py" "$MODULE_STAGING" "$FRAMEWORK_OUTPUT"
echo "Downloadable native framework ready: $FRAMEWORK_OUTPUT"
