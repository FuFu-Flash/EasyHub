<table>
  <tr>
    <th width="50%">看不懂的命令行报错</th>
    <th width="50%">用 EasyHub，轻松发布作品</th>
  </tr>
  <tr>
    <td><a href="docs/images/terminal-errors.png"><img src="docs/images/terminal-errors.png" alt="黑色终端中的 Git 命令与报错示意" width="640"></a></td>
    <td><a href="docs/images/easyhub-client.png"><img src="docs/images/easyhub-client.png" alt="EasyHub 客户端主页：项目概览、我的项目与最近更新" width="640"></a></td>
  </tr>
  <tr>
    <td align="center">终端报错示意</td>
    <td align="center">EasyHub 主页实拍 · 点击查看大图</td>
  </tr>
</table>

<p align="center">
  <img src="apps/desktop/src/renderer/src/assets/easyhub-icon.svg" alt="EasyHub 图标" width="72" height="72">
</p>

<h1 align="center">EasyHub</h1>

<p align="center"><strong>让 GitHub 像发布一条动态一样简单。</strong></p>

<p align="center"><strong>简体中文</strong> | <a href="README.en.md">English</a> · <a href="https://github.com/FuFu-Flash/EasyHub/releases">直接下载</a> · <a href="https://fufu-flash.github.io/easyhub-website/">官网</a></p>

**不会 Git 命令，也能把作品发到 GitHub。**

EasyHub 是面向新手的开源 **GitHub 客户端**。选择文件夹、查看改动、写一句说明，就能发布源码。用 Windows 或 macOS 版创作和发布，用 Android 版随时浏览项目、回复问题和审查合并请求。

不需要安装 Git，也不需要另外注册 EasyHub 账号；真正发布时，使用自己的 GitHub 账号登录即可。

> **English overview:** An open-source GitHub client for Windows, macOS, and Android. Publish code, manage releases, review pull requests, and get optional AI assistance. [Read the English guide](README.en.md).

## 下载

**当前版本：Windows 1.2.2 · macOS 1.2.2 · Android 1.1.0。**

| 平台 | 版本 | 适合谁 | 下载 |
| --- | --- | --- | --- |
| Windows | 安装版 | 长期使用，可选择安装位置和桌面快捷方式 | **[下载安装版](https://github.com/FuFu-Flash/EasyHub/releases/download/v1.2.2/EasyHub-1.2.2-setup.exe)** |
| Windows | 便携版 | 不想安装，下载后直接运行 | **[下载便携版](https://github.com/FuFu-Flash/EasyHub/releases/download/v1.2.2/EasyHub-1.2.2-portable.exe)** |
| macOS | 1.2.2 DMG 镜像 / ZIP | Apple 芯片 Mac，macOS 27 或以上 | **[下载 DMG](https://github.com/FuFu-Flash/EasyHub/releases/download/macos-v1.2.2/EasyHub-macOS.dmg)** · [下载 ZIP](https://github.com/FuFu-Flash/EasyHub/releases/download/macos-v1.2.2/EasyHub-macOS.zip) · [发行说明](https://github.com/FuFu-Flash/EasyHub/releases/tag/macos-v1.2.2) |
| Android | 1.1.0 ARM64 安装包 | 适合大多数较新的 Android 手机，安装包更小 | **[下载 ARM64 包](https://github.com/FuFu-Flash/EasyHub/releases/download/android-v1.1.0/EasyHub-Android-1.1.0-arm64.apk)** · [发行说明](https://github.com/FuFu-Flash/EasyHub/releases/tag/android-v1.1.0) |
| Android | 1.1.0 通用安装包 | ARM32、ARM64、x86、x86_64 设备与模拟器 | **[下载通用包](https://github.com/FuFu-Flash/EasyHub/releases/download/android-v1.1.0/EasyHub-Android-1.1.0-universal.apk)** · [发行说明](https://github.com/FuFu-Flash/EasyHub/releases/tag/android-v1.1.0) |

Windows 版适用于 64 位电脑，安装时会识别之前的安装位置，“创建桌面快捷方式”默认勾选。Android 版适用于 Android 7.0 及以上。macOS 版适用于 Apple 芯片 Mac，要求 macOS 27 或以上。打开 DMG，把 EasyHub 拖入 Applications，再从“应用程序”启动。

## 三步上手（Windows / macOS）

1. **登录 GitHub。** 在设置中选择“使用 GitHub 登录”，在浏览器中完成授权。
2. **选择项目。** 添加电脑上的已有文件夹，下载自己的云端项目，或从新文件夹创建项目。
3. **写一句说明，发布源码。** 查看文件差异，勾选这次要发布的改动，写下“这次改了什么”，点击“发布源码”。未勾选的修改继续留在电脑上。

发布前会检查 GitHub 上的新内容。同一个文件两边都改过时，EasyHub 会请你选择保留哪个版本，不会擅自覆盖文件。

- **发布源码**：把平时修改的项目文件保存到 GitHub。
- **发布新版本**：给别人提供可下载的版本，附上版本号、介绍和安装包等文件；可以先预览，再发布。

还没准备好登录，可以先体验模拟项目。**模拟操作未上传到 GitHub，重启后会重置。**

## AI 帮你审查，也帮你看懂代码

收到别人提交的改进后，在“合并请求审查”中查看说明和修改文件，按需点击“AI 审查”。AI 会提供摘要、可能存在的问题和修改建议；**批准并合入，还是拒绝并关闭，由你决定。**

- **审查代码改动**：查看新增和删除的代码，下载修改文件自行检查，也可以让 AI 帮你找出需要关注的地方。
- **框选代码，详细说明**：Windows 版支持选中本地修改或合并请求中的代码，点击“让 AI 详细说明”，解释语言跟随客户端设置。
- **审查程序文件**：Windows 版还可按需检查 EXE、DLL 等文件，帮助了解程序可能做什么。普通代码审查无需安装额外组件。

AI 审查是可选功能。不配置 AI 服务，也能正常发布源码和管理项目。

<details>
<summary><strong>配置 AI 与程序文件审查</strong></summary>

在设置里选择 OpenAI、DeepSeek、OpenRouter 或 SiliconFlow，填写你自己的 API Key，再选择模型。配置完成后，设置默认收起，平时可以直接切换模型。

开始审查前，EasyHub 会说明使用哪个服务、要发送什么内容，确认后才发送。私有项目会明确提醒；框选代码的说明只发送选中的代码和文件名。

程序文件审查首次使用时需要安装可选组件，下载大小会提前显示。EasyHub 先在电脑上读取文件，提取部分程序逻辑、文字和调用信息，再经你确认交给所选 AI 服务分析。可以检查电脑上的文件、合并请求里的文件或发行版附件。

Windows 版安装组件后，合并请求里的程序文件会与代码改动一起审查，结果汇总在同一份报告中。未安装时会给出提示，可永久忽略，也可在设置中重新开启。

审查用的临时文件会在完成、失败或取消后清理；异常退出留下的临时文件会在下次启动时清理。你主动保存的下载文件会保留。

**不会运行被审查的程序，也不会将原始程序文件上传给 AI 服务商。** 因为只检查部分内容，不能保证找出所有问题或证明程序安全。

API Key 保存在当前设备的安全存储中，用于连接你选择的 AI 服务。费用和可用额度由服务商决定。

Android 1.1.0 支持文字改动审查和本机程序文件审查。Java/Dalvik 组件约 2.67 MiB、原生程序组件约 25.14 MiB，可在设置中分别选择下载；组件与桌面版放在[同一个组件发布](https://github.com/FuFu-Flash/EasyHub/releases/tag/analysis-runtime-ghidra-12.1.2-java-21.0.12.1-r1)中。Java/Dalvik 组件支持 Android 8.0 及以上的各架构设备，原生程序组件目前仅支持 ARM64。被下载用于审查的程序文件在任务结束或取消后自动清理。

</details>

<details>
<summary><strong>Windows 版还可以做什么</strong></summary>

**管理自己的作品**

- 识别所选查找位置中已连接到自己 GitHub 项目的文件夹，自动加入“我的项目”。
- 查看新增、修改、删除和重命名的文件，预览差异后按文件选择发布。
- 编辑 README，插入图片和链接，预览 Markdown 与常见 HTML 排版，也可“边写边看”；介绍先保存在本地，发布源码后才更新到 GitHub。
- 创建和编辑发行版，预览介绍，增加或删除下载附件；未写完的文字可在下次继续填写。
- “问题”和“合并请求审查”分别显示待处理数量，支持按项目、标题或编号查找。
- 查看合并请求的修改文件、已有的构建与测试结果，下载文件，并决定批准合入或拒绝关闭。

**发现别人的作品**

- 搜索公开项目和用户，或粘贴项目地址直接打开；可切换精简、详细视图，最近 10 条搜索记录可随时清除。
- 浏览今日、本周、本月的“EasyHub 热门”，每页 30 个，可翻页查看更多。**这是 EasyHub 自己的排序，不是 GitHub 官方 Trending。**
- 浏览他人的公开项目，选择下载发行版或源码；文件与设置保持只读，仍可提问、回复和提交改进。
- 提交改进时，在自己的账号下创建仓库副本，下载、修改并发布源码，再向原项目作者提交合并请求。
- 查看用户头像、资料、贡献记录和公开项目；从 README 的发行版链接直接进入应用内下载页。

**翻译、下载与日常使用**

- 顶部翻译开关可翻译公开项目的介绍、问题、评论和版本说明，再点一次查看原文。项目名、作者名、版本号、文件名和链接尽量保持原样，也可补充不翻译的名称。
- 通知里查看下载进度、速度和剩余时间，暂停、继续或重试文件下载；完成后打开文件或所在文件夹。
- 返回时逐级恢复浏览历史，切换页面后也能继续之前的浏览。
- 设置里选择“自动适配”“舒适”或“紧凑”布局，在“关于”中检查更新。
- GitHub 连接不顺畅时，可启用系统代理。已有代理时优先复用；使用 Windows 系统代理设置的浏览器也可通过它访问 GitHub。
- 铃铛显示未读通知数量，打开查看后清零，新的待办变化和下载结果会重新提醒。

</details>

<details>
<summary><strong>Android 版能做什么</strong></summary>

使用 GitHub 登录后，可以查看项目、README、问题、历史版本和发行版，创建项目、提出或回复问题、下载版本。公开项目与用户搜索支持翻页，也可粘贴 GitHub 项目地址直接打开；个人主页支持查看不同年份和某一天的贡献。

合并请求审查可以查看修改文件和对应提交的构建、测试检查，加载后续回复与审查记录，按标题或编号搜索，并确认合入或关闭。可以 Star 项目、浏览加星列表，创建仓库副本和提交已有修改；管理员可管理可见性、存档、分支保护及其他仓库设置。

APK、DEX、JAR、CLASS 和 EXE、DLL、SO、ELF、Mach-O 可配合合并请求审查在手机本机反编译。框架在设置中按需下载，不随 APK 捆绑；不会运行被分析的程序。可选择自己配置的 AI 服务分析提取的证据。

数据页支持下拉刷新与安卓原生蓝色加载圈，刷新保留筛选和未发送的输入。页面切换带有动画，设置的“关于”支持检查安卓更新。公开内容可按需翻译，下载显示进度并可取消。

**Android 不提供本地项目、源码编辑与发布、发行版发布与编辑。** 创作与发布流程由桌面版完成，GitHub 上的内容可在手机查看和审查。

[功能对齐与构建说明](docs/android-parity.md) · [下拉刷新验证](docs/android-pull-refresh.md) · [更新与动画验证](docs/android-update-and-motion.md)

</details>

<details>
<summary><strong>常见问题</strong></summary>

**没有 GitHub 账号能用吗？**

可以先体验 Windows 版的模拟项目。真正保存到 GitHub、回复他人或发布版本时，需要自己的 GitHub 账号。

**一定要配置 AI 吗？**

不需要。AI 审查和代码说明是可选功能，不影响项目管理和发布源码。

**首次运行提示“未知发布者”？**

Windows 版尚未使用商业代码签名证书，首次运行可能出现此提示。下载请使用本仓库发行版或官网提供的链接。

**其他系统有安装包吗？**

目前提供 Windows、macOS 和 Android 安装包，下载链接见上方表格。Linux 暂无安装包，iOS 尚未推出。

</details>

<details>
<summary><strong>数据与隐私</strong></summary>

EasyHub 不需要另注册账号，也不提供自己的云端代码托管服务。项目文件保存在你选择的本地文件夹和 GitHub；登录凭证保存在当前设备的安全存储中。

- 翻译会把公开项目中需要翻译的文字发送给第三方翻译服务，不发送私有项目内容；译文保留在本地，原文始终可查看，不修改 GitHub 内容。
- AI 审查经你确认后，将改进的标题、描述、文件名和修改内容发送给你选择的服务商；私有项目会明确提醒。
- 程序文件审查发送文件信息和提取的部分内容，原始程序文件不发送给 AI 服务商。
- “让 AI 详细说明”只发送选中的代码和文件名。
- AI 结果在应用内展示，不会自动修改项目、发表评论或合入请求。

</details>

## 许可

EasyHub 采用 [Apache License 2.0](LICENSE)。第三方组件保留各自的许可证，详见[第三方许可说明](THIRD_PARTY_NOTICES.md)。

## macOS 桌面版

macOS 1.2.2（构建 17）对齐 Windows 1.2.2 的项目与发行版布局、刷新反馈、搜索与筛选动画、程序文件审查提示和临时文件清理，支持合并请求检查、选中代码解释、选择文件发布、下载管理、布局设置和浏览历史恢复。Mac 使用系统窗口按钮和菜单栏，默认圆点风格，并适配 GitHub 系统代理。

安装包见上方下载表。Mac 源码和构建脚本位于 [`macos` 分支](https://github.com/FuFu-Flash/EasyHub/tree/macos)，使用 `pnpm package:mac` 构建。当前 Mac 包采用 ad hoc 签名，尚未进行 Developer ID 公证。
