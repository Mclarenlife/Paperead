# 原生平台构建与测试

0.1.6 使用同一份源码构建 Windows、Android 和 macOS 测试安装包。用户明确不使用 WebDAV，本版本不包含同步。跨设备迁移使用完整 ZIP 备份。

## Windows

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-windows.ps1
```

安装包输出到 `release/`，附 SHA-256 校验文件。升级沿用 `app.paperead.reader` 与原有资料库。不要通过卸载或清理数据目录升级。

## Android

需要 JDK 21、Android SDK platform 36、build-tools 36.0.0、NDK 28.2.13676358 和 Rust `aarch64-linux-android` target。按照 [Tauri 平台前置要求](https://v2.tauri.app/start/prerequisites/) 安装并配置 `JAVA_HOME`、`ANDROID_HOME`、`NDK_HOME`。当前 Windows 工作区的工具已经安装在 `.tools/`，脚本会自动读取，无需修改系统 PATH。

```sh
pnpm install --frozen-lockfile
rustup target add aarch64-linux-android
pnpm build:android
```

脚本首次生成 Android 工程，编译经过优化的 ARM64 release APK，再使用项目本地测试密钥签名。最终输出 `release/Paperead_0.1.6_Android-arm64-test.apk` 和 SHA-256 文件，适用于 Android 8.0（API 26）及以上的 ARM64 设备。目标 SDK 为 36。将 APK 传到手机后，在系统文件管理器中打开安装；系统询问时允许该文件管理器安装应用。

测试密钥保存在 `.tools/android-signing/paperead-test.keystore`，已从 Git 排除；保留该文件才能给后续测试版本使用同一签名。它使用公开的开发密码，不用于商店发布。Windows 没有符号链接权限时，脚本仅在确认 Rust release 编译成功且错误明确属于符号链接权限后，复制原生库并交由 Gradle 打包；其他构建错误正常中止。

本次通过：83 项单元测试、生产前端与 ARM64 Rust 编译、Android Kotlin 编译、Gradle release lint、R8 压缩、APK v2/v3 签名验证、ZIP 16 KB 对齐及 ELF 所有 LOAD 段 16 KB 对齐。APK 大小 41,947,237 字节。未连接 Android 设备，尚未验证真机安装、系统选择器和重启后密钥读取。

`src-tauri/plugins/secure-credentials` 使用 Android Keystore 的 AES-256-GCM 密钥加密 API Key，随机 IV、服务地址标识作为 AAD，密文通过 AtomicFile 写入 `noBackupFilesDir`。API 密钥不进入 IndexedDB 或 ZIP 备份。读取失败不会降级到明文保存。实现依据 [Android Keystore](https://developer.android.com/privacy-and-security/keystore) 与 [Tauri 移动插件](https://v2.tauri.app/develop/plugins/develop-mobile/)。Kotlin 编译已通过，R8 保留插件及参数类；设备持久化仍需真机验收。

## macOS / iOS

macOS 需要 Mac 和 Xcode Command Line Tools；iOS 需要完整 Xcode 和相应 SDK。Windows 上的 Tauri CLI 不提供 iOS 构建命令。

```sh
pnpm install --frozen-lockfile
pnpm build:macos
# iOS 另需在 Xcode 中配置开发团队、签名和设备：
pnpm build:ios
```

macOS 脚本构建 `universal-apple-darwin`，同时包含 Apple Silicon 和 Intel 代码，输出 `release/Paperead_0.1.6_macOS-universal.dmg` 与 SHA-256。未配置 Developer ID 时使用 ad-hoc 签名，未进行 Apple 公证。打开 DMG 后将 Paperead 拖入 Applications。这是直接安装测试版本，不用于 App Store 分发。

2026-09-08 已完成 [macOS 构建](https://github.com/Mclarenlife/Paperead/actions/runs/34196862402) 和 [独立安装包校验](https://github.com/Mclarenlife/Paperead/actions/runs/34198165169)：镜像校验及只读挂载、Apple Silicon / Intel 架构检查、完整签名校验、版本与标识检查全部通过，应用在 macOS 云端成功启动并保持运行 10 秒。DMG 大小 66,096,117 字节，已下载到本地 `release/`；这不替代用户设备上的文件选择器、Keychain 和实际阅读操作验收。

本次安装包 SHA-256：

| 文件              | SHA-256                                                            |
| ----------------- | ------------------------------------------------------------------ |
| Android ARM64 APK | `145d19f8552d27bf541d3656b785df24015eee6051c4b286ec15f1c9383e84de` |
| macOS 通用 DMG    | `29e91a76126acc5a12fbfbab6b14735c6dc11d184238bc1c7cb9bc2de36feeed` |

源码仓库为 [Mclarenlife/Paperead](https://github.com/Mclarenlife/Paperead)。在 Actions 中手动运行 **Build macOS test installer**，完成后下载 **Paperead-macOS-universal** 产物，保留 14 天。工作流使用 Node 24、项目锁定的 pnpm 和 Rust 1.98.1，运行单元测试，构建 DMG，校验磁盘镜像、应用标识、版本、双架构和签名，并运行 10 秒启动检查。也可用 **Verify existing macOS installer** 验证已有构建产物。

iOS 工程需要在 Xcode 中配置开发团队及设备签名。本次不交付 IPA。

## 每个平台的真机验收

- PDF 导入、系统文件选择器、导出文件落地及备份恢复。
- 中英文 OCR 首次离线运行、暂停继续、内存与耗时；移动端应先测试短文献。
- API Key 保存后杀进程重启、切换服务地址、替换及删除密钥。
- 流式翻译与视觉页面上传、弱网取消及后台恢复。
- 批注、图片笔记、键盘遮挡、安全区、横竖屏和退出时草稿保护。

浏览器响应式测试不替代以上原生验收。
