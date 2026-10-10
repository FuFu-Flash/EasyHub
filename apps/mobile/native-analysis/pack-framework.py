#!/usr/bin/env python3
"""Create the deterministic, downloadable native framework from a clean build.

Input is an intermediate directory with jniLibs/arm64-v8a and assets/native-analysis.
The ZIP is a repository distribution artifact; this script never writes APK inputs.
"""
import argparse
import hashlib
import json
import pathlib
import re
import shutil
import stat
import tempfile
import zipfile


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(64 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def generated_duplicate(path):
    return path.name == ".DS_Store" or bool(re.search(r" \d+(?=\.|$)", path.name))


def pack(source, output):
    source, output = pathlib.Path(source), pathlib.Path(output)
    assets = source / "assets/native-analysis"
    libraries = source / "jniLibs/arm64-v8a"
    provenance = assets / "runtime-manifest.json"
    metadata = json.loads(provenance.read_text())
    if metadata.get("version") != "6.2.2" or metadata.get("abi") != "arm64-v8a" or metadata.get("minSdk") != 24:
        raise ValueError("Unexpected native framework provenance")
    inputs = {}
    for library in sorted(libraries.glob("*.so")):
        if library.name == "libc++_shared.so" or generated_duplicate(library):
            continue
        inputs["lib/" + library.name] = library
    if len(inputs) != 25 or "lib/libeasyhub-radare2.so" not in inputs or "lib/libcore_r2ghidra.so" not in inputs:
        raise ValueError("Expected the complete 25-library engine, excluding React Native's libc++ runtime")
    for directory in ["sleigh", "r2", "licenses"]:
        base = assets / directory
        if not base.is_dir():
            raise ValueError(f"Missing framework directory: {directory}")
        for path in sorted(base.rglob("*")):
            if not path.is_file() or generated_duplicate(path):
                continue
            if path.is_symlink():
                raise ValueError(f"Framework symlinks are not allowed: {path}")
            inputs[str(path.relative_to(assets))] = path
    # Keep the original engine version, source commits, processor list, licenses
    # and build metadata in the framework without changing its manager schema.
    inputs["licenses/native-provenance.json"] = provenance
    if sum(name.startswith("sleigh/") for name in inputs) != 287:
        raise ValueError("Expected all 287 pinned Sleigh definitions")
    for name, path in inputs.items():
        if path.is_symlink() or name.startswith("/") or any(part in {".", ".."} for part in pathlib.PurePosixPath(name).parts):
            raise ValueError(f"Unsafe framework path: {name}")
        old_name = "jniLibs/arm64-v8a/" + path.name if name.startswith("lib/") else "assets/native-analysis/" + name
        expected = metadata.get("sha256", {}).get(old_name)
        if expected and sha256(path) != expected:
            raise ValueError(f"Pinned native input hash differs: {name}")
    files = [{"path": name, "size": inputs[name].stat().st_size, "sha256": sha256(inputs[name])} for name in sorted(inputs)]
    manifest = {"schema": 1, "id": "native", "version": "6.2.2", "abi": "arm64-v8a", "minSdk": 24, "files": files}
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix=".easyhub-framework-", suffix=".zip", dir=output.parent, delete=False) as staged:
        temporary = pathlib.Path(staged.name)
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name in sorted([*inputs, "framework.json"]):
                info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.compress_type = zipfile.ZIP_DEFLATED
                info._compresslevel = 9
                mode = 0o555 if name == "lib/libeasyhub-radare2.so" else 0o444
                info.external_attr = (stat.S_IFREG | mode) << 16
                with archive.open(info, "w", force_zip64=True) as target:
                    if name == "framework.json":
                        target.write(manifest_bytes)
                    else:
                        with inputs[name].open("rb") as original:
                            shutil.copyfileobj(original, target, 64 * 1024)
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    return {"file": str(output), "sha256": sha256(output), "size": output.stat().st_size,
            "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(), "manifestBytes": len(manifest_bytes),
            "installedBytes": sum(item["size"] for item in files) + len(manifest_bytes),
            "entryCount": len(files) + 1, "manifestFileCount": len(files), "libraryCount": 25,
            "sleighFileCount": 287, "sourceRevisions": metadata.get("sourceRevisions", {})}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=pathlib.Path)
    parser.add_argument("output", type=pathlib.Path)
    parser.add_argument("--verification", type=pathlib.Path)
    args = parser.parse_args()
    result = pack(args.source, args.output)
    encoded = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.verification:
        args.verification.parent.mkdir(parents=True, exist_ok=True)
        args.verification.write_text(encoded)
    print(encoded, end="")


if __name__ == "__main__":
    main()
