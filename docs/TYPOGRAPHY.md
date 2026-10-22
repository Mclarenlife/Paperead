# Paperead 0.1.10 字号、字体与间距

本轮检查阅读器、Markdown 笔记和偏好设置，并统一共用的导航、按钮、表单和说明文字。原有界面多处正文仅 8–12px，笔记编辑与预览均为 12px，手机阅读正文也降至 12px；这类尺寸不适合作为长时间阅读的默认值。

## 官方规范的结论

没有一套适用于所有平台和所有文字的统一法定字号。平台设计系统提供分角色、分平台的建议，不能把 CSS px、Apple pt 和 Android sp 当作可直接互换的数值。

- [Fluent 2 Typography](https://fluent2.microsoft.design/typography)：Web / Windows 正文常用 14px，辅助文字常用 12px；按角色建立字号与行高层级，并优先考虑平台字体。
- [Material 3 Typography](https://developer.android.com/develop/ui/compose/designsystems/material3#typography)：Android 的 bodyLarge 为 16/24，bodyMedium 为 14/20，bodySmall 为 12/16。
- [Apple Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)：默认字号建议按平台区分，iOS / iPadOS 为 17pt，macOS 为 13pt，同时应允许用户放大文字。
- [Fluent 2 Layout](https://fluent2.microsoft.design/layout)：以 4 为基础单位组织间距，按内容关系与设备宽度调整。
- [WCAG 1.4.4](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html) 关注放大至 200% 后能否继续使用；[WCAG 1.4.12](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing) 关注用户覆盖文字间距后是否丢失内容，不能将其误解为强制所有界面使用同一个默认行距。

## 本项目采用的层级

| 角色                 | 默认 CSS 字号         | 行高 / 用途    |
| -------------------- | --------------------- | -------------- |
| 页面标题             | 24px                  | 1.4–1.5        |
| 对话框标题           | 20px                  | 1.4            |
| 面板标题             | 16px                  | 1.5            |
| 阅读、笔记预览正文   | 桌面 18px / 窄屏 17px | 1.85           |
| Markdown 源码编辑    | 16px                  | 1.85，等宽字体 |
| 表单输入             | 桌面 15px / 窄屏 16px | 1.5            |
| 按钮、导航、表单标签 | 14px                  | 1.5            |
| 辅助说明             | 13px                  | 1.65           |
| 时间、页码、状态栏   | 12px                  | 1.5            |

字号以 rem 定义，表中数值基于浏览器默认根字号 16px。阅读器保留原有内容缩放。PDF 原文的字体和 PDF.js 文本坐标不受界面字号影响，原文大小由原文缩放控制。

界面与 Markdown 正文采用统一的平台无衬线字体栈，包含随应用提供的中文字体后备；源码使用独立等宽栈。品牌标识、文献缩略图和公式保留各自字体。主要留白使用 8 / 12 / 16 / 20 / 24 / 32px。

## 配色与布局修正

- 沿用 0.1.9 的中性色与蓝色交互角色；服务商选择、主题选择和笔记选中态统一，修复深色服务商选中态的浅灰底。
- 批注颜色选择恢复有意义的黄、绿、紫，进度条使用交互强调色；标题和正文使用主要文字色，说明使用辅助文字色。
- 设置面板加宽，表单和服务商选项根据空间自动换列，手机不再通过缩小文字挤入多列。
- 阅读工具栏允许换行；手机侧面板定位在正文区域，不依赖固定的工具栏高度。
- 笔记页高度扣除顶栏和页面导航，避免底部状态栏被遮住；手机分栏可滚动并保留编辑区域。

## 验证范围

`tests/e2e/typography.spec.ts` 检查三页明暗主题的实际字号与文字对比度、390px 手机布局、底部状态栏、侧面板定位、设置操作按钮可达性，以及根字号放大至 200% 后的阅读和设置布局。预览与测量结果写入 `.tmp/*0.1.10*`。

这些检查用于本轮组件回归，不代表整套应用通过了完整无障碍合规认证，也不代替各平台真机验收。
