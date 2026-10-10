# Android 与桌面功能对齐

Android 1.1.0 下载：[arm64 APK](https://github.com/FuFu-Flash/EasyHub/releases/download/android-v1.1.0/EasyHub-Android-1.1.0-arm64.apk)。最新验收见 [下拉刷新记录](android-pull-refresh.md) 和 [验收证据包](https://github.com/FuFu-Flash/EasyHub/releases/download/android-v1.1.0/EasyHub-Android-1.1.0-verification.zip)。

下文保留各阶段的测量；`artifacts/...` 表示未纳入 Git 的本地档案路径。公开证据包只包含 `android-pull-refresh/` 的 20 组案例、JSON/log、源码摘要和 APK 验收，不包含框架或更早阶段的完整档案。

2026-10-10 对照上游 `FuFu-Flash/EasyHub` main 的 `e89e9a3`（Windows 1.2.1），只读比较，没有合并或重置当前修改。上一轮本地基线为 `30c65310ca85ecdb9cce25267a0e2b8afda0a571`。

Android 不提供本地项目、源码编辑与发布，也不提供发行版发布与编辑。这些创作流程由桌面版完成；Android 保留源码下载与版本查看。以下记录 Android 功能及各阶段验收。Android 1.0.0 下载包和旧界面验收包不包含后续新增的反编译模块。

## 更新与动画阶段：Android 1.1.0（历史包）

更新与动画阶段的验收包为 `artifacts/EasyHub-Android-1.1.0-arm64.apk`，Android versionCode **4**，大小 **27,474,706 字节（26.20 MiB）**。SHA-256：`00c115b7f8c88be807e7497a3929ad3dbaac93497f13769eafa13d63a42460a3`。production、`debuggable=false`、开发 fixture 关闭、Android 测试签名；**174 项**构建输入哈希匹配。主包保留 **21 个**应用 SO，不内置分析框架或 JADX，也不含 Reanimated/Worklets 原生库；本轮没有新增依赖。

设置中的更新检查对齐桌面 main `e89e9a337ae4b90d5e50e3131ef33a3632e5e980`：手动检查正式发行版，仅识别匹配版本的 EasyHub Android APK，发现更新后由用户打开官方发行页。**150 项**移动端 TypeScript 测试全部通过，其中包括 **11 项**更新检查测试；完整类型检查和全量 lint 通过。Android Studio AVD 的 **1080×2400 中文**和 **720×1600 英文**已实际显示 1.1.0；真实 HTTP 检查不会误报桌面 1.2.1，断网错误、恢复网络重试及切换标签取消均通过。

本轮更新与导航动画的验收见 [Android 1.1.0 更新与动画记录](android-update-and-motion.md) 和 本轮验证清单（`artifacts/android-v110/verification.json`）。下文 26.19 MiB、`8678…` 哈希及反编译截图属于上一轮按需框架基线，不能据此声称在新包重新执行了反编译验收。

| 流程 | Android 当前结果 |
| --- | --- |
| Fork 与提交改进 | 识别已有副本、等待 GitHub 异步就绪、显示原项目关系、比较默认分支；将已在桌面或 GitHub 发布的修改创建或复用改进请求 |
| 项目设置 | 管理员可见性、存档、分支保护、转移和删除；重新核对状态及权限；删除单独授权且再次输入名称确认 |
| 代码提交审查 | 显示文字 patch；按已检查的 head 和 blob SHA 下载修改文件；讨论回复与审查记录分页，保留评论、批准、合入、关闭；PR 同页查看程序反编译证据，并自动纳入同一次 AI 审查 |
| 构建与测试检查 | 按 PR head SHA 读取 checks/statuses，分页、去重、区分等待/失败/通过；权限失败保留可读取的另一来源和重试页，不把不可读结果视为通过 |
| 问题与讨论搜索 | 提出、回复、解决与重新打开；全局页面按待处理/已解决筛选，并选择仓库后按标题或 #编号搜索；项目内问题及 PR 同样支持搜索；问题回复与搜索结果分页，私有仓库维持独立筛选 |
| 公开内容翻译 | README、正文、评论、问题/PR 标题与发行说明分段翻译；代码、URL、文件名和自定义术语保留；私有或未知项目不发送 |
| 发现与 Star | GitHub 地址直达；公开项目和用户搜索分别翻页，遵守 GitHub 前 1000 项限制并显示部分结果提示；精简/详细视图、GitHub Star、加星列表和副本分组；私有加星项目准确标注 |
| 贡献与通知 | 年份和单日贡献活动；问题/PR 通知打开后已读清零，待办变化再次提醒 |
| 源码与发行下载 | 当前默认分支 ZIP 无需发行版；历史与发行版独立分页、失败重试，空仓库提交显示为空；按完整提交 SHA 下载历史源码；按 ID/tag 直读旧发行版并下载选定 tag 的 ZIP/TAR.GZ；进度、速度、预计时间、取消及重试，刷新或离开页面后的旧任务不会覆盖当前状态 |
| 程序反编译与证据审查 | 本机选择文件、下载并校验发行附件或 PR blob；真实 JADX/Ghidra 原生反编译、抽样证据、SHA-256、报告分享；PR 证据显示在对应修改文件下，AI 结果关联文件及函数地址；确认服务商后才将有界证据发送 AI |
| 设置中的程序文件审查 | AI 授权下默认折叠，与 PR 共用授权；Java/原生组件分别按需下载、校验、安装和移除；组件就绪后选择文件，一次确认后自动本机提取并 AI 审查；结果优先、提取证据折叠 |

项目 README、问题、历史和发行版请求的失败分别显示，可单独识别失败部分，不再把请求失败显示为空内容。

## 程序审查设置与依赖精简

设置依据桌面的 `BinaryAnalysisSettings` 与 `BinaryAnalysisPanel` 对齐：独立的“程序文件审查”位于 AI API 授权下，默认收起。选择或更换本地文件后，“AI 审查”先显示一次发送确认，列出共享授权的服务商、地址、模型、文件与发送范围；同意后自动完成真实本机提取和 AI 审查。没有 AI 授权时不会启动提取。

结果先显示 AI 摘要、随界面语言显示的严重程度、具体发现与审查范围；无发现也明确说明。文件、SHA-256、恢复代码、导入、文本和提取范围收在默认折叠的证据中。AI 失败仍保留已经提取的本机证据；折叠保留进度和结果。离开设置使旧确认失效并取消，等待底层任务结算后解锁；切换语言清除旧结果并取消旧任务。独立反编译及 PR 入口保留。

删除三个未使用的 mobile 直接依赖声明：`expo-symbols`、`react-native-reanimated`、`react-native-worklets`，Android 自动链接排除两个动画原生模块。此前内置框架包精简至 **53.98 MiB**，作为历史基线保留。上一轮把 Java/原生框架移出主包，由用户在“管理审查组件”分别安装；该轮主包为 **26.19 MiB**，再减少 **51.48%**，分析引擎 SO、原生框架 assets 及 JADX 类均不内置。更新与动画阶段的 1.1.0 主包为 **26.20 MiB**，具体测量见 [Android 依赖精简记录](android-dependency-audit.md)。

两个框架已发布到桌面同一个组件 Release，Java 下载 **2,804,563 字节**，原生下载 **26,357,764 字节**。安装会校验固定大小、SHA-256、manifest 及每个文件，并显示进度、取消及安装状态；移除会真实释放组件目录。组件不随选取文件或 AI 确认自动下载，未安装时给出所需组件与设置入口。详见 [Android 审查组件按需下载](android-framework-downloads.md)。

上一轮内置框架的运行资源迁移及缓存验收保留于 设置缓存与迁移验证（`artifacts/android-analysis-ui/settings-program-cache-cleanup.json`）：设置审查成功及 AI 取消后的私有输入缓存均为 **0**，原始选择文件保留。当前组件安装使用单独的私有目录，取消后等待底层任务与临时文件清理完成再允许重试。

## 反编译用于 PR 审查

反编译的主要用途是辅助判断合并请求。PR 页面允许先在本机检查修改的程序文件；同一次 AI 审查将文字 patch 和最多 **3 个**没有文字差异的程序文件证据分别解读，再在原 PR 页面汇总发现与未覆盖范围。程序证据绑定当前 head、完整文件路径和 blob SHA，显示抽样代码、导入、字符串及 SHA-256；同一版本可复用已完成的本机证据。AI 的程序发现使用实际证据中的函数地址或 Java 标识符，不伪造原始源码行号；意见仍由用户决定是否提交到 GitHub。

读取文件前后、每次 AI 发送前及返回结果时，均复核 head、base SHA、目标分支和修改文件数。刷新清除旧 AI 报告，分页读取也再次检查快照；新增空文件使用 Git 空 blob 判断。取消会停止当前下载或分析，成功、失败和取消后清理私有缓存中的下载文件与分析快照，保留页面上已验证的证据供审阅。

桌面上游同样只分析 PR **head** 的程序文件，没有对 base/head 两个程序版本做反编译比较。读取 base SHA 用于检查 PR 快照是否变化，不等于比较旧版程序。当前程序结论是单个 head 文件的抽样静态证据，不能据此声称某缺陷由本次修改引入。

## 本机反编译实现与限制

本轮 arm64 应用使用两个按需安装的实际引擎；输出来自分析输入文件，不使用预设反编译结果，也不执行被分析的程序。组件安装后从本机已校验的私有目录加载，分析过程不访问网络；首次使用需先安装相应组件。

- **JADX 1.5.6**：APK、DEX、JAR、CLASS；需要 Android 8.0/API 26 及以上。APK 仅覆盖 Java/Dalvik 字节码，不分析其中的资源或原生库；原生库可单独选择 SO 文件。
- **radare2/r2ghidra 6.2.2**：在 Android 本机子进程调用 Ghidra C++ 反编译器，读取 PE（EXE/DLL）、ELF（SO 等）和 Mach-O。当前交付架构为 arm64，应用最低 Android 7.0/API 24。
- 通用输入上限 **128 MiB**；Java/DEX 输入及展开字节码上限 **64 MiB**，类数量上限 20,000。最多抽样 12 个类或 16 个原生函数，每项最多 4000 字符；结果说明未覆盖范围，不能还原完整原始源码或证明程序安全。
- 原生分析设有 **3 分钟 watchdog**，取消或超时会终止所拥有的分析子进程。JADX 在应用进程内执行，采用合作式取消及中断检查；一次正在进行的类反编译无法保证立即停止，也不提供硬进程隔离。
- 发行附件重新读取 ID、名称、大小及 SHA-256 digest（若提供）；PR 文件重新检查 head、文件路径和 blob SHA，并从实际贡献者仓库下载。临时文件位于应用缓存；分析后清理。
- 独立本机分析无需 AI Key；设置的程序文件审查使用共享 AI 授权，确认后才开始自动提取。AI 请求仅发送有界代码、导入符号、字符串、文件名和摘要等证据，不发送原始二进制；结果校验所引用的函数与地址，取消或超时不返回完成结果。

## 从源码构建

先安装工作区依赖，并准备 Android SDK 和 JDK 17，再生成 Expo 原生工程：

```sh
pnpm install
EXPO_PUBLIC_UI_TEST=0 pnpm --filter @easyhub/mobile exec expo prebuild --platform android
```

随后在生成的 `apps/mobile/android` 工程运行 Gradle，构建包含组件安装与分析桥接模块的 arm64 APK；引擎本身由固定 catalog 指向仓库附件。Expo Go 不包含该原生模块。

需要重建原生框架时，再准备 NDK 27.1.12297006、Python 3、Git 与 Make，运行 `bash apps/mobile/native-analysis/build-android.sh`。它输出可下载的框架 ZIP，不生成 APK 的 JNI/assets 输入；同一 Release 已附构建支持、原生完整源码及校验清单。固定版本、重建参数、加载协议和第三方许可见 [原生引擎构建说明](../apps/mobile/native-analysis/README.md)。

`apps/mobile/app.json` 保持 `enableMinifyInReleaseBuilds: false`、`enableShrinkResourcesInReleaseBuilds: false` 和 `useLegacyPackaging: true`。Java 框架从已安装目录加载；原生在 API 29 及以上通过系统 `linker64` 加载私有目录中的可信引擎，共享 libc++ 来自主 APK。正式构建须关闭 `EXPO_PUBLIC_UI_TEST`；开发模拟数据只在 `__DEV__ && EXPO_PUBLIC_UI_TEST=1` 启用，不持久化 GitHub 凭据，没有真实网络写入或网络兜底。

## 平台边界

- Android 不连接本地项目文件夹，不执行源码编辑、发布、同步与冲突处理，也不创建或编辑发行版。本机选择程序文件用于反编译，不会把它连接为源码项目。
- Windows 系统代理与 hosts 修复仍由桌面提供；程序文件反编译已在 Android 本机实现，不再属于仅桌面功能。
- 发行附件取消后可重新下载，不宣称断点续传。桌面全局下载队列、完整浏览位置恢复及选中代码的详细 AI 说明未在 Android 全量对齐。

## 此前功能与反编译验证基线

- 返回、跳转、外链、仓库副本方向及展开/收起已使用 [Google Material Symbols 官方 SVG](https://developers.google.com/fonts/docs/material_symbols)，统一 24dp；相关点击区域按 [Android 规范](https://developer.android.com/guide/topics/ui/accessibility/apps#touch-targets)至少 48dp。源码扫描无字符箭头残留，1080×2400 与 720×1600、中英文均完成界面检查；路径、触摸区域及截图见 箭头验收记录（`artifacts/android-analysis-ui/material-arrows-ui-verification.json`）。

- 移动端 TypeScript 测试 **139 项通过**，覆盖组件状态、安装取消及任务锁；程序设置流程 **19 项**和 PR 程序审查 **16 项**继续保留。Kotlin 安装、校验及生命周期测试 **18 项通过**。
- 共享 API 相关 Vitest：**43 项通过**，包括 `mobileGitHubClient.test.ts`、`githubClient.test.ts`、`githubPagination.test.ts` 和 `mobileGitHubChecks.test.ts`。
- 桌面受本次共享接口影响的 `AiReviewService.test.ts` 与 `githubClient.test.ts`：**82 项通过**。移动端及桌面 Node/Web 类型检查、AI 审查相关 eslint 与 `git diff --check` 通过，见 PR 审查验证记录（`artifacts/native-analysis/pr-binary-review-verification.json`）。
- 模拟 transport 已实测：项目/用户/讨论搜索分页、100 条后的回复/审查/checks、真实 EXE/APK 字节和 SHA-256、真实 PR blob SHA，以及 10 块约 3 秒下载流的取消。
- 本轮移动端完整类型检查及全量 lint 已通过，按需框架的只读核验见 最终审计（`artifacts/analysis-frameworks/final-audit.md`）。此前 128 项设置验证及原生格式、取消、NUL 协议、哈希和 16 KiB 对齐记录，分别保留于 设置对齐基线（`artifacts/native-analysis/settings-alignment-verification.json`） 和 运行资源基线（`artifacts/native-analysis/runtime-pruned-smoke-verification.json`）。
- 此前已在 Android Studio AVD 上完成 **1080×2400 和 720×1600、正常字号**的实际界面检查；两个分辨率均完成 PR 同页真实 PE 反编译并展开恢复代码，1080×2400 实际恢复 `arg1 * 3 + 7`。720×1600 已检查取消及重试，取消和成功后的私有临时文件残留均为 **0**。上一轮独立离线 release APK 中真实 Java 字节码与 SO 分析成功，证据见 [Android 分析验收记录](android-analysis-check.md)。
- 本轮设置流程在 **1080×2400 中文**和 **720×1600 英文** AVD、正常字号上通过：1080 完成真实 APK 提取、AI 结果和取消后同文件重试；720 完成长文件名 APK 及 SO 的真实提取与 AI 结果。长确认内容可滚动，按钮实测为 48dp，删除动画模块后的 Tabs/Stack 导航正常，见 设置 UI 验证（`artifacts/android-analysis-ui/settings-ui-verification.json`）。AI 为界面明确标注的本地受控响应，提取由真实 JADX/r2ghidra 完成，没有收费请求。
- 上一轮 按需框架 arm64 APK（`artifacts/EasyHub-Android-on-demand-frameworks-arm64.apk`） 为 **27,463,442 字节（26.19 MiB）**，较历史内置框架包减少 **51.48%**；production、`debuggable=false`、开发 fixture 关闭、测试签名，170 项构建输入哈希匹配，见 主包验证（`artifacts/analysis-frameworks/on-demand-apk-verification.json`）。SHA-256：`8678cb4ea10cdb8590e9214a664aef7a5a77a27a0eec3e5fc6296fa6407b2197`。
- 两个框架已真实发布到桌面同一个 Release，含 3 个构建支持/源码附件的 7 个 Android 附件已核对；该 Release 实际共 21 个附件，见 发布验证（`artifacts/analysis-frameworks/repository-assets-final-verification.json`）。已从真实 GitHub 下载 Java 组件，并在最终生产主包断网后完成 APK 恢复代码（`artifacts/android-analysis-ui/ondemand-final-offline-apk-code.png`）；原生下载取消与网络重试安装实测成功，见 组件安装状态（`artifacts/android-analysis-ui/ondemand-components-installed.png`）。最终生产主包的 APK、JAR 和 ARM64 SO 断网代码恢复均通过；1080×2400 中文与 720×1600 英文、正常字号未发现组件布局问题。687 个组件文件哈希及只读权限匹配，临时文件残留为 0，中断安装恢复、Java 移除后重新下载及冷启动状态保持通过，见 最终模拟器验收（`artifacts/analysis-frameworks/emulator-framework-verification.json`） 与 界面审计（`artifacts/analysis-frameworks/framework-ui-audit.md`）。
- 历史内置框架包为 **56,598,974 字节（53.98 MiB）**，SHA-256 `8ad04189554d29cb49c39541ccdab050a92b24ddb6e892ab44a2a66714c4a412`，见 历史安装包验证（`artifacts/native-analysis/release-apk-verification.json`）。其 **915 ms** 冷启动、Java/SO 离线分析及 AI 授权提示保留于 历史 UI 验证（`artifacts/android-analysis-ui/final-ui-verification.json`） 和 `settings-release-*` 截图。
- 上一包的 PR 与 Material 箭头验收保留于 设置对齐前的 UI 基线（`artifacts/android-analysis-ui/final-ui-verification.before-settings-alignment.json`）；`material-release-*` 与 `settings-release-*` 截图属于前轮基线；按需框架本轮使用 `ondemand-final-*`。
- 2026-10-07 的 [排版验收记录](android-ui-check.md) 与 旧界面检查安装包（`artifacts/EasyHub-Android-ui-checked-arm64.apk`） 仅说明上一轮状态，该包不含本轮新增原生反编译实现。

真实 GitHub 写入和 OAuth 同账号删除授权未使用用户账号执行。当前模拟数据没有执行真实 GitHub 修改；安装后的真实账号验收仍需使用测试仓库。APK 不作为商店正式发行包。
