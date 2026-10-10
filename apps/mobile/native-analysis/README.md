# Android native decompiler

EasyHub uses the native Ghidra C++ decompiler through radare2/r2ghidra. The Android
engine runs locally as a child process. It reads the selected input as data; it
does not execute the EXE, DLL, ELF, or Mach-O being inspected. Java/DEX analysis
uses the separate Jadx integration.

## Rebuild

Requirements: macOS or Linux, Python 3, Git, Make, Android NDK **27.1.12297006**.
The script bootstraps pinned Meson/Ninja and a host pkgconf if needed. Intermediate
files default to `/tmp/easyhub-native-decompiler` to avoid spaces in Make paths.

```sh
bash apps/mobile/native-analysis/build-android.sh
```

Override the NDK with `EASYHUB_ANDROID_NDK`, intermediate directory with
`EASYHUB_NATIVE_BUILD_DIR`, or parallel jobs with `EASYHUB_BUILD_JOBS`. The build
produces a downloadable ZIP at
`artifacts/analysis-frameworks/easyhub-radare2-6.2.2-android-arm64-v1.zip`. Override
that path with `EASYHUB_NATIVE_FRAMEWORK_OUTPUT`. Intermediate libraries/resources
stay under the build directory; scripts never generate APK inputs. ZIP layout:

```text
lib/
  libeasyhub-radare2.so   # trusted PIE executable
  libcore_r2ghidra.so    # LGPL Ghidra integration plugin
  libr_*.so             # radare2 libraries
sleigh/                 # portable compiled processor descriptions
r2/share/radare2/6.2.2/  # original databases and static resources
licenses/               # upstream texts plus native-provenance.json
framework.json          # every payload path, size and SHA-256
```

The app downloads the framework selected by the user from the desktop component
release, tag `analysis-runtime-ghidra-12.1.2-java-21.0.12.1-r1`. Its catalog pins
the outer ZIP hash, size and manifest hash. The installer validates each file
before exposing the app-private installation directory. The engine is read-only
and executable (0555); the framework does not supply `libc++_shared.so`, since
React Native already packages the identical NDK 27.1 runtime. All engine ELF LOAD
segments use a 16 KiB alignment.

API 29+ starts `/system/bin/linker64 <installed lib/libeasyhub-radare2.so>`.
API 24–28 uses direct execution. Android 10's direct-execution restriction is
real: on API 36, direct execution returned EACCES while the system linker loaded
the same read-only engine, dependencies and r2ghidra plugin under the ordinary
app UID with SELinux enforcing. This is a measured AOSP device capability, not
an SDK guarantee for every OEM. See the recorded
[application sandbox probe](../../../artifacts/native-analysis/android-loader-probe.md)
and [primary platform sources](../../../artifacts/native-analysis/android-loader-primary-sources.md).
API 24–28 is selected from the platform implementation and remains untested.

The v1 ZIP preserves every canonical resource/license from the previous pinned
engine build, excluding only the shared libc++ runtime and Finder duplicates.
Subsequent builds retain all installed radare2 share resources; packaging does
not remove themes, web resources or databases.

## Pinned sources and licensing

- [radare2 6.2.2](https://github.com/radareorg/radare2/tree/ad27058877024389292fddf12e1db6e13824ba34), LGPLv3; built with `--without-gpl`.
- [r2ghidra 6.2.2](https://github.com/radareorg/r2ghidra/tree/1b5cba403c4c8751db8434f6790d5e0f132038f4), LGPL-3.0-only.
- [ghidra-native](https://github.com/radareorg/ghidra-native/tree/483ae94bcbc661a77667e52f1eff75928cb6aa2e), Apache-2.0; r2ghidra's pinned patch set is applied by Meson.
- [zlib 1.3.1](https://github.com/madler/zlib/tree/51b7f2abdade71cd9bb0e7a373ef2610ec6f9daf), zlib license.
- [Capstone](https://github.com/capstone-engine/capstone/tree/51360daf925e50d4da383cff2278107e6ffd8074), BSD and LLVM component licenses, with radare2's pinned patches.
- [sdb](https://github.com/radareorg/sdb/tree/fb36a38b65813abf827776995f89ca7660b4c30e), MIT.
- [Zydis 4.1.0](https://github.com/zyantific/zydis/releases/tag/v4.1.0), MIT, complete amalgamated C/H sources hash-pinned by radare2's wrap.

`licenses/` preserves upstream texts and third-party notices in the downloadable
framework. `licenses/native-provenance.json` records exact revisions, build
metadata and library/processor hashes. The same release also carries
`easyhub-native-framework-sources-v1.tar.gz`: full pinned sources, processor
definitions, applied patches, required Meson overlays, licenses and these build
scripts. `sources.json` verifies every archived input. Applied patch snapshots
are provenance; source trees already contain those patches, so do not apply
them again. Git internals, intermediate build outputs and caches are excluded;
upstream tracked test fixtures, including two ELF object fixtures, are retained.

To build from this archive without fetching runtime source repositories, extract
it, select a fresh build directory and run its script:

```sh
EASYHUB_NATIVE_SOURCE_ROOT=/absolute/path/to/extracted-sources \
EASYHUB_NATIVE_BUILD_DIR=/tmp/easyhub-native-rebuild \
EASYHUB_NATIVE_FRAMEWORK_OUTPUT=/absolute/path/to/rebuilt-framework.zip \
bash /absolute/path/to/extracted-sources/native-analysis/build-android.sh
```

NDK and host tools must already be installed, or the script will bootstrap the
pinned Meson 1.11.2/Ninja 1.13.2. Runtime source downloads are unnecessary with
the archive. Recipients can modify the LGPL source, create a replacement
framework and rebuild/re-sign EasyHub with their own framework catalog hashes.

Recreate distribution artifacts from an existing pinned build:

```sh
python3 apps/mobile/native-analysis/pack-framework.py BUILD/framework-source/main OUTPUT.zip
python3 apps/mobile/native-analysis/pack-sources.py BUILD apps/mobile/native-analysis OUTPUT.tar.gz \
  --framework artifacts/native-analysis/native-framework-verification.json
```

## Runtime protocol

Invoke the trusted CLI with `-q0`, `-e scr.color=0`,
`-e scr.interactive=false`, `-e dir.plugins=<framework/lib>`, and the controlled
snapshot filename as its own process argument. Set `LD_LIBRARY_PATH` to
`<framework/lib>:<ApplicationInfo.nativeLibraryDir>`, `SLEIGHHOME` to installed
`sleigh/`, `R2_PREFIX` to installed `r2/`, and `HOME` to controlled snapshot
storage. Set `R2_LIBR_PLUGINS`/`R2_USER_PLUGINS` to framework `lib/` and leave
`R2_NOPLUGINS` unset. The inspected binary is never the executable argument.

`-q0` produces one NUL delimiter on startup and after each newline command.
Read NUL-delimited stdout on a worker thread while draining bounded stderr. Send
`ij` for metadata, `omj` for maps, `iSj` for sections, then `aaa` for static
analysis. radare2 6.2.2 can leave PE maps empty; map those sections read-only via
`om <fd> <vaddr> <size> <paddr> r-x` before analysis. Use only checked integer
values from the parser, never filenames or symbol names in command text.

`aflj`, `iij`, and `izj` return JSON arrays of functions, imports, and strings.
`pdgj @ <numeric address>` returns `{ "code": "…", "annotations": […] }`, or
`{ "errors": […] }` for an unsupported/unrecoverable function. Bound analysis
time, memory/output, and samples (16 functions, 4000 characters per preview).
Destroy the child process for cancellation. Recovered C is an approximation;
it does not reproduce comments, original variable names, or a buildable project.

## Real Android smoke test

```sh
python3 apps/mobile/native-analysis/smoke-android.py
```

This builds small, reproducible AArch64 ELF and x86-32/x86-64 PE fixtures with the NDK,
loads the downloadable framework (override `EASYHUB_NATIVE_FRAMEWORK`), pushes
fixtures and the trusted engine to an already-running Android emulator, and
asserts recovered C contains the expected branch and arithmetic. It also checks
NUL framing, cancellation, metadata, string extraction, and ELF alignment.
On macOS it also builds and tests an AArch64 Mach-O dylib with the host toolchain.
Input binaries are never launched. This protocol test uses adb shell UID;
application loading permission evidence comes from the separate loader probe.
