# EasyHub Android JADX framework

This standalone Android project packages JADX 1.5.6 and its Android-compatible dependencies as an optional DEX framework. The main application does not need a compile-time JADX dependency. The package is intended for the EasyHub GitHub repository's fixed-version release assets.

The project requires Gradle 9.3.1, Android SDK 36, and JDK 21. It compiles Java 17 source with minSdk 26, targetSdk 36, and `desugar_jdk_libs` 2.1.5. There are no activities or permissions. All generated build files stay outside the checkout.

```sh
python3 apps/mobile/analysis-frameworks/jadx-runtime/package-framework.py \
  --gradle-wrapper /tmp/easyhub-mobile-build/apps/mobile/android/gradlew \
  --offline
```

The deterministic output is `artifacts/analysis-frameworks/easyhub-jadx-1.5.6-android-v1.zip`. Its `framework.json` pins every runtime and license file by size and SHA-256. The packager also writes an adjacent JSON summary with the complete ZIP's size/hash. ZIP entries are sorted and use a fixed timestamp and permissions. `runtime/jadx-runtime.apk` is a DEX/Java-resource ZIP for `DexClassLoader`, not an application to install with Package Installer.

Run `verify-framework.py` with the same `JAVA_HOME` after packaging. It checks every manifest record and the Android DEX method signature, requires the JADX classpath/TLD resources, and invokes the real framework on CLASS/JAR/DEX/APK fixture files. It also verifies that cancellation during sampled class processing propagates. This host JVM check complements device tests of `DexClassLoader`; Android loading and app workflow still need emulator/device verification.

The public boundary is:

```java
ProgramEngine.analyze(File input, String format, String language, File directory,
  Runnable check, Consumer<Map<String, Object>> progress)
```

It returns Java collection types containing `architecture`, `functionCount`, `functions`, `imports`, `strings`, and `limitations`. Progress contains `done`, `total`, and `message`. The host validates the input with `BinaryInput.inspectJava`, including archive expansion and bytecode limits, before invoking the plugin. The framework retains the 20,000-class limit, samples up to 12 classes, limits each reconstructed class to 4,000 characters, restricts identifiers/imports/strings, and explicitly loads only the DEX and Java input plugins. Output/cache/temp/config remain in the host-owned job directory. `check.run()` preserves the host's cancellation and deadline checks.

The host must verify the fixed release asset and every manifest file before loading, use application-private storage, and load only this trusted framework, never the analyzed input. Android 14 with targetSdk 34 or later requires dynamically loaded DEX/JAR/APK files to be read-only. Open the new staging file, immediately make it read-only, then write through the already-open stream, verify SHA-256, and atomically activate it. Do not write an installed plugin in place. See [Android's dynamic code loading requirements](https://developer.android.com/about/versions/14/behavior-changes-14#safer-dynamic-code-loading), [integrity and storage guidance](https://developer.android.com/privacy-and-security/risks/dynamic-code-loading), and the [AOSP DexClassLoader contract](https://android.googlesource.com/platform/libcore/+/refs/heads/main/dalvik/src/main/java/dalvik/system/DexClassLoader.java).
