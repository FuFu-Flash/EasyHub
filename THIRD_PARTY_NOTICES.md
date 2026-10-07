# Third-party notices

## Optional program analysis

EasyHub installs program-file analysis components only when the user chooses to install them. The Windows packages are reduced distributions prepared by EasyHub from fixed upstream releases. Existing complete installations of the supported versions can also be used.

| Component | Upstream version | License and notices |
| --- | --- | --- |
| Ghidra | [12.1.2](https://github.com/NationalSecurityAgency/ghidra/releases/tag/Ghidra_12.1.2_build) | [Apache-2.0](https://github.com/NationalSecurityAgency/ghidra/blob/Ghidra_12.1.2_build/LICENSE), with separate licenses for included third-party modules and GPL native tools described in the upstream [NOTICE](https://github.com/NationalSecurityAgency/ghidra/blob/Ghidra_12.1.2_build/NOTICE). |
| Ghidra MCP Java backend | [6.0.0](https://github.com/bethington/ghidra-mcp/releases/tag/v6.0.0) | [Apache-2.0](https://github.com/bethington/ghidra-mcp/blob/v6.0.0/LICENSE). |
| Java runtime linked from Eclipse Temurin | [21.0.12.1+1](https://github.com/adoptium/temurin21-binaries/releases/tag/jdk-21.0.12.1%2B1) | [GPLv2 with the Classpath Exception](https://github.com/adoptium/jdk21u/blob/1c417fbfc2f7/LICENSE), plus the selected modules' third-party licenses. |

The Ghidra package retains the runtime Framework, Features, processor modules, analysis data, and Windows native tools. Standalone documentation, debugging modules, Python packages, extension installers, and developer tooling are omitted. Retained upstream files are verified against the complete official ZIP. The package preserves the upstream `LICENSE`, license directories, module attribution files and embedded notices; `EASYHUB_COMPONENT_NOTICE.txt` and `easyhub-component.json` identify the repackaging and actual retained files. Ghidra's original `bom.json` is preserved as upstream provenance, while the component manifest describes the reduced distribution. The distribution also includes the upstream project's `NOTICE` from the matching source tag. [Ghidra attribution and module licensing](https://github.com/NationalSecurityAgency/ghidra/blob/Ghidra_12.1.2_build/NOTICE).

Ghidra's GNU demangler support programs have separate GPLv3 terms. Their corresponding source, headers, build scripts and notices are retained under `GPL/`, together with `GPL/licenses/`. This source accompanies the native executables in the same component archive. [Demangler license declarations](https://github.com/NationalSecurityAgency/ghidra/blob/Ghidra_12.1.2_build/GPL/DemanglerGnu/Module.manifest), [GPLv3 terms](https://github.com/NationalSecurityAgency/ghidra/blob/Ghidra_12.1.2_build/GPL/licenses/GPL_3.html).

The Java image is generated with `jlink` from the checksum-verified complete official Temurin JDK. Its selected modules retain their original `legal/<module>/` files, including GPL, the Classpath Exception, assembly exceptions and third-party notices. The upstream root `NOTICE` and release metadata are also preserved. `SOURCE.md` and `easyhub-runtime-build.json` identify the upstream source revision, build revision, selected modules and linking options. The Classpath Exception permits use with independent modules under their own licenses; it does not remove the Java runtime's corresponding-source distribution requirements. [Upstream GPL and exception](https://github.com/adoptium/jdk21u/blob/1c417fbfc2f7/LICENSE), [additional license information](https://github.com/adoptium/jdk21u/blob/1c417fbfc2f7/ADDITIONAL_LICENSE_INFO).

Java corresponding-source materials are:

- [Official complete source archive](https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jdk-sources_21.0.12.1_1.tar.gz): `OpenJDK21U-jdk-sources_21.0.12.1_1.tar.gz`, 115,126,841 bytes, SHA-256 `573057d03584ae793fb7ec9a14c76d826d9187a53efeefd99da47403a5308234`. Identity and digest are recorded in the [official release metadata](https://github.com/adoptium/temurin21-binaries/releases/tag/jdk-21.0.12.1%2B1).
- [Upstream Java source revision](https://github.com/adoptium/jdk21u/tree/1c417fbfc2f7) and [Temurin build scripts revision](https://github.com/adoptium/temurin-build/tree/e6ba7dec3d07654074559310376a3ae89da5f4ac).
- EasyHub's [Java preparation script](apps/desktop/scripts/prepare-analysis-java.mjs), also included in the runtime archive as `build-support/prepare-analysis-java.mjs`, and the image's `easyhub-runtime-build.json`, which record the exact preparation source, selected modules and linking options used to produce the reduced image.

When EasyHub component archives are published, the complete Java source archive is offered alongside the Java runtime as a separate download from the same component release. The exact EasyHub preparation script accompanies the runtime itself. Source archive downloads are optional for recipients and are excluded from the client's analysis-component installation size. This follows the equivalent source-access option in GPLv2 section 3; a source archive does not need to be fetched with every binary installation. [GPLv2 source-distribution terms](https://github.com/adoptium/jdk21u/blob/1c417fbfc2f7/LICENSE).

EasyHub uses a bounded HTTP adapter to the Ghidra MCP Java backend. The [upstream headless startup](https://github.com/bethington/ghidra-mcp/blob/v6.0.0/docker/entrypoint.sh) is the integration reference. The optional integration distributes the Java backend. The exact upstream plugin LICENSE and attribution are bundled in `licenses/ghidra-mcp-LICENSE` and written into `extension/LICENSE` for new component installations.

## AI review

EasyHub's AI review connection uses the official OpenAI TypeScript and JavaScript SDK, version 7.23.0.

- Project: https://github.com/openai/openai-node
- License: Apache License, Version 2.0
- License text: [openai-LICENSE](apps/desktop/resources/licenses/openai-LICENSE)

The complete SDK license is also included in the application's `licenses/openai-LICENSE` resource. EasyHub supplies no developer API key; users configure their own compatible service and credentials.

## GitHub acceleration

EasyHub's GitHub routing follows the origin address and TLS SNI routing design of Watt Toolkit (SteamTools).

- Project: https://github.com/BeyondDimension/SteamTools
- License: GNU General Public License, version 3.0
- Public routing configuration: https://api.steampp.net/accelerator/projectgroups

The TypeScript implementation and configuration parser are independently implemented for EasyHub. The SteamTools Client SDK is not included. The full GNU GPLv3 text is distributed in the application's `LICENSE` resource.
