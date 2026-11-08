# 组件库与设计规范

用途：定义可执行的组件规则与维护流程。状态：浅色/暗色配色主题、Tokens、CSS 参考展示库、中央 React 基础组件，以及 Browser、Inbox、Ask AI、Profile、Settings、Add Job、Applications 和占位页对它们的引用均**已实现**。其余业务功能页面为**占位**；其余业务流程及其余展示示例的 React 对应组件仍为**规划**。视觉方向归属 [DESIGN.md](../DESIGN.zh-CN.md)。

语言：简体中文 · [English](design-system.md)

## 一、源码与参考资源

| 职责 | 权威来源 |
| --- | --- |
| Token 值 | [浅色及共享 Tokens](../src/shared/ui/design-tokens.json)、[暗色颜色覆盖](../src/shared/ui/design-tokens.dark.json) |
| 公共 UI 基础组件 | [中央入口](../src/shared/ui/index.ts) |
| 共享应用外观 | [components.css](../src/shared/ui/components.css) |
| 参考示例及其展示样式 | [展示库 HTML](components/job-browser-component-library-8px.html) 和 [component-library.css](../src/shared/ui/component-library.css) |
| 生成资源 | [Tokens CSS](../src/shared/ui/design-tokens.css)、[原生颜色](../src/shared/ui/theme-colors.ts)、[原生尺寸](../src/shared/ui/geometry.ts)、[原生箭头样式](../src/shared/ui/history-indicator-styles.ts)、[原生导航提示样式](../src/shared/ui/navigation-tooltip-styles.ts)、[独立参考 CSS](components/job-browser-component-library-8px.css) |

[Renderer 入口](../src/renderer/main.tsx)导入 `components.css`，后者导入生成的 Tokens。展示库加载独立参考 CSS，并提供该 CSS、Tokens CSS 和 Tokens JSON 的下载。将 HTML 与独立 CSS 保存在同一目录即可离线查看，无需构建或外部字体。Tokens JSON 是 CSS 值的扁平映射，不是 DTCG 格式。

展示库保留十个分类：Foundations、Buttons、Forms、Navigation、Badges & chips、Cards、Job components、Feedback、Overlays、Tables，包含间距标尺和尺寸示例。示例职位、操作及密钥说明都是参考内容，不证明应用已实现相关能力。

应用与展示库的样式源码分离，共享相同 Tokens。生成器不会将展示示例转换成 React 组件，也不会自动同步其与运行组件的外观；通用视觉规则变化时须更新双方源码。

## 二、必须复用中央组件库

所有应用 UI 组件必须使用 `src/shared/ui/index.ts`（或对应目录导入）。页面和功能专属 UI 由这些基础组件组合，允许使用 `main`、`section`、`div`、`span`、`form` 等结构元素。仅引用 Tokens 不满足复用要求。纯业务 Domain 模块必须保持无 UI 依赖，遵循[代码架构](code-architecture.zh-CN.md)。

| 已实现组件 | 支持用途 | 实现 |
| --- | --- | --- |
| `Button`、`ActionRow`、`IconButton` | 操作、图标与浏览器标签变体；调用方提供名称和处理函数 | [Button.tsx](../src/shared/ui/Button.tsx) |
| `CopyButton` | 异步复制并防止重复提交；成功后原按钮禁用并切换为传入的已复制文案，以礼貌实时反馈播报；失败仍可重试 | [CopyButton.tsx](../src/shared/ui/CopyButton.tsx) |
| `TextArea` | 多行模型 ID、聊天输入和个人简介；最小高度使用 96px Token，支持缩放/焦点/禁用/错误状态 | [TextArea.tsx](../src/shared/ui/TextArea.tsx) |
| `Checkbox` | 原生键盘/焦点/禁用行为、关联可换行标签、40px 最小点击区及 16px 勾选控件，用于独立忽略控件 | [Checkbox.tsx](../src/shared/ui/Checkbox.tsx) |
| `TextInput` | 文本、URL、密码和数字字段，或位于有样式容器中的裸输入框 | [TextInput.tsx](../src/shared/ui/TextInput.tsx) |
| `ListInput` | 复用 `TextInput` 展示的逗号分隔列表，输入时保留末尾分隔符，外部值变更时同步重置 | [ListInput.tsx](../src/shared/ui/ListInput.tsx) |
| `ExternalLink` | 业务来源的 HTTP(S) 链接，拒绝凭据及其他协议，在外部打开 | [ExternalLink.tsx](../src/shared/ui/ExternalLink.tsx) |
| `Glyph` | 工作区导航使用的命名 SVG 图形 | [Glyph.tsx](../src/shared/ui/Glyph.tsx) |
| `historyIndicatorDocument` | 无页面脚本的原生历史箭头；固定位置、触发就绪及不可用状态 | [HistoryIndicator.ts](../src/shared/ui/HistoryIndicator.ts), [history-indicator.css](../src/shared/ui/history-indicator.css) |
| `Sidebar`, `NavigationGroup`, `NavigationItem` | 图标栏、无障碍导航分组及带定位标题提示和当前页面状态的命名按钮 | [Sidebar.tsx](../src/shared/ui/Sidebar.tsx) |
| `Icon`, `IconBox` | SVG 图形与中性/主要语义图标容器 | [Icon.tsx](../src/shared/ui/Icon.tsx) |
| `FeatureCard` | 带图标、标题和描述的功能入口 | [FeatureCard.tsx](../src/shared/ui/FeatureCard.tsx) |
| `FormField`, `Select` | 关联标签、帮助/错误及原生选择 | [Form.tsx](../src/shared/ui/Form.tsx) |
| `SectionCard` | 带标题的可折叠内容面板 | [Form.tsx](../src/shared/ui/Form.tsx) |
| `StatusMessage` | 中性、信息、成功及错误反馈 | [Form.tsx](../src/shared/ui/Form.tsx) |
| `Dialog` | 原生模态焦点约束、可选正文；页面管理操作及取消 | [Dialog.tsx](../src/shared/ui/Dialog.tsx) |
| `DataTable`、`Badge`、`DetailsList` | 命名滚动区、列标题、元数据列表及带文字的中性/成功/错误徽章 | [DataTable.tsx](../src/shared/ui/DataTable.tsx) |
| `PlaceholderPage` | 明确的待实现布局，操作由页面提供 | [PlaceholderPage.tsx](../src/shared/ui/PlaceholderPage.tsx) |
| `StageProgress` / `DocumentPreview` | 带当前步骤语义的业务阶段列表；隔离来源且禁脚本的 iframe，共享高度 640px，由 Main 阻止导航 | [StageProgress.tsx](../src/shared/ui/StageProgress.tsx)、[DocumentPreview.tsx](../src/shared/ui/DocumentPreview.tsx) |

- 缺少基础组件或变体时，先加入 `src/shared/ui/` 并从中央入口导出，再用于页面。仅存在展示示例的表单、徽章、职位卡片、反馈、对话框和表格，若未由现有基础组件表达，仍需中央 React 实现。
- 通用外观、尺寸、视觉状态和无障碍默认行为归中央库。页面 CSS 可通过共享 Tokens 安排布局，不得复制控件样式、重写 `.ui-*` 选择器或通过内联样式绕过中央库。
- 页面管理位置、业务数据、启用/加载状态、导航和事件处理。Shared UI 通过 props 与组合插槽接收配置，不得导入 App/Page/Domain/Platform 行为。`className` 用于组合，不用于另建组件外观。

[Browser 控件](../src/pages/browser/BrowserControls.tsx)、[AddressBar](../src/pages/browser/AddressBar.tsx)、[新增工作](../src/pages/find-jobs/AddJobPage.tsx)和[设置](../src/pages/settings/SettingsPage.tsx)使用这些原语。采集来源选择与[申请 Agent 面板](../src/pages/applications/ApplicationAgentPanel.tsx)组合现有 Select/TextArea/Button/SectionCard/StatusMessage，事件历史使用 DetailsList，不引入新控件外观或 Token。不要把图库标记复制到页面或导入私有实现。

## 三、布局、尺寸与排版

| 项目 | 必须使用的尺度或尺寸 | Tokens |
| --- | --- | --- |
| 间距 | 0 / 8 / 16 / 24 / 32 / 40 / 48 / 64 / 80 / 96px | `--space-*` |
| 控件 | 小号 32px / 默认 40px / 大号 48px | `--control-sm`, `--control-md`, `--control-lg` |
| Toolbar | 48px | `--toolbar-height` |
| Browser 标签栏 / 浏览器栏总高度 | 48px / 96px | `--tab-strip-height`, `--browser-chrome-height` |
| 工作区侧栏 | 所有窗口宽度下均为 64px 图标栏；导航项高 48px，图标为 24px | `--sidebar-width`, `--control-lg`, `--space-3` |
| List Row | 最小 64px；必要时随内容增高 | `--list-row-height` |
| Feature Card | 所有视口下最小 144px | `--feature-card-height` |
| 图标 / 容器 | 16px / 32px 或 40px | `--icon-size`, `--icon-box`, `--icon-box-lg` |
| 圆角 | 8 / 16 / 24px | `--radius-*` |
| 字号 | 12 / 14 / 16 / 20 / 32 / 40px | `--font-*` |
| 行高 | 16 / 24 / 32 / 40 / 48px | `--line-*` |
| 边框 / 焦点描边 | 1px / 2px | `--border-width`, `--focus-width` |

所有非零 Padding、Gap、Margin 必须使用间距 Tokens。允许零值和自动外边距。百分比、弹性轨道和 `min()` 用于流式尺寸，不用于任意间距。`--space-N` 表示 8px 步数，排除未列出的步数，例如 56px。不得以视口单位内边距或连续缩放的字号代替既定尺度。

字号和描边宽度是网格例外。圆形状态点和加载指示器使用 `50%` 圆角，矩形控件、标签与徽章使用圆角尺度。SVG 路径和图形描边不是布局尺寸；流式渲染宽度不必能被八整除。

通过 grid/flex 居中图标，文本使用固定 Token 行高，边框采用 `box-sizing: border-box`。允许标题/描述换行，并在窄屏保留卡片最小高度。[浏览器布局](../src/renderer/styles/global.css)保持固定浏览器栏高度。页面宽度和断点属于布局决策，不是新的间距基础值。

## 四、语义色规则

Designless V3 已落实到权威 Tokens 与共享组件外观。提供的 V3 HTML/CSS 是视觉参考，不是替换组件包：保留应用 DOM、业务文案/数据、流程、页面组合、断点、列数、间距与字号。参考中的单列展示和演示交互不决定应用布局或行为。现有图库保留十个分类及控件。

| 表面 / 含义 | Token | 浅色 / 暗色 | 用途 |
| --- | --- | --- | --- |
| 应用 / 导航栏 | `--app`, `--rail` | `#E8EAED` / `#101113`；`#E1E4E8` / `#191B1E` | 银石墨灰 / 中性黑外壳 |
| 页面 / 组件 | `--bg`, `--surface` | `#F6F7F9` / `#141618`；`#FFFFFF` / `#24272C` | 不透明中性层级 |
| 控件 / 选中 | `--quiet`, `--selected` | `#E8EAEE` / `#353A40`；`#E1E5EB` / `#24272B` | 中性控件与选中状态 |
| 操作 | `--primary`, `--primary-hover` | 两种主题均为 `#0066FF` | 主要操作、当前阶段和焦点轮廓；图标导航栏选中项使用 `--rail-active`（`rgba(0,102,255,.2)`，80% 透明度）及 `--on-rail-active` 图标（亮色 `#174A8B` / 暗色 `#A8CCFF`） |
| 成功 | `--success` | `#186541` / `#7EDCAA` | 操作完成或产物就绪 |
| 警告 | `--warning` | `#815000` / `#FFD08A` | 需要审核或注意 |
| 错误 / 破坏性操作 | `--danger` | `#A52E34` / `#FF9D98` | 操作失败、字段无效或破坏性操作 |

语义色克制用于带真实标签的小面积文字/图标。状态背景保持中性；破坏性按钮保留克制的 danger 背景。Saved/Closed 保持中性，Applied/Interview 使用信息样式。阶段本身不自动成为警告/错误。`--info` 与普通链接使用可读前景色；暗色表面上的品牌蓝不满足普通文字对比度，不能用作普通文字色。链接保留下划线。主蓝色控件使用 `--on-primary`（两种主题均为白色）；半透明蓝色导航选中项使用 `--on-rail-active`。普通文字目标 ≥4.5:1；必要的非文字状态区别目标 ≥3:1。静态检查覆盖选定色对，不代表所有叠加状态。

`--line`/`--line-hover` 为透明色，在保留现有边框盒尺寸的同时移除装饰边框。功能性分隔使用 `--muted-line`，新增卡片轮廓使用 `--field-edge`，保留无效字段边缘和键盘焦点轮廓。区块标题不加分隔线。阴影**仅增强组件边界辨识度**：外层卡片/输入容器使用静态 `--shadow`，浮层、提示和 Banner 使用 `--shadow-dialog`；嵌套卡片不额外添加阴影。悬停、焦点、选中、成功和进度均不新增或改变阴影。焦点使用 2px 轮廓，无光晕。避免泛蓝应用表面、玻璃模糊、渐变、装饰编号、emoji 点缀、彩色左边条和过大阴影；保留功能图标与语义标签。

主题仅修改颜色；结构、尺寸、间距、排版、圆角、边框粗细、阴影偏移/模糊、过渡与行为共用。生成器拒绝非颜色的暗色覆盖和阴影尺寸变化。图库专用颜色也使用权威 Tokens。

生成 CSS 支持 `data-theme="light"` / `data-theme="dark"`；未指定属性时跟随 `prefers-color-scheme`。离线图库随系统切换，不增加控件或脚本；十六进制说明记录浅色色板，填充随主题变化。在开发工具中设置根节点属性可检查任一主题。应用选择与同步归属[当前架构](architecture.zh-CN.md#三展示与交互)。

## 五、交互与无障碍

以下是 UI 新增和修改的要求，不代表已获得完整无障碍认证：

- 侧栏不显示品牌头部或文字标签，Ask AI 位于首位，其后依次为管理（个人资料、定制简历、智能笔记）、求职（新增工作、申请记录、收件箱）、工具（浏览器）和固定在底部的设置。分区之间用居中的 24px 短横线分隔，颜色和线宽分别使用 `--muted-line` 与 `--border-width`；横线仅作装饰，分组保留翻译后的无障碍名称。导航项的无障碍名称和提示都使用完整的翻译名称。鼠标悬停或键盘聚焦时，提示立即显示在图标右侧。鼠标移开、失去焦点或按 Escape 会关闭提示。[原生浮层](../src/platform/browser/navigationTooltip.ts)在浏览器和收件箱的网页内容上方显示同样的名称。使用 `aria-current="page"` 标记当前目标。中间分组滚动时，Settings 仍可访问。
- 所有控件提供无障碍名称。`IconButton` 要求 `aria-label`，输入框需要关联标签或无障碍名称。`Icon` 默认是装饰图形，应由所属控件传达含义，或明确配置图形的无障碍语义。
- 设置页外部 Agent 接入组合中央 SectionCard、DetailsList、Badge、Button、Dialog 和只读 TextArea。MCP 配置、连接结果和逐项 Skill 安装状态分开显示。Skill 安装/更新操作展示目录及已完成/待完成结果；文件夹不同时，确认弹窗列出冲突、默认聚焦取消，并明确无备份替换。其他 Agent 可打开内置 Skills 文件夹；MCP 替换仍采用独立的备份行为。MCP 重新连接会重写配置并验证新连接，Skills 重新连接会重新安装内置文件夹。MCP 和单项/全部 Skills 删除使用列出路径与受影响名称的确认对话框，初始焦点位于取消；结果分别显示已删除与待删除项，并明确提示宿主重新加载。路径可换行，忙碌时禁用操作，静态 Settings 图库展示这些控件。

- 使用共享的 `ActionRow` 将相关按钮集中在区域右侧，换行后仍右对齐。同一行有状态提示时，将其放在按钮之前。
- 每个 `SectionCard` 都有标题，标题栏支持键盘操作。折叠时保留单行标题和向右的箭头，上下内边距各为 16px。展开时箭头朝下，说明和内容恢复原有间距。相邻外层面板的垂直间距为 24px，嵌套面板之间为 16px。嵌套面板复用 `SectionCard`，各自独立展开和折叠，父面板关闭时保留子面板的内容和状态。校验时会展开包含无效字段的面板。
- 个人资料使用普通标题分组。资料条目和导入预览卡片可包含事实卡片，卡片最多嵌套两层。条目、事实、职位地点和要求的新增按钮使用虚线边框，与同组折叠卡片等宽、等高、同圆角，垂直间距也一致。
- 设置页各层级面板默认折叠，其他页面的内容面板默认展开。展开时使用 16px 圆角和 24px 内边距（窄屏为 16px）。包含嵌套卡片的面板在所有宽度下四周内边距均为 16px。设置页字段高 40px。页面 CSS 仅管理布局。成功反馈在中性表面使用语义文字。展示库设置示例复用共享面板样式。
- 导入页用中央状态组件展示读取和解析进度。失败后提供整次解析重试。定制简历复用 Profile 的字段、经历卡片和编辑 Dialog。编辑区使用普通标题，Bullet 卡片只嵌套在经历卡片内。手工简历的日期和链接使用文本输入框，日期上限为 200 字符，表述允许留空。条目对话框保留输入的文字，随后通过“保存并重新编译 PDF”提交。
- Profile 组合中央卡片、字段、忽略复选框、状态标记和对话框。基本信息和导入审核使用 `TextArea` 编辑可选个人简介（上限 2,000 字符），帮助文案说明 Agent 只能小修小补，Forms 图库包含示例。保存提交有效且未忽略内容；导入文本字段可以留空，格式错误在对应字段旁显示并聚焦。忽略父项排除子事实，部分导入保留已保存父项。[导入核对界面](../src/pages/profile/ImportReview.tsx)不按类型隐藏条目元数据字段；与手工编辑复用同一[事实字段](../src/app/profile-editor/ProfileFields.tsx)，仅含类别、内容和标签，不提供来源附件编辑框或详情行。窄屏标签换行，Forms 图库展示忽略状态。
- Settings 审计查看器组合中央 `DataTable`、`Badge`、`DetailsList` 和 `Dialog` 正文。表格单元格的上下内边距各为 8px。共享数据表格的单元格只显示首行，过长内容以省略号截断。申请和审计查看器可点击整行打开详情，也可用键盘激活首列，关闭弹窗后焦点返回该单元格。审计成功和失败分别使用绿色和红色文字。表格在页面内横向滚动。元数据弹窗在视口内滚动。Tables 展示库包含审计参考。
- Tailor Resume 使用中央字段、操作、StageProgress 和 DocumentPreview，分步展示资料复制、要点改写、校验、发布和输出。Agent Trace 使用紧接生成进度下方的独立中央 SectionCard，每次选择运行时默认折叠。Agent 关联后即显示卡片。展开后加载实时快照并流式接收文本和工具事件，轮询同步循环与请求诊断，折叠后停止订阅和轮询。详情复用 Ask 时间线样式。“复制诊断 JSON”读取最新生成状态、Artifact 输出元数据和 Agent 追踪，按钮显示复制成功，失败时可重试。Feedback 图库展示进度与追踪控件，PDF 排版由输出模板管理。
- 保留原生键盘激活、禁用行为和可见焦点。裸 `TextInput` 必须位于提供可见焦点反馈的容器中，参见 [AddressBar](../src/pages/browser/AddressBar.tsx)；其自身描边按设计被移除。
- Browser 的 Back/Forward、Alt 历史快捷键、右键拖动和触控板横向滑动仅操作网页历史；工作区导航保留浏览器状态及前进项。手势中内容和工具栏固定；中央 `historyIndicatorDocument` 组件在对应边缘的 64px 透明原生浮层中显示 48px 圆形箭头，边距为 8px。可用箭头使用 text/surface Token，达到触发距离后使用 primary/on-primary，不可用方向使用 muted/panel-solid；短距离或取消手势立即隐藏箭头，无位移或动画；成功的历史导航和刷新使用纯中性的 `--browser-transition-bg`（亮色和暗色均为 #303030）遮罩，目标帧就绪后直接显示。Browser 工作区/底层画布使用独立的 `--browser-canvas-bg`（亮色 #e5e5e5 / 暗色 #303030）。刷新位于 Forward 右侧，也出现在 Browser/Inbox 原生菜单；普通右键点击保留原生菜单，网页滚动优先。箭头和手势尺寸由现有尺寸/间距 Token 生成。新标签打开空白 Browser 工作区，标签名称使用浏览器标题。标签选择、键盘焦点和选中状态保持一致；键盘处理归 [TabStrip](../src/pages/browser/TabStrip.tsx)。通过适当文字/角色宣布错误，长文本保持可读，不隐藏完整含义。
- Browser 在地址输入框右侧放置共享复制图标按钮。空白、加载中或加载失败的网页禁用“复制网页文本”。工具栏和原生右键菜单均在成功时于工具栏显示“已复制”，失败时显示错误提示。[Browser 控件](../src/pages/browser/BrowserControls.tsx)
- 区分加载、空状态、成功与错误。不得让参考示例看起来像已实现操作；页面文案归属 [i18n 资源](../src/shared/i18n/locales/en.ts)。
- 遵循减少动态效果偏好，检查窄屏换行、裁剪和滚动。运行时动效规则位于[中央样式](../src/shared/ui/components.css)和[浏览器样式](../src/renderer/styles/global.css)。

对比度、屏幕阅读器表现、放大文字和完整键盘覆盖仍需人工审查，当前静态检查不能证明这些方面。

### Ask AI V2 对话

[对话基础组件](../src/shared/ui/Conversation.tsx)管理 ChatMessage、Collapsible、ActivityRow、SessionEntry、Drawer 和 ComposerSurface；[Markdown](../src/shared/ui/Markdown.tsx)渲染安全子集，HTML 转义、链接仅限 HTTP(S)，支持复制代码及代码/表格局部滚动。全部从中央入口导出，Feedback 图库包含静态对话参考。

常驻应用图标栏保持 64px。会话列表使用 `--chat-sidebar-width`（256px），低于 960px 改为模态抽屉；内容列使用 `--chat-content-width`（768px）。Ask AI 不显示顶部栏或角色/模型消息卡片。用户消息使用中性气泡，圆角依次为 16px / 16px / 0 / 16px；助手正文直接排版。输入容器圆角为 8px。底部输入区在发送/停止旁以同一行放置紧凑模型选择器，窄屏时收缩选择器；空会话居中显示介绍和输入区。ComposerSurface 聚焦时保持中性边界与静态边界阴影，内部文本框不显示聚焦轮廓或光晕；模型选择器与操作按钮保留各自的焦点提示。

返回的推理正文与摘要分别标注，展示来源/状态/耗时并支持全文复制；加密块明确标记没有可读文本。推理在流式期间展开，完成后折叠，尊重用户手动选择。未返回推理时显示处理中。工具行保留简短摘要，详情默认折叠，包含调用 ID/名称、状态、耗时、脱敏后的完整参数/结果及固定错误码。共享 CodeBlock 支持复制、JSON 局部滚动及推理文本换行；写入结果不确定时明确要求核对当前状态。停止后保留已完成写入；删除要求会话空闲并确认，尝试过写入的 Run 不提供自动重试。

Enter 发送、Shift+Enter 换行，输入法组合期间不发送。运行中允许发送到可靠 Pending 队列，同时保留停止操作；切换会话恢复草稿和滚动位置。靠近底部时跟随输出，向上滚动后保留位置并提供跳转最新；加载旧 Item 保留视口。控件支持键盘焦点，抽屉支持 Escape/焦点约束，遵循减少动画设置并仅播报简短状态，不逐 token 播报。

[会话操作](../src/pages/ai/SessionSidebar.tsx)顺序为重命名 → 复制调试 JSON → 删除。复制复用中央 Dialog/Button/CopyButton/StatusMessage，展示完整敏感数据警告，初始聚焦取消，并提供复制 JSON；不加复选框或展示 Token。打开、取消及 Escape 不复制。每次确认固定目标 Session（包括运行中的 Session），阻止重复提交；成功后保留弹窗，原 CopyButton 切换为“已复制到剪贴板”并保持禁用，关闭弹窗后才可重新确认复制；会话列表下方不显示成功提示。失败保留错误/重试弹窗。Overlays 画廊包含警告示例；完整数据留在 Main。

沿用 StatusMessage 展示 Pending、同步上下文压缩及工具搜索/激活。Memory 读写使用普通工具时间线行，不显示后台 Memory 状态或重试操作。仅有 Run 运行时 Session 才繁忙。设置中的上下文和输出上限供 Ask 使用。不提供 Ask Memory 模式开关或 Memory 控制台。

[工具详情](../src/app/components/AgentTimelineItem.tsx)组合现有 DetailsList 和 Collapsible，显示 Chat Run ID/最终状态、Guard 调用/派发/拦截计数、已确认操作及本地化停止原因。可选告警/恢复和下一步行说明策略切换，不改变工具成功状态。执行前拒绝标为“未执行”，成功及不确定结果保留各自状态。Feedback 图库包含这些区别，Token 和几何保持不变。

### 浏览器选区输入

浏览器业务操作使用 Electron 原生菜单，不新增应用样式右键菜单或 Token。Ask 和 Add Job 使用现有 StatusMessage/Button 展示交接失败及重试。Add Job 在普通文本输入旁通过 StatusMessage 展示来源标题/网址；内容可编辑，解析/保存仍由用户明确触发。Ask 保留已有草稿，将来源和引用文本追加至新对话输入框。Forms Gallery 包含来源/输入/重试参考。窄屏下来源文本在页面内换行，原生菜单标签随应用语言切换。交接不新增确认或权限流程。

### 全局通知

[原生通知组件](../src/shared/ui/Banner.ts) 使用共享的 368px 宽度、80px 高度和 16px 窗口边距。标题和详情各占一行，超出时在行尾省略。正文操作和关闭按钮分别响应点击。显示通知时保留字段焦点。每次接受更新后重新计时五秒。关闭后只有更晚的新事件能再次显示。

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
| [Browser smoke](../scripts/browser-smoke.cjs) | Ask AI 启动、侧栏切换及渲染浏览器栏与原生边界衔接 | 不属于完整展示库、无障碍或视觉回归测试 |
| [Inbox smoke](../scripts/inbox-smoke.cjs) | 全内容区原生边界、无应用浏览器栏、缩放、重定向、历史和加载恢复 | 使用本地测试页，不证明邮箱网站自身行为 |
| [侧栏 smoke](../scripts/sidebar-smoke.cjs) | 全部目标、当前状态、键盘激活、固定图标栏宽度、提示位置及关闭行为、原生视图不遮挡导航 | 不证明全部辅助技术行为 |
| [AI smoke](../scripts/ai-smoke.cjs) | Provider endpoint/超时表单、复用中央控件的模型检测/选择、真实 SSE/IPC、取消及 320/640/1200px 溢出检查 | 本地服务不证明第三方服务商行为 |
| [Ask AI smoke](../scripts/ask-ai-runtime-smoke.cjs) | 流式活动、并发会话、定向停止、草稿/滚动恢复、双语主题的 320/640/1200px 布局及强制结束进程后的恢复 | 本地样本，不证明真实 Provider 或屏幕阅读器兼容性 |
| [审计查看器 smoke](../scripts/audit-viewer-smoke.cjs) | 筛选、分页、元数据弹窗、键盘关闭、320/640/1200px 页面无溢出及只读/错误/加载状态 | 不认证读屏或并发写入时跨页快照一致性 |
| [个人资料 smoke](../scripts/profile-smoke.cjs) | 手动条目/事实、构建后的 PDF Worker/SSE、显式保存/忽略、分批保存、重载/分页、320/640/1200px 双语浅/暗布局及离开保护 | 使用生成 PDF/本地 AI 样本，不认证第三方 Provider、任意 PDF 排版或读屏器 |
| [Settings smoke](../scripts/settings-smoke.cjs) | 默认折叠、键盘操作、嵌套面板、草稿保留、真实表单、标签、40px 控件、16px 面板、320/640/1200px 布局、语言、校验和密钥生命周期 | 不证明读屏行为或服务商访问能力 |
| [主题 smoke](../scripts/theme-smoke.cjs)及[重启 smoke](../scripts/settings-restart-smoke.cjs) | 草稿/保存/失败/放弃、模拟原生外观变化、导航/原生边界不变、320/640/1200px 的 Settings 与 Ask AI 尺寸、展示库全部元素尺寸和持久化暗色启动 | 独立主题测试使用持久化配置；不覆盖首次写入的脏状态归一化、真实系统设置、全部视觉状态或无闪屏启动 |

原生边界通过[浏览器契约](../src/shared/browser.ts)使用[生成尺寸](../src/shared/ui/geometry.ts)，不得分别修改 CSS 与 Main 的工具栏高度。[构建配置](../electron.vite.config.ts)选择 Renderer 入口，脚本和命令以 [package.json](../package.json) 为准。

## 七、相关文档

- [设计纲要](../DESIGN.zh-CN.md)：视觉方向与设计入口。
- [当前架构](architecture.zh-CN.md)：已实现行为与限制。
- [代码架构](code-architecture.zh-CN.md)：依赖边界与页面归属。
- [产品架构](product-architecture.zh-CN.md)：示例代表的规划业务流程。

## 智能笔记知识库

中央 [MarkdownEditor](../src/shared/ui/MarkdownEditor.tsx)、[ExplorerRow/ResizableExplorer](../src/shared/ui/KnowledgeControls.tsx) 与 [Markdown](../src/shared/ui/Markdown.tsx)提供 CodeMirror、可访问树节点、宽度调整和安全 AST 渲染。HTML 保持文本，不加载远程图片。复用现有 Token 和主题，不新增几何 Token。

智能笔记在工作区导航中使用共享的 `notebook` [Glyph](../src/shared/ui/Glyph.tsx)，以笔记本搭配星芒。资源管理器分割线使用 `--border-width`（1px）和 `--line`，并保留不可见的 `--space-1`（8px）拖拽热区；键盘调整宽度和焦点样式仍然可用。

知识库设置组合中央 Checkbox、DetailsList、Progress、Button、Dialog 和 StatusMessage，提供可选本地语义检索。安装状态、模型维度/存储、下载/修复/校验、进度/取消和删除独立于已保存的语义偏好。删除确认说明笔记/备份/索引保留且禁用自动 Seed 导入，默认聚焦取消。生成式 AI 配置保持独立。Token/几何不变；设置图库包含模型操作和共享进度示例。

Memory v1 复用当前页面和编辑器：中央 `brain` 图标标识固定置顶且默认折叠的特殊根节点。[ExplorerRow](../src/shared/ui/KnowledgeControls.tsx)拥有选中/焦点/展开与键盘激活，页面 CSS 只负责布局。根节点禁用重命名/删除，内部目录在所属空间使用普通操作。选择前先 Flush，失败时保留原选择与草稿；同名 README 的编辑器/保存状态独立。搜索/历史跟随所选空间，恢复说明目标空间，同步说明整个仓库。首次或更换 Remote 的确认说明记忆及 Git 历史上传，默认聚焦取消，取消不影响本地使用。图库展示折叠根节点与说明，既有 Token、几何与主题不变。[Memory UI smoke](../scripts/memory-ui-smoke.cjs)检查延迟保存/搜索、Flush 失败、根节点保护及取消同步；完整辅助技术覆盖仍未验证。
