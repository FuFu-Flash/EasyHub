# Android 1.1.0 更新与导航动画验收

Android 1.1.0 下载：[arm64 APK](https://github.com/FuFu-Flash/EasyHub/releases/download/android-v1.1.0/EasyHub-Android-1.1.0-arm64.apk)。最新验收见 [下拉刷新记录](android-pull-refresh.md) 和 [验收证据包](https://github.com/FuFu-Flash/EasyHub/releases/download/android-v1.1.0/EasyHub-Android-1.1.0-verification.zip)。

下文保留各阶段的测量；`artifacts/...` 表示未纳入 Git 的本地档案路径。公开证据包只包含 `android-pull-refresh/` 的 20 组案例、JSON/log、源码摘要和 APK 验收，不包含框架或更早阶段的完整档案。

日期：2026-10-10。本文对应下拉刷新之前的更新与动画阶段验收包，保留该阶段的构建哈希和记录。更新行为对照桌面 main `e89e9a337ae4b90d5e50e3131ef33a3632e5e980`；Android 版本为 **1.1.0**，versionCode **4**。最终生产包的真实更新检查、正常/减少动画 Tabs 和 Stack 已完成验收；未来版本界面另使用隔离 fixture 验证。

## 应用更新实现

设置页“关于 EasyHub”显示从 `expo-constants` 应用配置读取的实际版本。用户点击“检查更新”才发起请求，不要求 GitHub 登录，不使用用户 Token；发现更新后，“查看更新并下载”只打开官方 GitHub 发行页，不自动下载或安装 APK。

- 与桌面使用相同的官方仓库列表：`https://api.github.com/repos/FuFu-Flash/EasyHub/releases?per_page=100`。同样检查列表第一页，采用 **15 秒**请求截止时间，覆盖请求和响应 JSON 读取；结束时清除定时器及取消监听器。
- 使用 `cache: 'no-store'`，并发送实际 HTTP 请求头 `Cache-Control: no-store`。后者补齐 Expo 原生 `fetch` 不读取 `RequestInit.cache` 的差异，使 Android 的 OkHttp 缓存也遵守手动检查不缓存的要求。
- 与桌面一致，只接收 `draft=false`、`prerelease=false` 的正式版本；接受可选小写 `v` 的三段数字版本，逐段数值比较，不按字符串排序。不提供接收预发布的偏好，不接受版本后缀、前导零或不安全整数。
- Android 候选必须存在精确匹配的 `EasyHub-Android-{版本}-{架构}.apk` 附件。架构名称接受 `arm64`、`arm64-v8a`、`universal`、`armv7`、`armeabi-v7a`、`x86`、`x86_64`；版本必须与发行 tag 对应。桌面 EXE、源码附件、未版本化的构建包及框架组件不会成为 Android 应用更新。
- 仅最新 Android 正式版本大于当前版本时提示更新。发行页地址从固定官方仓库和已识别 tag 构造，不采用远程 `html_url`。
- 检查期间禁用重复请求；设置标签失去焦点或组件卸载时取消。请求身份保留到 `finally` 结算，取消后不能回填旧结果，结算后再允许重试。错误以当前界面语言显示友好文案。

本轮没有新增依赖。导航使用现有 Expo Router Tabs/native Stack、React Native Animated 与 screens，不重新引入 Reanimated 或 Worklets。

## 已完成的更新与界面检查

Android Studio API 36 AVD 使用主流 **1080×2400 / 420dpi 中文**及 **720×1600 / 320dpi 英文**、正常字号。真实请求中，仓库虽然存在桌面 1.2.1，但可识别 Android APK 的最新版本为 1.0.0；当前 1.1.0 因而显示“已是最新版本”，没有误报桌面更新。

下表优先链接最终生产包结果。断网、恢复重试和失焦取消的早期证据单独标注阶段，保留其原始归属。

| 已完成流程 | 结果与证据 |
| --- | --- |
| 最终包 1080 中文版本显示及真实更新检查 | 当前版本 1.1.0、检查按钮与成功状态完整，见 中文成功截图（`artifacts/android-v110/UI/v110-1080-final-update-live.png`）。 |
| 最终包 720 英文版本显示及真实更新检查 | `Current version 1.1.0` 与 `You are up to date.` 完整，见 英文成功截图（`artifacts/android-v110/UI/v110-720-en-final-update-live.png`）。 |
| 初次 AVD：实际断网后检查 | 显示友好失败提示并恢复可操作状态，见 离线错误截图（`artifacts/android-v110/UI/v110-1080-update-offline.png`）。 |
| 初次 AVD：恢复网络后重试 | 成功返回当前版本状态，见 恢复重试截图（`artifacts/android-v110/UI/v110-1080-update-retry.png`）。 |
| 初次 AVD：检查中切换标签并返回 | 请求取消，检查按钮重新可用，没有残留加载、错误或旧结果，见 失焦取消截图（`artifacts/android-v110/UI/v110-update-cancel-after-blur.png`）。 |
| 最终包 1080 中文正常/减少动画快速切换 | 两模式分别完成 **15 次**标签切换，最后回到设置，更新成功结果及滚动内容保留；见 正常模式记录（`artifacts/android-v110/UI/normal-final-quick-tabs-verification.json`）、减少动画记录（`artifacts/android-v110/UI/reduced-final-quick-tabs-verification.json`） 及 正常模式截图（`artifacts/android-v110/UI/v110-final-normal-fast-tabs.png`）、减少动画截图（`artifacts/android-v110/UI/v110-final-reduced-fast-tabs.png`）。 |
| 最终包 720 英文正常/减少动画 Stack 进入及返回 | 两模式均正常进入、返回；返回前后滚动锚点 bounds 精确一致，更新成功结果保留。见 双模式验证（`artifacts/android-v110/UI/native-stack-final-verification.json`）、正常模式状态截图（`artifacts/android-v110/UI/v110-720-en-stack-final-normal-state-retained.png`） 和 减少动画状态截图（`artifacts/android-v110/UI/v110-720-en-stack-final-reduced-state-retained.png`）。 |

最终稳定页面的更新卡片、Material 外链箭头及 Stack 返回箭头未发现文字溢出、按钮截断或重叠；更新按钮实测至少 48dp。完整观察与边界见 本轮界面复核（`artifacts/android-v110/ui-audit.md`）。初次中文/英文更新截图和普通 Stack 截图属于前阶段证据，仍保留在 `artifacts/android-v110/UI/`，不替代上述最终包记录。

当前仓库没有可供真实升级检查的更高 Android 正式版本。未来版本 **1.10.0** 的提示和下载链接已用**临时测试 APK 的隔离 fixture**完成 1080 中文和 720 英文验收；界面层级有模拟标识，两处下载链接均完整可见且触摸高度 **48dp**，见 中文 fixture 截图（`artifacts/android-v110/UI/v110-fixture-1080-zh-update.png`）、英文 fixture 截图（`artifacts/android-v110/UI/v110-fixture-720-en-update.png`） 和 fixture 验证记录（`artifacts/android-v110/UI/future-update-fixture-verification.json`）。1.10.0 未真实发布，未打开发行页、下载或安装更新；生产源码和最终交付 APK 均不包含该 fixture。新版本、同版本和失败返回另有 transport 单元测试。

## 测试与构建记录

移动端 TypeScript 测试 **150 项全部通过**，其中更新模块 **11 项**覆盖桌面/框架发行过滤、数字版本排序、同版本与降级、精确 APK 名称、异常响应、匿名请求及实际缓存请求头、预取消、响应读取期间取消、15 秒截止时间与监听器清理。完整类型检查及全量 lint 通过，见 测试日志（`artifacts/android-v110/tests.log`）、类型检查日志（`artifacts/android-v110/typecheck.log`） 和 lint 日志（`artifacts/android-v110/lint.log`）。缓存请求头修正后，更新模块 11 项测试及范围 lint/typecheck 也重新通过。

最终重建包的 APK 验证（`artifacts/android-v110/apk-verification.json`） 已刷新：`artifacts/EasyHub-Android-1.1.0-arm64.apk` 为 **27,474,706 字节（26.20 MiB）**，SHA-256 `00c115b7f8c88be807e7497a3929ad3dbaac93497f13769eafa13d63a42460a3`。production、`debuggable=false`、开发 fixture 关闭、Android 测试签名，174 项构建输入匹配；21 个应用 SO，零内置框架库或资源，主 DEX 无 JADX 类。缓存请求头及下方减少动画模式修正已纳入此次构建；完整移动端 150 项测试、类型检查及全量 lint 再次通过。

本轮完整结果由 验证清单（`artifacts/android-v110/verification.json`） 汇总；APK 校验与本机界面、录屏和隔离 fixture 记录分别说明构建内容及实际行为。

上一轮 26.19 MiB 按需框架包及 `8678cb4ea10cdb8590e9214a664aef7a5a77a27a0eec3e5fc6296fa6407b2197` 的真实反编译、组件下载和发布证据仍属于历史基线，保留于 [反编译验收](android-analysis-check.md) 与 [框架下载记录](android-framework-downloads.md)。没有把旧包的反编译结果计为 1.1.0 新包重新测试。

## 动画修正与最终验收

实现采用普通 Tabs 的原生驱动淡入淡出及 native Stack 过渡，共享监听系统减少动画偏好并在前台恢复时重新读取。静态源码审查没有发现导航 key 或 Provider 被替换，但修正前的实际 AVD 已确认：从正常动画设置页动态开启系统“减少动画”后进入首页，正文可以持续空白。最小复现等待 1 秒后仍有背景与底部栏而没有首页标题，见 修复前截图（`artifacts/android-v110/UI/v110-reduced-home-before-fix.png`） 和 复现状态（`artifacts/android-v110/UI/reduced-home-minimal-before-fix.json`）。

单变量定位后，Tabs 保持 `animation: 'fade'`，减少动画只把 `transitionSpec` 的时长设为 **0**，避免在原生标签容器中动态切换动画模式。最终包的同一最小复现已从空白变为正常显示首页正文和标题，见 修正后截图（`artifacts/android-v110/UI/v110-reduced-home-final.png`） 与 复验状态（`artifacts/android-v110/UI/reduced-home-minimal-final.json`）。

最终包的减少动画慢速切换与两模式快速切换已复验，录屏每 **50ms** 采样正文可见状态：

| 最终生产包录屏 | 采样结果 |
| --- | --- |
| 720 减少动画慢速切换 | **227 个**样本，仅 1 个 50ms 空白样本，没有 ≥150ms 持续空白；见 正文信号记录（`artifacts/android-v110/UI/reduced-slow-final-body-signal.json`） 与 录像（`artifacts/android-v110/UI/v110-reduced-slow-final-transitions.mp4`）。 |
| 1080 正常动画快速切换 | **162 个**样本，无空白样本；见 正文信号记录（`artifacts/android-v110/UI/normal-final-fast-body-signal.json`） 与 录像（`artifacts/android-v110/UI/v110-final-normal-transitions.mp4`）。 |
| 1080 减少动画快速切换 | **263 个**样本，仅 1 个 50ms 空白样本，没有 ≥150ms 持续空白；见 正文信号记录（`artifacts/android-v110/UI/reduced-final-fast-body-signal.json`） 与 录像（`artifacts/android-v110/UI/v110-final-reduced-transitions.mp4`）。 |

原首页持续空白已消失；最终两模式 Stack 的进入、返回、精确滚动锚点及更新状态保留均通过，见 双模式 Stack 验证（`artifacts/android-v110/UI/native-stack-final-verification.json`）、正常模式录像（`artifacts/android-v110/UI/v110-native-stack-final-normal.mp4`） 和 减少动画录像（`artifacts/android-v110/UI/v110-native-stack-final-reduced.mp4`）。这里报告的是模拟器录屏抽样与可见状态，没有声称每一帧都无空白，也没有进行真机 FPS 测量。

最终已重新安装交付 APK，安装包 SHA-256 与交付文件完全相同，隔离 fixture 已移除。模拟器恢复 1080×2400、420dpi、正常字号、中文、动画比例 1.0 和正常网络；后台切换减少动画偏好再返回后首页与更新结果保持正常。见 最终模拟器验证（`artifacts/android-v110/final-emulator-verification.json`） 与 恢复后的真实更新检查（`artifacts/android-v110/UI/v110-final-production-restored.png`）。
