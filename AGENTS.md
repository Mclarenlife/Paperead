# 项目交付约定

- 每轮代码或界面修改完成并验证后，重新打包 Windows、Android 和 macOS 测试安装包，供用户真机测试。
- 更新测试版本号，保持 package.json、Cargo.toml、Cargo.lock、Tauri 配置和设置页版本一致；保留旧测试包。
- 将安装包和 SHA-256 校验文件保存到本地 release/。macOS 可以使用已配置的 GitHub Actions 构建，下载其构建产物到本地。
- 不创建或发布 GitHub Release，不上传 Release 附件，不创建发布标签。GitHub Actions 的临时构建产物可以使用。
- 沿用现有应用标识与 Android 本地测试签名密钥，便于覆盖升级和保留资料；密钥与工具缓存不得提交到 Git。
- 交付时提供各平台安装包的直接本地链接，并如实说明签名、公证和真机验收情况。
