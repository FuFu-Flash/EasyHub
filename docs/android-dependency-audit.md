# Android 依赖精简记录

Android 1.1.0 下载：[arm64 APK](https://github.com/FuFu-Flash/EasyHub/releases/download/android-v1.1.0/EasyHub-Android-1.1.0-arm64.apk)。最新验收见 [下拉刷新记录](android-pull-refresh.md) 和 [验收证据包](https://github.com/FuFu-Flash/EasyHub/releases/download/android-v1.1.0/EasyHub-Android-1.1.0-verification.zip)。

下文保留各阶段的测量；`artifacts/...` 表示未纳入 Git 的本地档案路径。公开证据包只包含 `android-pull-refresh/` 的 20 组案例、JSON/log、源码摘要和 APK 验收，不包含框架或更早阶段的完整档案。

本轮从 mobile 的直接依赖中移除 `expo-symbols`、
`react-native-reanimated`、`react-native-worklets`。应用图标使用现有
`react-native-svg`；底部标签导航使用 Expo Router 的普通 Tabs 和
React Native Animated，页面导航使用 native-stack 与 screens。
应用源码没有调用这三个库。

Expo Router 的原生标签支持仍传递依赖 expo-symbols，未使用的 Drawer
支持也会传递解析 Reanimated 与 Worklets。因此 Android 在
`package.json` 的 `expo.autolinking.android.exclude` 中明确排除两个动画
原生模块。官方自动链接命令验证只移除了这两项，保留 screens、SVG、
safe-area、WebView、gesture-handler 和本地反编译模块。

登录使用的 expo-web-browser、README 使用的 WebView，以及 Expo 自身
依赖的 expo-font 均保留。此次没有增加依赖，也没有升级现有解析：
锁文件的 1292 个 package entries 和 1301 个 snapshots 全部保持原值，
只删除 mobile importer 的三项声明。离线 frozen-lockfile 检查通过。

## 历史：内置框架的运行资源精简

上一轮内置框架以 `libeasyhub-radare2.so` 与 `libcore_r2ghidra.so` 为入口检查 ELF
`DT_NEEDED` 闭包，全部 26 个引擎库都需要保留。287 个 Sleigh 运行文件、
格式、类型、签名、指令、系统调用数据库及许可证也全部保留。

packager 只排除 radare2 的 `www`、`cons`、`fortunes`、`hud`、`panels`
五个交互资源目录。Android 的 NativeEngine 使用 `-N -q0`，关闭颜色和
交互，只发送固定的静态分析 JSON 命令。上游 `libr/main/radare2.c` 的
`-q` 分支还会关闭启动提示；其余四类文件分别用于 HTTP 界面、终端主题
和 visual 菜单，不参与 `aaa` 或 `pdgj` 分析。

packager 会先清理旧的生成目录再复制资源，干净构建和增量构建使用相同
的 static-analysis profile。运行清单记录排除目录；canonical 源目录与
构建快照的 313 个引擎文件 SHA-256 均验证一致。

## 历史：53.98 MiB 内置框架包

精简前 APK 为 57,793,064 字节，包含 48 个 SO。两项动画库在原包中占
2,602,376 字节，压缩后为 788,450 字节。五个交互目录合计 105 个文件，
原始大小 1,182,158 字节，压缩后为 367,375 字节。仅这部分可移除载荷
合计约 1.10 MiB。

该轮 release APK 实测为 **56,598,974 字节（53.98 MiB）**，较基线减少
**1,194,090 字节（1.14 MiB，2.07%）**，SO 数量从 **48 降为 46**。
该包同时包含反编译设置对齐改动，差值包括 DEX、资源及 ZIP 开销
变化。包内已验证没有两项动画库和五个交互资源目录；26 个引擎库、
287 个 Sleigh 文件、Material Symbols 许可证与来源文件的 SHA-256
均保持原值。签名、arm64 架构及 16 KiB ELF 对齐检查通过。

历史 APK SHA-256：
`8ad04189554d29cb49c39541ccdab050a92b24ddb6e892ab44a2a66714c4a412`。

具体基线及完成后的测量见
`artifacts/native-analysis/dependency-slimming.json`
与 `artifacts/native-analysis/release-apk-verification.json`。

## 历史：更新与动画阶段 Android 1.1.0 的 26.20 MiB 主包

`artifacts/EasyHub-Android-1.1.0-arm64.apk` 为 **27,474,706 字节（26.20 MiB）**，Android versionCode **4**，SHA-256 `00c115b7f8c88be807e7497a3929ad3dbaac93497f13769eafa13d63a42460a3`。比下方上一轮按需框架基线增加 **11,264 字节（11.00 KiB）**，继续保留 **21 个**应用 SO，分析框架内置文件为 **0**，主包无 JADX 类及 Reanimated/Worklets 原生库。

新增手动更新检查和 Tabs/native Stack 导航过渡均复用现有依赖，没有新增库。更新检查对齐桌面 main `e89e9a337ae4b90d5e50e3131ef33a3632e5e980` 的正式渠道和官方发行页流程，并仅识别 Android 应用附件。**150 项**移动端 TypeScript 测试（含 **11 项**更新检查测试）、完整类型检查及全量 lint 通过；production、`debuggable=false`、开发 fixture 关闭、测试签名及 **174 项**构建输入哈希已核对。1080×2400 中文和 720×1600 英文 AVD 的实际版本显示、HTTP 检查、断网错误、网络恢复重试和失焦取消通过，见 [本轮更新与动画记录](android-update-and-motion.md) 和 验证清单（`artifacts/android-v110/verification.json`）。

## 历史：26.19 MiB 主包与按需框架

上一轮 `artifacts/EasyHub-Android-on-demand-frameworks-arm64.apk` 为 **27,463,442 字节（26.19 MiB）**，比上述内置框架包减少 **29,135,532 字节（51.48%）**。该轮主包的 21 个 SO 均为应用依赖，分析引擎 SO 和原生框架 assets 均为 **0**，JADX 类不在 DEX 中；按需安装保留原有分析能力，用户只下载需要的组件。

历史按需主包 SHA-256：`8678cb4ea10cdb8590e9214a664aef7a5a77a27a0eec3e5fc6296fa6407b2197`。arm64、production、`debuggable=false`、开发 fixture 关闭、测试签名及 16 KiB ELF 对齐检查通过，170 项构建输入哈希一致，见 `artifacts/analysis-frameworks/on-demand-apk-verification.json`。

Java 框架下载 **2,804,563 字节**，原生框架下载 **26,357,764 字节**；均在桌面既有组件 Release 真实发布。当前原生 ZIP 保留 25 个引擎库、287 个 Sleigh 文件以及固定版本的数据库、资源和许可证；共享 libc++ 复用主包。前述五类交互资源裁剪属于内置框架阶段，当前框架打包器不再额外裁剪这些目录，详见 框架与源码验证（`artifacts/native-analysis/on-demand-native-frameworks.md`）。

同一 Release 的实际 21 个附件中包含 7 个 Android 附件，构建支持、原生完整源码及源码校验清单共 3 个；发布记录见 `artifacts/analysis-frameworks/repository-assets-final-verification.json`。组件安装方式及目前已完成的运行验证见 [按需下载说明](android-framework-downloads.md)。

上一轮按需包在 Android Studio API 36 AVD 的 1080×2400 中文与 720×1600 英文、正常字号下完成安装、取消重试、移除和重新下载，以及 APK/JAR/SO 的断网真实反编译。设备 687 个组件文件哈希及只读权限正确，分析/下载临时文件残留为 0，中断安装恢复通过，详见 最终模拟器验收（`artifacts/analysis-frameworks/emulator-framework-verification.json`）。这些反编译记录属于该历史包，不代表在 1.1.0 新包重新执行了同一验收。
