# 原生平台构建与测试

0.1.5 本轮交付 Windows x64 安装包。用户明确不使用 WebDAV，本版本不包含同步。跨设备迁移使用完整 ZIP 备份。

## Windows

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-windows.ps1
```

安装包输出到 `release/`，附 SHA-256 校验文件。升级沿用 `app.paperead.reader` 与原有资料库。不要通过卸载或清理数据目录升级。

## Android

需要 JDK、Android SDK（platform 36、build tools）、Android NDK 和 Rust `aarch64-linux-android` target。按照 [Tauri 平台前置要求](https://v2.tauri.app/start/prerequisites/) 安装并配置 `JAVA_HOME`、`ANDROID_HOME`、`NDK_HOME`。

```sh
pnpm install --frozen-lockfile
rustup target add aarch64-linux-android
pnpm build:android
```

脚本首次生成 Android 工程，然后构建供真机安装测试的 ARM64 debug APK。输出位于 `src-tauri/gen/android/app/build/outputs/apk/`；测试包使用开发签名。商店交付需要单独配置签名和 release 构建。

`src-tauri/plugins/secure-credentials` 使用 Android Keystore 的 AES-256-GCM 密钥加密 API Key，随机 IV、服务地址标识作为 AAD，密文通过 AtomicFile 写入 `noBackupFilesDir`。API 密钥不进入 IndexedDB 或 ZIP 备份。读取失败不会降级到明文保存。实现依据 [Android Keystore](https://developer.android.com/privacy-and-security/keystore) 与 [Tauri 移动插件](https://v2.tauri.app/develop/plugins/develop-mobile/)。本机没有 Android SDK，因此 Kotlin 编译与设备持久化验证尚未执行，不能将此实现视为已通过 Android 验收。

## macOS / iOS

需要 Mac、Xcode 和相应 SDK。Windows 上的 Tauri CLI 不提供 iOS 构建命令。

```sh
pnpm install --frozen-lockfile
pnpm build:macos
# iOS 另需在 Xcode 中配置开发团队、签名和设备：
pnpm build:ios
```

macOS 输出 DMG；iOS 工程通过 Xcode 签名后产生可安装的归档。依据 [Tauri Apple 分发要求](https://v2.tauri.app/distribute/app-store/)，Apple 原生构建必须运行在 macOS 上。本机没有该环境，未生成或测试 DMG/IPA。

## 每个平台的真机验收

- PDF 导入、系统文件选择器、导出文件落地及备份恢复。
- 中英文 OCR 首次离线运行、暂停继续、内存与耗时；移动端应先测试短文献。
- API Key 保存后杀进程重启、切换服务地址、替换及删除密钥。
- 流式翻译与视觉页面上传、弱网取消及后台恢复。
- 批注、图片笔记、键盘遮挡、安全区、横竖屏和退出时草稿保护。

浏览器响应式测试不替代以上原生验收。
