# Android 反编译与继续对齐验收

Android 1.1.0 下载：[arm64 APK](https://github.com/FuFu-Flash/EasyHub/releases/download/android-v1.1.0/EasyHub-Android-1.1.0-arm64.apk)。最新验收见 [下拉刷新记录](android-pull-refresh.md) 和 [验收证据包](https://github.com/FuFu-Flash/EasyHub/releases/download/android-v1.1.0/EasyHub-Android-1.1.0-verification.zip)。

下文保留各阶段的测量；`artifacts/...` 表示未纳入 Git 的本地档案路径。公开证据包只包含 `android-pull-refresh/` 的 20 组案例、JSON/log、源码摘要和 APK 验收，不包含框架或更早阶段的完整档案。

日期：2026-10-10。对照桌面源码 `origin/main` 的 `e89e9a337ae4b90d5e50e3131ef33a3632e5e980`；没有合并或重置本地工作。

## 更新与动画阶段：Android 1.1.0（历史包）

更新与动画阶段的验收包为 `artifacts/EasyHub-Android-1.1.0-arm64.apk`，Android versionCode **4**，大小 **27,474,706 字节（26.20 MiB）**，SHA-256 `00c115b7f8c88be807e7497a3929ad3dbaac93497f13769eafa13d63a42460a3`。production、`debuggable=false`、开发 fixture 关闭、测试签名，**174 项**构建输入哈希匹配；**21 个**应用 SO，零内置分析框架，无 JADX 类和 Reanimated/Worklets 原生库，本轮没有新增依赖。

本轮 **150 项**移动端 TypeScript 测试全部通过，包含 **11 项**更新检查测试，完整类型检查与全量 lint 通过。更新检查与桌面同为手动正式渠道，仅识别官方 Android APK 并打开官方发行页。1080×2400 中文及 720×1600 英文 AVD 实际显示 1.1.0，真实 HTTP 不误报桌面 1.2.1；断网错误、恢复网络重试、标签失焦取消已经通过。新增更新与导航过渡的最终验收见 [本轮记录](android-update-and-motion.md) 和 验证清单（`artifacts/android-v110/verification.json`）。

本文下方的真实反编译、组件下载与发布证据继续对应各自的历史包。尤其 **26.19 MiB** 和 `8678cb4ea10cdb8590e9214a664aef7a5a77a27a0eec3e5fc6296fa6407b2197` 属于上一轮按需框架基线，不作为 1.1.0 新包重新执行反编译的证明。

## 实现与入口

- 设置 → AI API 授权下的“程序文件审查”，默认收起，不要求 GitHub 登录。与桌面共用流程：选择本地文件 → AI 审查 → 一次确认发送 → 本机提取 → AI 审查；不再从设置跳到单独反编译页面。
- 设置与 PR 共用同一份 AI 授权。确认显示服务商、模型、服务地址、文件及发送范围，说明服务商可能收费；没有 AI 授权时只提示先设置，不启动提取。Java 与原生组件分别由“管理审查组件”按需下载，显示真实下载大小、支持及安装状态、已安装占用空间，并可单独移除；选取文件或 AI 确认不会隐式安装组件。
- 发行附件 → 下载并反编译。附件重新核对 ID、名称、大小及可用 SHA-256；PR 程序文件在原 PR 页面下载并反编译，重新核对 head/path/blob，并从实际 head 仓库读取固定 blob。
- Java/Dalvik：JADX 1.5.6，支持 APK、DEX、JAR、CLASS；至少 Android 8。SAF 名称从 DISPLAY_NAME 读取，ZIP 类型根据真实字节码判断。
- 原生程序：arm64 Android 上运行 radare2/r2ghidra 6.2.2，支持 PE、ELF、Mach-O。被分析程序不会执行；可信引擎从已校验的私有安装目录加载，API 29 及以上通过系统 `linker64` 启动，共享 libc++ 使用主 APK 的运行库。
- 设置先显示 AI 结果，严重程度随界面语言显示，并说明没有具体发现时的结果及审查范围。提取证据默认收起，包含文件、SHA-256、格式/架构、抽样恢复代码、导入、文本及提取范围；AI 失败仍可查看已经成功提取的证据。
- 折叠设置保留当前进度和结果；离开设置使旧确认失效并取消任务，只有底层任务真正结算后才解锁。切换语言清除旧结果并取消进行中的审查。确认前后及提取完成后核对 AI 配置，结果必须绑定当前分析 ID。
- 独立反编译页面及发行附件、PR 的分析入口保留；独立本机分析无需 AI Key，可以分享 Markdown 报告。报告围栏长度根据内容动态生成，程序文本不会变成额外 HTML、链接或 Markdown 标题。没有使用真实 API Key 执行收费请求。

### 依赖精简

移除 mobile 对 `expo-symbols`、`react-native-reanimated`、`react-native-worklets` 的直接声明，并从 Android 自动链接中排除两个未使用的动画原生模块。现有 SVG 图标、导航、登录、Markdown WebView 和真实反编译引擎继续保留；没有新增依赖或升级锁定版本。

此前内置框架阶段移除 radare2 五类交互资源，APK 的 SO 数量由 48 降至 46，包体积减少 **1,194,090 字节（1.14 MiB，2.07%）**，得到 53.98 MiB 历史包。上一轮将框架改为用户按需安装，该轮主包 **26.19 MiB**，再减少 **51.48%**；只有 21 个应用 SO，分析引擎 SO、原生框架 assets 均为 0，JADX 类不在主包 DEX 中。更新与动画阶段 1.1.0 的 **26.20 MiB** 主包继续保持这一按需组件方式。

当前可下载的原生 ZIP 保留 25 个引擎库、287 个 Sleigh 文件以及固定版本的资源、数据库和许可证，共享 libc++ 复用主 APK。详细测量见 [Android 依赖精简记录](android-dependency-audit.md)，下载与发布方式见 [组件按需下载](android-framework-downloads.md)，以前的真实格式/取消/NUL 协议回归保留于 运行资源验证（`artifacts/native-analysis/runtime-pruned-smoke-verification.json`）。

### PR 审查集成

程序反编译服务于合并请求审查。PR 修改文件下直接显示本机反编译证据，按 head SHA、完整文件路径和 blob SHA 关联，允许展开函数或类的恢复代码，并复用同一版本的已完成证据。一次 AI 审查同时处理文字 patch 和最多 **3 个**没有文字差异的程序文件；发现回到 PR 页面，包含文件路径及真实函数地址/Java 标识符，保留分析失败或抽样遗漏的说明。发送前说明服务商、模型和发送内容，不上传原始二进制，不自动发表 GitHub 评论或决定合入。

文件读取前后、每次发送 AI 前及返回结果时，复核 head、base SHA、base ref 和 changed_files。刷新清除旧 AI 报告，修改文件分页再次复核；每份 AI 程序证据保留对应 blob SHA，避免不同版本或同名文件串用。Git 空 blob 的新增文件跳过程序分析。

桌面上游的 PR 程序审查只分析 head 文件，**没有实际反编译比较 base/head**。本轮同样属于当前程序版本的抽样证据，不据此宣称问题由本次修改新增；base SHA 的检查仅用于发现 PR 上下文变化。

## 范围与限制

保留 Android 不提供本地项目、源码编辑/发布和发行版发布/编辑的要求。程序文件选择用于静态分析，不是项目工作区。

一般输入最多 128 MiB；Java 输入及展开字节码最多 64 MiB，归档总展开最多 128 MiB，最多 20,000 类/压缩项。抽样最多 12 类或 16 函数，每段最多 4,000 字符。APK 分析覆盖字节码，原生库需单独选择 SO；不还原资源或原项目。原生分析有 180 秒 watchdog、进程终止及等待；JADX 在应用内运行，取消为协作式，大小预检不等于进程隔离。

任务快照与远程下载文件在成功、失败或取消后清除，避免分析输入长期留在私有缓存，页面内的恢复代码与证据仍可继续审阅。缓存清理记录（`artifacts/android-analysis-ui/pr-program-cache-cleanup.json`） 已实际检查取消及成功后的临时目录，残留均为 0。用户主动分享的报告留在应用缓存，避免接收应用延迟读取失败；下次分享清理超过 24 小时的报告。

此前内置框架版本的设置成功及 AI 取消后输入缓存同样为 **0**，用户文件选择器中的原始文件保留。该轮已把旧引擎标记 `6.2.2` 迁移为 `6.2.2-static-analysis-1`，五类被裁掉的交互目录无残留，见 设置缓存与运行资源迁移记录（`artifacts/android-analysis-ui/settings-program-cache-cleanup.json`）。

## 上一轮按需框架验证

- 移动端 TypeScript 测试 **139 项通过**，Kotlin 安装、校验及生命周期测试 **18 项通过**；移动端完整类型检查和 lint 通过。只读核验见 最终审计（`artifacts/analysis-frameworks/final-audit.md`）。
- GitHub API 实际核对桌面既有 `analysis-runtime-ghidra-12.1.2-java-21.0.12.1-r1` Release 共 **21 个附件**，其中 **7 个 Android 附件**包含 3 个构建支持/源码附件；两个框架分别为 **2,804,563 字节**和 **26,357,764 字节**，ID、大小及 digest 见 发布附件记录（`artifacts/analysis-frameworks/repository-assets-final-verification.json`）。
- Java 组件已从真实 GitHub 下载并安装。最终生产主包真正断网后完成 APK 字节码反编译：恢复代码（`artifacts/android-analysis-ui/ondemand-final-offline-apk-code.png`） 包含 `computeScore` 分支、乘法和加 7，以及 `describe` 字符串，提取文字见 离线结果（`artifacts/android-analysis-ui/ondemand-final-offline-apk-texts.json`）。
- 原生网络下载取消已实际成功，完整网络重试后 两个组件均已安装（`artifacts/android-analysis-ui/ondemand-components-installed.png`）。
- 原生 SO 离线分析、最终冷启动及最新主包两个主流分辨率的最终界面检查继续验收。

## 历史功能与内置框架验证

- `pnpm --filter @easyhub/mobile test`：**128 项通过**。在 109 项基线上新增程序设置流程 **19 项**，覆盖缺少授权时不提取、一次确认流程、授权变化、证据与文件/分析 ID 绑定、失败及取消；此前 `pr-binary-review.test.mjs` 的 **16 项** PR 程序审查回归继续保留。
- 共享 GitHub 客户端相关 Vitest：43 项通过，包含检查/状态、搜索/回复与历史/发行分页。
- 桌面受影响的 `AiReviewService.test.ts` 与 `githubClient.test.ts`：**82 项通过**。移动端类型检查、桌面 Node/Web 类型检查、AI 审查相关 eslint 及 `git diff --check` 通过，完整日志与源码摘要见 `artifacts/native-analysis/pr-binary-review-verification.json`。
- 本轮移动端完整类型检查及全量 eslint 已通过，128 项测试与 165 项构建输入摘要见 `artifacts/native-analysis/settings-alignment-verification.json`；此前 93 项基线的完整记录保留于 `artifacts/native-analysis/final-validation.json`。
- `:easyhub-analysis:compileDebugKotlin`：成功。构建中遇到同步生成的数字后缀副本，仅清理生成输出后重试。
- `native-analysis/smoke-android.py`：真实 Android CLI 验证 ARM64 ELF、x64 EXE/DLL、x86 DLL、ARM64 Mach-O 均恢复分支与 `value * 3 + 7`；NUL 协议、取消及 16 KiB ELF 页面对齐通过。
- Java 测试输入来自 `javac --release 11` 和 Android D8，JAR 实际执行输出 30；DEX/APK 有真实可反编译代码，不是格式占位文件。
- 原生引擎此前回归 **11 项及取消检查 2 项通过**。本轮精简后的运行资源已再次验证 ARM64 ELF、x64 EXE/DLL、x86 DLL、ARM64 Mach-O，以及取消、NUL 协议与 16 KiB 对齐；687 个设备端运行文件与本地哈希一致，见 精简运行资源回归（`artifacts/native-analysis/runtime-pruned-smoke-verification.json`）。
- 已在 Android Studio AVD 上实际检查 1080×2400 与 720×1600、正常字号，涵盖分析结果、程序恢复代码、远程下载取消/重试、checks、讨论分页、历史/发行分页和搜索。遵循本轮要求，验收重点为这两个主流分辨率。
- 本轮设置流程在 **1080×2400 中文**和 **720×1600 英文** AVD、正常字号上通过。1080 检查真实 APK 提取、AI 结果、取消后同文件重试；720 检查长文件名 APK 与 SO 的真实提取和 AI 结果。长确认内容可滚动，确认按钮实测为 48dp，删除动画模块后的 Tabs/Stack 导航正常。AI 使用界面明确标注的本地受控响应，两类提取均使用真实引擎，完整记录与截图索引见 设置 UI 验证（`artifacts/android-analysis-ui/settings-ui-verification.json`）。
- 历史 53.98 MiB 内置框架生产 APK 的独立离线本机分析已通过：Java 恢复代码（`artifacts/android-analysis-ui/settings-release-offline-apk-code.png`） 包含实际类、负数分支及 `apples * 3 + oranges * 2 + 7`；SO 恢复代码（`artifacts/android-analysis-ui/settings-release-offline-so-score-code.png`） 包含负数分支及 `arg1 * 3 + 7`。未配置 AI 授权时设置只显示 先连接 AI 服务的提示（`artifacts/android-analysis-ui/settings-release-ai-access-required.png`），不启动提取。
- PR 同页真实 PE 反编译已在两个主流分辨率成功显示证据：720×1600 程序证据（`artifacts/android-analysis-ui/pr-integrated-720-evidence.png`）、1080×2400 程序证据（`artifacts/android-analysis-ui/pr-integrated-1080-evidence.png`）。两个分辨率均展开恢复代码，1080×2400 代码（`artifacts/android-analysis-ui/pr-integrated-1080-code-visible.png`） 实际恢复 `arg1 * 3 + 7`。720×1600 还完成 取消（`artifacts/android-analysis-ui/pr-integrated-720-cancel-confirmed.png`） 和 重试（`artifacts/android-analysis-ui/pr-integrated-720-code.png`）；取消及成功后的私有下载/分析快照残留均为 **0**。

AI 回归使用受控响应，没有使用真实 API Key 执行收费请求。

## 上一轮按需框架安装包（历史基线）

`artifacts/EasyHub-Android-on-demand-frameworks-arm64.apk` 保留设置审查、PR 集成及官方 Material Symbols 箭头，把 Java/原生框架改为用户按需下载，大小 **27,463,442 字节（26.19 MiB）**，较历史内置框架包减少 **51.48%**。arm64-v8a，最低 API 24、目标 API 36，production 构建、`debuggable=false`、开发 fixture 关闭、Android 测试签名；170 项构建输入哈希一致。包内确认零分析引擎 SO、零原生框架 assets、JADX 类不存在，详情见 `artifacts/analysis-frameworks/on-demand-apk-verification.json`。

SHA-256：`8678cb4ea10cdb8590e9214a664aef7a5a77a27a0eec3e5fc6296fa6407b2197`。

该轮主包已用 Android Studio API 36 AVD 完成真实 GitHub 组件下载、原生下载取消和重试、Java 移除后重新下载；断网完成 APK、JAR 和 ARM64 SO 的真实代码恢复。1080×2400 中文与 720×1600 英文、正常字号的组件界面未发现排版问题，冷启动后保持组件安装状态与默认折叠。687 个组件文件哈希及只读权限匹配，临时文件残留为 0，中断安装旧目录恢复通过；设备已还原中文、1080×2400 和网络。详情见 最终模拟器验收（`artifacts/analysis-frameworks/emulator-framework-verification.json`）、界面审计（`artifacts/analysis-frameworks/framework-ui-audit.md`） 和 设备文件核验（`artifacts/analysis-frameworks/device-framework-files-verification.json`）。

### 历史安装包基线

此前 `artifacts/EasyHub-Android-aligned-decompiler-arm64.apk` 为 **56,598,974 字节（53.98 MiB）**，SHA-256 `8ad04189554d29cb49c39541ccdab050a92b24ddb6e892ab44a2a66714c4a412`；165 项构建输入及生产配置见 历史包验证（`artifacts/native-analysis/release-apk-verification.json`）。该包已在 AVD 上完成断网冷启动，实测 **915 ms**，见 历史冷启动日志（`artifacts/android-analysis-ui/settings-release-cold-start.txt`），Java/SO 离线结果和 AI 授权提示见 历史 UI 验证（`artifacts/android-analysis-ui/final-ui-verification.json`）。

上一包的 Material 箭头和 PR 验收保留于 设置对齐前的 UI 基线（`artifacts/android-analysis-ui/final-ui-verification.before-settings-alignment.json`）。`material-release-*` 与 `settings-release-*` 截图属于前轮基线；按需框架本轮使用 `ondemand-final-*`。

## 证据位置

- `artifacts/native-analysis/`：真实引擎结果、源码编译与构建日志、测试文件及摘要。
- `artifacts/android-analysis-ui/`：本轮模拟器截图与 UI XML。
- `apps/mobile/native-analysis/`：固定引擎源码版本、重建脚本、许可证、运行文件哈希；JNI/资产为生成文件。
- 以前的 `EasyHub-Android-ui-checked-arm64.apk` 不包含本轮反编译引擎，不能作为此次验收包。
