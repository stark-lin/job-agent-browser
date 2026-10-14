# 组件库与设计规范

用途：定义可执行的组件规则与维护流程。状态：浅色/暗色配色主题、Tokens、CSS 参考展示库、中央 React 基础组件，以及 Home、Browser、Inbox、Ask AI、Settings 和占位页对它们的引用均**已实现**。其余业务功能页面为**占位**；业务流程及其余展示示例的 React 对应组件仍为**规划**。视觉方向归属 [DESIGN.md](../DESIGN.zh-CN.md)。

语言：简体中文 · [English](design-system.md)

## 一、源码与参考资源

| 职责 | 权威来源 |
| --- | --- |
| Token 值 | [浅色及共享 Tokens](../src/shared/ui/design-tokens.json)、[暗色颜色覆盖](../src/shared/ui/design-tokens.dark.json) |
| 公共 React 组件 | [中央入口](../src/shared/ui/index.ts) |
| 共享应用外观 | [components.css](../src/shared/ui/components.css) |
| 参考示例及其展示样式 | [展示库 HTML](components/job-browser-component-library-8px.html) 和 [component-library.css](../src/shared/ui/component-library.css) |
| 生成资源 | [Tokens CSS](../src/shared/ui/design-tokens.css)、[原生颜色](../src/shared/ui/theme-colors.ts)、[原生尺寸](../src/shared/ui/geometry.ts)、[侧栏响应式 CSS](../src/shared/ui/sidebar-responsive.css)、[独立参考 CSS](components/job-browser-component-library-8px.css) |

[Renderer 入口](../src/renderer/main.tsx)导入 `components.css`，后者导入生成的 Tokens。展示库加载独立参考 CSS，并提供该 CSS、Tokens CSS 和 Tokens JSON 的下载。将 HTML 与独立 CSS 保存在同一目录即可离线查看，无需构建或外部字体。Tokens JSON 是 CSS 值的扁平映射，不是 DTCG 格式。

展示库保留十个分类：Foundations、Buttons、Forms、Navigation、Badges & chips、Cards、Job components、Feedback、Overlays、Tables，包含间距标尺和尺寸示例。示例职位、操作及密钥说明都是参考内容，不证明应用已实现相关能力。

应用与展示库的样式源码分离，共享相同 Tokens。生成器不会将展示示例转换成 React 组件，也不会自动同步其与运行组件的外观；通用视觉规则变化时须更新双方源码。

## 二、必须复用中央组件库

所有应用 UI 组件必须使用 `src/shared/ui/index.ts`（或对应目录导入）。页面和功能专属 UI 由这些基础组件组合，允许使用 `main`、`section`、`div`、`span`、`form` 等结构元素。仅引用 Tokens 不满足复用要求。纯业务 Domain 模块必须保持无 UI 依赖，遵循[代码架构](code-architecture.zh-CN.md)。

| 已实现组件 | 支持用途 | 实现 |
| --- | --- | --- |
| `Button`, `IconButton` | 操作、图标与浏览器标签变体；调用方提供名称和处理函数 | [Button.tsx](../src/shared/ui/Button.tsx) |
| `TextArea` | 多行模型 ID 和聊天输入；最小高度使用 96px Token，支持缩放/焦点/禁用/错误状态 | [TextArea.tsx](../src/shared/ui/TextArea.tsx) |
| `TextInput` | 默认字段，或位于有样式容器中的裸输入框 | [TextInput.tsx](../src/shared/ui/TextInput.tsx) |
| `Glyph` | Home 与工作区导航复用的命名 SVG 图形 | [Glyph.tsx](../src/shared/ui/Glyph.tsx) |
| `Sidebar`, `NavigationGroup`, `NavigationItem` | 通用侧栏组合、分组标题及带当前页面状态的原生命名按钮 | [Sidebar.tsx](../src/shared/ui/Sidebar.tsx) |
| `Icon`, `IconBox` | SVG 图形与中性/主要语义图标容器 | [Icon.tsx](../src/shared/ui/Icon.tsx) |
| `FeatureCard` | 带图标、标题和描述的功能入口 | [FeatureCard.tsx](../src/shared/ui/FeatureCard.tsx) |
| `FormField`, `Select` | 关联标签、帮助/错误及原生选择 | [Form.tsx](../src/shared/ui/Form.tsx) |
| `SectionCard`, `PageHeading` | 共享面板及页面标题外观 | [Form.tsx](../src/shared/ui/Form.tsx) |
| `StatusMessage` | 中性、信息、成功及错误反馈 | [Form.tsx](../src/shared/ui/Form.tsx) |
| `Dialog` | 原生模态焦点约束、可选正文；页面管理操作及取消 | [Dialog.tsx](../src/shared/ui/Dialog.tsx) |
| `DataTable`、`Badge`、`DetailsList` | 命名滚动区、列标题、元数据列表及带文字的中性/成功/错误徽章 | [DataTable.tsx](../src/shared/ui/DataTable.tsx) |
| `PlaceholderPage` | 明确的待实现布局，操作由页面提供 | [PlaceholderPage.tsx](../src/shared/ui/PlaceholderPage.tsx) |

- 缺少基础组件或变体时，先加入 `src/shared/ui/` 并从中央入口导出，再用于页面。仅存在展示示例的表单、徽章、职位卡片、反馈、对话框和表格，若未由现有基础组件表达，仍需中央 React 实现。
- 通用外观、尺寸、视觉状态和无障碍默认行为归中央库。页面 CSS 可通过共享 Tokens 安排布局，不得复制控件样式、重写 `.ui-*` 选择器或通过内联样式绕过中央库。
- 页面管理位置、业务数据、启用/加载状态、导航和事件处理。Shared UI 通过 props 与组合插槽接收配置，不得导入 App/Page/Domain/Platform 行为。`className` 用于组合，不用于另建组件外观。

[HomeTile](../src/pages/home/HomeTile.tsx)、[Browser 控件](../src/pages/browser/BrowserControls.tsx)、[AddressBar](../src/pages/browser/AddressBar.tsx) 和 [FindJobsPage](../src/pages/find-jobs/FindJobsPage.tsx)及 [SettingsPage](../src/pages/settings/SettingsPage.tsx) 展示当前引用方式。不得将展示库结构复制到页面，或用私有实现文件导入代替公共入口。

## 三、布局、尺寸与排版

| 项目 | 必须使用的尺度或尺寸 | Tokens |
| --- | --- | --- |
| 间距 | 0 / 8 / 16 / 24 / 32 / 40 / 48 / 64 / 80 / 96px | `--space-*` |
| 控件 | 小号 32px / 默认 40px / 大号 48px | `--control-sm`, `--control-md`, `--control-lg` |
| Toolbar | 48px | `--toolbar-height` |
| Browser 标签栏 / 浏览器栏总高度 | 48px / 96px | `--tab-strip-height`, `--browser-chrome-height` |
| 工作区侧栏 | 超过 960px 时宽 208px，否则为 64px 图标栏；导航项最小 40px | `--sidebar-width`, `--sidebar-compact-width`, `--sidebar-breakpoint`, `--control-md` |
| List Row | 最小 64px；必要时随内容增高 | `--list-row-height` |
| Home Card | 所有视口下最小 144px | `--feature-card-height` |
| 图标 / 容器 | 16px / 32px 或 40px | `--icon-size`, `--icon-box`, `--icon-box-lg` |
| 圆角 | 8 / 16 / 24px | `--radius-*` |
| 字号 | 12 / 14 / 16 / 20 / 32 / 40px | `--font-*` |
| 行高 | 16 / 24 / 32 / 40 / 48px | `--line-*` |
| 边框 / 焦点描边 | 1px / 2px | `--border-width`, `--focus-width` |

所有非零 Padding、Gap、Margin 必须使用间距 Tokens。允许零值和自动外边距。百分比、弹性轨道和 `min()` 用于流式尺寸，不用于任意间距。`--space-N` 表示 8px 步数，排除未列出的步数，例如 56px。不得以视口单位内边距或连续缩放的字号代替既定尺度。

字号和描边宽度是网格例外。圆形状态点和加载指示器使用 `50%` 圆角，矩形控件、标签与徽章使用圆角尺度。SVG 路径和图形描边不是布局尺寸；流式渲染宽度不必能被八整除。

通过 grid/flex 居中图标，文本使用固定 Token 行高，边框采用 `box-sizing: border-box`。允许标题/描述换行，并在窄屏保留卡片最小高度。[Home 布局](../src/pages/home/home.css)在三列、两列与单列之间切换；[浏览器布局](../src/renderer/styles/global.css)保持固定浏览器栏高度。页面宽度和断点属于布局决策，不是新的间距基础值。

## 四、语义色规则

| 含义 | Token | 浅色 / 暗色 | 用途 |
| --- | --- | --- | --- |
| 操作 / 信息 | `--primary`, `--info` | `#2563eb` / `#60a5fa` | 主要操作、当前导航、信息状态 |
| 成功 | `--success` | `#16a34a` / `#4ade80` | 操作完成、产物就绪、获得 Offer |
| 警告 | `--warning` | `#d97706` / `#fbbf24` | 需要审核或注意 |
| 错误 / 破坏性操作 | `--danger` | `#dc2626` / `#f87171` | 操作失败、字段无效、破坏性操作 |

使用对应背景与边框 Tokens，每个任务优先保留一个明确主要操作。Saved/Closed 保持中性，Applied/Interview 使用信息样式。流程阶段本身不自动成为警告或错误；同时提供文字或图标，避免只通过颜色表达含义。[参考展示库](components/job-browser-component-library-8px.html)展示当前语义映射；若应用页面仍为占位，其使用这些语义的业务流程仍属规划。

主题只能修改背景、前景、边框、图标、焦点及阴影颜色。组件结构、尺寸、间距、排版、圆角、边框粗细、阴影偏移/模糊、过渡与行为共用。生成器拒绝非颜色的暗色覆盖和阴影尺寸变化。`--on-primary` 是主要按钮前景色，不得用 `--surface` 代替。展示库专用颜色也使用权威 Tokens。

生成 CSS 支持 `data-theme="light"` / `data-theme="dark"`；未指定属性时跟随 `prefers-color-scheme`。离线展示库随系统切换，不增加控件或脚本；十六进制说明文字记录浅色色板，色块填充跟随当前主题。需要检查指定配色时，在浏览器开发工具中设置根节点属性。应用选择与同步归属[当前架构](architecture.zh-CN.md#三展示与交互)。

## 五、交互与无障碍

以下是 UI 新增和修改的要求，不代表已获得完整无障碍认证：

- 侧栏隐藏文字时仍保留完整无障碍名称及原生提示气泡；使用 `aria-current="page"` 标记当前目标。中间分组滚动时，底部固定的 Settings 仍可访问。
- 所有控件提供无障碍名称。`IconButton` 要求 `aria-label`，输入框需要关联标签或无障碍名称。`Icon` 默认是装饰图形，应由所属控件传达含义，或明确配置图形的无障碍语义。
- Settings 在 16px 圆角面板中组合 40px 字段，内边距为 24px（窄屏为 16px）；页面 CSS 仅管理布局。成功反馈使用可读文字及成功背景/边框。展示库 Settings 示例引用这些共享规则。
- Settings 审计查看器组合中央 `DataTable`、`Badge`、`DetailsList` 和 `Dialog` 正文。表格行至少 64px，ID 可换行，状态带文字，横向滚动区可通过键盘聚焦，不撑宽页面。元数据弹窗在视口内滚动。Tables 展示库包含审计参考。
- 保留原生键盘激活、禁用行为和可见焦点。裸 `TextInput` 必须位于提供可见焦点反馈的容器中，参见 [AddressBar](../src/pages/browser/AddressBar.tsx)；其自身描边按设计被移除。
- 标签选择、键盘焦点和选中状态保持一致；键盘处理归 [TabStrip](../src/pages/browser/TabStrip.tsx)。通过适当文字/角色宣布错误，长文本保持可读，不隐藏完整含义。
- 区分加载、空状态、成功与错误。不得让参考示例看起来像已实现操作；页面文案归属 [i18n 资源](../src/shared/i18n/locales/en.ts)。
- 遵循减少动态效果偏好，检查窄屏换行、裁剪和滚动。运行时动效规则位于[中央样式](../src/shared/ui/components.css)和[浏览器样式](../src/renderer/styles/global.css)。

对比度、屏幕阅读器表现、放大文字和完整键盘覆盖仍需人工审查，当前静态检查不能证明这些方面。

## 六、维护与验证

1. 确认组件已在公共入口提供。必要时扩展中央实现和 `components.css`，页面行为与布局保留在调用处。
2. 浅色/共享值修改 `design-tokens.json`，仅颜色的暗色覆盖修改 `design-tokens.dark.json`，参考示例修改 `component-library.css`/展示库 HTML。不要手动修改生成资源。调整必须遵循的尺度时，同一变更中更新本规范与检查器的允许值断言。
3. 仅当 Tokens 或参考样式输入变化时重新生成：

```sh
npm run design:tokens
```

4. 运行相关检查。`quality` 包含设计验证与双语文档检查，纯文档变更执行它即可；运行时 UI 变更还须运行 [README](../README.zh-CN.md#验证与构建)中的相关应用检查。

```sh
npm run design:check
npm run quality
```

5. 在发生变化的应用和展示库中检查正常/悬停/焦点/禁用状态、长文本、语义反馈与窄屏布局。同步更新所属文档和翻译，再检查 `git diff --check`。

| 验证 | 能证明什么 | 边界 |
| --- | --- | --- |
| [设计检查器](../scripts/design-system.cjs) | 生成文件一致性、仅颜色覆盖/阴影尺寸不变、部分暗色文字对比度 ≥4.5:1、允许的 Token 值、声明间距/固定尺寸、Token 引用、展示库链接及十个分类；拒绝 Shared UI 外的 `.ui-*` 选择器 | 不证明所有计算后的布局、状态或无障碍属性 |
| [质量检查器](../scripts/quality.cjs) | 中央 UI 外禁止原生通用 JSX 控件/图标及显式 JSX `style` 属性；App/Page/Renderer 组件经公共入口导入；文档双语、路径和篇幅检查 | 不同类名的重复实现、props 展开绕过和动态创建元素仍需审查 |
| [Browser smoke](../scripts/browser-smoke.cjs) | Home 在 320/640/1200px 下的表现、卡片最小高度、溢出、中央卡片尺寸，以及渲染浏览器栏与原生边界衔接 | 不属于完整展示库、无障碍或视觉回归测试 |
| [Inbox smoke](../scripts/inbox-smoke.cjs) | 全内容区原生边界、无应用浏览器栏、缩放、重定向、历史和加载恢复 | 使用本地测试页，不证明邮箱网站自身行为 |
| [侧栏 smoke](../scripts/sidebar-smoke.cjs) | 全部目标、当前状态、键盘激活、响应式宽度及原生视图不遮挡导航 | 不证明全部辅助技术行为 |
| [AI smoke](../scripts/ai-smoke.cjs) | Provider 表单、中央多行输入、真实 SSE/IPC、取消及 320/640/1200px 溢出检查 | 本地服务不证明第三方服务商行为 |
| [审计查看器 smoke](../scripts/audit-viewer-smoke.cjs) | 筛选、分页、元数据弹窗、键盘关闭、320/640/1200px 页面无溢出及只读/错误/加载状态 | 不认证读屏或并发写入时跨页快照一致性 |
| [Settings smoke](../scripts/settings-smoke.cjs) | 真实表单、标签、40px 控件、16px 面板、320/640/1200px 布局、语言、校验和密钥生命周期 | 不证明读屏行为或服务商访问能力 |
| [主题 smoke](../scripts/theme-smoke.cjs)及[重启 smoke](../scripts/settings-restart-smoke.cjs) | 草稿/保存/失败/放弃、模拟原生外观变化、导航/原生边界不变、320/640/1200px 的 Settings/Home 尺寸、展示库全部元素尺寸和持久化暗色启动 | 不自动操作真实系统设置，不认证全部视觉状态，也不证明启动每一帧均无闪屏 |

原生边界通过[浏览器契约](../src/shared/browser.ts)使用[生成尺寸](../src/shared/ui/geometry.ts)，不得分别修改 CSS 与 Main 的工具栏高度。[构建配置](../electron.vite.config.ts)选择 Renderer 入口，脚本和命令以 [package.json](../package.json) 为准。

## 七、相关文档

- [设计纲要](../DESIGN.zh-CN.md)：视觉方向与设计入口。
- [当前架构](architecture.zh-CN.md)：已实现行为与限制。
- [代码架构](code-architecture.zh-CN.md)：依赖边界与页面归属。
- [产品架构](product-architecture.zh-CN.md)：示例代表的规划业务流程。
