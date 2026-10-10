# Android 下拉刷新

下载：[Android 1.1.0 arm64 APK](https://github.com/FuFu-Flash/EasyHub/releases/download/android-v1.1.0/EasyHub-Android-1.1.0-arm64.apk) · [验收证据包](https://github.com/FuFu-Flash/EasyHub/releases/download/android-v1.1.0/EasyHub-Android-1.1.0-verification.zip)。

下文的 `artifacts/...` 为档案内路径。证据包只包含 `android-pull-refresh/` 的 20 组案例、JSON/log、源码摘要和 APK 验收，不包含测试 fixture APK、框架或更早阶段的完整档案。

版本保持 **1.1.0 / versionCode 4**。使用 React Native 自带的 Android `RefreshControl`，下拉显示蓝色原生圆形加载指示器，等待当前页面的数据读取结束后收起；未增加依赖。

## 覆盖范围

- 首页、我的项目、发现/搜索、问题/代码审查、GitHub 已加星项目。
- 用户主页、项目详情、问题详情、合并请求详情、发行版详情、历史版本详情。
- 项目页同时刷新当前打开的历史/发行版列表、讨论搜索、合并请求列表、副本比较、Star 状态或已展开的分支保护规则。
- 合并请求重新确认文件对应的提交，读取该提交的检查、回复及审查记录；重新确认期间禁用需要有效提交快照的操作。

刷新保留已显示内容、搜索条件、展开状态、来源/目标分支和未发送的输入。连续下拉共用一次刷新；离开页面会取消读取，迟到的旧结果不能覆盖新页面。发行版和历史版本下载保持原有控制器，刷新读取不会卸载下载界面。

首页手动刷新绕过待办计数缓存，发现页手动刷新绕过热门缓存。移动端 GitHub 请求发送 `Cache-Control: no-store`，避免 Expo 原生 HTTP 缓存返回旧响应。关闭外层滚动容器的 Android 嵌套滚动，让原生刷新控件也能接管短列表和空白区域的下拉；实际模拟器曾复现默认嵌套滚动导致筛选后无法刷新的问题，关闭后同手势通过。创建项目、登录、设置等没有远程数据列表的页面保持原有操作入口。

## 验证

刷新阶段移动端 **167 项测试**、完整 TypeScript 检查和 ESLint 通过。共享 GitHub 读取方法增加兼容的可选取消信号，桌面相关 **4 个文件 / 43 项测试**通过。发布前合并远端桌面更新，补齐独立 `android-v1.1.0` 标签识别及发行版不存在时的兼容处理后，重新运行移动端 **169 项测试**、完整 TypeScript 检查和 ESLint，以及桌面相关 **7 个文件 / 59 项测试**，全部通过。

测试覆盖加载圈等待父页面和子列表、连续手势合并、失败收圈、失焦及重新进入、排队任务取消、分页刷新保留旧行、取消信号逐阶段传递、原生兼容的 AbortSignal，以及刷新请求头保留认证信息。

模拟器为 Android Studio 的 `Medium_Phone`（Android 16 / API 36），使用 1080×2400 / 420 dpi 和 720×1600 / 320 dpi，字体缩放 1.0。认证页面使用构建副本中的显式「UI test data · 界面测试数据」，带可控制的请求延迟和一次性 503 错误；测试数据无外部网络回退，不写入真实 GitHub。最终交付包关闭 fixture，仍使用真实 GitHub 登录。

实际下拉共记录 **20 组案例**：加载时均可见原生蓝圈，读取完成后均收起；包括连续手势只读一次、503 后重试、短列表与空列表、筛选和评论/审查草稿保留、展开的审查列表、PR 提交检查延迟，以及刷新中切换页面后取消并重新进入。加载圈截图与请求开始/结束记录互相核对。排版复查发现项目页横向标签栏被纵向拉高，补上 `flexGrow: 0` 后在两种分辨率重新验证，去除了多余空白。

完整刷新与输入保留使用第一阶段 fixture，最后的标签栏样式修正使用第二阶段 fixture 单独复测；每个案例记录自己的 APK SHA-256。详见独立视觉检查（`artifacts/android-pull-refresh/UI/visual-qa.json`） 和 加载圈记录（`artifacts/android-pull-refresh/UI/loading-circle-pixels.json`）。仍有少数长标题末行较短和长文件名断词的轻微现象，文本可读，未发现阻断使用的重叠或溢出。

最终包 **26.22 MiB**，比之前的 1.1.0 包增加 **20,132 字节**；SHA-256 为 `399998f68432e2274a09ecf8f74b7a80e071e65d4aa257adfcb12e4e749bb13f`。已安装回模拟器并核对安装包哈希，确认无测试数据标记、显示版本 1.1.0，真实网络的「检查更新」返回「已是最新版本。」。发布阶段按合并后的源码重新生成安装包；原加载圈与布局截图保留各自测试副本的身份。最终发布包重新安装并检查版本和更新入口；模拟器恢复 1080×2400、420 dpi、字体与动画缩放 1.0。见 最终包安装验证（`artifacts/android-pull-refresh/installed-production-verification.json`）。

详细检查、构建输入和模拟器证据保存在 `artifacts/android-pull-refresh/`；[Android 1.1.0 arm64 APK](https://github.com/FuFu-Flash/EasyHub/releases/download/android-v1.1.0/EasyHub-Android-1.1.0-arm64.apk)使用 Android 测试签名，与本地最终验收包内容一致。
