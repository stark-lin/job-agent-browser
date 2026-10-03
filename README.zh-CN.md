# Job Agent Browser

面向求职的本地优先桌面工作空间。状态：浏览器基础、九宫格 Home 及带自动审计和类型化 IPC 的分层 SQLite 业务后端**已实现**。业务页面、AI 执行与编译仍为**规划**；配置/密钥为**占位**。

语言：简体中文 · [English](README.md)

## 快速开始

需要 Node.js 22.12 或更新版本及 npm，以 [package.json](package.json) 为准。

```sh
npm install
npm run dev
```

首次开发启动时，`predev` 辅助程序下载 Electron 二进制文件。在 Home 选择 Browser 后，可输入 URL、域名或搜索词。Back 和 Forward 使用 Chromium 历史；Home 隐藏网页，重新打开 Browser 保留页面与历史。其余八个卡片禁用。运行细节及源码依据见[当前架构](docs/architecture.zh-CN.md)。

## 验证与构建

命令定义在 [package.json](package.json)：

```sh
npm run check
npm run test:smoke
```

构建根据 [electron.vite.config.ts](electron.vite.config.ts) 将 Main、Preload 和 Renderer 产物写入 `out/`。`check` 执行类型检查、架构/文档质量检查、Electron SQLite 集成测试及构建。`test:smoke` 需要图形桌面，使用临时数据验证构建后的窗口/Preload/IPC。单项命令为 `typecheck`、`quality`、`test` 和 `build`。平台安装包仍未配置。

文档修改应检查双语含义、实现状态、相对链接、Mermaid 一致性和篇幅限制，并检查 `git diff --check` 的结果。

## 文档索引

| 文档 | 用途 |
| --- | --- |
| [文档规范](AGENTS.zh-CN.md) · [English](AGENTS.md) | 内容归属、语言、篇幅限制与审查要求 |
| [当前架构](docs/architecture.zh-CN.md) · [English](docs/architecture.md) | 已实现的运行架构、安全边界与限制 |
| [产品架构](docs/product-architecture.zh-CN.md) · [English](docs/product-architecture.md) | 规划范围、入口与交付顺序 |
| [代码架构](docs/code-architecture.zh-CN.md) · [English](docs/code-architecture.md) | 目标组织、依赖边界与迁移约束 |
| [V1 数据架构与 API](docs/data-architecture.zh-CN.md) · [English](docs/data-architecture.md) | 已实现实体、事务、审计隐私、删除规则及业务 API |
| [共享 Mermaid ER 图](docs/diagrams/data-model.md) | 已实现的 11 表模型，由中英文数据架构共用 |
