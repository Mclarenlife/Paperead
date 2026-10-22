# Paperead 0.1.9 配色设计

配色以黑白为基调，用统一的蓝色表达交互。分类图标保留各自颜色；绿色、黄色、红色分别表达完成、提醒与错误。文献缩略图保留原始颜色，不对用户文档应用去色或暗化滤镜。

## 参考依据

- [Fluent 2 Color](https://fluent2.microsoft.design/color)：区分中性色、品牌色和语义色，避免用语义色作无关装饰。
- [Radix 色阶职责](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)：背景、交互状态、边框、文字使用不同层级。
- [Radix 浅色色值](https://github.com/radix-ui/colors/blob/main/src/light.ts)、[深色色值](https://github.com/radix-ui/colors/blob/main/src/dark.ts)：参考 Gray 与 Blue 色阶，明暗主题分别配置。
- [WCAG 2.2 文字对比度](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)：普通文字至少 4.5:1，大字至少 3:1。没有给所有软件规定统一饱和度百分比。

## 颜色职责

| 角色 | 浅色 | 深色 |
| --- | --- | --- |
| 页面背景 | `#f9f9f9` | `#111111` |
| 卡片表面 | `#ffffff` | `#191919` |
| 主要文字 | `#202020` | `#eeeeee` |
| 辅助文字 | `#646464` | `#b4b4b4` |
| 交互强调 | `#0d74ce` | `#70b8ff` |
| 选中背景 | `#e6f4fe` | `#0d2847` |
| 选中文字 | `#113264` | `#c2e6ff` |
| 完成状态 | `#18794e` | `#3dd68c` |
| 提醒 | `#835000` | `#ffca16` |
| 错误 | `#ce2c31` | `#ff9592` |

主要操作按钮保持黑白反转。统计图标使用中性色，演示封面使用中性底色，避免多种粉彩底色竞争注意力。状态始终配合文字或图标，不单独靠颜色区分。

## 实现与验证

`src/palette.css` 是颜色角色的唯一配置入口。`src/workspace.css` 管理布局；旧样式中的固定浅灰文字改为角色变量，避免深色模式与组件覆盖不一致。

浏览器实际测量了浅色、深色各 8 组文字与背景：标题、作者、页脚、导航选中态、阅读与完成状态、标签、侧栏标题。16 组最低对比度为 4.8268:1；作者信息浅色为 5.92:1，深色为 8.48:1。这是所测组件的结果，不代表整套软件完成了 WCAG 合规认证。

自动校验：`tests/e2e/palette.spec.ts`。布局和标签页回归：`tests/e2e/workspace.spec.ts`。测试报告与截图位于 `.tmp/palette-019-*`。
