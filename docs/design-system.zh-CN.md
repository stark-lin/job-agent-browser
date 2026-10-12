# 组件库与设计规范

用途：定义共享 UI 规范和可下载的参考组件库。状态：Tokens、CSS 展示库、中央 React 基础组件，以及 Home、Browser 和占位页对中央库的引用均**已实现**。展示库包含十个分类；示例不代表规划业务流程已实现，也不代表每个示例都有对应 React 组件。

语言：简体中文 · [English](design-system.md)

## 一、参考与资源

在浏览器中打开 [8px 组件库](components/job-browser-component-library-8px.html)。保留 Foundations、Buttons、Forms、Navigation、Badges & chips、Cards、Job components、Feedback、Overlays、Tables 十个分类，包含间距标尺与控件尺寸示例。提供的 HTML 作为视觉参考导入；示例职位、密钥说明和示例操作不定义应用实际行为。

- [独立组件 CSS](components/job-browser-component-library-8px.css)：生成的展示布局与组件样式，已包含 Tokens，可作为单个 CSS 文件使用。
- [Tokens CSS](../src/shared/ui/design-tokens.css)：与应用共用的 CSS 自定义属性。
- [Tokens JSON](../src/shared/ui/design-tokens.json)：Token 名称到 CSS 值的权威扁平映射，包含中性表面、语义色、间距、尺寸和排版。这是普通 CSS Tokens，不是 DTCG 交换格式。

展示库提供三个资源的下载链接，不依赖构建或外部字体。将 HTML 与独立 CSS 保存在同一目录即可离线查看。应用通过 [Renderer 入口](../src/renderer/main.tsx)导入中央运行样式及 Tokens；展示库样式不进入应用产物。

## 二、必须复用中央组件库

所有应用 UI 组件必须引用[中央公共入口](../src/shared/ui/index.ts)。页面和业务组件由共享基础组件组合；允许用于页面结构的语义 HTML。仅引用 Tokens 不满足组件复用要求。

- **已实现：**`Button`、`IconButton`、`TextInput`、`Icon`、`IconBox`、`FeatureCard`、`PlaceholderPage`，配合[中央运行样式](../src/shared/ui/components.css)。现有功能操作、浏览器控件/地址栏/标签和 Home 卡片/图标均使用这些组件。
- 缺少基础组件或变体时，必须先加入 `src/shared/ui/` 并从 `index.ts` 导出，再在页面使用。仅有展示示例的组件，进入应用前仍需中央 React 实现。
- 通用外观、尺寸、状态和无障碍默认行为归中央库。页面 CSS 可使用共享 Tokens 安排布局，不得重写组件外观、复制中央选择器或通过内联样式绕过组件库。
- 页面保留业务数据、位置、启用/加载状态、导航和事件处理。中央库不得导入 App/Page/Domain/Platform 行为，通过 props 与组合插槽接收配置。

[质量检查器](../scripts/quality.cjs)拒绝中央库以外的原生通用控件/图标和 JSX 内联样式，并要求 UI 组件通过公共入口导入。设计检查器拒绝页面/应用样式中的中央 `.ui-*` 选择器。这些检查覆盖常见绕过方式；审查仍需识别换用不同类名的重复外观。

## 三、布局、尺寸与排版

| 项目 | 必须使用的尺度或尺寸 |
| --- | --- |
| 间距 | 8 / 16 / 24 / 32 / 40 / 48 / 64 / 80 / 96px；允许零值 |
| 控件 | 小号 32px / 默认 40px / 大号 48px |
| Toolbar | 48px |
| Browser 标签栏 | 48px；浏览器栏总高度 96px |
| List Row | 最小 64px；必要时随内容增高 |
| Home Card | 所有视口下最小 144px |
| 图标 | 16px，使用 32px / 40px 容器 |
| 圆角 | 8 / 16 / 24px |
| 字号 | 12 / 14 / 16 / 20 / 32 / 40px |
| 行高 | 16 / 24 / 32 / 40 / 48px |
| 边框与分割线 | 1px |
| 焦点描边 | 2px |

所有非零 Padding、Gap、Margin 必须使用 `--space-*`。固定组件尺寸使用尺寸 Tokens，字号与行高使用排版 Tokens。按需允许数值零、`auto`、百分比和弹性网格轨道；不要使用破坏间距尺度的视口单位内边距。`--space-N` 的后缀表示 8px 步数，不表示像素值；排除未列出的步数，例如 56px。

字号与描边宽度不受网格倍数约束。圆形状态点和加载指示器使用 `50%` 圆角；矩形控件、标签与徽章使用圆角尺度。SVG 路径和描边宽度描述图形，不属于布局。响应式宽度和断点不意味着所有流式渲染宽度都能被八整除。

图标通过 grid/flex 居中。文本使用固定 Token 行高，允许标题和描述换行，并在窄屏保留卡片最小高度。边框使用 `box-sizing: border-box`。焦点描边可见，加载与悬停动效遵循减少动态效果偏好。参见 [Home 样式](../src/pages/home/home.css)、[应用样式](../src/renderer/styles/global.css)及[参考样式](../src/shared/ui/component-library.css)。

## 四、语义色规则

| 含义 | Token | 色值 | 用途 |
| --- | --- | --- | --- |
| 操作 / 信息 | `--primary`, `--info` | `#2563eb` | 主要操作、当前导航、信息状态 |
| 成功 | `--success` | `#16a34a` | 操作完成、产物就绪、获得 Offer |
| 警告 | `--warning` | `#d97706` | 需要审核或注意 |
| 错误 / 破坏性操作 | `--danger` | `#dc2626` | 操作失败、字段无效、破坏性操作 |

每种语义状态使用对应背景与边框 Tokens。每个任务优先保留一个明确主要操作。Saved/Closed 阶段保持中性，Applied/Interview 使用信息样式。阶段本身不自动成为警告或错误；同时提供文字或图标，避免只依赖颜色表达含义。

## 五、维护与验证

修改 `design-tokens.json` 或[参考组件样式](../src/shared/ui/component-library.css)后，重新生成 CSS 导出文件和[共享浏览器尺寸](../src/shared/ui/geometry.ts)：

```sh
npm run design:tokens
npm run design:check
```

[设计规范检查器](../scripts/design-system.cjs)校验生成文件一致性、允许的间距、固定尺寸、Token 引用、语义色、资源路径及十个展示分类。该检查包含在 `npm run quality` 中，因此也会随 `npm run check` 执行。它检查声明尺寸，不覆盖所有计算后的布局或无障碍对比度。

[浏览器契约](../src/shared/browser.ts)重新导出生成尺寸，供[原生视图布局](../src/platform/browser/browserManager.ts)使用。不要分别在 CSS 或 Main 中修改工具栏高度。[浏览器 smoke](../scripts/browser-smoke.cjs)比较渲染后的浏览器栏与原生边界，同时检查卡片尺寸和响应式布局。应用验证命令归属 [README](../README.zh-CN.md#验证与构建)。

## 六、相关文档

- [当前架构](architecture.zh-CN.md)：运行行为与剩余限制。
- [代码架构](code-architecture.zh-CN.md)：依赖边界和页面归属。
- [产品架构](product-architecture.zh-CN.md)：展示示例所代表的规划业务流程。
