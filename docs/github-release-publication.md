# GitHub API 发布与附件替换

仓库：`FuFu-Flash/EasyHub`。发布操作以当前用户请求为授权依据；本记录用于后续任务复用流程。

## 操作顺序

1. 确认待发布构建已有测试、签名、DMG/ZIP 内容核验记录。计算每个附件的字节数和 SHA-256，包括校验文本。完成条件：本地实际文件与构建报告一致。
2. 使用现有 Git credential helper；缺少可用凭据时，使用 EasyHub 在 macOS 钥匙串中的现有 GitHub OAuth 凭据。凭据只保留在进程内，通过请求头发送；日志、Markdown、JSON 和命令行参数不得包含密钥。系统要求密码时由用户在系统窗口输入。完成条件：`GET /user` 身份和仓库 `permissions.push` 均符合目标。
3. 读取最新发行版、目标发行版、全部发行版列表、源码分支和标签，保存无凭据快照。记录目标 release ID、旧附件 ID/名称/大小/digest、原正文和当前 latest。完成条件：目标版本与授权范围一致，远端状态没有被本地旧记录覆盖。
4. 将测试对应源码以普通 fast-forward push 发布到 `macos` 分支。Git 身份凭据通过子进程环境中的临时 HTTP 请求头提供，关闭 Git 凭据/网络追踪日志。已有正式标签保持不动；同版本替换构建使用独立源码标签，例如 `macos-v1.2.2-build18`。完成条件：远端分支与新构建标签指向已核验提交；构建后的提交只能包含明确审阅的文档变更。
5. 用暂存名称逐个 POST 上传二进制附件。请求目标是 `uploads.github.com`，传入实际 Content-Type、Content-Length，并流式读取文件。每次上传后 GET 核对 ID、`state=uploaded`、字节数和 `digest=sha256:…`，再通过无登录的公开下载完整计算 SHA-256。完成条件：所有新附件实际下载内容与本地一致，旧附件仍可用。
6. 按附件 ID 将旧正式附件改为明确的旧构建备份名称，再将新附件改成原正式名称。串行修改，逐次 GET 确认；保留原公开下载路径。更新中英文发布说明中的构建号、体积、源码链接、测试范围和哈希，保留用户现有文案及其他平台链接；PATCH release 时显式传入 `make_latest: "false"`。完成条件：正式名称均指向新内容，正文准确，Windows latest 未被替换。
7. 再次从原正式下载链接完整下载所有附件并核对哈希。核对源码标签、发行版 ID、名称、公开状态，以及其他发行版的元数据和附件。完成条件：稳定链接指向新包，所有非目标发行版保持原样。
8. 仅在上一步通过后，按快照 ID 和旧 digest 删除被替换的旧附件。再次核对新附件和 latest，保存发布结果及公开下载校验报告，并同步到原工作目录。完成条件：目标发行版只剩预期正式附件，全部结果可追溯。

## 中断与恢复

每次远端修改后保存附件 ID 和确认状态。网络中断或返回结果不明确时，先 GET 当前附件列表，按名称、ID、大小和 digest 判断已完成步骤，再继续；同名不同内容应停止检查。

切换失败且旧附件仍在时，将新正式附件退回暂存名、旧附件恢复正式名，并恢复原正文。暂存新包未核验通过时，保持旧正式包。删除旧附件之前保留恢复所需的全部记录。

历史构建验证记录保留其原始内容；新发布结果写到新构建的 `publication` 目录。文档与报告只保存公开元数据、文件哈希和操作结果。

## API 参考

- 元数据：`GET /repos/{owner}/{repo}/releases/tags/{tag}`、`GET /repos/{owner}/{repo}/releases/latest`、分页发行版列表。
- 上传：`POST https://uploads.github.com/repos/{owner}/{repo}/releases/{release_id}/assets?name=…`。
- 更名：`PATCH /repos/{owner}/{repo}/releases/assets/{asset_id}`，JSON 参数 `name`。
- 更新说明：`PATCH /repos/{owner}/{repo}/releases/{release_id}`。
- 清理：`DELETE /repos/{owner}/{repo}/releases/assets/{asset_id}`。
- 请求携带 GitHub JSON Accept 和显式 API version；公开文件校验请求使用单独的无认证请求。

官方参考：[附件 API](https://docs.github.com/en/rest/releases/assets)、[发行版 API](https://docs.github.com/en/rest/releases/releases)。

## 本次构建记录（2026-10-11）

用户要求替换现有 `macos-v1.2.2` 发行版。构建 18 的应用源码是 `e779691ef5b2637957bf1903b7abb7a78a0dc8fa`，对应源码标签为 `macos-v1.2.2-build18`；之后补充发布流程文档，应用内容不变。

- DMG：72,934,868 字节，比构建 17 缩小 35.09%；SHA-256 `4a6693b38c7f48e5a51118fb0b081f0b4d1e179580604aee4e657c67ff77e65f`。
- ZIP：97,661,064 字节；SHA-256 `1b3add68aa9388d8f5bee11ac7e6f82a8e0c47e37009c4d1a5293b2436d31e28`。
- `SHA256SUMS-macos-1.2.2.txt`：168 字节；SHA-256 `40aaf14e144eb8a4971138924b0cf41c063774ce65fbb6dbbb66f8d809f00611`。

最终是否发布成功以本地 `docs/macOS-1.2.2-build18/publication/GITHUB_MAC_PUBLICATION.json` 和公开下载验证报告为准；该目录位于桌面工作区根目录，不包含于源码仓库。
