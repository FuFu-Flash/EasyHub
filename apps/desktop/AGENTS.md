# 桌面平台边界

遵守根目录 AGENTS.md 的分支归属和提交规则。

- 共享业务：`src/renderer`、`src/preload`、`src/shared`、`src/main/services`；原生实现分别放到 `src/main/platforms/windows` 与 `src/main/platforms/macos`。
- 两端通过 `src/shared/systemProxy.ts` 的平台无关接口连接 GitHub 代理；Mac 代码不依赖 Windows 实现或其命名类型。
- Windows 打包配置在 `build/windows`；macOS 打包配置在 `build/macos`。配置明确指定目标，不依赖 electron-builder 自动探测。
- 普通开发构建保留 `out/main`、`out/preload`、`out/renderer`；发布中间文件分别为 `out/windows` 和 `out/macos`，安装包分别为 `release/windows` 和 `release/macos`。
- ASAR 内部仍使用 `out/main`、`out/preload`、`out/renderer`，避免改变启动入口与 IPC 路径。
- 保留平台运行时判断。Windows 代理和 PowerShell 只在 Windows 调用；Mac 菜单、系统代理和签名只在 Mac 调用。误用平台打包命令应在构建或写文件前失败。
- 修改构建规则后运行平台隔离单测、桌面类型检查/lint/单测/build，并在对应系统验证产物。Mac 构建成功不能作为 Windows 实机打包成功的证据。
