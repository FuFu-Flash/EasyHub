#!/usr/bin/env python3
"""Build an Android DEX plugin outside the checkout and produce a pinned ZIP."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import zipfile

STAMP = (2020, 1, 1, 0, 0, 0)
SOURCE = Path(__file__).resolve().parent
REPOSITORY = SOURCE.parents[3]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_zip(path, entries):
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(entries.items()):
            info = zipfile.ZipInfo(name, STAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100444 << 16
            archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-dir", type=Path, default=Path("/tmp/easyhub-jadx-framework-build"))
    parser.add_argument("--output", type=Path, default=REPOSITORY / "artifacts/analysis-frameworks/easyhub-jadx-1.5.6-android-v1.zip")
    parser.add_argument("--gradle-wrapper", type=Path, default=REPOSITORY / "apps/mobile/android/gradlew")
    parser.add_argument("--sdk", type=Path, default=Path(os.environ.get("ANDROID_HOME", str(Path.home() / "Library/Android/sdk"))))
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    build_dir = args.build_dir.resolve()
    if build_dir == SOURCE or SOURCE in build_dir.parents or REPOSITORY in build_dir.parents:
        parser.error("Build outside the repository to avoid generated Android files in the checkout.")
    if not args.gradle_wrapper.is_file() or not (args.sdk / "platforms/android-36/android.jar").is_file():
        parser.error("A Gradle 9.3.1 wrapper and Android SDK platform 36 are required.")
    build_dir.mkdir(parents=True, exist_ok=True)
    shutil.copytree(SOURCE, build_dir, dirs_exist_ok=True, ignore=shutil.ignore_patterns("build", ".gradle", "__pycache__", "local.properties"))
    (build_dir / "local.properties").write_text("sdk.dir=" + str(args.sdk.resolve()).replace("\\", "\\\\").replace(":", "\\:") + "\n")
    command = [str(args.gradle_wrapper.resolve()), "-p", str(build_dir), "assembleRelease", "writeRuntimeArtifacts", "--no-daemon"]
    if args.offline:
        command.append("--offline")
    subprocess.run(command, check=True)
    apk = build_dir / "build/outputs/apk/release/easyhub-jadx-runtime-release-unsigned.apk"
    with zipfile.ZipFile(apk) as built:
        # Retain the Android DEX files and Java resources, including JADX's own data.
        runtime_entries = {
            item.filename: built.read(item)
            for item in built.infolist()
            if not item.is_dir() and item.filename not in ("AndroidManifest.xml", "resources.arsc")
            and not item.filename.startswith("res/")
            and not re.fullmatch(r"META-INF/[^/]+\.(SF|RSA|DSA|EC)", item.filename)
        }
    dex_names = sorted(name for name in runtime_entries if re.fullmatch(r"classes(?:[2-9]|[1-9][0-9]+)?\.dex", name))
    if not dex_names or not any(b"Lapp/easyhub/frameworks/jadx/ProgramEngine;" in runtime_entries[name] for name in dex_names):
        raise RuntimeError("Framework entry class was not found in Android DEX output.")
    plugin = build_dir / "package/runtime/jadx-runtime.apk"
    write_zip(plugin, runtime_entries)
    entries = {"runtime/jadx-runtime.apk": plugin.read_bytes()}
    for path in sorted((SOURCE / "licenses").rglob("*")):
        if path.is_file():
            entries["licenses/" + path.relative_to(SOURCE / "licenses").as_posix()] = path.read_bytes()
    components = []
    artifacts = json.loads((build_dir / "build/runtime-artifacts.json").read_text())
    for artifact in artifacts:
        jar = Path(artifact["file"])
        if jar.suffix != ".jar":
            raise RuntimeError("Unexpected non-JAR framework dependency: " + artifact["id"])
        identity = artifact["id"].replace(":", "/")
        components.append({"id": artifact["id"], "size": jar.stat().st_size, "sha256": digest(jar.read_bytes())})
        with zipfile.ZipFile(jar) as dependency:
            for name in dependency.namelist():
                if not name.endswith("/") and any(term in name.upper().split("/")[-1] for term in ("LICENSE", "NOTICE", "COPYING")):
                    entries["licenses/dependencies/" + identity + "/" + name] = dependency.read(name)
    entries["licenses/dependencies.json"] = (json.dumps(components, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()
    if len(entries) < 4:
        raise RuntimeError("The framework package must include its dependency licenses.")
    manifest = {"schema": 1, "id": "java", "version": "1.5.6", "abi": "any", "minSdk": 26,
                "files": [{"path": name, "size": len(data), "sha256": digest(data)} for name, data in sorted(entries.items())]}
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()
    entries["framework.json"] = manifest_bytes
    write_zip(args.output, entries)
    summary = {"archive": str(args.output.resolve()), "size": args.output.stat().st_size,
               "sha256": digest(args.output.read_bytes()), "unpackedBytes": sum(map(len, entries.values())),
               "runtimeBytes": plugin.stat().st_size, "runtimeSha256": digest(plugin.read_bytes()),
               "manifestBytes": len(manifest_bytes), "manifestSha256": digest(manifest_bytes),
               "dexFiles": dex_names, "fileCount": len(manifest["files"])}
    args.output.with_suffix(".json").write_text(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
