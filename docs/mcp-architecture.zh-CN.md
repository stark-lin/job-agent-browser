# 工具与 MCP 运行时

用途：定义能力注册、受限执行及 MCP 集成。状态：Main 管理的 Native/stdio 工具、审计能力、兼容 AgentModel/AgentLoop 和 ResumeAgent 快照工具均**已实现**。Browser 工具及远程 Transport 仍为**规划**。

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

[原生绑定](../src/platform/tools/native.ts)明确提供 `job.get`、`job.list`、`profile.get`、`profile.list_facts` 和 `artifact.get`。仅 Main 可用的 `job.set_archived` 写能力复用 Domain Service，但不向 Agent 注册。生成阶段持久化、事务、原始 SQL 和 Secret 永不成为工具绑定。存储/审计语义归属[数据架构](data-architecture.zh-CN.md#四审计与事务)。

[AI SSE 适配器](../src/platform/ai/compatible.ts)保留无工具的流式对话。[AgentModel](../src/shared/agent/index.ts)独立定义非流式消息、工具批次、最终文本、取消及错误；[兼容适配](../src/platform/agent/compatible.ts)共享配置/HTTP 基础，将含点名称无冲突地映射为 Provider 名称。每个已接受模型调用记录一次固定结果审计，不持久化提示词/输出。

## 二、注册与 Scope

[Registry](../src/shared/tools/registry.ts)拒绝重复名称和保留的可信操作命名空间。MCP 名称必须以配置中唯一的 Server ID 开头，不能占用原生命名空间。Server 整批工具先校验再替换。描述符经克隆和冻结，不含执行函数。

[策略](../src/shared/tools/policy.ts)要求明确提供 `allow`，空数组不授予能力。仅支持完整名称或 `profile.*` 形式的尾部命名空间通配符。Deny 优先，`*.delete` 和任意 glob 模式无效。风险顺序为 `READ < COMPUTE < WRITE < EXTERNAL_ACTION`，默认最高风险为 `READ`。

Scope 在创建时固定允许的条目、策略及 Main 绑定的调用身份，新工具不会进入已有 Scope。移除/替换撤销旧条目和进行中的调用；旧 Scope 不会自动绑定重连后的工具。释放 Scope 或取消调用方会终止当前调用。在确认机制实现前，应用运行时仅接受 `READ / COMPUTE` Scope。

通用 [AgentLoop](../src/platform/agent/loop.ts)每阶段最多调用模型 8 次。先记录完整 assistant 调用列表，再顺序执行工具并追加对应 observation。普通工具错误可作为 observation；取消和审计失败立即终止。空/非法输出、重复 call ID 及超限明确失败。不提供自动重试、fallback、planner、memory 或并行工具。

[Resume Scope](../src/platform/agent/snapshot-tools.ts)使用任务私有 Registry，仅注册 `job.get`、`profile.get` 及分页 `profile.list_facts`，绑定不可变输入及固定对象 ID。不开放实时读取、外部 MCP 工具或 Artifact/状态写入。Domain 只获得注入的阶段 runner，Main 在完成/取消时释放 Scope。简历生命周期及溯源归属[数据架构](data-architecture.zh-CN.md)。

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

## 五、验证与后续交付

[工具测试](../tests/tools.test.ts)、[MCP 测试](../tests/mcp.test.ts)和[能力审计测试](../tests/capability-audit.test.ts)覆盖权限、撤销、输入/输出/隐私边界、真实分页 stdio、Schema 变化、错误、超时、取消、不可变审计及本地写事务。

[运行时 smoke](../scripts/run-mcp-smoke.cjs)将实际组装模块按 CJS 和生产依赖外置规则打包，在 Electron Node 运行时中执行，使用临时存储验证 Native/MCP 调用、写审计、取消、断连/重连、重启恢复及子进程清理。命令归属 [README](../README.zh-CN.md)。

**规划：**先接入首个真实服务及其所需 Transport/凭据，再实现模型 Tool Calling 和一个消费 Scope 的业务 Agent。HTTP/OAuth、Browser 适配、Resources/Prompts、多模态结果、高风险确认、自动安装及能力审计查看器尚未实现。本地样本测试不代表已认证第三方账号或 Windows/Linux 运行兼容性。

## 相关文档

- [代码架构](code-architecture.zh-CN.md)：依赖与进程边界。
- [数据架构](data-architecture.zh-CN.md)：带审计的 read/write 持久化及配置。
- [当前架构](architecture.zh-CN.md)：应用运行行为及限制。
