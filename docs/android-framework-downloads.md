# Android 审查组件按需下载

Android 1.1.0 下载：[arm64 APK](https://github.com/FuFu-Flash/EasyHub/releases/download/android-v1.1.0/EasyHub-Android-1.1.0-arm64.apk)。最新验收见 [下拉刷新记录](android-pull-refresh.md) 和 [验收证据包](https://github.com/FuFu-Flash/EasyHub/releases/download/android-v1.1.0/EasyHub-Android-1.1.0-verification.zip)。

下文保留各阶段的测量；`artifacts/...` 表示未纳入 Git 的本地档案路径。公开证据包只包含 `android-pull-refresh/` 的 20 组案例、JSON/log、源码摘要和 APK 验收，不包含框架或更早阶段的完整档案。

Android 主 APK 与桌面使用同样的组件管理方式：安装应用后，用户在设置中选择需要的反编译组件，从项目仓库下载。Java / Dalvik 与原生程序组件分别管理，不随主 APK 自动安装，也不在选取程序或确认 AI 审查时自动下载。

设置中的“程序文件审查”默认收起，展开后可打开“管理审查组件”。每个组件显示版本、下载大小、安装状态、支持状态；已安装的组件还显示占用空间，可单独移除。下载大小和安装状态来自原生模块，不在界面中写死。

- Java / Dalvik：JADX，适用于 APK、DEX、JAR、CLASS。
- 原生程序：radare2 / r2ghidra，适用于 EXE、DLL、SO、ELF、Mach-O。

下载、校验和安装过程中显示当前进度。取消后等待原生请求及临时文件清理结束，再允许重试或进行分析；安装、删除与分析使用同一原生任务锁。离开设置取消当前安装，并使旧的 AI 确认失效。

没有相应组件时，程序文件审查、独立反编译及 PR 程序分析解释所需组件，并提供设置入口；PR 会在下载程序文件前检查组件。安装完成或返回分析页面时重新读取状态。安装组件不需要 AI 授权；AI 审查仍使用现有共享授权和一次发送确认，完成后先显示 AI 结果，再显示默认折叠的提取证据。

## 安装包与真实发布来源

更新与动画阶段的主包为 `artifacts/EasyHub-Android-1.1.0-arm64.apk`，Android versionCode **4**，**27,474,706 字节（26.20 MiB）**，SHA-256 `00c115b7f8c88be807e7497a3929ad3dbaac93497f13769eafa13d63a42460a3`。production、开发 fixture 关闭、`debuggable=false`、Android 测试签名，**174 项**构建输入哈希匹配；主包有 **21 个**应用 SO，零内置分析框架，无 JADX 类和 Reanimated/Worklets 原生库，本轮未新增依赖。

1.1.0 增加与桌面一致的手动正式渠道应用更新检查，只识别官方 Android APK，下载按钮打开官方发行页。**150 项**移动端 TypeScript 测试（含 **11 项**更新检查测试）、完整类型检查和全量 lint 通过；1080×2400 中文和 720×1600 英文 AVD 显示版本正确，真实 HTTP 不误报桌面 1.2.1，断网、重试和标签切换取消通过。新包的更新与导航验收见 [本轮记录](android-update-and-motion.md) 和 验证清单（`artifacts/android-v110/verification.json`）；下方组件实测及发布证据保留上一轮归属。

上一轮按需框架基线包为 `artifacts/EasyHub-Android-on-demand-frameworks-arm64.apk`，**27,463,442 字节（26.19 MiB）**。相比此前内置框架包的 **56,598,974 字节（53.98 MiB）**减少 **51.48%**。该 APK 保留 21 个应用原生库和 6 个 DEX；分析引擎 SO、原生框架 assets 均为 **0**，JADX 类也不在 APK 中。production 构建、开发 fixture 关闭、`debuggable=false`，使用 Android 测试签名，170 项构建输入哈希匹配，见 历史主包验证（`artifacts/analysis-frameworks/on-demand-apk-verification.json`）。

历史按需主包 SHA-256：`8678cb4ea10cdb8590e9214a664aef7a5a77a27a0eec3e5fc6296fa6407b2197`。

两个 Android 组件已真实发布到桌面使用的既有 [analysis-runtime-ghidra-12.1.2-java-21.0.12.1-r1 Release](https://github.com/FuFu-Flash/EasyHub/releases/tag/analysis-runtime-ghidra-12.1.2-java-21.0.12.1-r1)：

| 组件 | 下载附件 | 实际大小 |
| --- | --- | ---: |
| Java / Dalvik，JADX 1.5.6 | `easyhub-jadx-1.5.6-android-v1.zip` | 2,804,563 字节 |
| 原生程序，radare2/r2ghidra 6.2.2，arm64 | `easyhub-radare2-6.2.2-android-arm64-v1.zip` | 26,357,764 字节 |

Android 共新增 7 个附件，其中 3 个为构建支持与源码附件：`easyhub-android-analysis-build-support-v1.zip`、`easyhub-native-framework-sources-v1.tar.gz`、`SHA256SUMS-android-sources.txt`；另有两个框架 ZIP、Android manifest 和框架校验清单。GitHub API 已核对同一 Release 共 **21 个附件**及其 ID、大小和 digest，见 发布附件验证（`artifacts/analysis-frameworks/repository-assets-final-verification.json`）。

安装器校验固定下载大小、ZIP SHA-256、manifest 及每个解压文件，成功后原子替换私有安装目录；分析前再次检查已安装文件。Java 从安装目录加载，原生在 API 29 及以上通过系统 `linker64` 加载已安装引擎，共享 libc++ 由主 APK 提供。已安装组件的本机分析路径不访问网络；首次使用仍需先由用户安装相应组件。

## 上一轮组件与发布验证基线

- 移动端 TypeScript 测试 **139 项通过**，Kotlin 输入校验、解压限制、框架文件校验和取消测试 **18 项通过**。
- 已从真实 GitHub 下载 Java 组件，最终生产主包断网后完成真实 APK 字节码反编译，恢复 `computeScore` 分支、乘法和加 7，以及 `describe` 字符串，见 离线恢复代码（`artifacts/android-analysis-ui/ondemand-final-offline-apk-code.png`）。
- 原生组件网络下载的取消已实测成功，完整网络重试后已安装，见 两个组件的安装状态（`artifacts/android-analysis-ui/ondemand-components-installed.png`）。
- 最终生产主包在断网下完成真实 APK、JAR 和 ARM64 SO 反编译；SO 恢复出负数分支及 `arg1 * 3 + 7`，见 SO 恢复代码（`artifacts/android-analysis-ui/ondemand-final-offline-so-score.png`） 和 JAR 恢复代码（`artifacts/android-analysis-ui/ondemand-final-720-offline-jar-code.png`）。
- Android Studio API 36 AVD 在 **1080×2400/420dpi 中文**与 **720×1600/320dpi 英文**、正常字号完成组件管理检查；移除 Java 后从 GitHub 重新下载成功，10 个完整可见组件操作按钮实测至少 48dp，未发现文字溢出、按钮截断或重叠，见 界面审计（`artifacts/analysis-frameworks/framework-ui-audit.md`）。
- 设备实际安装目录的 **687 个文件**大小、SHA-256 和只读权限均通过；分析输入与组件下载临时文件残留为 **0**。模拟中断留下的 staging、ZIP 已清理，旧组件目录恢复成功，见 设备文件验证（`artifacts/analysis-frameworks/device-framework-files-verification.json`）。
- 重启后组件仍已安装，程序文件审查默认收起；最后还原中文、1080×2400、正常字号和完整网络，设备实际 APK 哈希与交付包相同。完整验收见 模拟器验证（`artifacts/analysis-frameworks/emulator-framework-verification.json`），本次没有外部 AI 请求，也没有运行被审查程序。

此前 53.98 MiB 内置框架包及其离线截图是历史基线，保留于 [分析验收记录](android-analysis-check.md)。
