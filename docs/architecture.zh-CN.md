# 当前运行架构

用途：记录已验证的运行行为。状态：React 组装、混合导航、设置、个人资料编辑/PDF 导入、职位采集/申请 Agent、Ask AI V2 及包含 HTML/PDF 的 Resume Agent V1 均**已实现**。面试准备仍为**占位**，更多产品流程仍为**规划**。

语言：简体中文 · [English](architecture.md)

## 一、运行入口与进程边界

[构建配置](../electron.vite.config.ts) 使用 [Main](../src/platform/electron/main/index.ts)、[Preload](../src/platform/electron/preload/index.ts) 和 [Renderer HTML 入口](../src/renderer/index.html)。[包入口](../package.json) 保持 `out/main/index.js`。

```text
React App → Page → Preload → IPC → Main
                                  ├── Mixed history + WebContentsView → Session
                                  ├── Domain services → SQLite + audit
                                  ├── AI service → Provider SSE
                                  └── MCP Client → stdio Server → ToolScope → audited capability → Domain
```

[Renderer 启动代码](../src/renderer/main.tsx) 在 StrictMode 中挂载唯一 [App](../src/app/App.tsx)。[Provider](../src/app/providers.tsx) 注入受限浏览器/数据/AI 桥接和上下文；[导航 store](../src/app/navigation/navigationStore.ts) 在每次 Provider 生命周期中订阅一次，忽略旧快照及已清理的初始化读取。[路由](../src/app/router.tsx) 根据 Main 的当前目标选择 React 页面，不导航可信文档。

只有 [BrowserPage](../src/pages/browser/BrowserPage.tsx) 渲染标签、地址输入与浏览器控件。Home 和业务页面不显示浏览器栏或内部 URL。[HomeGrid](../src/pages/home/HomeGrid.tsx) 启用全部九个卡片。[Settings](../src/pages/settings/SettingsPage.tsx) 实现本地偏好和加密密钥管理。[Inbox](../src/pages/inbox/InboxPage.tsx) 管理全内容区网页邮箱视图、配置引导和加载恢复。[Ask AI](../src/pages/ai/AskAIPage.tsx) 已实现持久化多会话流式 Agent。[My Profile](../src/pages/profile/ProfilePage.tsx) 实现手动编辑及经核对的 PDF 导入，新增工作及申请记录基础列表已实现，定制简历已实现；面试准备仍为占位。

## 二、路由与混合历史

[目标契约](../src/shared/navigation.ts) 白名单包含 `app://home`、`app://find`、`app://resume`、`app://interview`、`app://applications`、`app://inbox`、`app://profile`、`app://browser`、`app://ai` 和 `app://settings`。内部 URL 是导航标识，不是已注册的操作系统协议或 Chromium 加载的文档。未知内部目标在修改历史前拒绝。公开 URL 由[产品架构](product-architecture.zh-CN.md)管理。

[BrowserManager](../src/platform/browser/browserManager.ts) 管理标签、当前目标及版本化快照。每个标签从 Home 开始。Home 新增内部历史项；新建或关闭最后一个标签后创建新的 Home。选择 Browser 新增空白浏览器工作区，地址框为空。切换标签不新增历史；关闭活动标签选择右侧邻居，无右侧时选择左侧。

[MixedHistory](../src/platform/browser/mixedHistory.ts) 将内部历史项与连续网页历史段组合。每个 [WebSegment](../src/platform/browser/webSegment.ts) 保留自己的原生视图与 Chromium 历史。Back/Forward 先遍历段内原生索引，再跨越内部项/网页段。进入内部页面只隐藏现有视图，不导航或销毁它，直接返回时保留当前网页状态。正常 Chromium 历史回放可能重新加载较早文档。

后退后发起新导航会裁剪应用前进栈和当前段的原生前进项。不可达段被关闭；关闭标签/窗口释放全部保留视图。网站链接、重定向和 SPA 导航更新原生历史，历史回放及替换不新增应用项。重复 URL 保留原生项身份。私有 [Chromium 历史观察器](../src/platform/browser/nativeHistory.ts)通过内部调试协议读取稳定项 ID，区分新访问与网站自身的历史回放，不注入页面脚本或暴露调试桥接。加载/错误事件归属原段，不会激活后台标签或内部页面。

[网页输入解析](../src/platform/browser/navigationManager.ts) 保留 HTTP(S)，识别域名/IP/localhost，其他输入使用 Google 搜索。裸地址默认 HTTPS，localhost 和回环地址默认 HTTP。空输入、无效显式网址及其他协议被拒绝。[测试](../tests/navigation.test.ts) 保留这些规则；[混合历史测试](../tests/mixed-history.test.ts) 覆盖内部路由与段间回放/分叉。

## 三、展示与交互

[WorkspaceSidebar](../src/app/WorkspaceSidebar.tsx) 常驻每个页面左侧，提供主页、九个功能、翻译后的无障碍分组及唯一当前状态，统一使用图标栏。原有 Home / Job search / Manage / Tools / Settings 分区及顺序保持不变，按照[设计规范](design-system.zh-CN.md#五交互与无障碍)用短横线分隔。悬停提示显示翻译后的目标名称；已移除侧栏品牌头部及 Home 标题上方的品牌文字。共享[功能元数据](../src/app/navigation/features.ts)管理侧栏及 Home 的图标/顺序。切换功能使用相同导航 API 和未保存设置保护；点击当前功能不新增历史。[HomePage](../src/pages/home/HomePage.tsx) 显示功能入口，不显示 Back 按钮。其他业务页面的页面导航只提供回到主页按钮（Ask AI V2 使用常驻侧栏的主页入口），不显示跨页面 Back/Next/Forward 控件。占位页面通过[占位布局](../src/shared/ui/PlaceholderPage.tsx)的 actions 插槽提供自己的按钮和处理函数，布局不定义导航行为。[Browser 控件](../src/pages/browser/BrowserControls.tsx)保留 Home、Back 和 Forward。按钮归属规范见[代码架构](code-architecture.zh-CN.md#页面按钮归属)。

**已实现：**页面控件/卡片/图标引用[中央 UI 组件](../src/shared/ui/index.ts)，由[中央运行样式](../src/shared/ui/components.css)提供外观；页面行为仍由页面管理。[共享 Tokens](../src/shared/ui/design-tokens.json)为 [Home](../src/pages/home/home.css) 和[应用样式](../src/renderer/styles/global.css)提供 8px 间距、组件尺寸、排版和语义色。[设计规范](design-system.zh-CN.md)管理这些规则和十个分类的 HTML 参考展示库；展示示例不代表业务功能已实现。

只有活动网页段可见。Browser 网页段位于 48px 标签栏和 48px 工具栏（总计 96px，来自[共享尺寸](../src/shared/ui/geometry.ts)）下方；Inbox 网页段从 `y = 0` 开始使用整个内容区高度，不显示应用标签、地址控件或顶部条。两种原生视图均位于侧栏右侧，使用[生成尺寸](../src/shared/ui/geometry.ts)：所有窗口宽度下均为 64px。[应用布局](../src/renderer/styles/global.css)使用相同宽度 Token，确保侧栏控件不会被原生视图遮挡。侧栏主页入口替代邮箱退出区域。[WebSegment](../src/platform/browser/webSegment.ts) 在重定向、原生导航和弹窗中保留所属视图；Browser 与 Inbox 切换创建独立网页段。边界随窗口调整。目标切换先隐藏全部原生视图，直到所属页面通过[原生展示](../src/app/navigation/useNativePresentation.ts)确认标签/目标。过期可见性请求被忽略。Renderer 重载期间隐藏视图，Provider 重新订阅后恢复 Main 的目标/历史，不将标签重置为 Home。

[TabStrip](../src/pages/browser/TabStrip.tsx) 支持新建、选择、关闭、滚动及方向键/Home/End 选择。内部目标以页面标题作为标签名称，不渲染 `app://` 文本。[AddressBar](../src/pages/browser/AddressBar.tsx) 在空闲时跟随状态，聚焦时保留编辑草稿；切换标签会重置输入。

[快捷键](../src/platform/browser/shortcuts.ts) 在可信 Renderer 和原生网页中生效：macOS 的 `Cmd+T/W` 或其他平台的 `Ctrl+T/W` 新建/关闭标签；`Ctrl+Tab` 和 `Ctrl+Shift+Tab` 切换标签。`Cmd+L`/`Ctrl+L` 仅在 Browser 聚焦并选择地址。`Alt+Left/Right` 遍历混合历史，也适用于没有浏览器栏的内部页面。

[Settings hook](../src/pages/settings/useSettings.ts) 管理独立草稿及保存反馈。Main 在导航、历史遍历、标签切换/关闭及窗口关闭前确认放弃未保存的设置和个人资料；通过标签/目标标识忽略过期草稿登记。刷新保护在导航提交前保留当前目标/草稿，取消刷新保留导入会话，已确认关闭不重复询问。已配置的 `app://inbox` 在写入历史前解析为带 Inbox 视图标识的 HTTPS 网页邮箱地址；未配置时显示设置引导。邮箱加载失败时隐藏原生视图，显示页面管理的重试/设置操作。存储语义由[数据架构](data-architecture.zh-CN.md#六配置密钥与待完成工作)管理。

**已实现外部 Agent 接入：**[设置页面](../src/pages/settings/ExternalMCPSettings.tsx)通过独立宿主 IPC 提供全局 MCP 安装、确认替换、剪贴板导出、独立连接检查及单独的内置 Skills 安装。Skills 显示逐项状态，确认后无备份替换，也可打开文件夹以手动复制到其他 Agent；不改变偏好草稿。宿主边界、安装目录与限制归属 [MCP 架构](mcp-architecture.zh-CN.md#五job-agent-browser-mcp)。

**已实现审计查看器：**[Settings 审计区块](../src/pages/settings/AuditViewerSection.tsx)通过[查看器 hook](../src/pages/settings/useAuditViewer.ts)独立于偏好表单加载，提供每页 25 条、显式筛选/刷新、元数据详情、空状态/错误/重试，并丢弃过期响应。筛选仅在页面内存中保留，不标记偏好为未保存。读取语义与审计范围归属[数据架构](data-architecture.zh-CN.md#四审计与事务)。

**已实现主题：**Settings 通过现有中央 `Select` 提供浅色、暗夜及跟随系统。主题与语言属于通用设置草稿：成功写入后点击保存生效；保存失败及放弃草稿保留当前主题。默认仍为浅色，偏好存储语义归属[数据架构](data-architecture.zh-CN.md#六配置密钥与待完成工作)。

[Main](../src/platform/electron/main/index.ts) 在创建窗口前应用保存的主题。[主题适配](../src/platform/electron/main/theme.ts)设置 Electron `nativeTheme.themeSource`；[BrowserManager](../src/platform/browser/browserManager.ts) 在原生外观变化时发布实际 `BrowserState.theme`，不改变导航目标/历史。[App ThemeProvider](../src/app/theme.tsx) 在 React 绘制更新前应用根节点主题，生成 CSS 在首个快照到达前使用原生颜色偏好。[窗口](../src/platform/electron/main/window.ts)及保留的 [WebSegments](../src/platform/browser/webSegment.ts)使用生成的主题背景；窗口持有一个监听，更新全部保留视图，并在窗口释放时清理。重新创建的窗口继承当前原生主题。

跟随系统响应原生外观变化；明确选择浅色/暗夜时覆盖系统。Browser/Inbox 远程文档接收 Chromium 颜色偏好，外观由网站自身控制，不注入强制改色。主题样式只修改颜色，规则由[设计规范](design-system.zh-CN.md#四语义色规则)管理。[独立主题运行器](../scripts/theme-runtime-smoke.cjs) 验证这些行为，包括 macOS 窗口重建；命令仍归属 README。启动背景匹配减少闪屏；完整逐帧验证和 Windows/Linux 的原生外观检查仍未验证。

[App Context](../src/app/context/appContext.ts) 提供当前页面的标签/标题/目标及可空 Job、Profile、Artifact ID。[引用 store](../src/app/context/contextStore.ts) 初始为空，不复制实体或提取网页内容。Profile 优先加载有效的引用记录，否则选择最近更新的 Profile，并在加载/保存后同步共享 ID。

**已实现 AI：**[Main 服务](../src/platform/ai/service.ts)在创建请求时固定所选 Provider、模型和凭据。目前仅支持 OpenAI 兼容的 Chat Completions。[共享传输](../src/platform/ai/transport.ts)为 `http://127.0.0.1:1234` 这类普通 endpoint 自动使用 `/v1`；显式填写的 `/v1`、`/gateway/v1` 等 API 路径会保留，并移除尾部斜杠。流式对话和 Resume Agent 共用这一地址解析。[兼容适配器](../src/platform/ai/compatible.ts)消费 SSE，拒绝重定向。远程地址必须使用 HTTPS；回环 HTTP 支持本地服务。自动重试、跨 Provider 回退和结构化输出能力探测尚未实现。

[旧 AI IPC](../src/platform/electron/main/ai-ipc.ts)暴露启动/取消及模型发现，事件只返回发起请求的可信 frame。[Renderer 协调](../src/app/ai/streamClient.ts)先订阅再调用，缓存早到事件，并在终态或页面释放时移除订阅。服务限制请求数量及上下文/输出大小，对话使用已保存的 AI 请求超时，并在 Renderer 导航/销毁或应用退出时取消请求。Provider SSE 保留在 Main，界面使用增量 IPC。

[Ask AI V2](../src/pages/ai/AskAIPage.tsx)使用 [Main 任务](../src/platform/electron/ask-agent-tasks.ts)、流式 Agent 循环及限定的 first-party MCP 会话。每 Session 一个活动 Run，每窗口最多四个、全局十六个。切换会话及内部页面保留任务；停止、Renderer 丢失及退出会取消任务。[App 投影](../src/app/ai/askStore.ts)先订阅再加载快照，对递增事件去重并在缺口时重同步。Session 保存模型选择，各 Run 独立捕获配置/凭据。已实现重命名/删除、草稿、历史分页和安全的手动重试；尝试过写入的 Run 引导核对当前状态，不自动重放。存储/隐私归属[数据架构](data-architecture.zh-CN.md)，工具范围归属 [MCP 架构](mcp-architecture.zh-CN.md)。

[流式适配](../src/platform/ai/agent-stream.ts)规范化正文及明确公开的 `reasoning_summary` 字符串增量。忽略未分类的 `reasoning`/`reasoning_content` 字段；不提供摘要的模型显示处理中及工具活动。工具调用整批组装、校验及审计成功后才执行。[Ask AI smoke](../scripts/ask-ai-runtime-smoke.cjs)通过本地样本验证真实 IPC/MCP、并发、双语 320/640/1200px 布局、重启及强制结束进程后的 checkpoint 恢复。

**已实现模型发现：**[Main 检测服务](../src/platform/ai/models.ts)按用户操作向已保存 Provider 的 `models` 资源发起 `GET`，使用已保存密钥；无需密钥的服务不发送身份验证。不要求已有模型/默认值。服务拒绝重定向，限制 JSON 为 1 MB/10,000 条，校验、去重并排序 ID，使用已保存的模型检测超时，每个窗口最多一个请求、全局最多 16 个。窗口释放/导航或应用退出会中止检测。

[设置选择器](../src/pages/settings/ModelDiscovery.tsx)将选中 ID 加入草稿（最多 100 个），保存后生效。空列表/错误不影响手填；切换 Provider 或控件卸载后忽略迟到结果。检测不调用生成、不写设置/审计，也不证明模型支持对话/工具。[回归测试](../tests/ai-models.test.ts)和[生产 smoke](../scripts/ai-smoke.cjs)使用本地样本；另已在本机 LM Studio 验证模型发现及短流式对话，其他真实服务的兼容性仍未验证。

**已实现个人资料：**[页面状态](../src/pages/profile/useProfile.ts)完整加载条目/事实分页，将事实归入所属经历、项目或教育条目，未关联事实单独展示。编辑和导入草稿使用原生离开保护及刷新保护。路由目标变化会重新挂载页面状态，确认放弃后丢弃导入会话。存储与显式保存语义归属[数据架构](data-architecture.zh-CN.md)。

[导入 IPC](../src/platform/electron/main/profile-import-ipc.ts)使用原生选择器选择一个 PDF，仅返回不透明文件 ID。[会话服务](../src/platform/profile-import/service.ts)在内存中管理文件字节、任务、草稿 ID、保存回执和窗口归属校验。[PDF.js 提取](../src/platform/import/pdf-worker.mjs)运行于可取消的 Node Worker，构建时复制到 Main 旁；CMaps、标准字体和 WASM 从已安装依赖解析。上限为 10 MB、20 页、60,000 个提取字符，加密/损坏/无文字/超限均明确报错。行列阅读顺序使用启发式重建，仍需人工核对。

Main 将 PDF 文字发送给已展示的全局默认 Provider/模型，复用 AI 超时、取消和启动审计。[草稿解析](../src/platform/profile-import/draft.ts)校验 JSON，将多个事实归入同一条目。导入输出不包含原文引用、页码及证据校验，可省略空的可选字段；已保存事实仍支持 Resume Agent 表述关联。原始流不作为已解析资料展示，重试由用户手动发起。原始 PDF、完整文字和未保存草稿不持久化，离页、刷新、崩溃和窗口销毁会释放会话。OCR、原始文件管理和真实第三方 Provider 兼容性认证尚未实现。

**已实现导入模式：**两种导入默认使用普通模式（`single`，一个 AI 请求）。在设置中选择 Provider，再在“配置并行导入的模型”中选择模型，勾选“允许此模型并行导入”并保存；随后在 PDF 或 URL 导入页面各自选择并行模式（`parallel`）。许可属于 Provider/模型组合，不是模型 API 参数。导入模式只存于页面/会话，不是持久化全局偏好；缺少许可时并行选项不可用，Main 也拒绝绕过界面的调用。见[模型控件](../src/pages/settings/ModelImportSettings.tsx)、[模式控件](../src/app/ai/ImportControls.tsx)和 [Main 策略](../src/platform/import/policy.ts)。

AI 工作前仅下载/清洗一次网页，或提取一次 PDF 文字。[职位分组](../src/platform/job-import/parts.ts)和[资料分组](../src/platform/profile-import/parts.ts)读取相同完整来源，不按页切分文档。普通与并行 PDF 导入使用同一精简事实结构，详见[数据架构](data-architecture.zh-CN.md#二业务规则)。

| 导入 | 分组 | 提取内容 |
| --- | --- | --- |
| 职位 URL | `basics` | 职位名称、公司原名、地点文字/列表、雇佣类型及薪资 |
| 职位 URL | `description` | 职位描述 |
| 职位 URL | `requirements` | 要求原文、类别及关键词 |
| PDF 资料 | `contact` | 包含个人简介的基本信息、链接及独立事实 |
| PDF 资料 | `experience` | 工作经历条目及所属事实 |
| PDF 资料 | `projects` | 项目条目及所属事实 |
| PDF 资料 | `education` | 教育条目及所属事实 |

并行模式下职位备注默认为空，来源元数据由本地组装。[共用批次](../src/platform/import/batch.ts)最多并发三组，PDF 的第四组等待空闲位置。每组只能返回分配的字段/条目类型；所有组成功后按固定顺序合并。资料合并按事实类别/内容去除同一父项内的重复及独立事实对条目事实的重复；不同父项下的相同事实分别保留。

[AI 服务](../src/platform/ai/service.ts)为 Profile 导入排队，每窗口四个/全局十六个活动请求，活动与排队合计最多八十个。职位采集通过 AgentModel 在每个窗口任务内最多并发三组。各组报告仅存内存的排队/处理耗时；[共用批次](../src/platform/import/batch.ts)使用单调时钟每 100 毫秒刷新，保留终态耗时，重试只重置失败组，完成/失败/取消释放计时器。

分组失败时，成功结果留在内存；只有任务返回 `retryable`，页面才提供“重试失败部分”。重试复用原来源、模型选择、模式和成功结果，不重新下载/提取，也不写业务数据。读取/提取失败，或没有失败组的最终合并失败，需要重新解析。替换、放弃、导航/窗口释放和进程退出会释放对应任务/缓存。重试标识规则见[数据架构](data-architecture.zh-CN.md#五api-契约与访问)。

每组接收完整输入，因此输入 token/费用可能增加。较短输出和并发请求可以减少等待，但效果取决于服务商并发、模型吞吐及网络延迟；本地样本测试不代表真实服务提速。

**已实现新增工作：**[页面](../src/pages/find-jobs/AddJobPage.tsx)支持手工录入及 URL/文本/PDF [采集 Agent](../src/platform/agent/capture.ts)。解析仅回填空字段，保留已有数组/薪资并显示所选模型。读取和理解期间不调用 JAB MCP，审核编辑后的草稿通过 job.import 保存；人工表单保留 typed IPC。[未保存保护](../src/app/navigation/useUnsavedGuard.ts)与 Profile 共用，存储规则归属[数据架构](data-architecture.zh-CN.md)。

[公开 URL 读取器](../src/platform/job-import/url-reader.ts)在 Main 读取 HTTP(S) HTML，不发送网站 Cookie，不执行网页脚本；使用已保存的网页读取超时，最多 5 次重定向、2 MB HTML、60,000 个正文字符及 40,000 个 JobPosting 元数据字符。[HTML 解析](../src/platform/job-import/html.ts)使用 htmlparser2 去除脚本/导航等内容；HTTP 拒绝、登录/验证页及无可读内容返回固定错误。仅脚本生成或无法识别的限制页可能无法解析，不保证所有招聘网站兼容。

[采集任务](../src/platform/job-import/service.ts)按窗口管理原始字节、草稿、重试和稳定保存 requestId。[通用 PDF 读取](../src/platform/import/pdf.ts)与 Profile 共用 Worker 和上限。职位解析使用 AgentModel；[分组解析](../src/platform/job-import/parts.ts)拒绝受控字段，保留成功分组供重试。窗口释放阻止迟到结果。登录态 Browser 采集、登录/验证码、OCR 和原文件管理仍未实现。

[申请记录](../src/pages/applications/ApplicationsPage.tsx)支持搜索/状态/归档筛选、25 条分页和手动刷新。详情包含来源、分页事件及[申请 Agent 面板](../src/pages/applications/ApplicationAgentPanel.tsx)。明确指令通过 MCP 执行本地状态/备注/日程/详情/归档动作，缺少信息时追问，部分失败保留已完成动作。保存 Job 后打开其详情。外部日历/邮件动作及重复合并仍为规划。

**已实现 Resume Agent V1：**[Main 任务](../src/platform/electron/resume-tasks.ts)组装固定五阶段的 [Resume Agent](../src/platform/agent/resume.ts)与真实 first-party stdio MCP 会话。不可变 start/read/submit/publish/fail/cancel/build 均经过 MCP，UI 查询/预览/导出属于独立 Main 操作。[异步桥接](../src/platform/electron/resume-contract.ts)驱动定制简历，保留历史、每窗口限制一个活动任务，并取消被销毁窗口的工作。[数据架构](data-architecture.zh-CN.md#三生成成品与删除)管理持久化/输出，[MCP 架构](mcp-architecture.zh-CN.md)管理 Agent 边界。

## 四、会话、安全与存储

远程视图共享 `persist:job-agent-browser`，网站存储跨重启保留。权限请求被拒绝；没有多资料选择器。

- [可信窗口](../src/platform/electron/main/window.ts)和[远程视图](../src/platform/browser/webSegment.ts)禁用 Node 集成，启用上下文隔离和沙盒；远程网页安全检查保持启用。
- 浏览器、数据及 AI IPC 要求自有可信文档及顶层 frame，并校验输入。[Preload](../src/platform/electron/preload/index.ts) 只暴露命名操作，不暴露原始 `ipcRenderer`。
- 远程主 frame 导航/重定向只允许 HTTP(S)。HTTP(S) 弹窗新建应用标签；原生弹窗和其他协议被拒绝。远程页面不能进入内部路由或访问浏览器/数据桥接。
- [可信 HTML](../src/renderer/index.html) 保持 CSP。可信 UI 外部链接通过窗口创建逻辑使用操作系统浏览器。

Main 在创建窗口前打开存储并注册数据处理器，退出时关闭存储，启动失败时报告错误且不重置数据。[后端组装](../src/platform/database/backend.ts) 注入 Repository/事务并恢复中断生成任务。[数据架构](data-architecture.zh-CN.md)管理已实现的 SQLite、业务校验、持久化及不含内容的审计。

**已实现工具/MCP：**[Main](../src/platform/electron/main/index.ts)分别管理可选第三方能力消费与 [first-party 会话](../src/platform/mcp/first-party-client.ts)。四个内部 Agent 与外部宿主共用提供 27 个工具的 [Node Server](../src/platform/mcp-server/runtime.ts)，Caller 标识仅影响审计。Renderer 只暴露命名流程 IPC，不开放通用工具执行。[MCP 架构](mcp-architecture.zh-CN.md)管理注册、上限和退出，数据架构管理多进程恢复。

## 五、国际化

**已实现：**英文与[简体中文资源](../src/shared/i18n/locales/zh-CN.ts)支持保存语言选择。[英文资源](../src/shared/i18n/locales/en.ts)集中管理应用自有的页面文案、内部标题、提示气泡、无障碍标签、错误及原生启动对话框。[共享初始化](../src/shared/i18n/index.ts)通过打包资源在各进程分别创建 i18next 实例，同步初始化，默认及回退语言均为英文。不请求网络翻译资源，也不检测系统语言。

[App 翻译 Provider](../src/app/i18n.tsx)向 `useTranslation()` 提供同一个 Renderer 实例，并更新文档标题和语言。非 React 代码使用共享 `t` 函数；[Main](../src/platform/electron/main/index.ts)可在 React 启动前取词。[构建配置](../electron.vite.config.ts)从与原生窗口共用的英文资源注入 HTML 标题。完整句子模板插入标签/标题，React 将结果作为文本渲染。用户数据、网站标题/内容及仅用于诊断的异常不进入文案资源。Main 在创建窗口前加载保存的语言，通过浏览器快照发布；Renderer 的 Provider 跟随该语言。新的浏览器标题/错误使用当前语言；之前已捕获的错误文字不重新翻译。

**规划：**更多语言及系统语言检测。[翻译测试](../tests/i18n.test.ts)覆盖启动取词、回退、实例隔离、React 资源使用、插值安全及无效键的类型检查。

## 六、验证与限制

[个人资料 smoke](../scripts/profile-smoke.cjs)使用本地样本验证手动编辑、多事实分组、构建后的 PDF Worker/SSE、分批导入、分页/重载及双语主题/布局。[导入测试](../tests/profile-import.test.ts)、[会话测试](../tests/profile-session.test.ts)和 [PDF 测试](../tests/profile-pdf.test.ts)覆盖原子回滚、回执、窗口归属、精简草稿、PDF 限制与错误。[审计查看器 smoke](../scripts/audit-viewer-smoke.cjs)验证生产 IPC、筛选/分页/详情、只读语义、加载/失败/空状态、过期响应拒绝、键盘关闭及 320/640/1200px 布局；[查看器测试](../tests/audit-viewer.test.ts)覆盖 ID/时间校验、夏令时转换、包含边界的范围及筛选分页。[AI 测试](../tests/ai.test.ts)和[AI smoke](../scripts/ai-smoke.cjs)验证本地兼容 SSE、仅启动审计、取消、Provider 配置及真实 IPC。[集成测试](../tests/audit.test.ts) 验证存储/隐私保证；[导航 store 测试](../tests/navigation-store.test.ts) 覆盖订阅顺序与 StrictMode 清理。[Electron smoke](../scripts/smoke.cjs) 验证构建后的 Main/Preload、IPC 和来源拒绝。[浏览器 smoke](../scripts/browser-smoke.cjs) 覆盖标签、边界、快捷键、隔离与失败；[导航 smoke](../scripts/navigation-smoke.cjs) 覆盖功能入口 UI、混合回放、分叉/释放、SPA/重复历史、重载、过期可见性和加载竞争。[主题 smoke](../scripts/theme-smoke.cjs) 验证仅颜色的尺寸一致性、保存/草稿主题、原生变化和导航不变。[设置 smoke](../scripts/settings-smoke.cjs) 验证真实表单、双语重载、响应式尺寸、校验、离开确认、Inbox 导航和加密密钥生命周期；[重启 smoke](../scripts/settings-restart-smoke.cjs) 验证新的生产进程恢复设置。[Inbox smoke](../scripts/inbox-smoke.cjs) 使用本地测试页验证无顶部偏移的原生边界、无应用顶部条、重定向/历史/重载/弹窗、草稿保留、缩放、隔离和加载恢复。[侧栏 smoke](../scripts/sidebar-smoke.cjs)验证全部目标、当前状态、键盘激活、固定图标栏尺寸、提示名称及矮窗口可访问性。[窗口关闭 smoke](../scripts/window-close-smoke.cjs) 验证自有窗口关闭后释放保留视图。命令见 README 索引。

标签历史和上下文引用仅存于内存。网页段通过分叉或关闭标签/窗口释放；自动淘汰和跨重启恢复尚未实现。其余业务流程、登录态网页提取、完整 Shared Context 捕获及安装包仍未实现。

[职位导入测试](../tests/job-import.test.ts)覆盖 HTML 清洗、访问限制、超时/取消、字段白名单、手工值保留及初始状态；[新增工作 smoke](../scripts/job-smoke.cjs)通过本地 HTML/SSE 服务验证真实桥接、保存跳转、申请记录及双语主题布局。[并行导入测试](../tests/import-parallel.test.ts)、[排队测试](../tests/ai-queue.test.ts)和[生产 smoke](../scripts/import-parallel-smoke.cjs)验证分组隔离、有界调度、重试/取消、模型许可及双语布局。真实第三方招聘站点和账号兼容性未验证。

## 七、相关文档

- [README](../README.zh-CN.md)：启动、验证和文档索引。
- [产品架构](product-architecture.zh-CN.md)：产品规则和规划交付顺序。
- [代码架构](code-architecture.zh-CN.md)：源码职责和依赖边界。
- [V1 数据架构与 API](data-architecture.zh-CN.md)：持久化与业务接口。
