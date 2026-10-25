# 桌面平台开发与构建

分支归属以根目录 [AGENTS.md](../AGENTS.md) 为准。`main` 保留 Windows/Android 与共享功能基线；Mac 开发源码在 [macos](https://github.com/FuFu-Flash/EasyHub/tree/macos)。

建议用两个独立的 Git 检出目录分别开发 Windows 与 Mac。同步共享功能时从 main 选择提交合入 Mac 分支；Mac 平台改动不整分支合回 main。

## 目录

| 内容 | 目录 |
| --- | --- |
| Windows 系统代理与原生实现 | apps/desktop/src/main/platforms/windows |
| Mac 系统代理、菜单与原生实现 | apps/desktop/src/main/platforms/macos |
| 平台无关代理契约 | apps/desktop/src/shared/systemProxy.ts |
| Windows 打包配置 | apps/desktop/build/windows |
| Mac 打包配置 | apps/desktop/build/macos |
| 普通开发构建 | apps/desktop/out/{main,preload,renderer} |
| Windows 发布中间文件 / 安装包 | apps/desktop/out/windows / apps/desktop/release/windows |
| Mac 发布中间文件 / 应用 | apps/desktop/out/macos / apps/desktop/release/macos |

## 命令

在仓库根目录安装锁定依赖：`pnpm install --frozen-lockfile`。

- Windows 系统、main 分支：`pnpm package:win`。安装版与便携版在 `apps/desktop/release/windows`。
- Apple Silicon Mac、macos 分支：`pnpm package:mac`。DMG 和 ZIP 在 `apps/desktop/release/macos`。
- 两端通用：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。

发布构建显式指定平台配置，并将平台中间文件映射为 ASAR 内统一的 out 目录。普通开发和现有 smoke 入口不变。构建不会自动上传安装包或创建发行版。

Mac 签名在系统临时目录内完成，再输出包含完整签名应用的 DMG / ZIP；避免桌面同步服务给应用包附加 Finder 元数据。构建结束清理本次临时目录，安装镜像和 ZIP 仍留在 Mac 独立产物目录。
