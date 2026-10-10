#!/usr/bin/env bash
# Real Java 11 bytecode fixtures for the Android JADX input pipeline.
# Does not launch, install, or drive a device. Optional --push copies inputs only.
set -euo pipefail

bytecode_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
bytecode_repo_dir="$(cd -- "$bytecode_script_dir/../../../.." && pwd)"
bytecode_output="${BYTECODE_FIXTURE_OUTPUT:-$bytecode_repo_dir/artifacts/native-analysis/fixtures}"
bytecode_sdk="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
bytecode_jdk="${BYTECODE_JAVA_HOME:-${JAVA_HOME:-/tmp/easyhub-jdk21/zulu21.52.203-ca-jdk21.0.12.1-macosx_aarch64/Contents/Home}}"
bytecode_tools="$bytecode_sdk/build-tools/35.0.0"
bytecode_android_jar="${BYTECODE_ANDROID_JAR:-$bytecode_sdk/platforms/android-36/android.jar}"
bytecode_push=false
if [[ "${1:-}" == "--push" ]]; then bytecode_push=true; shift; fi
if [[ $# -ne 0 ]]; then printf 'Usage: %s [--push]\n' "$0" >&2; exit 2; fi
for bytecode_tool in "$bytecode_jdk/bin/javac" "$bytecode_jdk/bin/java" "$bytecode_jdk/bin/jar" "$bytecode_tools/d8" "$bytecode_tools/dexdump" "$bytecode_tools/aapt"; do
  if [[ ! -x "$bytecode_tool" ]]; then printf 'Missing tool: %s\n' "$bytecode_tool" >&2; exit 1; fi
done
if [[ ! -f "$bytecode_android_jar" ]]; then printf 'Missing Android platform: %s\n' "$bytecode_android_jar" >&2; exit 1; fi
if [[ "$("$bytecode_jdk/bin/javac" -version 2>&1)" != javac\ 21.* ]]; then printf 'Set BYTECODE_JAVA_HOME to a JDK 21 installation.\n' >&2; exit 1; fi

mkdir -p -- "$bytecode_output"
bytecode_work="$(mktemp -d "${TMPDIR:-/tmp}/easyhub-bytecode.XXXXXX")"
trap 'rm -rf -- "$bytecode_work"' EXIT
mkdir -p -- "$bytecode_work/src/app/easyhub/fixture" "$bytecode_work/classes" "$bytecode_work/dex"
cat > "$bytecode_work/src/app/easyhub/fixture/BytecodeMain.java" <<'JAVA'
package app.easyhub.fixture;

public final class BytecodeMain {
    private BytecodeMain() {}

    public static int computeScore(int apples, int oranges) {
        if (apples < 0 || oranges < 0) {
            return -1;
        }
        return apples * 3 + oranges * 2 + 7;
    }

    public static String describe(int score) {
        return new StringBuilder("EasyHub bytecode fixture: score=")
                .append(score).toString();
    }

    public static void main(String[] args) {
        System.out.println(describe(computeScore(5, 4)));
    }
}
JAVA
"$bytecode_jdk/bin/javac" --release 11 -g -d "$bytecode_work/classes" "$bytecode_work/src/app/easyhub/fixture/BytecodeMain.java"
cp -- "$bytecode_work/classes/app/easyhub/fixture/BytecodeMain.class" "$bytecode_output/easyhub-java11.class"
"$bytecode_jdk/bin/jar" --create --date=2020-01-01T00:00:00Z --file "$bytecode_output/easyhub-java11.jar" --main-class app.easyhub.fixture.BytecodeMain -C "$bytecode_work/classes" .
"$bytecode_jdk/bin/java" -jar "$bytecode_output/easyhub-java11.jar" > "$bytecode_work/expected-output.txt"
if [[ "$(cat "$bytecode_work/expected-output.txt")" != 'EasyHub bytecode fixture: score=30' ]]; then printf 'Unexpected fixture behavior.\n' >&2; exit 1; fi
env JAVA_HOME="$bytecode_jdk" "$bytecode_tools/d8" --debug --min-api 26 --lib "$bytecode_android_jar" --output "$bytecode_work/dex" "$bytecode_output/easyhub-java11.jar"
cp -- "$bytecode_work/dex/classes.dex" "$bytecode_output/easyhub-dalvik.dex"

cat > "$bytecode_work/AndroidManifest.xml" <<'XML'
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="app.easyhub.fixture" android:versionCode="1" android:versionName="1.0">
  <uses-sdk android:minSdkVersion="26" android:targetSdkVersion="36" />
  <application android:label="EasyHub bytecode fixture" android:hasCode="true" />
</manifest>
XML
"$bytecode_tools/aapt" package -f -M "$bytecode_work/AndroidManifest.xml" -I "$bytecode_android_jar" -F "$bytecode_work/fixture.apk"
"$bytecode_jdk/bin/jar" --update --date=2020-01-01T00:00:00Z --file "$bytecode_work/fixture.apk" -C "$bytecode_work/dex" classes.dex
cp -- "$bytecode_work/fixture.apk" "$bytecode_output/easyhub-dalvik.apk"
"$bytecode_jdk/bin/javap" -verbose "$bytecode_output/easyhub-java11.class" > "$bytecode_output/java11-bytecode.txt"
"$bytecode_tools/dexdump" -d "$bytecode_output/easyhub-dalvik.dex" > "$bytecode_output/dalvik-bytecode.txt"
"$bytecode_tools/aapt" dump badging "$bytecode_output/easyhub-dalvik.apk" > "$bytecode_output/apk-badging.txt"
cat > "$bytecode_output/bytecode-expectations.txt" <<'EXPECTED'
Input files: easyhub-java11.class, easyhub-java11.jar, easyhub-dalvik.dex, easyhub-dalvik.apk
Original class: app.easyhub.fixture.BytecodeMain
Java class version: 55 (Java 11), compiled by JDK 21 with --release 11
computeScore(apples, oranges): negative input => -1, else apples * 3 + oranges * 2 + 7
computeScore(5, 4) => 30
describe(30) => EasyHub bytecode fixture: score=30
Expected JADX evidence: computeScore/describe/main, multiplication by 3 and 2, addition of 7, the literal message.
The APK has a compiled Android manifest and real classes.dex; it is unsigned and has no launchable Activity. It is for static analysis only.
EXPECTED
(
  cd -- "$bytecode_output"
  shasum -a 256 easyhub-java11.class easyhub-java11.jar easyhub-dalvik.dex easyhub-dalvik.apk > bytecode-fixtures.sha256
)
printf 'Generated inputs in %s\n' "$bytecode_output"
cat "$bytecode_output/bytecode-fixtures.sha256"
if [[ "$bytecode_push" == true ]]; then
  bytecode_adb="$bytecode_sdk/platform-tools/adb"
  if [[ ! -x "$bytecode_adb" ]]; then printf 'Missing adb: %s\n' "$bytecode_adb" >&2; exit 1; fi
  bytecode_device="${ANDROID_SERIAL:-emulator-5554}"
  for bytecode_name in easyhub-java11.class easyhub-java11.jar easyhub-dalvik.dex easyhub-dalvik.apk; do
    "$bytecode_adb" -s "$bytecode_device" push "$bytecode_output/$bytecode_name" "/sdcard/Download/$bytecode_name"
  done
fi
