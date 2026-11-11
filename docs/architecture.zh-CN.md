# 当前运行架构

用途：记录已验证的运行行为。状态：React 组装、工作区/浏览器分离导航、设置、个人资料编辑/PDF 导入、职位采集/申请 Agent、统一 Agent 运行时及包含 HTML/PDF 的 Resume V3 均**已实现**。智能笔记已实现，更多产品流程仍为**规划**。

语言：简体中文 · [English](architecture.md)

## 一、运行入口与进程边界

[构建配置](../electron.vite.config.ts) 使用 [Main](../src/platform/electron/main/index.ts)、[Preload](../src/platform/electron/preload/index.ts)、隔离的 [Browser 手势 Preload](../src/platform/electron/preload/browser-gestures.ts) 和 [Renderer HTML 入口](../src/renderer/index.html)。[包入口](../package.json) 保持 `out/main/index.js`。

```text
React App → Page → Preload → IPC → Main
                                  ├── Tab navigation + WebContentsView → Session
                                  ├── Domain services → SQLite + Consola
                                  ├── AI service → Provider SSE
                                  └── MCP Client → stdio Server → ToolScope → capability → Domain
```

[Renderer 启动代码](../src/renderer/main.tsx) 在 StrictMode 中挂载唯一 [App](../src/app/App.tsx)。[Provider](../src/app/providers.tsx) 注入受限浏览器/数据/AI 桥接和上下文；[导航 store](../src/app/navigation/navigationStore.ts) 在每次 Provider 生命周期中订阅一次，忽略旧快照及已清理的初始化读取。[路由](../src/app/router.tsx) 根据 Main 的当前目标选择 React 页面，不导航可信文档。

只有 [BrowserPage](../src/pages/browser/BrowserPage.tsx) 渲染标签、地址输入与浏览器控件。其他工作区页面隐藏浏览器栏和内部 URL。[Settings](../src/pages/settings/SettingsPage.tsx) 实现本地偏好和加密密钥管理。[Inbox](../src/pages/inbox/InboxPage.tsx) 管理全内容区网页邮箱视图、配置引导和加载恢复。[Ask AI](../src/pages/ai/AskAIPage.tsx) 已实现持久化多会话流式 Agent。[My Profile](../src/pages/profile/ProfilePage.tsx) 实现手动编辑及经核对的 PDF 导入，新增工作及申请记录基础列表已实现，定制简历已实现；智能笔记已实现。

[OnboardingGate](../src/app/onboarding.tsx) 在 `onboardingCompleted` 缺失/为 false 时先展示[初始化向导](../src/pages/onboarding/OnboardingPage.tsx)，并隐藏原生网页表面。保留参考的步骤布局、可选模型/Agent 路径、返回和跳过。模型发现/测试、MCP/Skills 和资料保存复用现有桥接。选择 PDF 后点击“导入”进行解析，结构化 Review 保持临时状态，人工确认时原子保存整份履历和快照。手动填写需要姓名；求职方向使用带 `target-role` 标签的 `OTHER` 事实。

“进入 JAB”持久化完成状态。Settings 可重新初始化且不删除数据，有未保存修改时禁用入口。未保存的草稿和步骤位置不跨重载保留。[初始化冒烟测试](../scripts/onboarding-runtime-smoke.cjs) 覆盖本地模型调用、资料持久化、双语主题、响应式尺寸及已完成/未完成的进程重启；真实服务商和外部 Agent 客户端仍未验证。

## 二、工作区路由与浏览器历史

[目标契约](../src/shared/navigation.ts) 白名单包含 `app://find`、`app://resume`、`app://knowledge`、`app://applications`、`app://inbox`、`app://profile`、`app://browser`、`app://ai` 和 `app://settings`。内部 URL 是导航标识，不是已注册的操作系统协议或 Chromium 加载的文档。未知内部目标在修改历史前拒绝。公开 URL 由[产品架构](product-architecture.zh-CN.md)管理。

[BrowserManager](../src/platform/browser/browserManager.ts) 管理标签、当前目标及版本化快照。底层启动目标为 Ask AI（`app://ai`）；新建或关闭最后一个标签后打开空白 Browser 工作区。选择 Browser 恢复保留的网页或空白工作区。在 Browser 切换标签始终停留在 Browser，即使目标标签上次显示业务页面。关闭活动标签选择右侧邻居，无右侧时选择左侧。

[TabNavigation](../src/platform/browser/tabNavigation.ts) 将当前工作区目标与保留的 Browser、Inbox 视图分离。每个 [WebSegment](../src/platform/browser/webSegment.ts) 保留原生视图与 Chromium 历史。Back/Forward 只操作当前 Browser 视图，在首项/末项停止。工作区页面和 Inbox 将两个控件标记为不可用并忽略历史请求。访问工作区页面保留浏览器位置、前进项及当前网页状态；Chromium 历史回放可能重新加载较早文档。

后退后打开新网址会裁剪该视图的原生前进项；切换工作区页面不会裁剪。每个标签最多保留一个 Browser 和一个 Inbox 视图；关闭标签/窗口时释放两者。网站链接、重定向和 SPA 导航更新原生历史，历史回放及替换不新增应用项。重复 URL 保留原生项身份。私有 [Chromium 历史观察器](../src/platform/browser/nativeHistory.ts)通过内部调试协议读取稳定项 ID，区分新访问与网站自身的历史回放，不注入页面脚本或暴露调试桥接。加载/错误事件归属原段，不会激活后台标签或内部页面。

[网页输入解析](../src/platform/browser/navigationManager.ts) 保留 HTTP(S)，识别域名/IP/localhost，其他输入使用 Google 搜索。裸地址默认 HTTPS，localhost 和回环地址默认 HTTP。空输入、无效显式网址及其他协议被拒绝。[测试](../tests/navigation.test.ts) 保留这些规则；[标签导航测试](../tests/tab-navigation.test.ts) 覆盖工作区隔离、前进历史保留、Inbox 分离及原生历史边界。

### 复制网页文本

**已实现。** Browser 工具栏和原生右键菜单在触发时复制当前活动 Browser 网页。工具栏调用通过[可信 Renderer IPC](../src/platform/electron/main/browser-ipc.ts)。[WebSegment](../src/platform/browser/webSegment.ts) 在隔离环境解析主文档的实时 HTML 快照，将整理后的 `<body>` 文本写入系统剪贴板。保留隐藏文本，排除脚本、样式、嵌入 Frame 和 Shadow DOM 的内容。空白标签页、加载失败和空结果均保留原剪贴板。[Electron Smoke](../scripts/browser-copy-smoke.cjs) 覆盖两个入口、标签切换、网页复制限制、动态文本和空结果。

### 网页选区交接

**已实现：**[WebSegment](../src/platform/browser/webSegment.ts) 为普通 Browser 选区（包括 Frame）提供原生右键菜单，并保留原生编辑操作。Inbox、表单控件和可编辑区域不显示业务入口。点击时重新校验活动标签页/目标、源文档导航代次和存活 Frame；重载、导航或切换标签页会使旧菜单失效。[选区校验](../src/shared/browser-selection.ts) 保留最多 60,000 个 UTF-16 单元的原文，限制网址/标题长度，并净化来源网址的凭据、片段及已知认证查询参数。来源统一使用顶层网址和标题。

[BrowserManager](../src/platform/browser/browserManager.ts) 在发布当前标签页的内部目标前，写入 UUID 绑定的[内存交接](../src/platform/browser/selectionHandoff.ts)。可信主 Frame IPC 按标签页/目标/页面读取，输入状态提交后 ACK。五分钟内可重试；离开目标、关闭标签页及退出时清理。内容不进入网址、BrowserState、日志。[消费逻辑](../src/app/navigation/useWebSelection.ts) 忽略过期/卸载后的返回并防止重复填入。Ask 追加到未发送的新对话草稿，不覆盖会话草稿或启动 Run；进行中的发送不会抢回该草稿。Add Job 切至文本，等待用户解析/保存。交接等同用户输入，后续沿用普通持久化和导出规则。来源保存由[数据架构](data-architecture.zh-CN.md#二业务规则)说明。

现有 `persist:job-agent-browser` Session 继续在原生视图间共享。[选区 Smoke](../scripts/browser-selection-smoke.cjs) 覆盖真实右键事件、Frame、来源保存、显式 AI 操作、登录复用/过期/退出；[重启 Smoke](../scripts/settings-restart-smoke.cjs) 在新的生产进程中通过同一本地来源验证持久 Cookie 和 localStorage。JAB 不续期已过期的网站会话；真实提供方的登录兼容性仍未经验证。

### 智能粘贴与全局通知

**已实现：** Browser 和 Inbox 的原生右键菜单可在受支持的文本字段中选择已保存的智能粘贴提示词，覆盖同源和跨源 HTTP(S) frame。[隔离 preload](../src/platform/electron/preload/web-field.ts) 锁定实际元素与选区。[宿主任务](../src/platform/smart-paste/service.ts) 使用已保存的默认模型创建后台 Ask AI 会话，并将助手文本流式写入该范围。工具轮的临时文本会撤回。失败和取消保留已写入的部分回答。用户编辑、字段被替换或 frame 导航时停止写入。切换工作区页面时，仍存活的目标可继续写入。网页接收 input 事件并自行管理表单。[智能粘贴 smoke](../scripts/smart-paste-smoke.cjs)可通过 `npm run test:smoke -- --smart-paste` 单独运行。

[Main 通知](../src/platform/banner/bannerView.ts) 使用一个 View，置于原生网页视图上方，并经导航守卫打开关联的 Ask AI 会话。[数据架构](data-architecture.zh-CN.md) 说明设置与会话留存。[MCP 架构](mcp-architecture.zh-CN.md) 说明智能粘贴工具权限。

## 三、展示与交互

[WorkspaceSidebar](../src/app/WorkspaceSidebar.tsx) 将 Ask AI 放在常驻图标栏首位，之后是管理、求职、工具分组及底部的设置。各组以短横线分隔，悬停时显示翻译后的名称。切换目标使用共享导航 API 和离开保护。在任意工作区页面均可从侧栏打开 Ask AI。[Browser 控件](../src/pages/browser/BrowserControls.tsx)提供后退、前进和刷新。参见[设计规范](design-system.zh-CN.md#五交互与无障碍)及[页面按钮归属](code-architecture.zh-CN.md#页面按钮归属)。

**已实现：**页面控件/卡片/图标引用[中央 UI 组件](../src/shared/ui/index.ts)，由[中央运行样式](../src/shared/ui/components.css)提供外观；页面行为仍由页面管理。[共享 Tokens](../src/shared/ui/design-tokens.json)为[应用样式](../src/renderer/styles/global.css)提供 8px 间距、组件尺寸、排版和语义色。[设计规范](design-system.zh-CN.md)管理这些规则和十个分类的 HTML 参考展示库；展示示例不代表业务功能已实现。

只有活动网页段可见。Browser 网页段位于 48px 标签栏和 48px 工具栏（总计 96px，来自[共享尺寸](../src/shared/ui/geometry.ts)）下方；Inbox 网页段从 `y = 0` 开始使用整个内容区高度，不显示应用标签、地址控件或顶部条。两种原生视图均位于侧栏右侧，使用[生成尺寸](../src/shared/ui/geometry.ts)：所有窗口宽度下均为 64px。[应用布局](../src/renderer/styles/global.css)使用相同宽度 Token，确保侧栏控件不会被原生视图遮挡。[WebSegment](../src/platform/browser/webSegment.ts) 在重定向、原生导航和弹窗中保留所属视图；Browser 与 Inbox 保留独立网页段；配置未变时重新打开 Inbox 会恢复其当前页面/草稿，加载失败后仍可重试。边界随窗口调整。目标切换先隐藏全部原生视图，直到所属页面通过[原生展示](../src/app/navigation/useNativePresentation.ts)确认标签/目标。过期可见性请求被忽略。Renderer 重载期间隐藏视图，Provider 重新订阅后恢复 Main 的目标及历史。

[TabStrip](../src/pages/browser/TabStrip.tsx) 支持新建、选择、关闭、滚动及方向键/Home/End 选择。标签名称使用保留的浏览器标题或翻译后的“新建标签页”，包括上次显示业务页面的后台标签；不渲染 `app://` 文本。[AddressBar](../src/pages/browser/AddressBar.tsx) 在空闲时跟随状态，聚焦时保留编辑草稿；切换标签会重置输入。

[快捷键](../src/platform/browser/shortcuts.ts) 在可信 Renderer 和原生网页中生效：macOS 的 `Cmd+T` 或其他平台的 `Ctrl+T` 可从任意页面新建 Browser 标签，并遵守离开保护。`Cmd+W`/`Ctrl+W` 关闭标签及 `Ctrl+Tab`/`Ctrl+Shift+Tab` 切换标签仅在 Browser 生效。`Cmd+L`/`Ctrl+L` 仅在 Browser 聚焦并选择地址。`Alt+Left/Right` 仅遍历 Browser 网页历史，在工作区页面和 Inbox 不执行操作。

### Browser 历史手势

**已实现：**[HistoryDrag](../src/platform/browser/historyDrag.ts) 统一右键拖动与触控板横向滚动手势。向右手势表示后退、向左手势表示前进；松手时距离达到 96px（窄视口为宽度的四分之一）则导航一次。网页、视口和工具栏始终固定。沙箱中的[原生指示器](../src/platform/browser/historyIndicator.ts)在内容对应边缘显示中央箭头组件，达到阈值后高亮，不可用方向保持弱化。短距离或反向收回的手势直接隐藏箭头，不导航也不回弹。箭头尺寸/边距和手势阈值复用生成的 Token 尺寸；所有偏好下均无手势动画，包括减少动态效果偏好。成功手势立即进入现有纯灰遮罩。失焦、缩放、导航、切换标签及释放时取消待完成手势。

隔离的[手势 Preload](../src/platform/electron/preload/browser-gestures.ts) 处理顶层文档的可信像素滚轮事件，将纵向/带修饰键滚动、可编辑字段、可横向滚动区域和 CSS 滚动边界限制留给网站。连续滚动在 120ms 无事件后结束，尾部抑制限制重复导航。从子 Frame 内开始的滚动仍由网站处理。没有横向拖动的右键点击保留原生菜单；纵向鼠标拖动不导航。Inbox 和工作区页面不提供历史手势。

[历史展示](../src/platform/browser/historyPresentation.ts) 在两个隔离环境动画帧和合成器截图完成前持续遮住旧文档/尚未绘制好的文档，然后直接显示，不淡入或继续移出。后续导航使较早的就绪结果失效。Browser 顶部 Back/Forward 使用相同遮罩，目标确认期间不隐藏原生视口。中性浅色/暗色色值归属[设计规范](design-system.zh-CN.md)。

顶部[刷新](../src/pages/browser/BrowserControls.tsx) 位于 Forward 右侧，空白/加载中的标签不可用。沙箱命名 [reload IPC](../src/platform/electron/main/browser-ipc.ts) 仅刷新当前 Browser 网页。Browser/Inbox 原生右键菜单也提供翻译后的刷新，拒绝过期/隐藏页面的点击，使用相同的纯灰到就绪展示，不重载可信应用文档。

[滚动 IPC](../src/platform/browser/historyGesture.ts) 仅接受所属视图顶层 Preload 的有界增量和当前文档代次，并要求其 Browser 目标处于活动状态，不向网站暴露 API。[手势测试](../tests/history-drag.test.ts) 覆盖方向/阈值/反向、边界、窄视口阈值及过期取消。[手势 Smoke](../scripts/history-gesture-smoke.cjs) 回放原生鼠标钩子（Electron 合成鼠标输入绕过该钩子），并发送真实 Chromium 滚轮事件，验证导航、边缘箭头/触发状态、固定内容及工具栏、等待首帧的纯灰展示、顶部/菜单刷新、网页滚动和取消。物理设备手感及不同系统的惯性仍需人工验证。

[Settings hook](../src/pages/settings/useSettings.ts) 管理独立草稿及保存反馈。Main 在导航、标签切换/关闭及窗口关闭前确认放弃未保存的设置和个人资料；通过标签/目标标识忽略过期草稿登记。刷新保护在导航提交前保留当前目标/草稿，取消刷新保留导入会话，已确认关闭不重复询问。已配置的 `app://inbox` 在激活视图前解析为带 Inbox 视图标识的 HTTPS 网页邮箱地址；未配置时显示设置引导。邮箱加载失败时隐藏原生视图，显示页面管理的重试/设置操作。存储语义由[数据架构](data-architecture.zh-CN.md#六配置密钥与待完成工作)管理。

**已实现外部 Agent 接入：**[设置页面](../src/pages/settings/ExternalMCPSettings.tsx)通过独立宿主 IPC 提供全局 MCP 安装、确认替换、剪贴板导出、独立连接检查、MCP 重新连接与删除，以及单独的内置 Skills 安装、重新连接和按项删除。Skills 显示逐项状态，确认后无备份替换，也可打开文件夹以手动复制到其他 Agent；不改变偏好草稿。宿主边界、安装目录与限制归属 [MCP 架构](mcp-architecture.zh-CN.md#五job-agent-browser-mcp)。


**已实现主题：**Settings 通过现有中央 `Select` 提供浅色、暗夜及跟随系统。主题与语言属于通用设置草稿：成功写入后点击保存生效；保存失败及放弃草稿保留当前主题。默认仍为浅色，偏好存储语义归属[数据架构](data-architecture.zh-CN.md#六配置密钥与待完成工作)。

[Main](../src/platform/electron/main/index.ts) 在创建窗口前应用保存的主题。[主题适配](../src/platform/electron/main/theme.ts)设置 Electron `nativeTheme.themeSource`；[BrowserManager](../src/platform/browser/browserManager.ts) 在原生外观变化时发布实际 `BrowserState.theme`，不改变导航目标/历史。[App ThemeProvider](../src/app/theme.tsx) 在 React 绘制更新前应用根节点主题，生成 CSS 在首个快照到达前使用原生颜色偏好。[窗口](../src/platform/electron/main/window.ts)及保留的 [WebSegments](../src/platform/browser/webSegment.ts)使用生成的主题背景；窗口持有一个监听，更新全部保留视图，并在窗口释放时清理。重新创建的窗口继承当前原生主题。

跟随系统响应原生外观变化；明确选择浅色/暗夜时覆盖系统。Browser/Inbox 远程文档接收 Chromium 颜色偏好，外观由网站自身控制，不注入强制改色。主题样式只修改颜色，规则由[设计规范](design-system.zh-CN.md#四语义色规则)管理。[独立主题运行器](../scripts/theme-runtime-smoke.cjs) 验证这些行为，包括 macOS 窗口重建；命令仍归属 README。启动背景匹配减少闪屏；完整逐帧验证和 Windows/Linux 的原生外观检查仍未验证。

[App Context](../src/app/context/appContext.ts) 提供当前页面的标签/标题/目标及可空 Job、Profile、Artifact ID。[引用 store](../src/app/context/contextStore.ts) 初始为空，不复制实体或提取网页内容。Profile 优先加载有效的引用记录，否则选择最近更新的 Profile，并在加载/保存后同步共享 ID。

**已实现 AI：**[Main 服务](../src/platform/ai/service.ts)在创建请求时固定所选 Provider、模型和凭据。支持 OpenAI 兼容的 Chat Completions；知识库 embeddings 使用下文独立的内置本地运行时。[共享传输](../src/platform/ai/transport.ts)为 `http://127.0.0.1:1234` 这类普通 endpoint 自动使用 `/v1`；显式填写的 `/v1`、`/gateway/v1` 等 API 路径会保留，并移除尾部斜杠。流式对话和 Resume Agent 共用这一地址解析。[兼容适配器](../src/platform/ai/compatible.ts)消费 SSE，拒绝重定向。远程地址必须使用 HTTPS；回环 HTTP 支持本地服务。自动重试、跨 Provider 回退和结构化输出能力探测尚未实现。

[AI IPC](../src/platform/electron/main/ai-ipc.ts)仅向发起请求的可信 frame 发送增量，并在 Renderer 导航、销毁或退出时取消工作。[固定超时](../src/shared/ai.ts)为模型发现 15 秒、网页读取 20 秒、推理 300 秒。非流式请求采用总时限，流式请求收到有效模型输出后重置空闲时限。

[Ask AI](../src/pages/ai/AskAIPage.tsx)和智能粘贴在一个 Run 中串行执行 Prepare 与 Execute。[Main 协调器](../src/platform/electron/ask-agent-tasks.ts)每窗口最多排队四个 Run、全局十六个，同一 Session 按 FIFO 放行，不同 Session 竞争全局执行占用。停止后保留已提交写入与已记录的部分输出。[App 投影](../src/app/ai/askStore.ts)按单调事件序号重同步，保留草稿和分页。阶段转换和共享预算见 [Agent 运行时](agent-runtime.zh-CN.md)。

**已实现请求校验：**[稳定 Provider 名称](../src/platform/ai/agent-protocol.ts)保留语义化名称片段、短哈希及 Description 中的逻辑名称前缀。[Pi 适配器](../src/platform/agent/pi/model-adapter.ts)在发送前核对运行时 loadout、Pi 声明和已组装的 Provider 名称/完整输入 Schema 指纹；不一致时以 AGENT_PROTOCOL_ERROR 停止。[MCP 架构](mcp-architecture.zh-CN.md)管理 Scope 展开与 Human Ask，[数据架构](data-architecture.zh-CN.md#ask-ai-会话存储)管理可删除的逐请求诊断。[披露集成测试](../tests/ask-disclosure.test.ts)通过真实 HTTP 与第一方 MCP 验证链路，不使用自动展开辅助层；真实模型的工具选择质量仍未验证。

[流式适配](../src/platform/ai/agent-stream.ts)及[推理规范化](../src/platform/ai/reasoning.ts)展示返回的 `reasoning_content`、`reasoning`、`reasoning_summary` 和 `reasoning_details` 可读块，保留来源/类型并消除镜像字段重复。加密块显示不可读标记，未返回推理时显示处理中。上述格式经过本地样本验证，不代表兼容任意提供商私有格式。Pi 在工具请求间保留 Host 专属续传状态；持久化归属[数据架构](data-architecture.zh-CN.md)。工具调用整批组装及校验成功后才执行。[Ask AI smoke](../scripts/ask-ai-runtime-smoke.cjs)通过本地样本验证真实 IPC/MCP、准入隔离、双语 320/640/1200px 布局、重启及强制结束进程后的 checkpoint 恢复。

[SessionSidebar](../src/pages/ai/SessionSidebar.tsx)确认后通过 App 注入的 Data IPC 复制调试 JSON；完整持久化快照留在 Main，回读剪贴板一致后才成功，详见[数据架构](data-architecture.zh-CN.md#copy-debug-json)。

[上下文管理](../src/platform/agent/context/manager.ts)按模型窗口预留输出和安全空间，完整轮次达到 80% 时向 60% 压缩。Prepare 加载有界的 [Core Memory](../src/platform/agent/context/core-memory.ts)参考视图。[能力解析](../src/platform/ai/ask-capabilities.ts)依次使用运行时限制（包括 LM Studio 已加载窗口）、Provider 元数据、匹配端点的模型目录及手动覆盖。未知时使用 65,536 Tokens 上下文窗口和 8,192 Tokens 最大输出。较小窗口按可用空间预算，模型错误在实际推理时返回。

[Ask 策略](../src/platform/agent/ask.ts)由 Execute 负责最终工具调用及长期 Memory 决策。项目、经历、技能读取 Profile 条目/Facts；基本资料使用 profile.get，收藏职位使用 Job，偏好使用 Memory，笔记使用 Knowledge。多个 Profile 无法确定时询问用户；同来源两次无新增信息后，Prompt 要求切换来源或回答已确认结果并说明缺失项。匹配分析读取 Job/Profile/Facts；简历请求引导至专用页面，不自动生成。[MCP 策略](mcp-architecture.zh-CN.md)强制 Ask 能力子集及有界恢复。[路由样本](../tests/ask-routing.test.ts)验证集成，真实模型路由质量仍未验证。

**已实现 AI Connection V2。**[初始化和设置](../src/app/ai/AIConnectionEditor.tsx)共用 Provider、Endpoint 和可选 API Key 表单。继续时使用草稿调用 [GET /models](../src/platform/ai/models.ts) 并校验非空模型 ID 列表。发现阶段不保存配置或执行推理。单模型自动选中，多模型由用户选择要保存的模型和全局默认项。保存更新[偏好和凭据](data-architecture.zh-CN.md)。[连接 Smoke](../scripts/onboarding-runtime-smoke.cjs)使用本地样本验证两个入口。

**已实现个人资料：**[页面状态](../src/pages/profile/useProfile.ts)完整加载条目/事实分页，将事实归入所属经历、项目或教育条目，未关联事实单独展示。编辑和导入草稿使用原生离开保护及刷新保护。路由目标变化会重新挂载页面状态，确认放弃后丢弃导入会话。存储与显式保存语义归属[数据架构](data-architecture.zh-CN.md)。 履历选择会确认放弃未保存修改并清理旧编辑/导入状态；界面不显示草稿状态；导入沿用人工审查确认并保留首次快照，手动新建或复制可点击确认履历。确认和恢复通过可信 IPC 校验审查时的 Revision。[基准规则](data-architecture.zh-CN.md#工作履历与人工确认基准)

[导入 IPC](../src/platform/electron/main/profile-import-ipc.ts)使用原生选择器选择一个 PDF，仅返回不透明文件 ID。[会话服务](../src/platform/profile-import/service.ts)在内存中管理文件字节、任务、草稿 ID、保存回执和窗口归属校验。[PDF.js 提取](../src/platform/import/pdf-worker.mjs)运行于可取消的 Node Worker，构建时复制到 Main 旁；CMaps、标准字体和 WASM 从已安装依赖解析。上限为 10 MB、20 页、60,000 个提取字符，加密/损坏/无文字/超限均明确报错。行列阅读顺序使用启发式重建，仍需人工核对。

主进程向已选模型提交带页码和行号的 PDF 提取文本。[草稿解析](../src/platform/profile-import/draft.ts)校验位置，按来源排序并对 Fact 去重。未归类原文供人工分配字段、转换为 Fact 或忽略。原始 PDF、全文和未保存草稿留在内存。

[导入请求](../src/platform/import/request.ts)在每次解析中发送一次模型请求。解析失败后手工重试复用已读取的来源，并重新执行整次解析。任务取消、替换或关闭窗口后释放对应缓存。

**已实现新增工作：**[页面](../src/pages/find-jobs/AddJobPage.tsx)支持手工录入及 URL/文本/PDF [采集 Agent](../src/platform/agent/capture.ts)。解析仅回填空字段，保留已有数组/薪资并显示所选模型。读取和理解期间不调用 JAB MCP，审核编辑后的草稿通过 job.import 保存；人工表单保留 typed IPC。[未保存保护](../src/app/navigation/useUnsavedGuard.ts)与 Profile 共用，存储规则归属[数据架构](data-architecture.zh-CN.md)。

[公开 URL 读取器](../src/platform/job-import/url-reader.ts)在 Main 读取 HTTP(S) HTML，不发送网站 Cookie，不执行网页脚本；使用已保存的网页读取超时，最多 5 次重定向、2 MB HTML、60,000 个正文字符及 40,000 个 JobPosting 元数据字符。[HTML 解析](../src/platform/job-import/html.ts)使用 htmlparser2 去除脚本/导航等内容；HTTP 拒绝、登录/验证页及无可读内容返回固定错误。仅脚本生成或无法识别的限制页可能无法解析，不保证所有招聘网站兼容。

[采集任务](../src/platform/job-import/service.ts)按窗口管理来源、草稿、重试和稳定的保存 requestId。[职位解析](../src/platform/agent/capture.ts)使用 AgentModel，并在关闭窗口时抑制迟到的结果。PDF 读取与个人资料导入共用 Worker 和上限。

[申请记录](../src/pages/applications/ApplicationsPage.tsx)支持搜索/状态/归档筛选、25 条分页和手动刷新。详情包含来源、分页事件及[申请 Agent 面板](../src/pages/applications/ApplicationAgentPanel.tsx)。明确指令通过 MCP 执行本地状态/备注/日程/详情/归档动作，缺少信息时追问，部分失败保留已完成动作。保存 Job 后打开其详情。外部日历/邮件动作及重复合并仍为规划。

**已实现 Resume V3。**[主进程任务](../src/platform/electron/resume-tasks.ts)通过 MCP 复制已保存的个人资料，并使用[共享 Agent Engine](../src/platform/agent/engine/index.ts)改写已有要点。[定制简历页面](../src/pages/tailor-resume/TailorResumePage.tsx)展示业务进度、历史及 HTML/PDF 预览，[Agent Trace](../src/pages/tailor-resume/ResumeTraceView.tsx) 位于进度下方的默认折叠卡片中。Agent 关联后通过简历 IPC 流式传递时间线事件；展开时读取记录器实时快照，支持事件序列缺口恢复及诊断轮询。“复制诊断 JSON”包含最新生成状态、Artifact 输出元数据和追踪，也支持运行中的部分结果及失败记录。手工保存更新 Artifact，重建无需推理。

## 四、会话、安全与存储

远程视图共享 `persist:job-agent-browser`，网站存储跨重启保留。权限请求被拒绝；没有多资料选择器。

- [可信窗口](../src/platform/electron/main/window.ts)和[远程视图](../src/platform/browser/webSegment.ts)禁用 Node 集成，启用上下文隔离和沙盒；远程网页安全检查保持启用。
- 业务浏览器、数据及 AI IPC 要求自有可信文档及顶层 frame，并校验输入。[Preload](../src/platform/electron/preload/index.ts) 只暴露命名操作，不暴露原始 `ipcRenderer`。
- 远程主 frame 导航/重定向只允许 HTTP(S)。HTTP(S) 弹窗新建应用标签；原生弹窗和其他协议被拒绝。远程页面不能进入内部路由或访问浏览器/数据桥接。
- [可信 HTML](../src/renderer/index.html) 保持 CSP。可信 UI 外部链接通过窗口创建逻辑使用操作系统浏览器。

Main 在创建窗口前打开存储并注册数据处理器，退出时关闭存储，启动失败时报告错误且不重置数据。[后端组装](../src/platform/database/backend.ts) 注入 Repository/事务并恢复中断生成任务。[数据架构](data-architecture.zh-CN.md)管理已实现的 SQLite、业务校验、持久化与终端诊断。

**已实现工具/MCP：**[Main](../src/platform/electron/main/index.ts)分别管理可选第三方能力消费与 [first-party 会话](../src/platform/mcp/first-party-client.ts)。内部流程与外部宿主通过限定 Scope 共用业务能力，使用同一 [Node Server](../src/platform/mcp-server/runtime.ts)，Caller 标识不授予权限。Renderer 只暴露命名流程 IPC，不开放通用工具执行。[MCP 架构](mcp-architecture.zh-CN.md)管理注册、上限和退出，数据架构管理多进程恢复。

## 五、国际化

**已实现：**英文与[简体中文资源](../src/shared/i18n/locales/zh-CN.ts)支持保存语言选择。[英文资源](../src/shared/i18n/locales/en.ts)集中管理应用自有的页面文案、内部标题、提示气泡、无障碍标签、错误及原生启动对话框。[共享初始化](../src/shared/i18n/index.ts)通过打包资源在各进程分别创建 i18next 实例，同步初始化，默认及回退语言均为英文。不请求网络翻译资源，也不检测系统语言。

[App 翻译 Provider](../src/app/i18n.tsx)向 `useTranslation()` 提供同一个 Renderer 实例，并更新文档标题和语言。非 React 代码使用共享 `t` 函数；[Main](../src/platform/electron/main/index.ts)可在 React 启动前取词。[构建配置](../electron.vite.config.ts)从与原生窗口共用的英文资源注入 HTML 标题。完整句子模板插入标签/标题，React 将结果作为文本渲染。用户数据、网站标题/内容及仅用于诊断的异常不进入文案资源。Main 在创建窗口前加载保存的语言，通过浏览器快照发布；Renderer 的 Provider 跟随该语言。新的浏览器标题/错误使用当前语言；之前已捕获的错误文字不重新翻译。

**规划：**更多语言及系统语言检测。[翻译测试](../tests/i18n.test.ts)覆盖启动取词、回退、实例隔离、React 资源使用、插值安全及无效键的类型检查。

## 六、验证与限制

[个人资料 smoke](../scripts/profile-smoke.cjs)使用本地样本验证手动编辑、多事实分组、构建后的 PDF Worker/SSE、审核确认导入及快照、分页/重载及双语主题/布局。[导入测试](../tests/profile-import.test.ts)、[会话测试](../tests/profile-session.test.ts)和 [PDF 测试](../tests/profile-pdf.test.ts)覆盖原子回滚、回执、窗口归属、精简草稿、PDF 限制与错误。[AI 测试](../tests/ai.test.ts)和[AI smoke](../scripts/ai-smoke.cjs)验证本地兼容 SSE、取消、Provider 配置及真实 IPC。[事务测试](../tests/transactions.test.ts)验证原子提交与回滚，[迁移测试](../tests/remove-audit-migration.test.ts)验证 V22 数据保留；[导航 store 测试](../tests/navigation-store.test.ts) 覆盖订阅顺序与 StrictMode 清理。[Electron smoke](../scripts/smoke.cjs) 验证构建后的 Main/Preload、IPC 和来源拒绝。[浏览器 smoke](../scripts/browser-smoke.cjs) 覆盖标签、边界、快捷键、隔离与失败；[导航 smoke](../scripts/navigation-smoke.cjs) 覆盖功能入口 UI、工作区/历史分离、分叉/释放、SPA/重复历史、重载、过期可见性和加载竞争。[主题 smoke](../scripts/theme-smoke.cjs) 验证仅颜色的尺寸一致性、保存/草稿主题、原生变化和导航不变。[设置 smoke](../scripts/settings-smoke.cjs) 验证真实表单、双语重载、响应式尺寸、校验、离开确认、Inbox 导航和加密密钥生命周期；[重启 smoke](../scripts/settings-restart-smoke.cjs) 验证新的生产进程恢复设置。[Inbox smoke](../scripts/inbox-smoke.cjs) 使用本地测试页验证无顶部偏移的原生边界、无应用顶部条、重定向/历史/重载/弹窗、草稿保留、缩放、隔离和加载恢复。[侧栏 smoke](../scripts/sidebar-smoke.cjs)验证全部目标、当前状态、键盘激活、固定图标栏尺寸、提示名称及矮窗口可访问性。[窗口关闭 smoke](../scripts/window-close-smoke.cjs) 验证自有窗口关闭后释放保留视图。命令见 README 索引。

标签历史和上下文引用仅存于内存。网页段通过分叉或关闭标签/窗口释放；自动淘汰和跨重启恢复尚未实现。其余业务流程、登录态网页提取、完整 Shared Context 捕获仍未实现；打包及其验收状态归属 [CI/CD](ci-cd.zh-CN.md)。

[职位导入测试](../tests/job-import.test.ts)和[职位 smoke](../scripts/job-smoke.cjs)覆盖 URL、文本、PDF、单次解析和人工保存。真实第三方招聘站点和账号兼容性尚未验证。

## 七、相关文档

- [README](../README.zh-CN.md)：启动、验证和文档索引。
- [产品架构](product-architecture.zh-CN.md)：产品规则和规划交付顺序。
- [代码架构](code-architecture.zh-CN.md)：源码职责和依赖边界。
- [V1 数据架构与 API](data-architecture.zh-CN.md)：持久化与业务接口。

## 智能笔记知识库

**已实现 Memory v1：**[SmartNoteWorkspace](../src/platform/knowledge/workspace.ts)拥有两个固定根 Markdown 服务视图、一个 Git 仓库/锁、Watcher、自动备份和共享资源。[存储架构](data-architecture.zh-CN.md#智能笔记存储与-memory-v1)负责迁移/恢复及同步同意语义。独立 MCP 不能迁移或恢复未完成的工作区，会提示先启动 JAB。

[工作区队列](../src/platform/knowledge/workspace-embedding.ts)串行调度唯一共享 Provider，限制排队并优先查询。重建单个索引仅等待自身任务，不取消或释放共享模型；全局配置/移除/退出协调两个视图。[Broker](../src/platform/knowledge/broker.ts)仅依赖共享查询向量生成能力，不依赖任一空间索引。独立 MCP 不加载模型，Main 或模型不可用时保留词法检索。

[可信 IPC](../src/platform/electron/knowledge-contract.ts)保留 `window.knowledge`，为文件/搜索/历史/恢复/索引调用增加可选空间（默认 Knowledge）；同步/配置/模型/备份仍为工作区操作。[编辑器 Hook](../src/pages/knowledge/useKnowledge.ts)为每次保存捕获空间与 Revision，选择前先 Flush，失败时保留草稿与原选择。Memory 是固定置顶且默认折叠的 Explorer 根节点，搜索拒绝其他空间迟到结果，相对链接保留当前文件的空间。[UI 规则](design-system.zh-CN.md#智能笔记知识库)负责共享组件，[MCP 架构](mcp-architecture.zh-CN.md#智能笔记知识库)负责启动授权及 Ask Memory 写入授权。Ask V2 Runtime 行为见上文。

[本地 embedding](../src/platform/knowledge/rag/local-embedding.ts) 按需调度单个 CPU [utility process](../src/platform/knowledge/rag/embedding-process.ts)，优先处理查询、限制队列并拒绝取消/超时/崩溃请求。Worker 禁止远程加载和 fetch，只读取用户模型存储中完整校验过的 revision。Main 的 [Model Manager](../src/platform/models/manager.ts) 管理下载/Seed 导入、重试/取消、校验、原子提交和删除；[路径](../src/platform/models/paths.ts) 独立于安装位置和 cwd。GUI 启动不等待模型校验或导入；模型不可用时保留关键词搜索。激活后立即调度缺失向量，删除权重前停止本实例推理。跨进程读取租约阻止替换或删除其他实例正在使用的模型。[打包](ci-cd.zh-CN.md) 负责发行检查。

[Bootstrap](../src/platform/electron/main/bootstrap.ts)在加载 Main 前分派打包后的子进程角色；应用入口为 application-main.js。PDF worker 先宣布就绪再接收输入，使用由父进程清理的临时 userData。[包内验收](../src/platform/electron/verify-resume-package.ts)还通过完整 MCP 简历流程生成 HTML/PDF，并使用包内 PDF worker 提取文本。

[npm 适配器](../packages/npm/bin/jab.cjs) 启动相同的 Electron bootstrap，提供版本/doctor/stdio MCP 命令。npm 默认使用 JAB 应用数据目录，也可显式传入绝对路径覆盖。DMG/npm 凭据需在干净 Mac 上验证兼容性；解密失败会保留密文并报错。模型与应用安装的生命周期独立；自动应用更新尚未实现。

[全局 Human Ask](../src/app/components/HumanAskDialog.tsx)挂载在路由旁，组合共享 Dialog/Radio/TextArea/Button。[Main](../src/platform/electron/main/human-ipc.ts)负责可信 IPC 和请求/窗口清理；[BrowserManager](../src/platform/browser/browserManager.ts)临时抑制原生视图可见性，保留原可见状态及导航。闭包式请求服务由内外部认证通道共用。[协议及限制](mcp-architecture.zh-CN.md#human-ask)
