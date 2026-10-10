#!/usr/bin/env python3
"""Verify and restore a corresponding-source release into a fresh build folder."""
import hashlib
import json
import pathlib
import shutil
import sys


def restore(source, work):
    source, work = pathlib.Path(source).resolve(), pathlib.Path(work).resolve()
    metadata = json.loads((source / "sources.json").read_text())
    if metadata.get("schema") != 1 or metadata.get("engineVersion") != "6.2.2":
        raise ValueError("Unexpected corresponding-source manifest")
    expected = {item["path"] for item in metadata["files"]}
    actual = {str(path.relative_to(source)) for path in source.rglob("*") if path.is_file()}
    if actual != expected | {"sources.json"}:
        raise ValueError("Source archive has missing or unexpected files")
    for item in metadata["files"]:
        relative = pathlib.PurePosixPath(item["path"])
        if relative.is_absolute() or any(part in {".", ".."} for part in relative.parts):
            raise ValueError("Unsafe source path")
        path = source / item["path"]
        if path.is_symlink() or path.stat().st_size != item["size"]:
            raise ValueError(f"Unexpected source file: {item['path']}")
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for block in iter(lambda: handle.read(64 * 1024), b""):
                digest.update(block)
        if digest.hexdigest() != item["sha256"]:
            raise ValueError(f"Source integrity check failed: {item['path']}")
    trees = sorted((source / "sources").iterdir())
    for tree in trees:
        if (work / tree.name).exists():
            raise ValueError("Use a fresh EASYHUB_NATIVE_BUILD_DIR when restoring corresponding sources")
    work.mkdir(parents=True, exist_ok=True)
    for tree in trees:
        shutil.copytree(tree, work / tree.name)
    for component in metadata["components"]:
        if component.get("revision"):
            (work / component["path"] / ".easyhub-source-revision").write_text(component["revision"] + "\n")
    return {"verifiedFiles": len(expected), "components": len(metadata["components"]), "destination": str(work)}


if __name__ == "__main__":
    print(json.dumps(restore(*sys.argv[1:]), indent=2))
