# Windows 安装包

## 构建

在项目根目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm build:windows
```

脚本先运行单元测试，准备离线 PDF 资源，然后使用 Cargo.lock 构建 Windows x64 Release 和 NSIS 安装程序。前端仍由 Tauri 的 beforeBuildCommand 构建。

当前产物复制到 `release/Paperead_0.1.6_x64-setup.exe`，同目录的 `.sha256` 文件用于校验完整性；文件名从 package.json 版本生成。`release`、Rust 编译缓存和 `.tools` 不纳入版本管理。首次构建前执行 `node scripts/fetch-reading-assets.mjs` 准备带校验和的 OCR 语言数据和中文导出字体；这些资源随安装包离线分发。

0.1.6 安装包为 32,563,616 字节，83 项单元、26 条浏览器流程及 12 项 Windows 原生 AI 检查分别通过，详见 [本次验收](AI-0.1.6.md)。SHA-256：

```text
da3efaad49200d868ca6bc58e5bda00fe4e94ab565913662cd2abbe249e77add
```

0.1.5 安装包为 32,579,626 字节，新增体积主要是离线 OCR、中文导出字体和结构化导出依赖。SHA-256：

```text
27ae11613334465df86dbd1cb4a18aacd5b98b65776d224d4d4453134791fadc
```

0.1.4 安装包为 17,591,710 字节，SHA-256：

```text
724e852027b41733f6ecf41cbbb5a4417eb99a09c63db3f19c3047b021354170
```

0.1.3 安装包为 17,582,128 字节，SHA-256：

```text
d0b6491038a41c5d313afc7de2732435a54a97339662ba0e93d39826e6316328
```

0.1.2 安装包为 17,561,689 字节，SHA-256：

```text
efb73fea99395d4831db0d124fe20d0f6ed6eb665c7af7c6ade9070ccec20df7
```

0.1.1 最终安装包为 17,558,691 字节，SHA-256：

```text
cccb96c85cfc0f656d9edcd7a438d813e9f37dc1ec6effb6201d83748ab07709
```

2026-09-07 的历史 0.1.0 安装包已完成实际安装验证，大小为 17,533,978 字节，SHA-256：

```text
177a641ad201dbca91324c9fa7b23a1b87686937bde7cd1c895430b47a413fe5
```

所需工具：Node.js 24、pnpm、Rust MSVC stable、Visual Studio 2022 Build Tools 的 C++ 桌面开发工作负载、Windows SDK。脚本优先使用项目 `.tools/cargo` 和 `.tools/rustup`，否则使用 PATH 中的 Rust，不修改系统 PATH。

当前机器的 C++ Build Tools 安装在 `.tools/vs-buildtools`，它是已注册的微软安装实例。如需卸载，应使用 Visual Studio Installer，不能直接删除该目录。

## 安装行为

- Windows x64，按当前用户安装；包含简体中文和英文安装界面。
- 默认安装位置为当前用户的本地应用程序目录，可在向导中更改。
- WebView2 使用已安装的运行时；缺少时安装器下载微软引导安装程序，因此首次安装可能需要联网。
- 应用界面、字体和 PDF 阅读资源随包分发，阅读本地文献不需要开发服务器。
- 这是 0.1.6 开发版，尚未配置代码签名证书。安装程序和主程序没有数字签名。
- 用户数据存储在当前用户的应用 WebView 数据目录，开发测试使用独立目录；升级或迁移前可在应用内导出完整 ZIP 备份。

## 原生验收脚本

`scripts/smoke-windows.mjs` 通过 Playwright 连接测试进程的 WebView2，验证编译后的资源、PDF Worker、批注、笔记和 Rust HTTP 插件。

`scripts/smoke-ai-windows.mjs` 自动复制 Release 程序到新的临时目录，以隔离的 WebView2 资料目录验证连续全文、逐段原文对照及其批注重启恢复、SSE、取消、真实 30 秒正文超时、模型切换和系统凭据在完整重启后的恢复。它仅使用本机模拟服务和随机端口下的测试凭据，结束时清除测试凭据；不会覆盖已安装的用户程序或读取用户资料库。

`scripts/smoke-safety-windows.mjs` 验证重复进程退出且原窗口 AI 请求继续完成、回收站恢复后 AI 结果保留、笔记写入失败时阻止关闭、用户确认关闭后重新启动恢复草稿、重试正式保存，以及正常退出。

`scripts/smoke-reader-windows.mjs` 验证多配置及凭据重启恢复、校对保存失败与原生关闭保护、草稿重启恢复、新版本与书签 / 阅读位置保存、以校对稿作为重排输入及单独删除版本。原生脚本应串行运行，避免单实例插件使测试进程互相接管。

原生测试应使用独立应用数据目录。执行 `scripts/build-native-validation.ps1`，使用同一源码和前端资源、仅覆盖应用标识为 `app.paperead.validation015`，生成 `.tmp/validation-015/paperead.exe`（后缀随版本自动生成）；正式安装包不变，脚本会恢复生产主程序。设置进程环境变量 `PAPEREAD_TEST_EXECUTABLE` 为此验证程序的绝对路径，再串行运行 reader、ai、safety 和 extended 四个验收脚本。验证构建不作为安装包分发。0.1.5 合计 25 项原生检查通过，详细报告在 `.tmp/windows-*-015-report.json`。

```powershell
node scripts/smoke-safety-windows.mjs
node scripts/smoke-ai-windows.mjs
```

测试时单独设置进程环境变量 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9240 --remote-debugging-address=127.0.0.1` 和 `WEBVIEW2_USER_DATA_FOLDER`，后者必须指向独立的临时测试目录。启动 Release 程序后执行：

```powershell
node scripts/smoke-windows.mjs
```

不要复用已有资料库运行这个脚本。脚本会创建测试文献、笔记和本机模拟 AI 配置。调试端口只由测试进程环境启用，发布配置不启用该端口。AI 测试服务仅监听本机，不使用真实 API Key。

相关依据：[Tauri Windows 安装器](https://v2.tauri.app/distribute/windows-installer/)、[微软 Playwright WebView2 测试文档](https://github.com/microsoft/playwright/blob/main/docs/src/webview2.md)。
