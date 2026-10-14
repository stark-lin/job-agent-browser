# Job Agent Browser

面向求职的本地优先桌面工作空间。状态：统一 React App、九个可访问 Home 入口、每标签混合导航及带自动审计和类型化 IPC 的分层 SQLite 业务后端**已实现**。设置、独立 Inbox 网页邮箱及兼容 OpenAI 的 SSE 对话**已实现**；其余五个功能入口为**占位**；业务流程与编译仍为**规划**。

语言：简体中文 · [English](README.md)

## 快速开始

需要 Node.js 22.12 或更新版本及 npm，以 [package.json](package.json) 为准。

```sh
npm install
npm run dev
```

首次开发启动时，`predev` 辅助程序下载 Electron 二进制文件。Home 九个卡片均可访问。Browser 打开可输入 URL、域名或搜索词的空白工作区，Settings 支持语言及浅色/暗夜/跟随系统外观持久化、多个 AI Provider、加密 API 密钥和邮箱配置；Ask AI 通过所选 Provider/模型流式对话；其他功能在流程尚不可用时显示待实现内容。只有 Browser 显示标签栏和地址控件；所有功能共用左侧工作区导航；已配置的 Inbox 显示网页邮箱，不显示应用顶部条。侧栏主页入口替代邮箱退出按钮。Home/新标签隐藏浏览器栏及内部 URL；Back/Forward 在每个标签内遍历内部页面与网站。导航规则、快捷键、运行细节及源码依据见[当前架构](docs/architecture.zh-CN.md)。

## 验证与构建

命令定义在 [package.json](package.json)：

```sh
npm run check
npm run test:smoke
npm run test:theme
```

构建根据 [electron.vite.config.ts](electron.vite.config.ts) 将 Main、Preload 和 Renderer 产物写入 `out/`。`check` 执行类型检查、架构/文档质量检查、Electron SQLite 集成测试及构建。`test:smoke` 需要图形桌面，使用临时数据验证构建后的窗口/Preload/IPC、九个入口页面、混合历史、视图生命周期、Settings、AI SSE 对话、全局侧栏及 Inbox。`test:theme` 独立验证主题、仅颜色的尺寸一致性及重启恢复，无需原生键盘焦点。单项命令为 `typecheck`、`quality`、`test` 和 `build`。平台安装包仍未配置。

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
| [设计纲要](DESIGN.zh-CN.md) · [English](DESIGN.md) | 视觉方向、交互原则与 UI 设计入口 |
| [组件库与设计规范](docs/design-system.zh-CN.md) · [English](docs/design-system.md) | 8px UI 规范、参考 HTML、可下载 CSS/Tokens 与验证 |
