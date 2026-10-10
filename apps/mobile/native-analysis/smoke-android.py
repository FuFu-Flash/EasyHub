#!/usr/bin/env python3
"""Exercise engine formats/protocol under adb shell, not app loading permissions.

The separate loaderprobe test records ordinary-app UID/SELinux compatibility.
"""
import hashlib
import json
import os
import pathlib
import select
import shlex
import shutil
import subprocess
import sys
import threading
import time
import zipfile

script_dir = pathlib.Path(__file__).resolve().parent
mobile_dir = script_dir.parent
repo_dir = mobile_dir.parent.parent
framework_zip = pathlib.Path(os.environ.get("EASYHUB_NATIVE_FRAMEWORK", str(repo_dir / "artifacts/analysis-frameworks/easyhub-radare2-6.2.2-android-arm64-v1.zip")))
sdk = pathlib.Path(os.environ.get("ANDROID_SDK_ROOT", os.environ.get("ANDROID_HOME", str(pathlib.Path.home() / "Library/Android/sdk"))))
ndk = pathlib.Path(os.environ.get("EASYHUB_ANDROID_NDK", str(sdk / "ndk/27.1.12297006")))
host_tag = "darwin-x86_64" if sys.platform == "darwin" else "linux-x86_64"
toolchain = ndk / "toolchains/llvm/prebuilt" / host_tag
adb = str(sdk / "platform-tools/adb")
output = repo_dir / "artifacts/native-analysis"
fixtures = output / "fixtures"
fixtures.mkdir(parents=True, exist_ok=True)
source = script_dir / "fixtures/score.c"

def run(args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, **kwargs)

run([toolchain / "bin/aarch64-linux-android24-clang", "-O0", "-shared", "-fPIC", "-Wl,-z,max-page-size=16384", source,
     "-o", fixtures / "easyhub-arm64.so"])
run([toolchain / "bin/clang", "--target=x86_64-pc-windows-msvc", "-O0", "-c", source, "-o", fixtures / "score.obj"])
for extension, options in [("dll", ["/dll", "/noentry"]), ("exe", ["/entry:easyhub_score", "/subsystem:console"])]:
    run([toolchain / "bin/ld.lld", "-flavor", "link", *options, "/nodefaultlib", "/timestamp:0",
         "/export:easyhub_score", "/export:easyhub_message", f"/out:{fixtures / ('easyhub-x64.' + extension)}", fixtures / "score.obj"])
run([toolchain / "bin/clang", "--target=i686-pc-windows-msvc", "-O0", "-c", source, "-o", fixtures / "score-x86.obj"])
run([toolchain / "bin/ld.lld", "-flavor", "link", "/dll", "/noentry", "/nodefaultlib", "/machine:X86", "/timestamp:0",
     "/export:easyhub_score", "/export:easyhub_message", f"/out:{fixtures / 'easyhub-x86.dll'}", fixtures / "score-x86.obj"])
filenames = ["easyhub-arm64.so", "easyhub-x64.dll", "easyhub-x64.exe", "easyhub-x86.dll"]
if sys.platform == "darwin":
    run(["/usr/bin/clang", "-target", "arm64-apple-macos11", "-O0", "-dynamiclib", source,
         "-o", fixtures / "easyhub-macos.dylib"])
    filenames.append("easyhub-macos.dylib")

runtime = output / "runtime"
if runtime.exists():
    shutil.rmtree(runtime)
runtime.mkdir()
with zipfile.ZipFile(framework_zip) as archive:
    manifest = json.loads(archive.read("framework.json"))
    assert manifest["id"] == "native" and manifest["version"] == "6.2.2"
    for item in manifest["files"]:
        path = pathlib.PurePosixPath(item["path"])
        assert not path.is_absolute() and all(part not in {".", ".."} for part in path.parts)
        data = archive.read(item["path"])
        assert len(data) == item["size"] and hashlib.sha256(data).hexdigest() == item["sha256"]
        if path.parts[0] not in {"lib", "sleigh", "r2"}:
            continue
        target = runtime / (str(path.relative_to("lib")) if path.parts[0] == "lib" else str(path))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
# Only this standalone shell test needs its own copy of libc++; the app finds
# React Native's identical NDK 27.1 runtime in applicationInfo.nativeLibraryDir.
shutil.copyfile(toolchain / "sysroot/usr/lib/aarch64-linux-android/libc++_shared.so", runtime / "libc++_shared.so")
assert (runtime / "libeasyhub-radare2.so").is_file(), "Run build-android.sh first."

# Verify actual ELF LOAD alignment; file names and build flags alone are not proof.
for lib in runtime.glob("*.so"):
    headers = subprocess.check_output([str(toolchain / "bin/llvm-readelf"), "-l", str(lib)], text=True)
    for line in headers.splitlines():
        if line.lstrip().startswith("LOAD"):
            assert int(line.split()[-1], 16) >= 16384, f"Insufficient page alignment: {lib.name}"

remote = "/data/local/tmp/easyhub-native-smoke"
remote_fixtures = "/data/local/tmp/easyhub-native-smoke-fixtures"
# adb push nests a directory on subsequent runs when its destination exists.
# These two fixed task-owned temporary directories contain only smoke fixtures.
run([adb, "shell", "rm", "-rf", remote, remote_fixtures])
run([adb, "push", runtime, remote], stdout=subprocess.DEVNULL)
run([adb, "push", fixtures, remote_fixtures], stdout=subprocess.DEVNULL)
run([adb, "shell", "chmod", "755", remote + "/libeasyhub-radare2.so"])

class Session:
    def __init__(self, filename):
        args = ["env", "LD_LIBRARY_PATH=" + remote, "SLEIGHHOME=" + remote + "/sleigh", "R2_PREFIX=" + remote + "/r2",
                "HOME=" + remote, remote + "/libeasyhub-radare2.so", "-q0", "-e", "scr.color=0",
                "-e", "scr.interactive=false", "-e", "dir.plugins=" + remote, remote_fixtures + "/" + filename]
        self.process = subprocess.Popen([adb, "shell", "-T", shlex.join(args)], stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.buffer = bytearray()
        self.stderr = bytearray()
        self.reader = threading.Thread(target=self.drain_errors, daemon=True)
        self.reader.start()
        self.read_frame()

    def drain_errors(self):
        while chunk := self.process.stderr.read(4096):
            self.stderr.extend(chunk[:max(0, 65536 - len(self.stderr))])

    def read_frame(self, timeout=60):
        deadline = time.monotonic() + timeout
        while 0 not in self.buffer:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([self.process.stdout], [], [], max(0, remaining))[0]:
                raise TimeoutError("Native decompiler did not produce a NUL frame.")
            chunk = os.read(self.process.stdout.fileno(), 65536)
            if not chunk:
                raise RuntimeError("Native decompiler exited: " + self.stderr.decode(errors="replace"))
            self.buffer.extend(chunk)
            if len(self.buffer) > 2 * 1024 * 1024:
                raise RuntimeError("Native decompiler exceeded bounded response size.")
        end = self.buffer.index(0)
        result = bytes(self.buffer[:end]).decode("utf-8", errors="replace")
        del self.buffer[:end + 1]
        return result.strip()

    def command(self, command):
        self.process.stdin.write((command + "\n").encode())
        self.process.stdin.flush()
        return self.read_frame()

    def close(self):
        if self.process.poll() is None:
            self.process.stdin.write(b"q\n")
            self.process.stdin.flush()
            self.process.wait(timeout=10)
        self.reader.join(timeout=2)

results = []
for filename in filenames:
    session = Session(filename)
    try:
        metadata = json.loads(session.command("ij"))
        assert metadata["bin"]["bits"] in {32, 64}
        assert metadata["bin"]["bintype"] in {"elf", "pe", "mach0"}
        maps = json.loads(session.command("omj"))
        if not maps:
            fd = int(metadata["core"]["fd"])
            sections = json.loads(session.command("iSj"))
            assert 0 < len(sections) <= 256
            for section in sections:
                size = int(section["size"])
                paddr = int(section["paddr"])
                vaddr = int(section["vaddr"])
                if size > 0:
                    assert min(fd, size, paddr, vaddr) >= 0
                    session.command(f"om {fd} {vaddr} {size} {paddr} r-x")
        symbols = json.loads(session.command("isj"))
        expected_address = next(int(symbol["vaddr"]) for symbol in symbols
                                if symbol.get("realname", symbol.get("name", "")).lstrip("_") == "easyhub_score")
        session.command("aaa")
        functions = json.loads(session.command("aflj"))
        selected = next(fn for fn in functions if int(fn["addr"]) == expected_address)
        decompiled = json.loads(session.command("pdgj @ " + str(int(selected["addr"]))))
        code = decompiled.get("code", "")
        assert "if" in code and "* 3 + 7" in code and "-1" in code, decompiled
        strings = json.loads(session.command("izj"))
        assert any("EasyHub native analysis fixture" in item.get("string", "") for item in strings), strings
        imports = json.loads(session.command("iij"))
        assert isinstance(imports, list)
        results.append({"file": filename, "metadata": metadata, "functionCount": len(functions),
                        "function": selected, "code": code, "strings": strings, "imports": imports})
        print(f"PASS {filename}: {metadata['bin']['arch']}-{metadata['bin']['bits']}, {len(functions)} functions, recovered C")
    finally:
        session.close()
        (output / (filename + ".stderr.txt")).write_bytes(session.stderr)

# Child isolation/cancellation: terminate the trusted running analysis process,
# never launch the input fixture. The app uses Process.destroyForcibly instead.
session = Session("easyhub-arm64.so")
pid = int(session.command("?v $p"), 16)
assert pid > 1
session.process.stdin.write(b"aaa\n")
session.process.stdin.flush()
run([adb, "shell", "kill", "-9", str(pid)])
session.process.wait(timeout=10)
assert session.process.returncode is not None
print("PASS cancellation and NUL framing; all engine libraries support 16 KiB pages")
(output / "smoke-results.json").write_text(json.dumps(results, indent=2) + "\n")
