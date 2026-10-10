#!/usr/bin/env python3
"""Compile portable Sleigh definitions into intermediate framework inputs.

The destination belongs under EASYHUB_NATIVE_BUILD_DIR, never the Android module.
pack-framework.py produces the repository download ZIP from these inputs.
"""
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import sys

work, toolchain, module_main, script_dir = map(pathlib.Path, sys.argv[1:])
if "modules/easyhub-analysis/android/src/main" in module_main.as_posix():
    raise ValueError("Generate framework staging inputs outside the Android module")
r2 = work / "radare2"
ghidra = work / "r2ghidra"
native = ghidra / "subprojects/ghidra-native"
libdir = module_main / "jniLibs/arm64-v8a"
assets = module_main / "assets/native-analysis"
sleigh = assets / "sleigh"
libdir.mkdir(parents=True, exist_ok=True)
sleigh.mkdir(parents=True, exist_ok=True)
(libdir / "libc++_shared.so").unlink(missing_ok=True)

def atomic_copy(source, destination):
    """Avoid rewriting equal files or preserving stale mtime in synced folders."""
    source, destination = pathlib.Path(source), pathlib.Path(destination)
    if destination.is_file() and source.stat().st_size == destination.stat().st_size:
        if hashlib.sha256(source.read_bytes()).digest() == hashlib.sha256(destination.read_bytes()).digest():
            return str(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name("." + destination.name + ".easyhub-copy")
    shutil.copyfile(source, temporary)
    shutil.copymode(source, temporary)
    temporary.replace(destination)
    return str(destination)

def remove_generated_duplicates(directory):
    # iCloud/Finder may retain a numbered prior copy when a generated file is
    # replaced. This directory contains task-owned build outputs only.
    for duplicate in directory.rglob("*"):
        if duplicate.is_file() and re.search(r" \d+\.", duplicate.name):
            canonical = duplicate.with_name(re.sub(r" \d+(?=\.)", "", duplicate.name))
            if canonical.is_file():
                duplicate.unlink()

remove_generated_duplicates(libdir)
remove_generated_duplicates(assets)

libraries = [(work / "install/usr/local/bin/radare2", "libeasyhub-radare2.so")]
libraries += [(p, p.name) for p in sorted((work / "install/usr/local/lib").glob("libr_*.so"))]
libraries += [(work / "r2ghidra-android/libcore_r2ghidra.so", "libcore_r2ghidra.so")]
for source, name in libraries:
    destination = libdir / name
    stripped = work / "packaged-libs" / name
    stripped.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, stripped)
    shutil.copymode(source, stripped)
    subprocess.run([str(toolchain / "bin/llvm-strip"), "--strip-unneeded", str(stripped)], check=True)
    atomic_copy(stripped, destination)

processors = ["DATA"] + [line.strip() for line in (ghidra / "ghidra-processors.txt.default").read_text().splitlines()
                         if line.strip() and not line.lstrip().startswith("#")]
for processor in processors:
    source = native / "src/Processors" / processor
    subprocess.run([sys.executable, str(ghidra / "ghidra/sleigh_compile.py"), str(work / "sleigh-host/sleighc"),
                    str(source), str(work / f"sleigh-{processor}.stamp")], check=True)
    for definition in sorted((source / "data/languages").glob("*")):
        # Runtime definitions only. Full input sources remain reproducible from
        # the pinned public commit and checked-in build instructions.
        if definition.suffix not in {".sla", ".ldefs", ".pspec", ".cspec"}:
            continue
        destination = sleigh / definition.name
        if destination.exists() and destination.read_bytes() != definition.read_bytes():
            raise RuntimeError(f"Conflicting Sleigh definition: {definition.name}")
        atomic_copy(definition, destination)

# radare2's bundled type/signature databases improve recovered argument names.
# Keep their original prefix layout for R2_PREFIX at runtime.
share_source = work / "install/usr/local/share/radare2/6.2.2"
share_dest = assets / "r2/share/radare2/6.2.2"
if share_source.is_dir():
    shutil.copytree(share_source, share_dest, dirs_exist_ok=True, copy_function=atomic_copy)

licenses = script_dir / "licenses"
licenses.mkdir(parents=True, exist_ok=True)
license_files = {
    "radare2-COPYING.md": r2 / "COPYING.md",
    "radare2-license-summary.md": r2 / "doc/licenses.md",
    "r2ghidra-LICENSE.md": ghidra / "LICENSE.md",
    "r2ghidra-LGPL-3.0.md": ghidra / "LESSER.md",
    "r2ghidra-GPL-3.0.txt": ghidra / "COPYING",
    "ghidra-native-Apache-2.0.txt": native / "LICENSE",
    "zlib-LICENSE.txt": ghidra / "subprojects/zlib/LICENSE",
    "capstone-LICENSE.txt": r2 / "subprojects/capstone-v5/LICENSE.TXT",
    "capstone-LLVM-LICENSE.txt": r2 / "subprojects/capstone-v5/LICENSE_LLVM.TXT",
    "zydis-LICENSE.txt": r2 / "subprojects/zydis/LICENSE.MIT",
    "sdb-LICENSE.txt": r2 / "subprojects/sdb/COPYING",
    "android-libcxx-NOTICE.txt": toolchain.parents[3] / "NOTICE",
}
for name, source in license_files.items():
    if source.is_file():
        atomic_copy(source, licenses / name)
shutil.copytree(r2 / "doc/licenses", licenses / "radare2-components", dirs_exist_ok=True, copy_function=atomic_copy)
shutil.copytree(licenses, assets / "licenses", dirs_exist_ok=True, copy_function=atomic_copy)

def revision(path):
    if (path / ".easyhub-source-revision").is_file():
        return (path / ".easyhub-source-revision").read_text().strip()
    return subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True).strip()

manifest = {
    "engine": "radare2 + r2ghidra", "version": "6.2.2", "abi": "arm64-v8a",
    "minSdk": 24, "ndkVersion": "27.1.12297006", "elfPageSize": 16384,
    "runtimeProfile": {"kind": "downloadable-framework", "excludedRadare2Directories": []},
    "sourceRevisions": {"radare2": revision(r2), "r2ghidra": revision(ghidra),
                        "ghidra-native": revision(native), "zlib": revision(ghidra / "subprojects/zlib"),
                        "capstone": revision(r2 / "subprojects/capstone-v5"),
                        "sdb": revision(r2 / "subprojects/sdb")},
    "processors": processors,
    "sha256": {str(path.relative_to(module_main)): hashlib.sha256(path.read_bytes()).hexdigest()
               for path in sorted(list(libdir.glob("*.so")) + list(sleigh.glob("*"))) if path.is_file()},
}
output = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
manifest_stage = work / "runtime-manifest.json"
manifest_stage.write_text(output)
atomic_copy(manifest_stage, script_dir / "runtime-manifest.json")
atomic_copy(manifest_stage, assets / "runtime-manifest.json")
