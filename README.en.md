<p align="center">
  <img src="apps/desktop/src/renderer/src/assets/easyhub-icon.svg" alt="EasyHub icon" width="72" height="72">
</p>

<h1 align="center">EasyHub</h1>

<p align="center"><a href="README.md">简体中文</a> | <strong>English</strong></p>

<p align="center">Make GitHub as easy as posting an update.</p>

EasyHub makes GitHub easier to use. Create and publish source on Windows, and use Android to manage projects, reply to issues, download releases, and review contributions wherever you are. You do not need to learn complex Git commands.

[Visit the EasyHub website](https://fufu-flash.github.io/easyhub-website/) · [View all releases](https://github.com/FuFu-Flash/EasyHub/releases)

**This checkout's Windows version is 1.1.0, and the current Android development version is 1.1.0. The public Android downloads below remain at 1.0.0.** An iOS version is not yet available.

Android 1.1.0 adds manual update checks matching desktop and page transitions. The [local arm64 test APK](artifacts/EasyHub-Android-1.1.0-arm64.apk) was checked at mainstream resolutions in the Android Studio emulator; see the [update and motion verification](docs/android-update-and-motion.md).

The subsequent development build adds pull to refresh to data screens, with the native blue Android loading indicator and retained search criteria and drafts: [updated arm64 test APK](artifacts/EasyHub-Android-1.1.0-pull-refresh-arm64.apk), [refresh verification](docs/android-pull-refresh.md). The version remains 1.1.0.

## Download EasyHub

| Platform | Edition | Best for | Download |
| --- | --- | --- | --- |
| Windows | Installer | Regular use; choose the installation folder and whether to create a desktop shortcut during setup | [Download installer](https://github.com/FuFu-Flash/EasyHub/releases/download/v1.1.0/EasyHub-1.1.0-setup.exe) |
| Windows | Portable | Running directly after downloading, without installation | [Download portable edition](https://github.com/FuFu-Flash/EasyHub/releases/download/v1.1.0/EasyHub-1.1.0-portable.exe) |
| Android | Smaller package | Most newer Android phones | [Download Android package](https://github.com/FuFu-Flash/EasyHub/releases/download/v1.0.0/EasyHub-Android-1.0.0-arm64.apk) |
| Android | Universal package | Try this if the smaller package will not install | [Download universal package](https://github.com/FuFu-Flash/EasyHub/releases/download/v1.0.0/EasyHub-Android-1.0.0-universal.apk) |

Both Windows editions require a 64-bit computer. The app does not yet use a commercial code signing certificate, so Windows may show “Unknown publisher” when you first run it. The Android edition requires Android 7.0 or later. Open the package downloaded from GitHub and follow your device's prompts to allow installation.

The Windows installer detects the previous installation folder. “Create a desktop shortcut” is selected by default and can be unchecked during setup.

## Create and publish on Windows

1. Open EasyHub, choose “Sign in with GitHub” in Settings, and follow the prompts to authorize it in your browser. You can try demo projects before signing in.
2. Download an existing GitHub project or select a folder on your computer. You can also start with a new folder to create a public project or a private project visible only to you.
3. After you edit files, EasyHub shows how many files remain unpublished. Write a short note under “What changed?” and click “Publish Source”.
4. Return to the project page at any time to view its introduction, issues, and version history.

Before publishing, EasyHub checks GitHub for new changes. If the same file has changed both locally and on GitHub, it asks which version to keep. It will not overwrite files without your choice or force an upload.

## Review code and program files with AI

When someone submits a contribution to your project, open “Code Reviews” to read the description and inspect changed files, then click “AI review” if needed. The Windows edition combines text changes and supported program files into one report with possible issues, related files, and suggested changes. You can also download the changed files to inspect them yourself before approving and merging the request, or rejecting and closing it. **AI does not make the merge decision for you.**

Getting started on Windows or Android takes three steps:

1. In Settings, choose OpenAI, DeepSeek, OpenRouter, or SiliconFlow and enter your own API key.
2. Open a pull request and click “AI review”. EasyHub first shows the service it will use and explains what will be sent. The review starts only after you confirm.
3. Read the review summary, risk notes, and suggested changes.

**The Windows edition can also review program files.** To get started, expand “Program file review” in AI settings and follow the prompts to install the optional components. The download size is shown in advance. Once installed, you can review program files in pull requests, select program files on your computer, or review release attachments such as EXE and DLL files. These components are not needed for ordinary code reviews.

A packaged Mac application is not yet available.

**How are program files reviewed?** EasyHub first reads the files on your computer. It converts portions of the program's logic into text resembling code and extracts text from the program along with information about the functions it references. After you confirm, this material is sent to your chosen AI service to help explain what the program may do and suggest issues and further checks supported by that material.

The process **does not launch the program being reviewed or run tests for you**. The original program files are not uploaded to the AI provider. Only portions of the content are inspected, so the review cannot fully reconstruct the original source code, guarantee that every issue will be found, or prove that the program is safe.

Reviews show progress and can be canceled. Results describe what was checked and which files could not be completed. You can also expand the extracted program content used in the review. The output language follows your app settings.

The current Android development version supports text-change reviews and on-device program decompilation, described below. Review results are for reference, and your AI provider may charge for use. Your API key is kept in secure storage on the current device. Once configured, the settings are collapsed by default, and you can select a model directly for everyday use.

## View and manage on Android

These additions describe the current development source. The existing Android 1.0.0 download links do not imply that these changes are included. On-device decompiler and component-download checks were completed on the previous framework build; update and navigation checks were completed on 1.1.0. See the [parity record](docs/android-parity.md), [analysis validation record](docs/android-analysis-check.md), and [update and motion verification](docs/android-update-and-motion.md) for each build's evidence.

After signing in with GitHub, view your projects, introductions, issues, history, and releases; create projects; open or reply to issues; and download versions. Public repository and user searches support pagination. Paste a GitHub repository address to open it directly, switch between compact and detailed results, browse “EasyHub Popular”, and view profiles and contributions.

When you receive a pull request, inspect changed files and build/test checks tied to its revision, leave a review, or confirm a merge or rejection. Project issues and pull requests support title or #number searches; discussion replies and review history can load subsequent pages. Android also offers optional AI reviews using the AI service you configure yourself.

Create a fork of a public project and submit changes already published from desktop or GitHub to the original project. Forks are listed separately with their parent relationship. Administrators can manage visibility, archiving, default branch protection, transfers and deletion. Deletion requires a separate GitHub authorization and entering the project name again.

Translate introductions, issue bodies and comments, pull requests and release notes on demand. Translation sends text only from confirmed public repositories and preserves code, filenames, links and custom protected names. Star projects on GitHub and browse your starred list. Opening notifications clears their unread count; changed tasks notify again. Contribution history supports year selection and viewing a day's activity.

**Android does not provide local projects, source editing or publishing, or release publishing and editing. These workflows remain on Windows.** View versions, download a source ZIP from the current default branch, or download source for a selected commit or release tag and release attachments. Downloads show progress, speed, and estimated time, with cancellation and retry.

The current arm64 development build includes real on-device decompilation: JADX 1.5.6 reads APK, DEX, JAR, and CLASS files; radare2/r2ghidra 6.2.2 uses the native Ghidra decompiler for EXE, DLL, SO, ELF, and Mach-O files. Select a program file on your phone, or download and verify a release attachment or changed pull-request file. View sampled code, symbols, strings, and SHA-256, then share a report. Local analysis does not require an AI key. Optional AI interpretation sends extracted evidence only after you confirm the provider; it does not send the original program file or execute it.

Inputs are limited to 128 MiB, with a 64 MiB limit for Java/DEX input and expanded bytecode. Analysis samples up to 12 classes or 16 native functions, displaying up to 4,000 characters per sample. Java/DEX decompilation requires Android 8.0 or later. Native analysis can terminate its child process and has a three-minute watchdog. JADX cancellation is cooperative; it cannot provide hard isolation or immediately interrupt a class already being decompiled. See the [Android parity record](docs/android-parity.md) for build instructions and limits. Windows system proxy and hosts repair remain desktop features.

## What else can you do on Windows?

**Manage your work**

- View project introductions, issues, and version history; create, reply to, close, or reopen issues.
- “Issues” and “Code Reviews” each show their pending counts, so you can check feedback and review contributions by project.
- Add existing folders, see added, modified, deleted, and renamed files, and publish changes that have not yet been saved to GitHub.
- In “My Projects”, choose a location on your computer to find folders already connected to your GitHub projects and add them automatically to this computer's project list. Only the selected location is checked, and project files are not modified.
- Edit project introductions using “Edit”, “Preview”, or “Live preview”. Combine Markdown and HTML, insert image and web links, and see images, centered content, tables, and collapsible sections update as you write. In narrow windows, the editor and preview are stacked vertically. You can select and copy content while reading. Introductions for real projects are saved locally first and updated on GitHub when you click “Publish Source”.
- Use “Edit Releases” to update the description of a published release and add or remove download attachments.
- Browse available releases, select attachments such as installers, or download the project files for a particular version. Download notifications show progress, speed, and time remaining, and downloads can be canceled.

**Discover other people's work**

- Search public projects and users, or paste a GitHub project URL to open it directly. Switch between compact and detailed views, and clear your last 10 searches at any time.
- Browse today's, this week's, and this month's projects in “EasyHub Popular”, with 30 projects per page and more available on subsequent pages. EasyHub ranks this list; **it is not GitHub's official Trending list**.
- View other people's public projects on a separate browsing page. Project files and settings are read-only, while you can still open and reply to issues and view pull requests.
- To contribute code, automatically create a repository copy (a fork) under your own account, download it to your computer, edit it, and publish the source. Then submit your changes to the original project's author for review. Forks are listed separately, with their relationship to the original project shown.
- When you receive a pull request, inspect and download the contributor's changed files, approve and merge it, or give a reason before rejecting and closing it.
- Follow release links in a project introduction directly to EasyHub's download page, then choose the version or file you need.

**Translate when needed**

Click the translation toggle at the top to translate public project introductions, issues, comments, and release notes. Click again to view the original text. Project names, author names, version numbers, file names, and links are preserved where possible, and you can add names that should not be translated. Long introductions show translations in sections; the original text remains available if translation fails.

**Connections and notifications**

- If GitHub connections are unreliable, enable “GitHub system proxy” in Settings and check connection status for sign-in, projects, and downloads. Browsers that use Windows system proxy settings can also access GitHub through it; other websites keep their existing connection route. EasyHub reuses existing system proxies without overwriting their configuration, restores its own changes when disabled or closed, and yields control if another proxy app takes over.
- The bell in the upper right shows the unread notification count, which clears when you open the notifications. Project tasks you have already seen remain available, and changes to pending tasks or download results trigger new notifications.
- The app and installer use consistent rounded corners and progress indicators. The mouse keeps its default arrow, while text input and content selection work as usual.

## “Publish Source” and “Publish New Release” on Windows

- **Publish Source**: Save your everyday changes to project files. This feature is connected to real GitHub projects.
- **Publish New Release**: Enter a version number and description for your project, add images, links, and multiple download files, then preview and publish to GitHub. EasyHub suggests the next version number when you publish again.

When you are not signed in, creating, publishing, and replying only affect demo projects inside the app.

## About your data

EasyHub does not require a separate account and has no cloud server of its own. Your work, issues, and version history are stored on GitHub. Sign-in credentials are kept in secure storage on the current device.

Translation sends the text that needs translating from **public projects** to a third-party translation service. Private project content is not sent. The original text is shown if the service is unavailable, and translation does not change content on GitHub.

Before each AI review, EasyHub asks for your consent. Once you confirm, the contribution's title, description, file names, and changes are sent to your chosen AI provider. Program file reviews also send file information and portions of extracted content; the original program files are not sent to the AI provider. EasyHub also clearly indicates when a project is private. Review results are shown only in EasyHub and do not post comments or merge changes on your behalf.

EasyHub is licensed under [GNU GPLv3](LICENSE).
