# 工具与 MCP 运行时

用途：定义能力注册、受限执行及 MCP 集成。状态：审计工具、兼容 AgentModel/AgentLoop、共享 Resume 工作流能力、外部 MCP Client 及本地 stdio Resume Server 均**已实现**。Browser 工具及远程 Transport 仍为**规划**。

语言：简体中文 · [English](mcp-architecture.md)

## 一、归属与调用链

Main 创建唯一[运行时](../src/platform/mcp/runtime.ts)，注入已封装审计的能力。业务 Agent 接收仅类型的 [ToolScope 契约](../src/shared/tools/index.ts)，不接收 Registry 修改接口、SDK Client、SQL、审计写入器、Electron 对象或 Secret 读取器。Renderer 没有工具 IPC。

```text
Main-bound caller → ToolScope → validated Tool binding
                                  ↓
                         audited read / write capability
                                  ↓
                       Domain Service or MCP Client
```

[原生绑定](../src/platform/tools/native.ts)提供 `job.get`、`job.list`、`profile.get`、`profile.list`、`profile.list_facts` 和 `artifact.get`。`job.set_archived` 仍不向 Agent 注册。[Resume 绑定](../src/platform/tools/resume.ts)封装可信生成操作；`generation`、SQL、事务及 Secret 继续保留。存储/审计语义归属[数据架构](data-architecture.zh-CN.md#四审计与事务)。

[AI SSE 适配器](../src/platform/ai/compatible.ts)保留无工具的流式对话。[AgentModel](../src/shared/agent/index.ts)独立定义非流式消息、工具批次、最终文本、取消及错误；[兼容适配](../src/platform/agent/compatible.ts)共享配置/HTTP 基础，将含点名称无冲突地映射为 Provider 名称。每个已接受模型调用记录一次固定结果审计，不持久化提示词/输出。

## 二、注册与 Scope

[Registry](../src/shared/tools/registry.ts)拒绝重复名称和保留的可信操作命名空间。MCP 名称必须以配置中唯一的 Server ID 开头，不能占用原生命名空间。Server 整批工具先校验再替换。描述符经克隆和冻结，不含执行函数。

[策略](../src/shared/tools/policy.ts)要求明确提供 `allow`，空数组不授予能力。仅支持完整名称或 `profile.*` 形式的尾部命名空间通配符。Deny 优先，`*.delete` 和任意 glob 模式无效。风险顺序为 `READ < COMPUTE < WRITE < EXTERNAL_ACTION`，默认最高风险为 `READ`。

Scope 在创建时固定允许的条目、策略及 Main 绑定的调用身份，新工具不会进入已有 Scope。移除/替换撤销旧条目和进行中的调用；旧 Scope 不会自动绑定重连后的工具。释放 Scope 或取消调用方会终止当前调用。消费外部 MCP 的运行时仅接受 `READ / COMPUTE`；可信 Resume controller 和明确的 Resume Server 白名单使用原生 `WRITE` 能力。

通用 [AgentLoop](../src/platform/agent/loop.ts)每阶段最多调用模型 8 次。先记录完整 assistant 调用列表，再顺序执行工具并追加对应 observation。普通工具错误可作为 observation；取消和审计失败立即终止。空/非法输出、重复 call ID 及超限明确失败。不提供自动重试、fallback、planner、memory 或并行工具。

[共享 Resume 工具](../src/platform/tools/resume.ts)替代任务专用别名。内部模型仅获得绑定当前 run ID 的 `resume.get_context` 及分页 `resume.list_facts`，读取 `GenerationRun.inputSnapshot`。[Domain controller](../src/domain/resume/resume.agent.ts)接收写 Scope 和阶段 runner；Codex 经 MCP 提交同样的阶段载荷。两条路径共享描述符、校验、审计和 handler。内部模型 Scope 不含实时读取或外部 MCP 工具。

## 三、Provider 审核与转换

每个 [Provider](../src/platform/mcp/provider.ts)根据明确的本地审核清单筛选发现结果。清单管理应用名称、原始名称、描述、风险、标签、输入 Schema 和可选输出 Schema。上游描述、指令及风险提示不能授予权限或替换审核后的描述；未知工具被忽略。

[Schema 指纹](../src/platform/mcp/tool-adapter.ts)忽略对象属性顺序，但拒绝其他任何输入/输出 Schema 变化，包括增删 `outputSchema`。缺失或变化的工具被隔离。发现变更通知时先撤销当前批次，再刷新；刷新失败时保持不可用。不自动重连或重试执行，Main 可显式重连。

[校验](../src/platform/tools/schema.ts)支持对象输入及 JSON Schema 2020-12，包括本地引用。拒绝其他方言、远程引用和动态引用；不做类型转换、不填默认值、不删除字段。JSON 边界拒绝 getter、循环、非 JSON 值及超限/过深数据。

结果支持文本块和可选 JSON `structuredContent`，声明输出 Schema 时执行校验。`isError` 转换为稳定执行错误；图片、音频、资源读取及额外输入/交互流程暂不支持。SDK、进程及 Server 错误正文不会成为公开异常。

## 四、配置与生命周期

Main 通过[配置适配器](../src/platform/storage/mcp-config.ts)读取可选的版本 1 `userData/mcp.json`。文件缺失时不启动外部进程；文件无效时保留原文，产生不含敏感信息的诊断，不阻塞窗口。暂不提供 Settings UI、凭据字段、OAuth 或自动安装。配置及 Secret 存储规则归属[数据架构](data-architecture.zh-CN.md#六配置密钥与待完成工作)。

以下人工审核示例与[测试 Server](../tests/fixtures/mcp-server.mjs)的 `echo` Schema 一致。须将可执行文件和脚本路径替换为已安装文件的绝对路径；接入其他 Server 时必须审核其真实 Schema，不能原样照搬清单。

```json
{
  "version": 1,
  "servers": [{
    "id": "example",
    "enabled": true,
    "transport": "stdio",
    "command": "/absolute/path/node",
    "args": ["/absolute/path/server.mjs"],
    "tools": [{
      "name": "example.echo",
      "originalName": "echo",
      "description": "Echo supplied text.",
      "risk": "READ",
      "inputSchema": {
        "type": "object",
        "properties": { "text": { "type": "string" } },
        "required": ["text"],
        "additionalProperties": false
      }
    }]
  }]
}
```

[SDK v2 Client](../src/platform/mcp/client.ts)通过 stdio 使用默认的旧版初始化握手，不经 shell 启动绝对路径命令，使用 SDK 限定的环境变量继承，丢弃 stderr，不注入应用凭据。使用 Electron 自身可执行文件时选择其 Node 模式。本地进程属于受信任的可执行程序，不是操作系统沙盒。

[连接池](../src/platform/mcp/client-pool.ts)合并待完成连接，拒绝 Server ID 配置冲突。发现最多聚合 16 页/500 个工具；连接和发现各有 10 秒上限。调用默认 30 秒、最高 120 秒，每 Server 最多并发 4 个请求，全局最多 16 个活动能力，超限立即失败。Schema/输入限制 64 KiB，结果 1 MiB，Transport 消息 2 MiB，嵌套 32 层，JSON 节点 16,384 个。

Main 在后台启动可选连接。断连时撤销工具并终止其本地等待。超时/取消会通知 Server，即使操作忽略信号，本地调用也会结束，但不保证远端副作用已撤销。单次取消不关闭共享连接。退出时先撤销 Scope、完成调用审计并关闭 Client，再关闭 SQLite；SDK 关闭 stdin，随后按有界清理流程逐级终止进程。

## 五、Resume Server 与 Codex

[Node 入口](../src/platform/mcp-server/stdio.ts)要求显式 `JOB_BROWSER_USER_DATA`，其中必须已有 `database.sqlite`；不猜测目录或创建空工作区。使用带 `DatabaseSync.setAuthorizer` 的 Node >=24.10。[构建入口](../electron.vite.config.ts)生成 `out/main/job-agent-mcp.js` 和 `out/main/resume-output-worker.js`；Server SDK 属于运行依赖。

完成 README 的构建/链接命令后，将以下示例加入 Codex 用户配置或可信项目配置，并替换绝对路径。见[官方 MCP 配置](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。直接启动 Node 入口，使 stdout 只包含 MCP 消息。

```toml
[mcp_servers.job_agent_browser]
command = "/absolute/path/node"
args = ["/absolute/path/job-agent-browser/out/main/job-agent-mcp.js"]
tool_timeout_sec = 100

[mcp_servers.job_agent_browser.env]
JOB_BROWSER_USER_DATA = "/absolute/path/existing-user-data"
```

[适配器](../src/platform/mcp-server/tool-adapter.ts)转换描述符/结果；[Server](../src/platform/mcp-server/server.ts)只列出 Scope 内描述符并调用 `ToolScope.execute()`。错误只含固定代码；取消传到 handler 和 Worker 进程。EOF/退出先完成调用清理再关闭 SQLite。[运行时](../src/platform/mcp-server/runtime.ts)不初始化应用 AI 设置、凭据、模型或外部 MCP Client。

| 公开能力 | 契约 |
| --- | --- |
| `job.list`, `profile.list` | 选择已保存的输入 ID |
| `resume.start` | 原子快照/启动及同会话请求 UUID 回执 |
| `resume.get_context`, `resume.list_facts` | 不可变上下文/进度/文档及分页事实 |
| `resume.submit_scores`, `resume.submit_gate`, `resume.submit_selection` | 接受下一阶段；相同重试返回已接受状态 |
| `resume.submit_draft`, `resume.submit_polished` | 只接受 writing；应用从快照补齐元数据 |
| `resume.publish`, `resume.cancel` | 发布一次或取消自有未完成 run |
| `artifact.build`, `artifact.get` | 构建 HTML/PDF、返回本地路径及查看文档/溯源 |

[白名单和 Schema](../src/platform/tools/resume.ts)将最高风险限定为 `WRITE`，不含 `EXTERNAL_ACTION`。快照上限为 1000 Facts、200 条目、256 KiB 上下文及每条 Fact 8 KiB。事实每页最多 100 条。评分理由最多 512 字符；评分输入允许 1 MiB，writing 输入允许 512 KiB；其他输入/结果/深度/节点限制不变。进度/溯源视图也必须符合结果容量；容量失败在创建/变更前拒绝。阶段冲突失败；结构校验不证明语义真实。

[共享输出服务](../src/platform/resume-output/service.ts)管理状态/文件。MCP 使用可取消的 [Electron Worker 适配器](../src/platform/resume-output/worker-client.ts)，无需主应用窗口，但仍需要图形 Electron 环境。二进制文件来自已安装 Electron 包或 `JOB_BROWSER_ELECTRON`。UI 与 Worker 复用 exporter、分页及固定字体。输出失败可无模型调用重建；生命周期归属由数据架构管理。

双语 [Skill](../skills/tailor-resume/SKILL.zh-CN.md)说明五个推理阶段，[工作流常量](../src/domain/resume/workflow.ts)定义阶段/工具顺序。`skill:link` 创建仓库 `.agents/skills/tailor-resume` 符号链接。运行时不把 Skill 文字加载为业务规则。发现未刷新时重启宿主，见[官方 Skill 发现规则](https://learn.chatgpt.com/docs/build-skills)。

## 六、验证与后续交付

[工具测试](../tests/tools.test.ts)、[MCP 测试](../tests/mcp.test.ts)和[能力审计测试](../tests/capability-audit.test.ts)覆盖权限、撤销、输入/输出/隐私边界、真实分页 stdio、Schema 变化、错误、超时、取消、不可变审计及本地写事务。

[运行时 smoke](../scripts/run-mcp-smoke.cjs)将实际组装模块按 CJS 和生产依赖外置规则打包，在 Electron Node 运行时中执行，使用临时存储验证 Native/MCP 调用、写审计、取消、断连/重连、重启恢复及子进程清理。命令归属 [README](../README.zh-CN.md)。

[Resume 工具测试](../tests/resume-tools.test.ts)、[运行时一致性](../tests/resume-runtime-parity.test.ts)、[租约测试](../tests/runtime-leases.test.ts)及 [Server smoke](../scripts/run-mcp-server-smoke.cjs)覆盖共享 handler、归属、真实 stdio 和 Electron 输出。**规划：**真实第三方服务、HTTP/OAuth、Browser 适配、Resources/Prompts、多模态结果、高风险确认、自动安装及能力审计查看器。本地样本测试不证明 Windows/Linux 兼容性或宿主自动调用已验证。

## 相关文档

- [代码架构](code-architecture.zh-CN.md)：依赖与进程边界。
- [数据架构](data-architecture.zh-CN.md)：带审计的 read/write 持久化及配置。
- [当前架构](architecture.zh-CN.md)：应用运行行为及限制。
