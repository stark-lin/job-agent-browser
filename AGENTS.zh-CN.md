# 文档约束

语言：简体中文 · [English](AGENTS.md)

适用于本仓库文档的新增与修改；存量文档在实质修改时按本规范收敛。

## 文档分工

| 文档 | 唯一职责 |
| --- | --- |
| [README.md](README.md) · [中文](README.zh-CN.md) | 项目简介、快速开始、验证命令、文档索引。 |
| [docs/architecture.md](docs/architecture.md) · [中文](docs/architecture.zh-CN.md) | 当前运行架构、已实现行为、限制及源码依据。 |
| [docs/product-architecture.md](docs/product-architecture.md) · [中文](docs/product-architecture.zh-CN.md) | 产品目标、范围与开发顺序；明确标为规划。 |
| [docs/code-architecture.md](docs/code-architecture.md) · [中文](docs/code-architecture.zh-CN.md) | 目标代码组织、依赖边界与迁移约束；区分现状与目标。 |
| [DESIGN.md](DESIGN.md) · [中文](DESIGN.zh-CN.md) | 视觉方向、交互原则与设计入口；具体组件规则仍归设计规范。 |
| [docs/design-system.md](docs/design-system.md) · [中文](docs/design-system.zh-CN.md) | 共享 UI 规范、组件参考展示库、Design Tokens 与设计验证。 |
| [docs/data-architecture.md](docs/data-architecture.md) · [中文](docs/data-architecture.zh-CN.md) | 当前及规划的 V1 数据模型、业务数据 API、生成、溯源、审计与存储；拥有共享 [ER 图](docs/diagrams/data-model.md)。 |
| [docs/mcp-architecture.md](docs/mcp-architecture.md) · [中文](docs/mcp-architecture.zh-CN.md) | 工具注册、Agent Scope、带审计能力绑定、MCP Provider/Client 行为及生命周期。 |
| [CI/CD](docs/ci-cd.zh-CN.md) · [English](docs/ci-cd.md) | 分支集成、验证、模型来源、打包、签名与发布运维。 |

新增文档前先检查上表；只有独立主题无法合理归入现有文档时才新建，并在 README 索引中添加链接。

## 中英文独立文件

- 中英文必须分文件：英文使用 `name.md`，简体中文使用 `name.zh-CN.md`，包括 `README` 和 `AGENTS`。禁止在同一文件中混排双语段落、标题或表格列；允许语言切换链接。
- 配对文件必须相互提供语言链接、保持章节顺序和内容含义一致，并在同一变更中同步。单语文档实质修改时补齐缺失的语言版本。
- 路径、命令、标识符保持原样；两个版本的代码块、目录树和图表保持一致，可共用的资源优先链接引用。

## 结构与篇幅

- 先写用途和状态，再写必要正文，最后列相关链接；只保留适用章节，标题不超过三级。
- README 每个语言版本不超过 120 行，专题文档每个语言版本不超过 200 行，均含空行和代码块。超出先删减重复和非必要示例，再按独立主题拆分，禁止为凑行数合并长段落。

## 与实现对齐

- 明确区分已实现、占位、规划；目录、注释或示例接口存在不代表能力已实现。
- 描述当前行为前核对运行入口、调用路径、配置及已有测试，并在相关段落链接具体源码；命令以 `package.json` 为准，构建入口以 `electron.vite.config.ts` 为准。
- 行为、接口、目录或配置变化时，同一变更中更新对应文档及翻译。当前事实与源码冲突时修正文档；尚未实现的目标保留规划标记，未经验证的内容明确说明。

## 避免重复与提交检查

- 每个主题只在所属文档详细说明，其他位置用一句摘要和相对链接引用；翻译视为同一主题。不要复制完整接口、目录清单、安装步骤或产品流程；源码能直接表达的细节优先链接。
- 提交前检查：双语含义一致、状态与实现匹配、路径和链接有效、篇幅合规、无重复正文；运行与变更相关的验证，并如实记录未验证项。

## UI 设计规范

- UI 新增和修改遵循[组件库规范](docs/design-system.zh-CN.md)，间距、尺寸、排版、圆角和语义色使用共享 Tokens。
- 所有 UI 组件必须通过 `src/shared/ui/index.ts` 引用中央组件库；页面和业务组件由中央基础组件组合，缺失的基础组件或变体必须先加入中央库。页面可定义布局与行为，不得重复编写控件结构/样式或通过内联样式覆盖中央外观。
- 修改权威 Tokens 时同步生成共享 CSS/浏览器尺寸，运行设计验证和相关运行检查；参考展示库与两个语言版本的规范保持一致。

## Agent 能力边界

- 所有由 Agent 发起的业务能力调用必须跨越 Job Agent Browser MCP 协议边界，包括流程提交、持久化、取消、失败收尾和产物构建。
- `ToolScope` 是服务端实现细节，不得作为 Agent 接口。Agent 代码使用 `AgentModel`、`AgentTools` 和纯流程契约；禁止导入 Domain Service/Repository、数据库适配器或工具 Registry，也不得通过重新导出或动态导入绕过。
- 宿主资料读取和模型推理在业务 MCP 外完成。`job.import` 仅保存结构化数据。人工表单和只读 UI 投影可继续使用 typed IPC 与 Domain 服务。

## Git 集成

创建或复用 `dev` 集成分支。改动先推送到 `dev`，再通过 `CI required` 成功的 PR 将其合入 `main`。功能分支使用 `codex/` 前缀并以 `dev` 为目标。不要直接向 `main` 推送实现提交。`main` 更新负责自动发布，普通集成不得绕过 CI。
