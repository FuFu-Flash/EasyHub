# 桌面平台开发与构建

所有平台都在 `main` 开发，规则以根目录 [AGENTS.md](../AGENTS.md) 为准。平台差异放在下表的 `platforms/` 和 `build/` 目录，共享界面按运行平台判断（如 `platform === 'darwin'`）。

原来的 [macos](https://github.com/FuFu-Flash/EasyHub/tree/macos) 分支已合回 `main` 并停止使用，只保留历史。

## 目录

| 内容 | 目录 |
| --- | --- |
| Windows 系统代理与原生实现 | apps/desktop/src/main/platforms/windows |
| Mac 系统代理、菜单与原生实现 | apps/desktop/src/main/platforms/macos |
| Linux 代理读取 | apps/desktop/src/main/platforms/linux |
| 平台无关代理契约 | apps/desktop/src/shared/systemProxy.ts |
| Windows 打包配置 | apps/desktop/build/windows |
| Mac 打包配置 | apps/desktop/build/macos |
| Linux 打包配置 | apps/desktop/build/linux |
| 普通开发构建 | apps/desktop/out/{main,preload,renderer} |
| Windows 发布中间文件 / 安装包 | apps/desktop/out/windows / apps/desktop/release/windows |
| Mac 发布中间文件 / 应用 | apps/desktop/out/macos / apps/desktop/release/macos |
| Linux 发布中间文件 / 安装包 | apps/desktop/out/linux / apps/desktop/release/linux |

## 命令

在仓库根目录安装锁定依赖：`pnpm install --frozen-lockfile`。

- Windows 系统：`pnpm package:win`。安装版与便携版在 `apps/desktop/release/windows`。
- Apple Silicon Mac：`pnpm package:mac`。DMG 和 ZIP 在 `apps/desktop/release/macos`。
- Linux x64 或 arm64：`pnpm package:linux`。AppImage 与 deb 在 `apps/desktop/release/linux`，文件名形如 `EasyHub-<版本>-x64.AppImage`。请在对应架构的 Linux 上构建，不交叉编译。
- 通用检查：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。

发布构建显式指定平台配置，并将平台中间文件映射为 ASAR 内统一的 out 目录。普通开发和现有 smoke 入口不变。构建不会自动上传安装包或创建发行版。

Linux 包面向 glibc 发行版（如 Ubuntu、Debian、Fedora）。登录使用系统密钥环（Secret Service，常见于 GNOME 密钥环或 KWallet）。程序文件审查组件仍只提供 Windows x64 和 Apple 芯片 macOS。检查更新只认 `linux-v` 开头、且带有当前架构 AppImage 或 deb 的正式发行版。

在 Linux 上安装：给 AppImage 加上可执行权限后直接运行；deb 可用系统的软件安装器或 `sudo apt install ./EasyHub-<版本>-<架构>.deb`。部分环境运行 AppImage 需要 FUSE（`libfuse2`）。无图形界面时可用 `xvfb-run` 做启动检查。

Mac 签名在系统临时目录内完成，再输出包含完整签名应用的 DMG / ZIP；避免桌面同步服务给应用包附加 Finder 元数据。构建结束清理本次临时目录，安装镜像和 ZIP 仍留在 Mac 独立产物目录。
