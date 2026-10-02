# Job Agent Browser

面向求职的本地优先桌面工作空间。状态：浏览器基础和九宫格 Home **已实现**；业务模块为**占位**；职位管理、个人事实、简历生成与 V1 数据模型仍为**规划**。

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
npm run typecheck
npm run build
```

构建根据 [electron.vite.config.ts](electron.vite.config.ts) 将 Main、Preload 和 Renderer 产物写入 `out/`。目前没有配置测试命令或平台安装包。构建成功不代表规划中的产品能力已通过验证。

文档修改应检查双语含义、实现状态、相对链接、Mermaid 一致性和篇幅限制，并检查 `git diff --check` 的结果。

## 文档索引

| 文档 | 用途 |
| --- | --- |
| [文档规范](AGENTS.zh-CN.md) · [English](AGENTS.md) | 内容归属、语言、篇幅限制与审查要求 |
| [当前架构](docs/architecture.zh-CN.md) · [English](docs/architecture.md) | 已实现的运行架构、安全边界与限制 |
| [产品架构](docs/product-architecture.zh-CN.md) · [English](docs/product-architecture.md) | 规划范围、入口与交付顺序 |
| [代码架构](docs/code-architecture.zh-CN.md) · [English](docs/code-architecture.md) | 目标组织、依赖边界与迁移约束 |
| [V1 数据架构](docs/data-architecture.zh-CN.md) · [English](docs/data-architecture.md) | 规划实体、生成流程、溯源、审计与存储 |
| [共享 Mermaid ER 图](docs/diagrams/data-model.md) | 完整的 11 表规划模型，由中英文数据架构共用 |
