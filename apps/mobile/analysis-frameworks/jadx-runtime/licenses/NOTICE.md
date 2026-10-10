# JADX framework dependency notices

This framework contains JADX 1.5.6 and its DEX/Java input plugins, with Java resources retained from the upstream runtime JARs. EasyHub's entry point samples reconstructed code for static program review. All upstream licenses and notices contained in dependency JARs are copied without editing under `licenses/dependencies/`. `licenses/dependencies.json` records the exact dependency versions, original JAR sizes, and SHA-256 hashes, including the desugaring tool/runtime inputs.

The checked-in license texts below were retrieved from these upstream projects. They are shipped with the ZIP and covered by `framework.json` file hashes. Apache-licensed dependencies are covered by the complete `Apache-2.0.txt` license as well as their individual upstream texts where available.

| Component | License | Included upstream text/source |
| --- | --- | --- |
| JADX core, input API, ZIP, DEX input, Java input 1.5.6 | Apache-2.0 | `jadx-LICENSE`, https://github.com/skylot/jadx/blob/v1.5.6/LICENSE |
| raung common/disasm 0.1.1 | MIT | `raung-LICENSE`, https://github.com/skylot/raung/blob/v0.1.1/LICENSE |
| Gson 2.14.0 | Apache-2.0 | `gson-LICENSE`, https://github.com/google/gson/blob/gson-parent-2.14.0/LICENSE |
| Guava 33.6.0, failureaccess 1.0.3, empty listenablefuture conflict placeholder | Apache-2.0 | `guava-LICENSE`, https://github.com/google/guava/blob/v33.6.0/LICENSE; failureaccess's embedded license is retained |
| JSpecify 1.0.0 | Apache-2.0 | `jspecify-LICENSE`, https://github.com/jspecify/jspecify/blob/v1.0.0/LICENSE |
| error_prone_annotations 2.48.0, j2objc-annotations 3.1, jsr305 3.0.2 | Apache-2.0 | `Apache-2.0.txt`; license declarations in their published Maven POMs |
| SLF4J API/NOP 2.0.18 | MIT | Both unmodified embedded `META-INF/LICENSE.txt` files are retained under `dependencies/org.slf4j/` |
| Android smali baksmali/util/dexlib2 3.0.9 | BSD-3-Clause | All three unmodified embedded `LICENSE` files are retained under `dependencies/com.android.tools.smali/` |
| ASM 9.6 | BSD-3-Clause | `asm-license.html`, https://asm.ow2.io/license.html |
| desugar_jdk_libs and configuration 2.1.5 | GPL-2.0 with Classpath Exception; additional notices apply | `desugar-LICENSE`, `desugar-ADDITIONAL_LICENSE_INFO`; https://github.com/google/desugar_jdk_libs/blob/master/LICENSE and ADDITIONAL_LICENSE_INFO, as referenced by the 2.1.5 Maven POM |

The framework contains no GUI, CLI launcher, unrelated JADX input plugins, external JRE, native libraries, or Android permissions. It only loads the two explicitly selected input plugins. Files supplied for review are analyzed as data and are not executed or used as a class loader input.
