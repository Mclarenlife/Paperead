# Paperead

**让阅读，沉淀为知识。** 一个使用 Tauri 2、React 19 与 TypeScript 构建的本地优先论文阅读工作台。

这是可运行的 **0.1.6 开发版**：改进 DeepSeek V4 首字等待、双栏分段、Markdown 标题和 LaTeX 公式保护，支持并行批次即时预览。保留 PDF／Word 导出、快照、DOI 与引用管理、笔记文件夹／标签／历史／图片、离线 OCR 和视觉解析。macOS / Android / iOS 尚未完成原生构建和真机验证；不包含 WebDAV 或云同步。

Windows 安装包：`release/Paperead_0.1.6_x64-setup.exe`（未签名开发版）。关闭旧版后运行安装包升级，资料保留；旧译文需点击“使用当前配置重新处理”应用新的分段和公式保护。缺少 WebView2 时需要联网安装运行时。详见 [本次修复与验收](docs/AI-0.1.6.md)、[Windows 打包](docs/WINDOWS-BUILD.md)、[其他平台](docs/NATIVE-PLATFORMS.md)。

## 开始使用

环境：Node.js 24 LTS、pnpm 11.19.0。也可用兼容的较新 pnpm；团队构建建议沿用锁文件。

```bash
pnpm install --frozen-lockfile
node scripts/fetch-reading-assets.mjs
node scripts/prepare-reading.mjs
pnpm dev
```

打开 <http://127.0.0.1:1420>。安装后会自动准备 PDF.js 的字体、CMap 与图像解码资源；如跳过了安装脚本，手动运行 `pnpm prepare:pdf`。

```bash
pnpm typecheck       # TypeScript 检查
pnpm test            # 数据与 AI 任务测试
pnpm test:e2e        # Playwright 浏览器验收，默认使用已安装的 Edge
pnpm build           # 构建 dist 静态资源
pnpm preview         # 预览生产构建，先停掉同端口开发服务器
pnpm format          # 统一代码格式
```

在没有 Microsoft Edge 的开发设备上，可在 `playwright.config.ts` 移除 `channel: 'msedge'`，再通过 Playwright 安装 Chromium。单元测试不依赖浏览器。

## 当前功能

- **文献管理**：拖拽 / 批量导入 PDF，SHA-256 去重，元数据与缩略图，标题、作者、年份、来源、摘要、标签、文献集、收藏、阅读状态、检索和排序。卡片和列表的「更多操作」可直接整理文献；勾选后可批量移动、增删或替换标签、修改状态、导出原始文献 ZIP、移入回收站。文献集可重命名、改色、删除；删除文献集保留论文。
- **回收站**：文献、笔记、批注先软删除，支持短时撤销和手动恢复，不自动清空。文献恢复时保留 PDF、批注及 AI 结果；彻底删除前再次确认，独立笔记保留并解除关联。
- **PDF 阅读**：PDF.js Worker 渲染，文本选择，翻页与页码跳转、缩放。文献内全文查找与匹配跳转（Ctrl/Cmd+F）、PDF 自带目录、Markdown 标题目录、命名书签；原文页和各结果版本独立记录阅读位置。PDF 字体、中文 CMap、图片解码器与界面字体都随应用打包。
- **批注**：原文、译文、重排内容可划词高亮与评论；PDF 使用归一化坐标，文本结果使用引用和文字偏移；AI 批注绑定生成版本。支持编辑评论和颜色、搜索引用与评论、按来源或当前版本筛选、导出当前文献的 Markdown 批注汇总，以及转为关联笔记。
- **AI**：OpenAI Responses、OpenAI 兼容 Chat Completions、Claude Messages、Gemini generateContent 四种协议。自定义地址、模型与目标语言；按段落跨页合并、连续全文 Markdown、可选逐段原文对照、流式预览、暂停、失败继续与结果持久化。
- **校对与版本**：AI 结果可命名、单独删除、编辑 Markdown 并预览；校对另存为修订版本，原结果与原批注保留。重排可选择原文、已有译文或校对版本。偏好设置可保存和切换多套命名 API 配置。
- **Markdown 笔记**：本地即时保存、编辑 / 分栏 / 预览、搜索、关联论文、文件夹、标签、历史恢复、图片附件、导入导出与批量 ZIP。支持 GFM 表格、任务列表和 LaTeX 公式。写入失败保留草稿，可重试和导出；离开或关闭前提醒，独立草稿缓存可在重启后恢复。
- **导出**：Markdown、独立 HTML、TXT、结构化 DOCX、直接生成 PDF、原始 PDF。文件名区分来源及结果版本。
- **备份**：资料库 ZIP、图片校验和、恢复覆盖预览、恢复前快照；应用运行时自动备份与提醒、本机快照保留数量和删除管理。
- **元数据**：待核验标记、DOI 查询预览、BibTeX / RIS 导入导出，纯引用记录附加 PDF。
- **扫描件与版面识别**：Tesseract.js 离线中英文 OCR；支持图片的自定义视觉模型处理表格与公式。逐页保存进度、暂停继续、汇总连续 Markdown，可保留页面图。
- **界面**：中文、暖白 / 森林绿、深色模式、跟随系统、响应式导航与阅读面板、微交互和减少动画偏好。

首页的 6 条示例记录仅含原创演示导读，**不是下载的论文全文**。导入你自己的 PDF 后即可使用实际 PDF 功能。记录可通过文献卡片右上角「更多操作 → 移入回收站」删除，也可勾选后批量删除。

## 连接 AI

1. 打开「偏好设置 → AI 服务」。
2. 为配置命名，选择协议，填写 Base URL、你账户实际可用的模型 ID、目标语言与 API Key；「新建配置」可以另存其他服务或模型。
3. 保存或测试连接。
4. 打开文献的 AI 阅读助手，选择翻译或重排；勾选「原文对照」即可获得 `> 原文` 下接译文的逐段 Markdown。译文完成后可「校对当前结果 → 保存为新版本」，再选择该版本作为「重排输入来源」。

切换配置会同时切换地址、模型、语言和请求参数，不自动调用 API。相同协议和地址的配置共用该地址的密钥；不同地址的密钥隔离。删除配置不删除共用的系统凭据，需要时使用「清除密钥」。运行中的任务保留启动时的配置和输入快照。

兼容服务的 Base URL 应包含服务商要求的 API 版本前缀，但不要包含 `/chat/completions`。例如本机 Ollama 的兼容地址通常为 `http://localhost:11434/v1`，模型名称由本机已安装模型决定。

Windows 默认将密钥保存到系统凭据存储，按协议与规范化服务地址隔离，重启后可自动读取；可取消勾选「安全保存 API Key」改为仅当前会话，并支持清除。macOS / iOS 已接入 Keychain，Android 新增 Keystore 加密适配，这三个平台尚需原生验证；浏览器只使用会话密钥。资料库、源码、备份中都不保存密钥。

只有主动运行任务或测试连接时才会请求指定 API。默认流式输出、每服务两个请求并行、每正文批次最多 6000 字符和 300 秒超时，可在「请求与性能设置」调整。全应用最多并行 3 个请求，排队不计入服务超时。流式模式也兼容完整 JSON；服务拒绝流式参数时可关闭。进度显示排队、等待时间和接收字数，取消和超时会保留已完成批次。对照模式由本地插入原文，模型仅生成译文；所有批次按来源顺序合并为一份文档。

任务卡显示实际使用的模型和地址。切换模型 / 服务后，「继续原任务」明确沿用旧配置；「使用当前配置重新处理」创建新的完整处理版本，保留旧结果和批注。同一服务继续任务时可采用当前的超时、流式与并行设置。从 0.1.0 升级需重新填写并保存密钥；0.1.1 已安全保存的密钥可以继续使用。

浏览器直连受服务商 CORS 约束；Tauri 使用原生 HTTP。仅支持 HTTPS 服务及 localhost / 127.0.0.1 的 HTTP 服务。第三方调用按服务商账户计费。本项目没有内置密钥、云服务或订阅。

## 原生平台

| 平台    | 所需环境                                                          | 运行 / 构建                                                                     |
| ------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Windows | Rust MSVC、Visual Studio C++ Build Tools、Windows SDK、WebView2   | `pnpm dev:desktop` / `pnpm build:desktop`                                       |
| macOS   | Rust、Xcode Command Line Tools，分发需签名                        | `pnpm dev:desktop` / `pnpm build:desktop`                                       |
| Android | Rust Android targets、Android Studio、JDK、SDK、NDK，设置环境变量 | `pnpm tauri android init`，然后 `pnpm dev:android` / `pnpm tauri android build` |
| iOS     | **macOS**、Xcode、iOS Rust targets、Apple 开发团队 / 签名         | `pnpm tauri ios init`，然后 `pnpm dev:ios` / `pnpm tauri ios build`             |

配置的最低系统基线为 Android API 26、iOS 18；实际支持范围仍需真机验证。移动端初始化生成的 `src-tauri/gen` 当前不提交，执行 init 后按团队需要纳入版本管理。Tauri 平台文件选择器覆盖 PDF、笔记与备份导入，以及所有文件导出。

Windows 构建使用 Rust 1.98.1 MSVC、Visual Studio Build Tools 17.14、Windows SDK 10.0.26100，已提交依赖锁文件 Cargo.lock。运行 `pnpm build:windows` 可重新生成 x64 NSIS 安装包与 SHA-256 校验文件。正式分发仍需代码签名与更多 Windows 设备兼容性验证。

官方环境说明：[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)。

## 已知边界

- 本地 OCR 支持中英文普通文字；复杂表格和公式可使用支持图片的视觉模型。识别结果需校对，不保证任意多栏版面无损恢复。原始页面图可保留在 Markdown 中。
- Word 支持表格、引用、列表、图片及常用公式的原生 OMML 结构；复杂 TeX 扩展未做全面验证。PDF 中公式独立成行，保留 Markdown 可继续编辑。
- PDF 批注保存在资料库中，重新导出的原始 PDF 不写入这些批注。批注随完整 ZIP 备份迁移。
- 浏览器打印使用打印对话框；原生端可直接导出 PDF 后打印。
- 文献与笔记保存在当前浏览器 / WebView 的 IndexedDB 中，无账号和云同步。API Key 使用独立系统凭据存储或会话内存。清除站点数据会删除本地资料，应定期备份。桌面单实例启动，浏览器同一资料库只允许一个窗口写入。
- 草稿缓存和资料库都无法写入时，仅能在当前进程内保留草稿，界面会提示关闭前导出。新版备份格式为 4，保留图片、笔记文件夹与历史、识别任务及已有所有资料；可导入旧格式 1 / 2 / 3。旧版不能读取格式 4。完整备份前需保存或明确放弃草稿。API 配置档案不随备份导出。
- 自动备份只在应用运行时执行；默认关闭，可在偏好设置启用。Windows 快照位于应用数据目录 backups，浏览器快照仍属于站点存储。另存 ZIP 可防止站点或设备数据丢失。
- 单个 PDF 上限 100 MB、1500 页；笔记正文上限 500 万字符，含内嵌图片的导入文件上限 20 MB、单图 10 MB；导入备份上限 500 MB。大型资料库、低内存移动端尚未做压力验证。
- 浏览器原文阅读依赖本地开发 / 静态服务器；Tauri 安装后资源随包离线运行。当前没有浏览器 PWA Service Worker。

## 项目结构

```text
src/
  components/       Markdown、弹窗、提示等复用组件
  features/         文献库、阅读器、笔记、设置
  lib/              数据库、PDF、AI、导出、备份、平台适配
  types.ts          领域类型
  styles.css        设计系统、响应式与暗色样式
src-tauri/          Rust 入口、四端图标、权限与打包配置
scripts/           PDF 资源准备、截图检查
tests/             单元测试与真实浏览器流程
docs/              架构决策、验收记录
```

先设计后实现的完整记录见 [架构文档](docs/ARCHITECTURE.md)，验证范围见 [验收记录](docs/VALIDATION.md)。
