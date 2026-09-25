# EasyHub

EasyHub 是面向普通用户的 GitHub 客户端。Windows 桌面端已包含演示界面、GitHub 接入和本地项目的源码发布。未登录时，创建、发布、下载和回复只修改当前窗口内的演示数据。登录后可使用真实 GitHub 项目、本地文件夹和源码发布；Release 上传仍属于后续阶段。

Windows 用户可从 [EasyHub 1.0.0 下载页](https://github.com/FuFu-Flash/EasyHub/releases/tag/v1.0.0)选择安装版、便携版或演示版。

## 运行

需要 Windows、Node.js 22+、pnpm 11+。

```powershell
pnpm install
pnpm dev
```

检查：

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:ui
```

## Windows 1.0.0 安装包

在 Windows 上运行 `pnpm package:win` 会构建安装版与便携版，分别输出到 `apps/desktop/release/EasyHub-1.0.0-setup.exe` 和 `apps/desktop/release/EasyHub-1.0.0-portable.exe`。运行 `pnpm package:demo` 会构建仅使用模拟数据、不会连接 GitHub 的独立演示版，输出到 `apps/desktop/release/demo/EasyHub-1.0.0-demo.exe`。这三个版本都不要求用户安装 Git。构建产物未使用商业代码签名证书，因此 Windows 可能显示“未知发布者”。

正式版解包文件位于 `apps/desktop/release/win-unpacked/EasyHub.exe`，用于验证打包后的应用；演示版解包文件位于 `apps/desktop/release/demo/win-unpacked/EasyHub Demo.exe`。运行 `pnpm test:packaged` 与 `pnpm test:demo-packaged` 可重复执行交互验收。发布说明草稿见 `RELEASE_DRAFT_1.0.0.md`。

桌面品牌图标位于 `apps/desktop/src/renderer/src/assets/easyhub-icon.svg`。更换 SVG 后，先运行 `pnpm build`，再运行 `pnpm icons`，即可更新 Windows 窗口使用的 PNG 和 ICO。

## 可点击演示

首页可直接填写 `Minecraft Mod` 的更新说明并发布。也可按“新建项目 → 选择文件夹 → 创建项目 → 模拟文件修改 → 发布更新 → 查看历史版本”体验完整流程。首页还可打开“添加现有文件夹”。左侧导航可访问项目、问题和设置；在问题页面可创建、回复、关闭及重新打开问题。云端项目 `旅行笔记` 可通过项目列表的云端标签体验下载流程。

项目详情上方有独立的“发布新版本”入口，用于演示 GitHub Release；左侧卡片的“发布源码”进入日常代码更新流程，发布页会说明两者用途。新版本可选择正式版、Alpha 或 Beta，自动建议 `v0.01`、`alpha0.1` 或 `beta0.1`，同一项目再次发布时自动续号；填写介绍，可插入网页链接、网页图片或本地图片，选择单个或多个下载文件，预览后确认。文件选择按 GitHub Release 的公开限制检查：每个文件小于 2 GiB、每个版本最多 1000 个文件，同一版本内不允许同名文件；不限制扩展名。“发布更新”仍是日常修改入口，其历史记录与“发布新版本”分开。当前 Release 的确认与下载也只演示页面状态，文件不会实际上传或保存；重新启动后恢复初始演示数据。

项目介绍右侧可以打开 Markdown 编辑器，使用“添加图片”“添加链接”插入公开可访问的网址，并切换到“预览”检查排版、图片和链接。演示模式保存后，`README.md` 会计入尚未发布的模拟修改。真实账号下需先把项目下载到电脑；保存介绍会在明确确认后替换本地 `README.md`，再通过“发布源码”同步到 GitHub。当前图片插入使用网页地址，尚不直接上传本地图片文件。项目详情底部参照 GitHub 设置加入危险区：变更可见性、切换演示分支保护规则、转移演示所有者、存档或取消存档、删除演示项目。每项操作须输入完整项目名称确认；转移还需填写目标用户名。存档后项目的介绍、发布和问题操作会变为只读，取消存档可恢复。删除仅移除当前窗口内的项目和关联问题，不触碰 GitHub 或本地文件。

首页盆栽使用 `apps/desktop/src/renderer/src/assets/easyhub-potted-plant.svg`。问题列表按项目分组，进入全局列表时默认收起；从项目详情打开时会展开对应项目。

顶部线条地球图标可切换中文与英文。设置中可切换自绘窗口按钮的样式。页面内容可通过鼠标滚轮滚动；下方还有内容时，窗口底部会显示灰底白箭头的滚动提示。语言与窗口按钮偏好保存在本机。

## 连接 GitHub

在“设置 → 账户与连接”点击“使用 GitHub 登录”，浏览器会打开 GitHub 的设备授权页。将 EasyHub 窗口中的一次性代码输入 GitHub，确认授权后，应用会自动切换到真实项目界面。当前 OAuth App 的公开 Client ID 已配置在桌面端 Main Process；不需要 Client secret。GitHub 返回的访问令牌与刷新令牌只保存在 Windows 凭证管理器，Renderer 只接收登录状态和用户信息。

真实界面支持：项目列表、GitHub README 项目介绍、问题列表与创建/回复/关闭/重新打开、历史版本与详情、项目 ZIP 和历史版本 ZIP 下载。下载时可取消；选择覆盖已有文件会再次确认。顶部刷新按钮会重新获取当前项目及问题回复。全部请求由桌面端直接发送 GitHub，无 EasyHub 服务器。

登录后在首页或“我的项目”点击“添加文件夹 / 下载项目”：可选择本地文件夹、识别已有 GitHub 项目、从文件夹创建项目，或选择保存位置下载云端项目。项目详情的“本地项目与发布源码”可检查新增、修改、删除、重命名的文件，填写一句说明并发布。文件扫描在独立 Worker 中执行，遵守 `.gitignore` 并避开常见依赖目录；文件夹变化会触发防抖检查。发布前检查云端版本；可安全衔接的远端更新会先获取再发布，双方改动同一文件时要求逐个查看并选择保留版本。复杂文件、分叉历史和未完成的文件写入会阻止自动发布；不会强制上传或未经确认覆盖文件。

下载通知会同时显示速度与预计剩余时间；速度每两秒更新一次，避免数字快速跳动。第三阶段的可选实际账号验收命令为 `pnpm test:live-local`，只对已建立的 `FuFu-Flash/easyhub-account-check-20260924-dhaqxv` 测试仓库执行下载、文件变化检测和一次源码发布，不会修改其他仓库。

真实 Release 上传和危险区操作仍未接入；未登录时这些入口仍是明确标注的演示流程。真实项目界面不会把演示发布结果伪装成 GitHub 数据。2026-09-24 已获用户授权，用其账号对一个新建的私有测试项目完成真实创建、源码发布、介绍编辑、历史读取与重新下载。GitHub API 与登录使用 Electron 的系统网络代理；Git 文件传输沿用系统代理设置。

## 公开内容翻译

浏览公开项目时（包括自己的公开项目），点击顶部地球图标左侧的翻译开关，可统一翻译项目简介、README、问题正文、问题评论和 Release 描述；再次点击统一查看原文。私有项目不会发送给第三方翻译服务。设置中可选择简体中文或英语为目标语言；翻译默认关闭。原文始终来自 GitHub，翻译不会修改 GitHub 项目或问题。Markdown 翻译只处理可见文字，保留链接目标、图片地址和代码块。当前项目名、作者名及正文链接到的 GitHub 项目名称会自动加入不翻译词表；版本号和文件名也会保护。用户可在设置中逐行添加其他不翻译的名称。发送翻译前替换成占位符，收到译文后校验并还原。如果翻译服务丢失占位符，EasyHub 会尝试分别翻译说明文字并在本地重新拼接；仍失败时显示原文。译文按内容、目标语言及词表缓存到本机应用数据目录的 `translations.json`；该文件不含 GitHub 凭证。

README 按 Markdown 段落逐步翻译：打开顶部开关后，仅处理当前可见及附近的段落；滚动时继续翻译，已完成的段落立即显示译文。代码块保持原样，引用式链接继续指向原地址。关闭开关即可查看原文；翻译失败的段落继续显示原文。

当前默认适配器使用 [MyMemory 公共翻译 API](https://mymemory.translated.net/doc/spec.php)，无需在应用内嵌入开发者私密 API Key。主动点击翻译或启用自动翻译后，公开文本会发送给这个第三方服务；它的可用性和请求额度会影响翻译，失败时仍可查看原文。`TranslationProvider` 与 `TranslationService` 的接口分离，未来可替换为本地引擎或用户自行配置的服务。`pnpm test:live-translation` 可发起一条真实公共文本翻译请求。

EasyHub 使用 [GNU GPLv3](LICENSE)（`GPL-3.0-only`）。便携版中包含完整许可证文本，设置页可打开官方许可证页面。

架构和当前功能范围见本说明文档。
