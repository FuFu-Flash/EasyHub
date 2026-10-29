# Android 1.2.0 发布说明（草稿）

标签：`android-v1.2.0`（应用版本 1.2.0，versionCode 5，必须与标签一致）。

## 重要：这一版更换了签名

1.1.0 及更早的安装包使用的是公开的调试签名，任何人都可以伪造同签名的安装包。从 1.2.0 起改用 EasyHub 自己的发布密钥。

- **从 1.1.0 或更早版本升级，需要先卸载旧版，再安装 1.2.0。** 系统不允许签名不同的包直接覆盖安装。
- **卸载会清除应用里保存的 GitHub 登录，安装后需要重新登录。** 你在 GitHub 上的项目和数据不受影响。
- 只从本发行版页面下载，并核对下面的证书指纹。

## 新的签名证书

- 证书 SHA-256：`e3bc715e03d2e63aac2a898ec283e6f72c4a9b945ec91ebeda76e9882c4e9f79`
- 证书主体：`CN=EasyHub, C=CN`，APK Signature Scheme v2 校验通过

可以在电脑上用 `apksigner verify --print-certs EasyHub-Android-1.2.0-arm64.apk` 自行核对。

## 这一版的改动

- 首页改为"等你处理"：同一项目的问题和待审查合并请求合并成一行，其余折叠。
- 新增深色模式（设置里的"外观"：跟随系统 / 浅色 / 深色），配色与桌面端一致。
- 返回按钮改为安卓风格箭头，页面名放进顶部栏；筛选、设置、搜索历史等界面整理。
- 批准合并前显示改动文件数和检查结果，检查未通过时会提醒。
- 登录和删除授权里的"验证码"统一叫"配对码"。
- 读屏软件可以识别更多可点按的位置。

---

# Android 1.2.0 release notes (English)

Tag: `android-v1.2.0` (app version 1.2.0, versionCode 5).

## Important: the signing key changed

Android 1.1.0 and earlier were signed with a public debug key, which anyone can use to make a look-alike package. From 1.2.0 on, EasyHub is signed with its own release key.

- **To upgrade from 1.1.0 or earlier, uninstall the old app first, then install 1.2.0.** Android does not allow a package signed with a different key to replace an installed one.
- **Uninstalling removes the GitHub sign-in saved in the app, so you need to sign in again.** Your projects and data on GitHub are not affected.
- Download only from this release page and check the certificate fingerprint below.

## Signing certificate

- Certificate SHA-256: `e3bc715e03d2e63aac2a898ec283e6f72c4a9b945ec91ebeda76e9882c4e9f79` (`CN=EasyHub, C=CN`)

Verify on a computer with `apksigner verify --print-certs EasyHub-Android-1.2.0-arm64.apk`.

## What's new

- The home page is now "Needs your attention": a project's open issues and pull requests to review share one row, and the rest are folded away.
- Dark mode: Settings → Appearance (Follow system / Light / Dark), with the same colors as the desktop app.
- The back button is a standard Android arrow and page names sit in the top bar; filters, settings and search history were tidied.
- Before you approve and merge, you see how many files changed and the check results, with a warning if checks failed.
- "Verification code" is now called "pairing code" in sign-in and deletion authorization.
- Screen readers can recognize more tappable elements.
