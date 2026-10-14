# 当前运行架构

用途：记录已验证的运行行为。状态：React 应用组装、九个可访问入口、每标签混合导航、浏览器基础、Settings、兼容 OpenAI 的 SSE 对话及业务存储**已实现**。业务流程与编译仍为**规划**；其余业务页面 UI 为**占位**。

语言：简体中文 · [English](architecture.md)

## 一、运行入口与进程边界

[构建配置](../electron.vite.config.ts) 使用 [Main](../src/platform/electron/main/index.ts)、[Preload](../src/platform/electron/preload/index.ts) 和 [Renderer HTML 入口](../src/renderer/index.html)。[包入口](../package.json) 保持 `out/main/index.js`。

```text
React App → Page → Preload → IPC → Main
                                  ├── Mixed history + WebContentsView → Session
                                  ├── Domain services → SQLite + audit
                                  └── AI service → Provider SSE
```

[Renderer 启动代码](../src/renderer/main.tsx) 在 StrictMode 中挂载唯一 [App](../src/app/App.tsx)。[Provider](../src/app/providers.tsx) 注入受限浏览器/数据/AI 桥接和上下文；[导航 store](../src/app/navigation/navigationStore.ts) 在每次 Provider 生命周期中订阅一次，忽略旧快照及已清理的初始化读取。[路由](../src/app/router.tsx) 根据 Main 的当前目标选择 React 页面，不导航可信文档。

只有 [BrowserPage](../src/pages/browser/BrowserPage.tsx) 渲染标签、地址输入与浏览器控件。Home 和业务页面不显示浏览器栏或内部 URL。[HomeGrid](../src/pages/home/HomeGrid.tsx) 启用全部九个卡片。[Settings](../src/pages/settings/SettingsPage.tsx) 实现本地偏好和加密密钥管理。[Inbox](../src/pages/inbox/InboxPage.tsx) 管理全内容区网页邮箱视图、配置引导和加载恢复。[Ask AI](../src/pages/ai/AskAIPage.tsx) 已实现流式对话，其余五个功能入口仍为占位。

## 二、路由与混合历史

[目标契约](../src/shared/navigation.ts) 白名单包含 `app://home`、`app://find`、`app://resume`、`app://interview`、`app://applications`、`app://inbox`、`app://profile`、`app://browser`、`app://ai` 和 `app://settings`。内部 URL 是导航标识，不是已注册的操作系统协议或 Chromium 加载的文档。未知内部目标在修改历史前拒绝。公开 URL 由[产品架构](product-architecture.zh-CN.md)管理。

[BrowserManager](../src/platform/browser/browserManager.ts) 管理标签、当前目标及版本化快照。每个标签从 Home 开始。Home 新增内部历史项；新建或关闭最后一个标签后创建新的 Home。选择 Browser 新增空白浏览器工作区，地址框为空。切换标签不新增历史；关闭活动标签选择右侧邻居，无右侧时选择左侧。

[MixedHistory](../src/platform/browser/mixedHistory.ts) 将内部历史项与连续网页历史段组合。每个 [WebSegment](../src/platform/browser/webSegment.ts) 保留自己的原生视图与 Chromium 历史。Back/Forward 先遍历段内原生索引，再跨越内部项/网页段。进入内部页面只隐藏现有视图，不导航或销毁它，直接返回时保留当前网页状态。正常 Chromium 历史回放可能重新加载较早文档。

后退后发起新导航会裁剪应用前进栈和当前段的原生前进项。不可达段被关闭；关闭标签/窗口释放全部保留视图。网站链接、重定向和 SPA 导航更新原生历史，历史回放及替换不新增应用项。重复 URL 保留原生项身份。私有 [Chromium 历史观察器](../src/platform/browser/nativeHistory.ts)通过内部调试协议读取稳定项 ID，区分新访问与网站自身的历史回放，不注入页面脚本或暴露调试桥接。加载/错误事件归属原段，不会激活后台标签或内部页面。

[网页输入解析](../src/platform/browser/navigationManager.ts) 保留 HTTP(S)，识别域名/IP/localhost，其他输入使用 Google 搜索。裸地址默认 HTTPS，localhost 和回环地址默认 HTTP。空输入、无效显式网址及其他协议被拒绝。[测试](../tests/navigation.test.ts) 保留这些规则；[混合历史测试](../tests/mixed-history.test.ts) 覆盖内部路由与段间回放/分叉。

## 三、展示与交互

[WorkspaceSidebar](../src/app/WorkspaceSidebar.tsx) 常驻每个页面左侧，提供主页、九个功能、翻译后的分组及唯一当前状态。共享[功能元数据](../src/app/navigation/features.ts)管理侧栏及 Home 的图标/顺序。切换功能使用相同导航 API 和未保存设置保护；点击当前功能不新增历史。[HomePage](../src/pages/home/HomePage.tsx) 显示功能入口，不显示 Back 按钮。其他业务页面的页面导航只提供回到主页按钮，不显示跨页面 Back/Next/Forward 控件。占位页面通过[占位布局](../src/shared/ui/PlaceholderPage.tsx)的 actions 插槽提供自己的按钮和处理函数，布局不定义导航行为。[Browser 控件](../src/pages/browser/BrowserControls.tsx)保留 Home、Back 和 Forward。按钮归属规范见[代码架构](code-architecture.zh-CN.md#页面按钮归属)。

**已实现：**页面控件/卡片/图标引用[中央 UI 组件](../src/shared/ui/index.ts)，由[中央运行样式](../src/shared/ui/components.css)提供外观；页面行为仍由页面管理。[共享 Tokens](../src/shared/ui/design-tokens.json)为 [Home](../src/pages/home/home.css) 和[应用样式](../src/renderer/styles/global.css)提供 8px 间距、组件尺寸、排版和语义色。[设计规范](design-system.zh-CN.md)管理这些规则和十个分类的 HTML 参考展示库；展示示例不代表业务功能已实现。

只有活动网页段可见。Browser 网页段位于 48px 标签栏和 48px 工具栏（总计 96px，来自[共享尺寸](../src/shared/ui/geometry.ts)）下方；Inbox 网页段从 `y = 0` 开始使用整个内容区高度，不显示应用标签、地址控件或顶部条。两种原生视图均位于侧栏右侧，使用[生成尺寸](../src/shared/ui/geometry.ts)：窗口宽度超过 960px 时为 208px，否则为 64px。[生成的响应式 CSS](../src/shared/ui/sidebar-responsive.css)使用相同 Tokens，确保侧栏控件不会被原生视图遮挡。侧栏主页入口替代邮箱退出区域。[WebSegment](../src/platform/browser/webSegment.ts) 在重定向、原生导航和弹窗中保留所属视图；Browser 与 Inbox 切换创建独立网页段。边界随窗口调整。目标切换先隐藏全部原生视图，直到所属页面通过[原生展示](../src/app/navigation/useNativePresentation.ts)确认标签/目标。过期可见性请求被忽略。Renderer 重载期间隐藏视图，Provider 重新订阅后恢复 Main 的目标/历史，不将标签重置为 Home。

[TabStrip](../src/pages/browser/TabStrip.tsx) 支持新建、选择、关闭、滚动及方向键/Home/End 选择。内部目标以页面标题作为标签名称，不渲染 `app://` 文本。[AddressBar](../src/pages/browser/AddressBar.tsx) 在空闲时跟随状态，聚焦时保留编辑草稿；切换标签会重置输入。

[快捷键](../src/platform/browser/shortcuts.ts) 在可信 Renderer 和原生网页中生效：macOS 的 `Cmd+T/W` 或其他平台的 `Ctrl+T/W` 新建/关闭标签；`Ctrl+Tab` 和 `Ctrl+Shift+Tab` 切换标签。`Cmd+L`/`Ctrl+L` 仅在 Browser 聚焦并选择地址。`Alt+Left/Right` 遍历混合历史，也适用于没有浏览器栏的内部页面。

[Settings hook](../src/pages/settings/useSettings.ts) 管理独立草稿及保存反馈。Main 在导航、历史遍历、标签切换/关闭及窗口关闭前确认放弃未保存设置；通过标签/目标标识忽略过期草稿登记。已配置的 `app://inbox` 在写入历史前解析为带 Inbox 视图标识的 HTTPS 网页邮箱地址；未配置时显示设置引导。邮箱加载失败时隐藏原生视图，显示页面管理的重试/设置操作。存储语义由[数据架构](data-architecture.zh-CN.md#六配置密钥与待完成工作)管理。

**已实现审计查看器：**[Settings 审计区块](../src/pages/settings/AuditViewerSection.tsx)通过[查看器 hook](../src/pages/settings/useAuditViewer.ts)独立于偏好表单加载，提供每页 25 条、显式筛选/刷新、元数据详情、空状态/错误/重试，并丢弃过期响应。筛选仅在页面内存中保留，不标记偏好为未保存。读取语义与审计范围归属[数据架构](data-architecture.zh-CN.md#四审计与事务)。

**已实现主题：**Settings 通过现有中央 `Select` 提供浅色、暗夜及跟随系统。主题与语言属于通用设置草稿：成功写入后点击保存生效；保存失败及放弃草稿保留当前主题。默认仍为浅色，偏好存储语义归属[数据架构](data-architecture.zh-CN.md#六配置密钥与待完成工作)。

[Main](../src/platform/electron/main/index.ts) 在创建窗口前应用保存的主题。[主题适配](../src/platform/electron/main/theme.ts)设置 Electron `nativeTheme.themeSource`；[BrowserManager](../src/platform/browser/browserManager.ts) 在原生外观变化时发布实际 `BrowserState.theme`，不改变导航目标/历史。[App ThemeProvider](../src/app/theme.tsx) 在 React 绘制更新前应用根节点主题，生成 CSS 在首个快照到达前使用原生颜色偏好。[窗口](../src/platform/electron/main/window.ts)及保留的 [WebSegments](../src/platform/browser/webSegment.ts)使用生成的主题背景；窗口持有一个监听，更新全部保留视图，并在窗口释放时清理。重新创建的窗口继承当前原生主题。

跟随系统响应原生外观变化；明确选择浅色/暗夜时覆盖系统。Browser/Inbox 远程文档接收 Chromium 颜色偏好，外观由网站自身控制，不注入强制改色。主题样式只修改颜色，规则由[设计规范](design-system.zh-CN.md#四语义色规则)管理。[独立主题运行器](../scripts/theme-runtime-smoke.cjs) 验证这些行为，包括 macOS 窗口重建；命令仍归属 README。启动背景匹配减少闪屏；完整逐帧验证和 Windows/Linux 的原生外观检查仍未验证。

[App Context](../src/app/context/appContext.ts) 提供当前页面的标签/标题/目标及可空 Job、Profile、Artifact ID。[引用 store](../src/app/context/contextStore.ts) 初始为空，不复制实体、提取网页内容或自动选择业务记录。

**已实现 AI：**[Main 服务](../src/platform/ai/service.ts)在创建请求时固定所选 Provider、模型和凭据。[兼容适配器](../src/platform/ai/compatible.ts)在配置的 Base URL 下调用 Chat Completions 并消费 SSE，拒绝重定向。远程地址必须使用 HTTPS；回环 HTTP 支持本地服务。尚未实现自动重试、跨 Provider 回退、工具、结构化输出能力探测或模型发现。

[AI IPC](../src/platform/electron/main/ai-ipc.ts)只暴露启动/取消，事件只返回发起请求的可信 frame。[Renderer 协调](../src/app/ai/streamClient.ts)先订阅再调用，缓存早到事件，并在终态或页面释放时移除订阅。服务限制请求数量及上下文/输出大小，设置 120 秒总超时，并在 Renderer 导航/销毁或应用退出时取消请求。Provider SSE 保留在 Main，界面使用增量 IPC。

[对话](../src/pages/ai/useChat.ts)继承已保存默认值，可覆盖 Provider/模型，并展示完成、失败或停止状态。新对话清空消息；离开页面取消请求并清除仅存内存的历史。切换模型后已有消息保留响应模型标签。[AI 设置](../src/pages/settings/AISettingsSection.tsx)管理 Provider 实例、手填模型 ID，以及显式发起的短流式连接测试。自动 Job/Profile/网页上下文和业务生成仍为规划。审计和凭据持久化归属[数据架构](data-architecture.zh-CN.md)。

## 四、会话、安全与存储

远程视图共享 `persist:job-agent-browser`，网站存储跨重启保留。权限请求被拒绝；没有多资料选择器。

- [可信窗口](../src/platform/electron/main/window.ts)和[远程视图](../src/platform/browser/webSegment.ts)禁用 Node 集成，启用上下文隔离和沙盒；远程网页安全检查保持启用。
- 浏览器、数据及 AI IPC 要求自有可信文档及顶层 frame，并校验输入。[Preload](../src/platform/electron/preload/index.ts) 只暴露命名操作，不暴露原始 `ipcRenderer`。
- 远程主 frame 导航/重定向只允许 HTTP(S)。HTTP(S) 弹窗新建应用标签；原生弹窗和其他协议被拒绝。远程页面不能进入内部路由或访问浏览器/数据桥接。
- [可信 HTML](../src/renderer/index.html) 保持 CSP。可信 UI 外部链接通过窗口创建逻辑使用操作系统浏览器。

Main 在创建窗口前打开存储并注册数据处理器，退出时关闭存储，启动失败时报告错误且不重置数据。[后端组装](../src/platform/database/backend.ts) 注入 Repository/事务并恢复中断生成任务。[数据架构](data-architecture.zh-CN.md)管理已实现的 SQLite、业务校验、持久化及不含内容的审计。

## 五、国际化

**已实现：**英文与[简体中文资源](../src/shared/i18n/locales/zh-CN.ts)支持保存语言选择。[英文资源](../src/shared/i18n/locales/en.ts)集中管理应用自有的页面文案、内部标题、提示气泡、无障碍标签、错误及原生启动对话框。[共享初始化](../src/shared/i18n/index.ts)通过打包资源在各进程分别创建 i18next 实例，同步初始化，默认及回退语言均为英文。不请求网络翻译资源，也不检测系统语言。

[App 翻译 Provider](../src/app/i18n.tsx)向 `useTranslation()` 提供同一个 Renderer 实例，并更新文档标题和语言。非 React 代码使用共享 `t` 函数；[Main](../src/platform/electron/main/index.ts)可在 React 启动前取词。[构建配置](../electron.vite.config.ts)从与原生窗口共用的英文资源注入 HTML 标题。完整句子模板插入标签/标题，React 将结果作为文本渲染。用户数据、网站标题/内容及仅用于诊断的异常不进入文案资源。Main 在创建窗口前加载保存的语言，通过浏览器快照发布；Renderer 的 Provider 跟随该语言。新的浏览器标题/错误使用当前语言；之前已捕获的错误文字不重新翻译。

**规划：**更多语言及系统语言检测。[翻译测试](../tests/i18n.test.ts)覆盖启动取词、回退、实例隔离、React 资源使用、插值安全及无效键的类型检查。

## 六、验证与限制

[审计查看器 smoke](../scripts/audit-viewer-smoke.cjs)验证生产 IPC、筛选/分页/详情、只读语义、加载/失败/空状态、过期响应拒绝、键盘关闭及 320/640/1200px 布局；[查看器测试](../tests/audit-viewer.test.ts)覆盖 ID/时间校验、夏令时转换、包含边界的范围及筛选分页。[AI 测试](../tests/ai.test.ts)和[AI smoke](../scripts/ai-smoke.cjs)验证本地兼容 SSE、仅启动审计、取消、Provider 配置及真实 IPC。[集成测试](../tests/audit.test.ts) 验证存储/隐私保证；[导航 store 测试](../tests/navigation-store.test.ts) 覆盖订阅顺序与 StrictMode 清理。[Electron smoke](../scripts/smoke.cjs) 验证构建后的 Main/Preload、IPC 和来源拒绝。[浏览器 smoke](../scripts/browser-smoke.cjs) 覆盖标签、边界、快捷键、隔离与失败；[导航 smoke](../scripts/navigation-smoke.cjs) 覆盖功能入口 UI、混合回放、分叉/释放、SPA/重复历史、重载、过期可见性和加载竞争。[主题 smoke](../scripts/theme-smoke.cjs) 验证仅颜色的尺寸一致性、保存/草稿主题、原生变化和导航不变。[设置 smoke](../scripts/settings-smoke.cjs) 验证真实表单、双语重载、响应式尺寸、校验、离开确认、Inbox 导航和加密密钥生命周期；[重启 smoke](../scripts/settings-restart-smoke.cjs) 验证新的生产进程恢复设置。[Inbox smoke](../scripts/inbox-smoke.cjs) 使用本地测试页验证无顶部偏移的原生边界、无应用顶部条、重定向/历史/重载/弹窗、草稿保留、缩放、隔离和加载恢复。[侧栏 smoke](../scripts/sidebar-smoke.cjs)验证全部目标、当前状态、键盘激活、响应式尺寸及矮窗口可访问性。[窗口关闭 smoke](../scripts/window-close-smoke.cjs) 验证自有窗口关闭后释放保留视图。命令见 README 索引。

标签历史和上下文引用仅存于内存。网页段通过分叉或关闭标签/窗口释放；自动淘汰和跨重启恢复尚未实现。业务流程、网页提取、AI 业务生成、编译、完整 Shared Context 捕获、安装包仍未实现。

## 七、相关文档

- [README](../README.zh-CN.md)：启动、验证和文档索引。
- [产品架构](product-architecture.zh-CN.md)：产品规则和规划交付顺序。
- [代码架构](code-architecture.zh-CN.md)：源码职责和依赖边界。
- [V1 数据架构与 API](data-architecture.zh-CN.md)：持久化与业务接口。
