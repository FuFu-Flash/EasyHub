# 桌面端一致性修复验收

基线：GitHub main `b5bea1c05205f3025cc58ef1afc370930b22c80a`。
工作分支：`codex/desktop-consistency`；使用独立工作区，原工作区的历史未提交修改保留。
版本保持 1.3.0。本轮只在本地提交、构建和打包，没有推送源码或替换 GitHub 发行版。

## 改动和涉及文件

| 事项 | 结果 | 主要文件（相对 apps/desktop） |
| --- | --- | --- |
| 检查恢复 | 声明 SOCKS 依赖；同步锁文件；恢复 macOS 主进程兼容实现、preload 契约和凭据隔离；修正失效的 mock、异步 IPC 断言和 Windows 权限断言；恢复 PowerShell 脚本的 UTF-8 标记 | `package.json`、`eslint.config.mjs`、`src/main/index.ts`、`src/main/services/githubService.ts`、`src/main/services/MacSystemProxy.ts`、`src/preload/index.ts`、`src/renderer/src/global.d.ts`、对应测试及 `resources/*.ps1` |
| 返回快捷键 | 编辑 input、textarea、contenteditable 时不处理；macOS 使用 Cmd+[ / Cmd+]，其他桌面平台使用 Alt+方向键；Windows 原生浏览器后退事件也不能绕过输入保护 | `src/renderer/src/useNavigationShortcuts.ts`、对应单测、`navigation-state-smoke.mjs` |
| 敏感文件提示 | 弹窗文字使用危险文字 token，避免被普通弹窗段落的浅色覆盖；实测对比度 4.94:1 | `src/renderer/src/styles.css`、`local-publish-selection-smoke.mjs` |
| 页面提示 | 五处成功提示使用 FeedbackNotice，四秒消失；悬停或获得焦点暂停；可手动关闭；保留页面切换时清除提示；AI 授权保存后收起面板仍能看见结果 | `LocalWorkspace.tsx`、`components/{PullRequestsPanel,ReleaseEditPanel,AiSettingsPanel,BinaryAnalysisPanel}.tsx`、`useNoticeState.ts` |
| 离线无缓存 | 不再伪造空账号；显示无项目数据的离线说明，可重试或打开现有网络修复面板；恢复连接后进入真实工作区 | `src/renderer/src/App.tsx`、`components/OfflineStart.tsx`、`locales/{zh,en}.ts` |
| 待审查分组 | 待审查数量异步到达后自动展开；多个分组独立加载；手动收起不会被下一次数量更新覆盖；原始标题不当作界面翻译 | `src/renderer/src/components/PullReviewGroups.tsx`、`demo-checks.mjs` |
| 日期 | 公共项目的问题、评论、修改记录、发行版、代理状态和源码历史统一调用 format.ts；公共问题详情明确接收父组件的语言参数 | `components/{PublicProjectBrowser,ReleaseDownloads,HostsRepairPanel,SourceHistory}.tsx`、`format.ts`、对应单测 |
| 格式化 | 增加 120 列 Prettier 配置和根目录、桌面目录的 format / format:check；renderer 格式化使用独立提交 | 根目录 `.prettierrc.json`、两份 `package.json`、`scripts/run-desktop.mjs`、`src/renderer` |

为修复缺失的已有导入，新增运行依赖 `socks-proxy-agent@10.1.0`。
按本次要求新增开发依赖 `prettier@3.9.10`。没有升级其他直接依赖，没有修改 `apps/mobile`。
锁文件的 mobile importer 只同步其已有清单中删除的三个依赖。
可选的 `p0` / `p1` 参数批量重命名没有执行。

## 检查失败的判定

- `loadCommitExplanation` 缺失属于测试 mock 过期；统一 IPC 错误封装后，验证失败也应断言 Promise 拒绝。
- 补上 mock 后，main 原有 24 个用例仍有 23 个失败，不能仅靠调整断言解决。对照已有 macOS 分支恢复窗口、菜单、系统代理选择、设备码复制和退出清理，同时保留当前的错误编码、日志、发布文件选择与修改记录解释接口。
- preload 的平台与代理接口，以及自动化模式的内存凭据隔离确实缺失，属于代码回归。恢复后 main 24 项、preload 3 项、原生凭据迁移 14 项均通过。
- 原生凭据迁移测试的 Keychain 和网络均为替身，现可在 Windows 上模拟 darwin 分支，包含首次迁移、保留原记录、退出与并发写入。
- macOS 恢复租约的 `0600` 权限断言仅适用于 POSIX。Windows 仍检查实际写入、读取和移除，不伪装成支持 POSIX 权限。
- 原生后退测试会避开 100ms 去重窗口，已验证修复前确实离开编辑页面、修复后保留页面和草稿。
- 日期回归检查让父组件显式使用英文、外围 context 使用中文，已验证修复前错误显示中文日期、修复后使用英文日期。

## 自动验证

在 Windows / PowerShell 7.6.5、Node 24.20.0、pnpm 11.25.0 下执行：

- `pnpm install --frozen-lockfile`：通过。
- `npm run typecheck`、`npm run lint`、`npm test`、`npm run build`：通过。
- Vitest：896 项通过，12 项受环境限制跳过，0 项失败。
- `npm run format:check`：通过。
- 要求的 smoke 全部通过：`local-publish-selection`、`navigation-state`、`navigation-chain`、`dialog-focus`、`pull-review-tools`、`issue-workspace`、`key-localization`。
- 新增 `npm run test:consistency-repair`：覆盖无缓存离线重试、网络修复、恢复登录、异步分组数量、手动收起、显式语言日期，以及五个实际组件的成功提示、暂停计时、手动关闭、切页清除和错误保留。
- `pnpm package:win`：生成安装版和便携版，不生成演示版。
- 打包后的 UI smoke 和 `compact-package` 检查：通过；在隔离应用副本中加载真实原生密钥环模块、打包的 SDK 与 Git worker，检查新增、删除、修改文件；没有修改用户账号或系统代理。

格式化提交 `8fd981c` 单独检查了 167 个 renderer 代码及样式文件：比较编译后的 JS AST（规范化相邻 DOM 文本空白）和 CSS，没有发现可执行逻辑或样式语义变化。HTML、类型声明也通过后续构建与类型检查。

## 独立体验检查及边界

- 真实工作区使用隔离 API 数据，检查中英文 × 舒适/紧凑 × 1440/1000 宽度 × 六个主要页面，共 48 种组合。检查横向溢出、窗口控件位置、顶级页面返回入口、文字及 aria-label / title / placeholder。
- 无缓存离线页面另检查中英文和 1440/1000 两种宽度，实际打开网络修复并重试回到真实工作区。
- 实际演示模式检查首次选择、下载通知的焦点和 Esc、新建、选文件发布、无 GitHub 写入、重启重置。
- 手动查看了敏感文件弹窗、英文 1000 宽度离线网络修复、英文紧凑合并请求和中文舒适设置截图。未发现本次改动造成的新溢出、遮挡或窗口控件漂移。
- 未运行 `test:live-*`，未使用真实账号写入或付费 AI API。真实工作区中的 API 数据、审批和授权均为隔离模拟，不能替代真实网络验收。
- 没有 macOS 实机界面验收。跳过项为 9 项 macOS 压缩包检查、2 项 macOS Swift helper 原生检查和 1 项需要额外真实 Ghidra 组件的检查。
- 范围外待办：新建项目先输入名称、再选择文件夹时，现有选择文件夹逻辑仍会用文件夹名覆盖输入。为遵守本轮范围限制，未顺手修改。

日志、截图、对比度和格式化结构记录保存在本地 `apps/desktop/out`，不会作为源码提交。`PLAN.md` 仍只保留在本地。
