# Job Agent Browser

面向求职的本地优先桌面工作空间。状态：React 导航、Browser/Inbox、设置、流式 AI、SQLite/审计、个人资料编辑/PDF 导入、职位采集/申请及包含 HTML/PDF 的 Resume Agent V1 均**已实现**。智能笔记已实现；更多产品流程仍为**规划**。

语言：简体中文 · [English](README.md)

## 快速开始

需要 Node.js 24.10 或更新版本及 npm，以 [package.json](package.json) 为准。

```sh
npm install
JOB_BROWSER_USER_DATA=/tmp/job-agent-browser-resume-v1 npm run dev
```

首次开发启动时，`predev` 辅助程序下载 Electron 二进制文件。Home 九个卡片均可访问。Browser 打开可输入 URL、域名或搜索词的空白工作区，Settings 支持语言及浅色/暗夜/跟随系统外观持久化、多个 AI Provider、加密 API 密钥和邮箱配置；Ask AI 通过限定的 first-party MCP 工具提供持久化多会话流式 Agent 对话；My Profile 管理包含多个事实的履历条目及经核对的 PDF 导入；新增工作支持手工录入与 URL/文本/PDF Agent 采集，保存为未开始申请后进入申请记录；申请记录通过 Agent 管理状态、备注、本地日程及归档/详情变更；其他功能在流程尚不可用时显示待实现内容。只有 Browser 显示标签栏和地址控件；所有功能共用带悬停提示和分区短横线的左侧图标导航；已配置的 Inbox 显示网页邮箱，不显示应用顶部条。侧栏主页入口替代邮箱退出按钮。Home/新标签隐藏浏览器栏及内部 URL；Back/Forward 在每个标签内遍历内部页面与网站。导航规则、快捷键、运行细节及源码依据见[当前架构](docs/architecture.zh-CN.md)。

配置 AI 服务、密钥及全局默认模型后，即可采集职位 URL/文本/PDF、管理申请或导入 PDF 简历；在设置中为该模型开启并行导入并保存后，可在两个导入入口分别选择并行模式。分组、重试及精简输出的运行说明见[当前架构](docs/architecture.zh-CN.md)。

## 验证与构建

命令定义在 [package.json](package.json)：

```sh
npm run check
npm run test:smoke
npm run test:theme
npm run test:jobs
npm run test:mcp
npm run test:mcp-server
npm run test:integrations
npm run test:agent
npm run test:profile
npm run test:ask-ai
```

构建根据 [electron.vite.config.ts](electron.vite.config.ts) 将 Main、MCP Server、输出 Worker、Preload 和 Renderer 产物写入 `out/`。`check` 执行类型检查、架构/文档质量检查、Electron SQLite 集成测试及构建。`test:smoke` 需要图形桌面，使用临时数据验证构建后的窗口/Preload/IPC、九个入口页面、混合历史、视图生命周期、Settings、AI SSE 对话、个人资料编辑/PDF 导入、新增工作/申请记录、全局侧栏及 Inbox。`test:theme` 独立验证主题、仅颜色的尺寸一致性及重启恢复，无需原生键盘焦点。`test:jobs` 独立验证新增工作、URL/文本/PDF 采集、申请 Agent 动作及两种并行导入及进程重启持久化。单项命令为 `typecheck`、`quality`、`test` 和 `build`。平台打包已配置于 [electron-builder.yml](electron-builder.yml)，验收及发布前置条件见 [CI/CD](docs/ci-cd.zh-CN.md)。

`test:mcp` 验证现有 MCP Client 运行时。`test:mcp-server` 验证 Job/Application/Resume 公共能力、运行时一致性及构建后的 Node stdio Server，使用临时存储和真实 Electron HTML/PDF 输出。两种运行时 smoke 均纳入 `check`；Server PDF 验证需要图形桌面。见 [MCP 架构](docs/mcp-architecture.zh-CN.md)。

`test:integrations` 构建并使用临时配置目录验证外部 Agent 的 MCP/Skills 接入、重新连接、确认后的单项/全部删除、过期版本、可信 IPC 以及双语响应式主题，需要图形桌面。

`test:agent` 组合 Agent/溯源/数据库测试及真实 Electron UI 和多页 PDF 样本，使用临时 userData 与本地兼容模型服务。`test:profile` 独立验证 Profile 编辑/导入及双语布局，均不依赖付费模型。[CI](docs/ci-cd.zh-CN.md)覆盖 macOS arm64 发布目标的 PDF 渲染；真实 Provider 兼容性及 CI 之外的干净机器行为仍未验证。Resume V1 需要新数据库世代，旧库明确拒绝，不迁移或删除。

`test:ask-ai` 验证会话存储、流式适配/循环、真实 MCP 读写及事件重同步，再通过 Electron 验证并发会话、停止、草稿、Markdown、双语主题、响应式布局及强制结束进程后的恢复。测试使用本地样本与临时 userData；真实 Provider 的思考摘要/工具兼容性仍未认证。V6 对匹配代际的数据库进行增量升级。

文档修改应检查双语含义、实现状态、相对链接、Mermaid 一致性和篇幅限制，并检查 `git diff --check` 的结果。

接入本机 Codex、Claude Code 或 Cursor 时，打开设置 → 连接外部 Agent → 添加 MCP，再单独点击“安装 Skills”安装五个内置工作流。其他 Agent 可通过“打开 Skills 文件夹”复制；`npm run skill:link` 保留为仅用于仓库的替代方式。[MCP 接入说明](docs/mcp-architecture.zh-CN.md#五job-agent-browser-mcp)管理接入及限制。Codex 生成无需应用 AI Provider。

## 打包与集成

普通 `build` 保持离线且不要求模型存在。本地语义搜索先准备一次模型；打包时会自动下载并校验。全新安装在测试前需要运行 `npx --no-install install-electron`。

```sh
npm run model:prepare
npm run model:verify
npm run test:embedding
npm run test:release
npm run package:dir
npm run package:mac
npm run package:verify -- /absolute/path/to/unpacked-app
```

改动先集成到 `dev`，再通过检查成功的 PR 将 `dev` 合入 `main`。`dev` 更新运行 CI；`main` 更新自动验证、构建 macOS arm64 并发布对应预发布版本。预览安装包默认不签名，严格签名须先配置。[CI/CD](docs/ci-cd.zh-CN.md)负责 runner、签名、重试及分支保护说明。

## 文档索引

| 文档 | 用途 |
| --- | --- |
| [文档规范](AGENTS.zh-CN.md) · [English](AGENTS.md) | 内容归属、语言、篇幅限制与审查要求 |
| [CI/CD](docs/ci-cd.zh-CN.md) · [English](docs/ci-cd.md) | 分支集成、自动验证、打包、签名与发布运维 |
| [当前架构](docs/architecture.zh-CN.md) · [English](docs/architecture.md) | 已实现的运行架构、安全边界与限制 |
| [产品架构](docs/product-architecture.zh-CN.md) · [English](docs/product-architecture.md) | 规划范围、入口与交付顺序 |
| [代码架构](docs/code-architecture.zh-CN.md) · [English](docs/code-architecture.md) | 目标组织、依赖边界与迁移约束 |
| [V1 数据架构与 API](docs/data-architecture.zh-CN.md) · [English](docs/data-architecture.md) | 已实现实体、事务、审计隐私、删除规则及业务 API |
| [工具与 MCP 运行时](docs/mcp-architecture.zh-CN.md) · [English](docs/mcp-architecture.md) | 受限工具、带审计能力绑定、stdio 接入及生命周期 |
| [职位采集 Skill](skills/capture-job/SKILL.zh-CN.md) · [English](skills/capture-job/SKILL.md) | 宿主理解资料后通过 MCP 保存结构化结果 |
| [申请管理 Skill](skills/manage-applications/SKILL.zh-CN.md) · [English](skills/manage-applications/SKILL.md) | 状态、备注、本地事件、详情及归档流程 |
| [Resume Skill](skills/tailor-resume/SKILL.zh-CN.md) · [English](skills/tailor-resume/SKILL.md) | Codex 使用共享 Resume 工具的推理流程；接入配置归属 MCP 架构 |
| [共享 Mermaid ER 图](docs/diagrams/data-model.md) | 已实现的 20 表模型，由中英文数据架构共用 |
| [设计纲要](DESIGN.zh-CN.md) · [English](DESIGN.md) | 视觉方向、交互原则与 UI 设计入口 |
| [组件库与设计规范](docs/design-system.zh-CN.md) · [English](docs/design-system.md) | 8px UI 规范、参考 HTML、可下载 CSS/Tokens 与验证 |

## 智能笔记知识库

智能笔记以唯一本地 Markdown 文件树提供编辑/分栏/预览、恢复快照、可选 GitHub 备份与混合检索。用户和 MCP Agent 共用知识库，新安装默认启用内置离线 embedding 模型，已有明确关闭选择会保留。见[知识存储](docs/data-architecture.zh-CN.md)与 [MCP 工具](docs/mcp-architecture.zh-CN.md)。
