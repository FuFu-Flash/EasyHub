# Android 界面验收记录

Android 1.1.0 下载：[arm64 APK](https://github.com/FuFu-Flash/EasyHub/releases/download/android-v1.1.0/EasyHub-Android-1.1.0-arm64.apk)。最新验收见 [下拉刷新记录](android-pull-refresh.md) 和 [验收证据包](https://github.com/FuFu-Flash/EasyHub/releases/download/android-v1.1.0/EasyHub-Android-1.1.0-verification.zip)。

下文保留各阶段的测量；`artifacts/...` 表示未纳入 Git 的本地档案路径。公开证据包只包含 `android-pull-refresh/` 的 20 组案例、JSON/log、源码摘要和 APK 验收，不包含框架或更早阶段的完整档案。

日期：2026-10-07。本轮检查使用 Android 16 / API 36 原生 `Medium_Phone` 模拟器，覆盖中文与英文、普通字体和大字体。

## 检查配置

- 物理分辨率：1080 × 2400。
- 原始 density 420，逻辑宽度约 411 dp；窄屏 density 540，逻辑宽度 320 dp。
- `font_scale`：1.0 与 2.0。
- 开发界面测试由 `__DEV__ && EXPO_PUBLIC_UI_TEST=1` 启用，使用内存模拟账号和项目；不持久化 GitHub 凭据，不执行真实 GitHub 写入。下载进度与取消同样使用内存模拟。

## 已修复并复测

| 页面或流程 | 检查结果与证据 |
| --- | --- |
| 发现 | 修复搜索结果工具栏、精简项目卡片越出窄屏的问题；搜索结果（`artifacts/android-layout/discover-search-after.png`）。 |
| 设置 | 账号入口箭头与说明留在容器内，大字体下可换行；设置页（`artifacts/android-layout/settings-footer-large-after.png`）。 |
| 首页 | 修复装饰与标题重叠、统计标签断行。320 dp / 2.0 字体下统计改为上下排列；统计最终复测（`artifacts/android-layout/home-stats-large-final.png`）。 |
| 首页项目卡片 | 完整显示 EasyHub 标题；特别长的项目名按两行省略。保存状态、时间、打开及更多操作均在卡片内；项目卡片最终复测（`artifacts/android-layout/home-projects-large-final.png`）。 |
| PR 审查 | 批准、拒绝操作可换行；2.0 字体的确认内容与按钮可完整查看；确认窗口（`artifacts/android-layout/pr-alert-large-verified.png`）。 |
| 通知 | 精简排列保留完整标题，列表可滚动，关闭按钮可操作；通知列表（`artifacts/android-layout/notifications-large-after.png`）、滚动复测（`artifacts/android-layout/notifications-last-after.png`）。 |
| 新建问题 | 键盘弹出后输入与提交操作避让键盘，提交可一次点击完成；提交复测（`artifacts/android-layout/issue-submit-one-tap.png`）。 |
| 发行附件下载 | 下载状态、取消与重新下载位于对应附件旁，2.0 字体下仍可操作；下载中（`artifacts/android-layout/release-inline-progress-large.png`）、取消后（`artifacts/android-layout/release-inline-cancelled-large.png`）。 |
| 请求取消 | 修复已安装 React Native 的 AbortSignal 缺少 `throwIfAborted()` 导致的异常，改用兼容的取消检查；原生取消信号与 AI 审查取消回归通过，下载取消经模拟器操作验证。 |

按用户要求，Android 已移除本地项目与源码编辑/发布入口；发行版发布和编辑也不提供。源码压缩包下载、版本查看与现有 GitHub 项目管理仍保留。

## 自动验证与安装包

- Mobile 类型检查与 lint 通过；Mobile 测试 54 项通过；共享 GitHub API 相关测试 27 项通过；`git diff --check` 通过。
- 安装包：`artifacts/EasyHub-Android-ui-checked-arm64.apk`。仅 arm64，最低 Android API 24，target API 36；生产构建 `EXPO_PUBLIC_UI_TEST=0`，使用测试签名。
- SHA-256：`b2dd9da2f6533e3cdcbf0e5a2bb3aab05c8375cbe184a6a2613e3fbef3d47bb3`。

模拟数据界面验收不能代替真实账号的 GitHub 网络、OAuth 授权和写入验收。此 APK 不是商店发行包。

## 最终安装包冷启动检查

通过：安装上述最终 APK，停止 Metro 开发服务器并移除端口转发后冷启动。显示真实的未登录界面，未加载模拟账号；首页、设置、项目标签切换及返回首页正常，启动日志无 React Native JS 或 AndroidRuntime 错误。证据：冷启动（`artifacts/android-layout/final-release-cold-start.png`）、设置（`artifacts/android-layout/final-release-settings.png`）、项目（`artifacts/android-layout/final-release-projects.png`）、启动日志（`artifacts/android-layout/final-release-cold-start.log`）。

复测结束后，模拟器恢复原始 density 420、`font_scale=1.0` 和中文界面，清除了本轮添加的测试搜索历史。
