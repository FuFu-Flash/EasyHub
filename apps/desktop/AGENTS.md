# 桌面平台边界

遵守根目录 AGENTS.md 的分支和提交规则：所有平台都在 `main` 开发，平台差异按下面的目录放置并按运行平台判断。

- 共享业务：`src/renderer`、`src/preload`、`src/shared`、`src/main/services`；原生实现分别放到 `src/main/platforms/windows`、`src/main/platforms/macos` 与 `src/main/platforms/linux`。
- Windows、macOS 和 Linux 通过 `src/shared/systemProxy.ts` 的平台无关接口连接 GitHub 代理；一端的代码不依赖另一端的实现或其命名类型。
- Windows 打包配置在 `build/windows`；macOS 打包配置在 `build/macos`；Linux 打包配置在 `build/linux`。配置明确指定目标，不依赖 electron-builder 自动探测。
- 普通开发构建保留 `out/main`、`out/preload`、`out/renderer`；发布中间文件分别为 `out/windows`、`out/macos` 和 `out/linux`，安装包分别为 `release/windows`、`release/macos` 和 `release/linux`。
- ASAR 内部仍使用 `out/main`、`out/preload`、`out/renderer`，避免改变启动入口与 IPC 路径。
- 保留平台运行时判断。Windows 代理和 PowerShell 只在 Windows 调用；Mac 菜单、系统代理和签名只在 Mac 调用；Linux 只读取已有代理，不调用另外两端的原生命令。误用平台打包命令应在构建或写文件前失败。
- 修改构建规则后运行平台隔离单测、桌面类型检查/lint/单测/build，并在对应系统验证产物。某一端构建成功不能作为其他端实机打包成功的证据。
- Mac 发行包在系统临时目录内完成签名，交付 DMG / ZIP 到 `release/macos`；避免把已签名的 `.app` 目录复制回桌面同步目录，导致 Finder 元数据使签名校验失效。
