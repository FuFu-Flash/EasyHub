# macOS ARM64 analysis components

These optional headless components supply EasyHub's local program analysis. Versions and checksums are fixed. The existing Mac v1 binaries were verified locally and must be published unchanged; only the Ghidra release filename gains the `easyhub-` prefix.

Release repository: `FuFu-Flash/EasyHub`.
Release tag: `analysis-runtime-ghidra-12.1.2-java-21.0.12.1-r1`.
Keep all existing Windows release assets and the existing complete Java source asset unchanged.

| New Mac asset | Bytes | SHA-256 |
| --- | ---: | --- |
| easyhub-ghidra-12.1.2-mac-arm64-v1.zip | 226376392 | c195aa703e8f9465f25eaaa5c396696967c56f4d12120f75d24e5b1501bb857e |
| easyhub-java-21.0.12.1-mac-arm64-v1.tar.gz | 49510546 | d2d0e014593c25d2e22c40ad3a30115acfebf19cf6bb5d2af746a8c99f877dbe |

The runtime also uses the unchanged upstream `bethington/ghidra-mcp` `v6.0.0` asset `GhidraMCP-6.0.0.zip`: 728120 bytes, SHA-256 `867731de27d5143632a010943b907a6485dd54d0e19729e2f85ee9f692c99873`. Total runtime download is 276615058 bytes (about 264 MiB), 64.24% smaller than the complete Mac components.

## Repository layout and preparation

Install the three preparation scripts and the fixed JSON manifest from this directory into `apps/desktop/scripts/`. The scripts locate `apps/desktop` from their own location and default to `apps/desktop/out/analysis-components`. They download nothing, use fresh output staging, and refuse to replace existing v1 output. Supply absolute paths; the examples use placeholders for input paths.

For future Ghidra preparation (Python 3.9+, no extra Python packages):

```sh
python3 apps/desktop/scripts/prepare-mac-ghidra.py \
  --archive /absolute/path/ghidra_12.1.2_PUBLIC_20260605.zip \
  --output /absolute/path/new-ghidra-output
```

Optional `--runtime-root /absolute/path/runtime` validates the installed Ghidra 12.1.2 metadata and fixed Ghidra MCP 6.0.0 JAR. Packaging does not execute program analysis. Output is the Ghidra image, `easyhub-ghidra-12.1.2-mac-arm64-v1.zip`, SHA-256 sidecar, and `.build.json` report. `--output-root` is an alias for `--output`.

For future Java preparation, use an Apple Silicon Mac, Node 20+, Python 3 and macOS command-line tools (`tar`, `lipo`, `codesign`). `--runtime-root` must contain `ghidra/Ghidra` plus `extension/lib/GhidraMCP-6.0.0.jar` from the fixed installed runtime:

```sh
node apps/desktop/scripts/prepare-mac-java.mjs \
  --archive /absolute/path/OpenJDK21U-jdk_aarch64_mac_hotspot_21.0.12.1_1.tar.gz \
  --runtime-root /absolute/path/runtime \
  --output /absolute/path/new-java-output
```

The Java recipe hashes the complete pinned JDK, scans all Ghidra/MCP runtime JARs with `jdeps`, links static and dynamic dependencies, restores every selected module's full legal material, verifies compilation, GBK and locales, verifies every native file's ARM64 architecture and original signature, and compresses the same linked image twice. It leaves its own stage for diagnostics. The output manifest records JAR/JMOD hashes, module selection, flags and recipe hash.

## Existing immutable Java v1 provenance

The published Java v1 archive contains `build-support/prepare-mac-java.mjs` from its original construction, SHA-256 `db414c0d8c72b2a0ffa14dd0579132265b6144b793f1fb8247f0d870c9c78c5b`. That embedded original recipe still has research-machine defaults and is retained unchanged to preserve provenance. The repository CLI is an adapted recipe with explicit inputs; it does not replace the embedded recipe or describe itself as the original build bytes. Its recipe hash and generated metadata differ. Preparing a new image does not authorize replacing the pinned v1 release asset; publish any newly built Java artifact under a new revision and update its verified pins together.

Archive reproducibility means repeated compression of the same linked image. Independent `jlink` invocations have not been established to produce byte-identical images.

## Stage the existing v1 release assets

```sh
node apps/desktop/scripts/prepare-mac-analysis-release.mjs \
  --component-root /absolute/path/existing-components \
  --output /absolute/path/new-release-staging
```

The helper accepts either the already prefixed Ghidra name or the original local `ghidra-12.1.2-mac-arm64-v1.zip`, validates both pinned size and SHA-256, copies unchanged bytes under the release names, and produces Mac-specific manifest, checksums and release notes. It neither uploads files nor modifies GitHub. Its optional `--java-source /absolute/path/OpenJDK21U-jdk-sources_21.0.12.1_1.tar.gz` verifies a local copy of the existing complete source asset without copying or re-uploading it. The helper rejects a previously staged output directory.

## Licenses and corresponding source

Ghidra retains the original `LICENSE`, all 156 original legal files, matching-tag `NOTICE`, unchanged `bom.json`, and the GPL tools' complete corresponding source and notices (68 files under GPL source directories). Its inventory lists each retained official file's hash and permissions. All 39 processors, all format/typeinfo data and ten FID databases stay intact. Omitted components include standalone GUI/debugger/server launchers, non-Mac native tools, docs/examples except legal files, user scripts, Python wheels, PostgreSQL and YAJSW except legal files. Refer to the included upstream terms for each component.

Java retains `Contents/Home/NOTICE`, `upstream-release`, and every selected module's complete `Contents/Home/legal` material, including `java.base/LICENSE` and `ADDITIONAL_LICENSE_INFO`. `SOURCE.md` and `easyhub-runtime-build.json` record exact upstream Java/source/build revisions and build inputs. The complete, unmodified corresponding source archive is already an asset on the same EasyHub release:

- Name: `OpenJDK21U-jdk-sources_21.0.12.1_1.tar.gz`
- Bytes: `115126841`
- SHA-256: `573057d03584ae793fb7ec9a14c76d826d9187a53efeefd99da47403a5308234`
- [Existing EasyHub source asset](https://github.com/FuFu-Flash/EasyHub/releases/download/analysis-runtime-ghidra-12.1.2-java-21.0.12.1-r1/OpenJDK21U-jdk-sources_21.0.12.1_1.tar.gz)
- [Official corresponding source](https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jdk-sources_21.0.12.1_1.tar.gz)
- [Java source revision 1c417fbfc2f7](https://github.com/adoptium/jdk21u/tree/1c417fbfc2f7)
- [Temurin build revision e6ba7dec3d07654074559310376a3ae89da5f4ac](https://github.com/adoptium/temurin-build/tree/e6ba7dec3d07654074559310376a3ae89da5f4ac)

If a local copy is needed, obtain that fixed official URL and validate **both** size and SHA-256 before using it. The release preparation helper provides that validation. Keep the full source attachment and notices available alongside the binary; it is separate from runtime downloads. EasyHub application code is licensed under Apache License 2.0; third-party components retain their respective license terms.

## Verification scope

The immutable v1 images passed per-file archive extraction, SHA-256 and executable mode round trips with the application's production extractor. Ghidra retained every runtime JAR/module manifest/data/legal file selected by the fixed retention rules. Mac native tools and Java native launchers/libraries verified correctly. Real Mach-O ARM64, ELF x86_64 and PE x86_64 samples matched the complete runtime's normalized functions, imports, strings and decompilation. Cancellation, owned-process cleanup, Unicode/space paths, compiler, character encodings, locales, EC crypto and ZIP filesystem providers passed. Sample equivalence covers those samples; inventory preservation covers all processors/data. Packaging scripts alone do not establish analysis equivalence.
