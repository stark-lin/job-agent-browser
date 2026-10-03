# 当前运行架构

用途：记录已核实的运行行为。状态：浏览器基础、Home 和业务存储后端**已实现**；业务页面、AI 执行与编译仍为**规划**。

语言：简体中文 · [English](architecture.md)

## 一、运行入口与进程边界

[构建配置](../electron.vite.config.ts) 指定 [Main](../src/main/index.ts)、[Preload](../src/preload/index.ts) 和 [Renderer HTML 入口](../src/renderer/index.html)。[包入口](../package.json) 指向 `out/main/index.js`。

```text
React Renderer → window.browser / window.data → Preload → IPC → Main
                                                               ├── BrowserWindow / WebContentsView → Session
                                                               └── Domain services → SQLite + audit
```

[Main](../src/main/index.ts) 管理窗口生命周期和 IPC；[窗口创建逻辑](../src/main/window.ts) 创建可信 UI 与浏览器管理器。[Preload](../src/preload/index.ts) 按 [BrowserAPI](../src/shared/browser.ts) 暴露命名操作，包括导航、可见性、状态获取和订阅。

[BrowserManager](../src/main/browser/BrowserManager.ts) 为每个窗口管理一个持久网页视图，放在 64 像素工具栏下方，并在窗口缩放时更新边界。[Renderer App](../src/renderer/App.tsx) 切换 Home 与 Browser。[HomeGrid](../src/pages/home/HomeGrid.tsx) 仅启用 Browser，其余八个功能卡片禁用。

## 二、导航与状态

[NavigationController](../src/main/browser/NavigationController.ts) 去除输入首尾空白；包含空白时搜索 Google，无协议时补充 HTTPS，无法解析的 URL 输入转为搜索。空输入和非 HTTP(S) 协议被拒绝。Back 和 Forward 使用 `WebContents.navigationHistory`。

[BrowserManager](../src/main/browser/BrowserManager.ts) 在导航和加载事件后发布 URL、前进后退可用性及加载状态。网页初始隐藏。Home 隐藏视图而不销毁历史，重新打开 Browser 时再次显示。可信 Renderer 重载时也会隐藏网页。Home 切换不进入 Chromium 历史。

[AddressBar](../src/renderer/browser/AddressBar.tsx) 空闲时跟随浏览器状态，聚焦时保留用户输入。[BrowserWorkspace](../src/renderer/browser/BrowserWorkspace.tsx) 订阅状态、发起导航并展示错误。

## 三、会话与安全

[BrowserManager](../src/main/browser/BrowserManager.ts) 使用 `persist:job-agent-browser`，允许网站存储跨重启保留，并安装拒绝权限请求的处理器。当前共用一个会话分区，没有实现多配置选择器。

- [可信窗口](../src/main/window.ts) 与[远程网页视图](../src/main/browser/BrowserManager.ts) 禁用 Node 集成，启用上下文隔离和沙盒；远程网页保留 web security。
- [IPC 处理器](../src/main/index.ts) 检查发送方 webContents 是否属于 BrowserWindow，并校验导航和可见性参数类型。[Preload](../src/preload/index.ts) 不暴露原始 `ipcRenderer`。
- [远程导航](../src/main/browser/BrowserManager.ts) 阻止非 HTTP(S) 的 `will-navigate` 事件。拒绝弹窗；要求新窗口的 HTTP(S) 链接交给系统浏览器，其他协议丢弃。
- [可信 HTML 文档](../src/renderer/index.html) 设置受限的 Content Security Policy，外部网页独立承载。

[数据 IPC 处理器](../src/platform/electron/main/data-ipc.ts) 额外要求精确匹配的可信 Renderer 文档和顶层 frame。固定能力白名单与领域输入校验限制数据操作；不暴露原始 SQL、审计写入或生成阶段写入。

## 四、业务存储与限制

[Main](../src/main/index.ts) 在创建窗口前打开数据库并安装 `window.data` 处理器，退出时关闭存储。[后端组装](../src/platform/database/backend.ts) 将 Repository 和事务注入 Domain 用例，并恢复中断的生成任务。存储启动失败时不打开窗口，显示固定错误且不重置数据。

SQLite 迁移、业务持久化、不含业务内容的自动审计和类型化业务 IPC 已实现；规则与 API 由[数据架构](data-architecture.zh-CN.md) 负责。[集成测试](../tests/audit.test.ts) 验证事务/隐私保证；[Electron 冒烟测试](../scripts/smoke.cjs) 验证构建后的 Main、沙盒 Preload 和 IPC。验证命令由 README 索引。

[应用导航](../src/app/navigation/navigate.ts)、[上下文](../src/app/context/appContext.ts)、[AI](../src/platform/ai/index.ts) 和目标 [App](../src/app/App.tsx) 仍为占位。业务页面仍禁用。内部路由、混合历史、Shared Context、网页提取、AI 生成执行、编译、配置/密钥持久化和安装包尚未实现。

## 五、相关文档

- [README](../README.zh-CN.md)：启动、验证与文档索引。
- [产品架构](product-architecture.zh-CN.md)：规划范围与交付顺序。
- [代码架构](code-architecture.zh-CN.md)：目标组织与迁移边界。
- [V1 数据架构与 API](data-architecture.zh-CN.md)：已实现持久化及业务接口。
