#!/usr/bin/env python3
"""Verify framework integrity, its Android reflection ABI, and real JVM fixtures."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import struct
import subprocess
import zipfile

SOURCE = Path(__file__).resolve().parent
REPOSITORY = SOURCE.parents[3]
ENTRY = "Lapp/easyhub/frameworks/jadx/ProgramEngine;"
SIGNATURE = "(Ljava/io/File;Ljava/lang/String;Ljava/lang/String;Ljava/io/File;Ljava/lang/Runnable;Ljava/util/function/Consumer;)Ljava/util/Map;"


def reflection_abi(dex):
    def u32(offset): return struct.unpack_from("<I", dex, offset)[0]
    def string(offset):
        while dex[offset] & 128: offset += 1
        offset += 1
        return dex[offset:dex.index(b"\0", offset)].decode("utf-8", errors="replace")
    strings = [string(u32(u32(60) + i * 4)) for i in range(u32(56))]
    types = [strings[u32(u32(68) + i * 4)] for i in range(u32(64))]
    for i in range(u32(88)):
        class_id, proto_id, name_id = struct.unpack_from("<HHI", dex, u32(92) + i * 8)
        if types[class_id] == ENTRY and strings[name_id] == "analyze":
            _, return_id, parameters = struct.unpack_from("<III", dex, u32(76) + proto_id * 12)
            params = [] if not parameters else [types[struct.unpack_from("<H", dex, parameters + 4 + j * 2)[0]] for j in range(u32(parameters))]
            return "(" + "".join(params) + ")" + types[return_id]
    return None


HARNESS = r'''
import app.easyhub.frameworks.jadx.ProgramEngine;
import java.io.File;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CancellationException;
import java.util.concurrent.atomic.AtomicBoolean;

public class FrameworkCheck {
  public static void main(String[] args) {
    String[] names = {"easyhub-java11.class", "easyhub-java11.jar", "easyhub-dalvik.dex", "easyhub-dalvik.apk"};
    String[] formats = {"class", "jar", "dex", "apk"};
    for (int i = 0; i < names.length; i++) {
      File directory = new File(args[1], formats[i]);
      if (!directory.isDirectory() && !directory.mkdirs()) throw new AssertionError("workspace");
      Map<String, Object> result = ProgramEngine.analyze(new File(args[0], names[i]), formats[i], "en", directory, () -> {}, value -> {
        if (!(value.get("done") instanceof Integer) || !(value.get("total") instanceof Integer) || !(value.get("message") instanceof String)) throw new AssertionError("progress contract");
      });
      List<Map<String, String>> functions = (List<Map<String, String>>) result.get("functions");
      String code = functions.stream().map(value -> value.get("code")).reduce("", String::concat);
      if (!code.contains("computeScore") || !code.contains("describe") || !code.contains("EasyHub bytecode fixture:")) throw new AssertionError("fixture evidence " + formats[i]);
      if (((Number) result.get("functionCount")).intValue() != 1 || functions.size() != 1 || code.length() > 4000) throw new AssertionError("bounded evidence " + formats[i]);
      System.out.println(formats[i] + ": actual JADX evidence passed");
    }
    AtomicBoolean cancelled = new AtomicBoolean(false);
    try {
      ProgramEngine.analyze(new File(args[0], names[0]), "class", "zh", new File(args[1], "cancel"), () -> {
        if (cancelled.get()) throw new CancellationException("fixture cancellation");
      }, value -> { if (value.get("message").toString().contains("BytecodeMain")) cancelled.set(true); });
      throw new AssertionError("cancel was swallowed");
    } catch (CancellationException expected) {
      System.out.println("cancellation: propagated during sampled class processing");
    }
  }
}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=REPOSITORY / "artifacts/analysis-frameworks/easyhub-jadx-1.5.6-android-v1.zip")
    parser.add_argument("--build-dir", type=Path, default=Path("/tmp/easyhub-jadx-framework-build"))
    parser.add_argument("--fixtures", type=Path, default=REPOSITORY / "artifacts/native-analysis/fixtures")
    args = parser.parse_args()
    with zipfile.ZipFile(args.archive) as archive:
        manifest_bytes = archive.read("framework.json")
        manifest = json.loads(manifest_bytes)
        assert (manifest["schema"], manifest["id"], manifest["version"], manifest["abi"], manifest["minSdk"]) == (1, "java", "1.5.6", "any", 26)
        assert set(archive.namelist()) == {"framework.json", *(record["path"] for record in manifest["files"])}
        for record in manifest["files"]:
            data = archive.read(record["path"])
            assert len(data) == record["size"] and hashlib.sha256(data).hexdigest() == record["sha256"], record["path"]
        with zipfile.ZipFile(io.BytesIO(archive.read("runtime/jadx-runtime.apk"))) as runtime:
            signatures = [reflection_abi(runtime.read(name)) for name in runtime.namelist() if name.endswith(".dex")]
            assert SIGNATURE in signatures, signatures
            assert "clst/core.jcst" in runtime.namelist() or "clsp/core.jcst" in runtime.namelist(), runtime.namelist()
            assert "jadx/core/deobf/conditions/tlds.txt" in runtime.namelist()
            assert not any(name.startswith("lib/") or name in ("AndroidManifest.xml", "resources.arsc") for name in runtime.namelist())
    build_dir = args.build_dir.resolve()
    classes = build_dir / "build/intermediates/javac/release/compileReleaseJavaWithJavac/classes"
    artifacts = json.loads((build_dir / "build/runtime-artifacts.json").read_text())
    classpath = os.pathsep.join([str(classes), *(record["file"] for record in artifacts if not record["id"].startswith("com.android.tools:desugar_"))])
    verification = build_dir / "verification"
    verification.mkdir(exist_ok=True)
    harness = verification / "FrameworkCheck.java"
    harness.write_text(HARNESS)
    java = Path(os.environ["JAVA_HOME"]) / "bin"
    subprocess.run([str(java / "javac"), "--release", "17", "-classpath", classpath, "-d", str(verification), str(harness)], check=True)
    subprocess.run([str(java / "java"), "-classpath", str(verification) + os.pathsep + classpath, "FrameworkCheck", str(args.fixtures.resolve()), str(verification / "jobs")], check=True)
    print(json.dumps({"manifestFiles": len(manifest["files"]), "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
                      "reflectionSignature": SIGNATURE, "jvmFixtureFormats": ["class", "jar", "dex", "apk"], "cancellation": "passed"}, indent=2))


if __name__ == "__main__": main()
