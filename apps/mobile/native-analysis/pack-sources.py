#!/usr/bin/env python3
"""Package full pinned corresponding sources with deterministic tar/gzip metadata.

Uses tracked source files from the actual build trees, plus required Meson
overlays; no Git internals, intermediate objects, caches or generated build dirs.
"""
import argparse
import gzip
import hashlib
import io
import json
import pathlib
import stat
import subprocess
import tarfile


GIT_COMPONENTS = [
    ("radare2", "ad27058877024389292fddf12e1db6e13824ba34"),
    ("r2ghidra", "1b5cba403c4c8751db8434f6790d5e0f132038f4"),
    ("r2ghidra/subprojects/ghidra-native", "483ae94bcbc661a77667e52f1eff75928cb6aa2e"),
    ("r2ghidra/subprojects/zlib", "51b7f2abdade71cd9bb0e7a373ef2610ec6f9daf"),
    ("radare2/subprojects/capstone-v5", "51360daf925e50d4da383cff2278107e6ffd8074"),
    ("radare2/subprojects/sdb", "fb36a38b65813abf827776995f89ca7660b4c30e"),
    ("pkgconf", "a88c0d962a987c62d98ede5a738e37ec71005cbd"),
]


def git(directory, *args):
    return subprocess.check_output(["git", "-C", str(directory), *args])


def pack(work, scripts, output, framework):
    work, scripts, output, framework = map(pathlib.Path, [work, scripts, output, framework])
    inputs, extra, components = {}, {}, []
    for relative, revision in GIT_COMPONENTS:
        directory = work / relative
        if git(directory, "rev-parse", "HEAD").decode().strip() != revision:
            raise ValueError("Unexpected source revision: " + relative)
        for filename in git(directory, "ls-files", "-z").decode().split("\0"):
            if not filename:
                continue
            path = directory / filename
            if path.is_dir():  # Git submodules are included by their own component.
                continue
            # Upstream syscall databases use internal relative symlinks. Store
            # their complete resolved source bytes as ordinary archive files.
            if path.is_symlink() and not path.resolve().is_relative_to(directory.resolve()):
                raise ValueError("Source symlink escapes its component: " + str(path))
            if not path.is_file():
                raise ValueError("Missing or unsupported tracked source: " + str(path))
            inputs["sources/" + relative + "/" + filename] = path
        # Meson copies these build definitions/patch files from the enclosing
        # pinned packagefiles directory. They are source inputs, not outputs.
        for pattern in ["meson.build", "meson_options.txt", "patches/*", "capstone-patches/**/*"]:
            for path in sorted(directory.glob(pattern)):
                if path.is_file():
                    inputs["sources/" + relative + "/" + str(path.relative_to(directory))] = path
        diff = git(directory, "diff", "--binary", "HEAD")
        if diff:
            extra["patches/" + relative.replace("/", "-") + "-applied.patch"] = diff
        components.append({"path": relative, "revision": revision, "sourceState": "already-patched-build-inputs"})
    # Zydis is fetched as a hash-pinned complete amalgamated upstream C/H
    # release, not a Git submodule. Include its source and overlays, no objects.
    zydis = work / "radare2/subprojects/zydis"
    for path in sorted(zydis.rglob("*")):
        if path.is_file() and path.suffix not in {".o", ".a", ".d"}:
            inputs["sources/radare2/subprojects/zydis/" + str(path.relative_to(zydis))] = path
    components.append({"path": "radare2/subprojects/zydis", "version": "4.1.0", "sourceArchiveSha256": "aa9b82be3a37a2998bd8e16cf583bbf2b6c3d80e97dc20504169dc32ca1ced59", "sourceState": "complete-amalgamated-upstream-source-with-overlay"})
    for path in sorted(scripts.rglob("*")):
        relative = path.relative_to(scripts)
        if path.is_file() and not any(part in {"__pycache__", "generated"} for part in relative.parts) and path.suffix not in {".pyc", ".so", ".zip", ".gz"}:
            inputs["native-analysis/" + str(relative)] = path
    inputs["distribution/native-framework-verification.json"] = framework
    epoch = int(git(work / "radare2", "log", "-1", "--format=%ct"))
    entries = {}
    for name, path in inputs.items():
        entries[name] = (path.read_bytes(), 0o755 if path.stat().st_mode & stat.S_IXUSR else 0o644)
    entries.update({name: (data, 0o644) for name, data in extra.items()})
    records = [{"path": name, "size": len(entries[name][0]), "sha256": hashlib.sha256(entries[name][0]).hexdigest()} for name in sorted(entries)]
    manifest = {"schema": 1, "engineVersion": "6.2.2", "sourceDateEpoch": epoch, "ndkVersion": "27.1.12297006", "components": components, "files": records, "patchPolicy": "Source files already contain pinned upstream build patches; patches/ records the actual applied diffs for provenance. Do not apply them again."}
    entries["sources.json"] = ((json.dumps(manifest, indent=2) + "\n").encode(), 0o644)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as handle, gzip.GzipFile(fileobj=handle, filename="", mode="wb", mtime=0, compresslevel=9) as compressed, tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as archive:
        for name in sorted(entries):
            data, mode = entries[name]
            info = tarfile.TarInfo(name)
            info.size, info.mode, info.mtime = len(data), mode, epoch
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            archive.addfile(info, io.BytesIO(data))
    return {"file": str(output), "size": output.stat().st_size, "sha256": hashlib.sha256(output.read_bytes()).hexdigest(), "entryCount": len(entries), "sourceBytes": sum(len(data) for data, _ in entries.values()), "sourceDateEpoch": epoch, "components": components}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("work")
    parser.add_argument("scripts")
    parser.add_argument("output")
    parser.add_argument("--framework", required=True)
    args = parser.parse_args()
    print(json.dumps(pack(args.work, args.scripts, args.output, args.framework), indent=2))
