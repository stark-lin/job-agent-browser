# 当前运行架构

用途：记录已验证的运行行为。状态：React 应用组装、九个可访问入口、每标签混合导航、浏览器基础及业务存储**已实现**。业务流程、AI 执行与编译仍为**规划**；业务页面 UI 为**占位**。

语言：简体中文 · [English](architecture.md)

## 一、运行入口与进程边界

[构建配置](../electron.vite.config.ts) 使用 [Main](../src/platform/electron/main/index.ts)、[Preload](../src/platform/electron/preload/index.ts) 和 [Renderer HTML 入口](../src/renderer/index.html)。[包入口](../package.json) 保持 `out/main/index.js`。

```text
React App → Page → window.browser / window.data → Preload → IPC → Main
                                                               ├── Mixed history + WebContentsView → Session
                                                               └── Domain services → SQLite + audit
```

[Renderer 启动代码](../src/renderer/main.tsx) 在 StrictMode 中挂载唯一 [App](../src/app/App.tsx)。[Provider](../src/app/providers.tsx) 注入受限浏览器/数据桥接和上下文；[导航 store](../src/app/navigation/navigationStore.ts) 在每次 Provider 生命周期中订阅一次，忽略旧快照及已清理的初始化读取。[路由](../src/app/router.tsx) 根据 Main 的当前目标选择 React 页面，不导航可信文档。

只有 [BrowserPage](../src/pages/browser/BrowserPage.tsx) 渲染标签、地址输入与浏览器控件。Home 和业务页面不显示浏览器栏或内部 URL。[HomeGrid](../src/pages/home/HomeGrid.tsx) 启用全部九个卡片。八个业务页面明确显示待实现说明和页面内 Back/Home，不实现业务流程；Inbox 可进入 Settings 占位页。

## 二、路由与混合历史

[目标契约](../src/shared/navigation.ts) 白名单包含 `app://home`、`app://find`、`app://resume`、`app://interview`、`app://applications`、`app://inbox`、`app://profile`、`app://browser`、`app://ai` 和 `app://settings`。内部 URL 是导航标识，不是已注册的操作系统协议或 Chromium 加载的文档。未知内部目标在修改历史前拒绝。公开 URL 由[产品架构](product-architecture.zh-CN.md)管理。

[BrowserManager](../src/platform/browser/browserManager.ts) 管理标签、当前目标及版本化快照。每个标签从 Home 开始。Home 新增内部历史项；新建或关闭最后一个标签后创建新的 Home。选择 Browser 新增空白浏览器工作区，地址框为空。切换标签不新增历史；关闭活动标签选择右侧邻居，无右侧时选择左侧。

[MixedHistory](../src/platform/browser/mixedHistory.ts) 将内部历史项与连续网页历史段组合。每个 [WebSegment](../src/platform/browser/webSegment.ts) 保留自己的原生视图与 Chromium 历史。Back/Forward 先遍历段内原生索引，再跨越内部项/网页段。进入内部页面只隐藏现有视图，不导航或销毁它，直接返回时保留当前网页状态。正常 Chromium 历史回放可能重新加载较早文档。

后退后发起新导航会裁剪应用前进栈和当前段的原生前进项。不可达段被关闭；关闭标签/窗口释放全部保留视图。网站链接、重定向和 SPA 导航更新原生历史，历史回放及替换不新增应用项。重复 URL 保留原生项身份。私有 [Chromium 历史观察器](../src/platform/browser/nativeHistory.ts)通过内部调试协议读取稳定项 ID，区分新访问与网站自身的历史回放，不注入页面脚本或暴露调试桥接。加载/错误事件归属原段，不会激活后台标签或内部页面。

[网页输入解析](../src/platform/browser/navigationManager.ts) 保留 HTTP(S)，识别域名/IP/localhost，其他输入使用 Google 搜索。裸地址默认 HTTPS，localhost 和回环地址默认 HTTP。空输入、无效显式网址及其他协议被拒绝。[测试](../tests/navigation.test.ts) 保留这些规则；[混合历史测试](../tests/mixed-history.test.ts) 覆盖内部路由与段间回放/分叉。

## 三、展示与交互

只有活动网页段可见，位于 Browser 的 44 像素标签栏和 64 像素工具栏下方，随窗口调整边界。目标切换先隐藏全部原生视图，直到 BrowserPage 提交后确认当前标签/目标。过期可见性请求被忽略。Renderer 重载期间隐藏视图，Provider 重新订阅后恢复 Main 的目标/历史，不将标签重置为 Home。

[TabStrip](../src/pages/browser/TabStrip.tsx) 支持新建、选择、关闭、滚动及方向键/Home/End 选择。内部目标以页面标题作为标签名称，不渲染 `app://` 文本。[AddressBar](../src/pages/browser/AddressBar.tsx) 在空闲时跟随状态，聚焦时保留编辑草稿；切换标签会重置输入。

[快捷键](../src/platform/browser/shortcuts.ts) 在可信 Renderer 和原生网页中生效：macOS 的 `Cmd+T/W` 或其他平台的 `Ctrl+T/W` 新建/关闭标签；`Ctrl+Tab` 和 `Ctrl+Shift+Tab` 切换标签。`Cmd+L`/`Ctrl+L` 仅在 Browser 聚焦并选择地址。`Alt+Left/Right` 遍历混合历史，也适用于没有浏览器栏的内部页面。

[App Context](../src/app/context/appContext.ts) 提供当前页面的标签/标题/目标及可空 Job、Profile、Artifact ID。[引用 store](../src/app/context/contextStore.ts) 初始为空，不复制实体、提取网页内容或自动选择业务记录。

## 四、会话、安全与存储

远程视图共享 `persist:job-agent-browser`，网站存储跨重启保留。权限请求被拒绝；没有多资料选择器。

- [可信窗口](../src/platform/electron/main/window.ts)和[远程视图](../src/platform/browser/webSegment.ts)禁用 Node 集成，启用上下文隔离和沙盒；远程网页安全检查保持启用。
- 浏览器和数据 IPC 要求自有可信文档及顶层 frame，并校验输入。[Preload](../src/platform/electron/preload/index.ts) 只暴露命名操作，不暴露原始 `ipcRenderer`。
- 远程主 frame 导航/重定向只允许 HTTP(S)。HTTP(S) 弹窗新建应用标签；原生弹窗和其他协议被拒绝。远程页面不能进入内部路由或访问浏览器/数据桥接。
- [可信 HTML](../src/renderer/index.html) 保持 CSP。可信 UI 外部链接通过窗口创建逻辑使用操作系统浏览器。

Main 在创建窗口前打开存储并注册数据处理器，退出时关闭存储，启动失败时报告错误且不重置数据。[后端组装](../src/platform/database/backend.ts) 注入 Repository/事务并恢复中断生成任务。[数据架构](data-architecture.zh-CN.md)管理已实现的 SQLite、业务校验、持久化及不含内容的审计。

## 五、验证与限制

[集成测试](../tests/audit.test.ts) 验证存储/隐私保证；[导航 store 测试](../tests/navigation-store.test.ts) 覆盖订阅顺序与 StrictMode 清理。[Electron smoke](../scripts/smoke.cjs) 验证构建后的 Main/Preload、IPC 和来源拒绝。[浏览器 smoke](../scripts/browser-smoke.cjs) 覆盖标签、边界、快捷键、隔离与失败；[导航 smoke](../scripts/navigation-smoke.cjs) 覆盖功能入口 UI、混合回放、分叉/释放、SPA/重复历史、重载、过期可见性和加载竞争。[窗口关闭 smoke](../scripts/window-close-smoke.cjs) 验证自有窗口关闭后释放保留视图。命令见 README 索引。

标签历史和上下文引用仅存于内存。网页段通过分叉或关闭标签/窗口释放；自动淘汰和跨重启恢复尚未实现。业务流程、网页提取、AI 生成执行、编译、完整 Shared Context 捕获、邮箱配置、配置/密钥持久化和安装包仍未实现。

## 六、相关文档

- [README](../README.zh-CN.md)：启动、验证和文档索引。
- [产品架构](product-architecture.zh-CN.md)：产品规则和规划交付顺序。
- [代码架构](code-architecture.zh-CN.md)：源码职责和依赖边界。
- [V1 数据架构与 API](data-architecture.zh-CN.md)：持久化与业务接口。
