# 工具与 MCP 运行时

用途：定义能力注册、Agent 边界与 MCP 集成。状态：四个内部 Agent、统一 Job Agent Browser MCP 公共能力、受保护能力及第三方 stdio 消费均**已实现**。远程传输仍为**规划**。

语言：简体中文 · [English](mcp-architecture.md)

## 一、归属与调用路径

```text
Agent → MCP Client → stdio Server → ToolScope → capability → Domain → SQLite
UI    → typed IPC → Domain
```

[AgentTools](../src/shared/agent/index.ts) 是异步发现/调用契约，生产实现只有 [MCPAgentTools](../src/platform/mcp/first-party-client.ts)。Agent 不接收 ToolScope、Domain 服务、Repository、backend dispatch 或数据库句柄。资料读取和模型推理属于业务 MCP 外的宿主能力。[架构检查](../scripts/quality.cjs)禁止 Agent 模块直接/间接依赖特权实现，以及通过重新导出、动态导入或 ToolScope 绕过。

[Main](../src/platform/electron/main/index.ts)负责模型配置、凭据、窗口归属和只读 UI 投影。人工表单保留 typed IPC；Agent 保存、流程提交、失败、取消和输出构建必须经过 MCP。Ask AI 使用基于限定 first-party MCP 会话的持久化多会话流式 Agent 运行时；Profile 导入保留独立的审核导入流程。

## 二、注册与流程契约

唯一公共组合入口是 [createJobAgentTooling](../src/platform/tools/index.ts)。[Server](../src/platform/mcp-server/server.ts)列出受限描述符，并交由服务端 ToolScope 执行；Registry/Policy 不再是 Agent API。[能力层](../src/platform/tools/capabilities.ts)管理执行保护、受限 JSON/schema 校验和取消，Domain 管理业务校验与状态转换。

[Registry 策略](../src/shared/tools/policy.ts)必须提供 allowlist，deny 优先，只支持命名空间尾部通配。公共能力风险上限为 WRITE，不包含公司写入、SQL、设置、密钥、Provider 配置、浏览器控制、邮件或外部动作。已有 Scope 不会静默加入新描述符；被移除或替换的条目会撤销。

[Agent Engine](../src/platform/agent/engine/index.ts)用共享 Pi 循环执行 Ask 和 Resume，串行调用工具并校验请求。[AgentModel 适配](../src/platform/ai/agent-model.ts)映射逻辑工具名，并记录不含内容的模型结果。[职位采集](../src/platform/agent/capture.ts)和[申请管理](../src/platform/agent/application.ts)使用单次无工具模型请求，由 Controller 通过 MCP 派发已授权并绑定的写入。

[Ask Agent](../src/platform/agent/ask.ts)、智能粘贴和 Resume 使用 [ScopedToolset](../src/platform/agent/tools/scoped-toolset.ts)。模型初始工具仅含有权使用的 `scope.job/profile/application/resume/artifact/knowledge/memory` 目录和 `human.ask`。内部 MCP 同时列出原始授权描述。Scope 调用真实经过 Server，按当前权限返回名称/描述/风险，下一轮模型请求加入整个领域的原始 Schema。未展开调用以 AGENT_PROTOCOL_ERROR 拒绝。重复目录幂等，多个领域累积至 Run 结束。没有搜索、激活、LRU 或工具数软预算；硬上下文超限返回 ASK_CONTEXT_OVERFLOW，不静默移除工具。校验后的批次串行执行，每 Run 最多 64 次模型请求（含摘要）和 256 次模型工具调用。

[Scope 测试](../tests/scoped-toolset.test.ts)覆盖 Run 隔离、领域展开、权限、重复调用和硬预算。[Provider 测试](../tests/agent-disclosure.test.ts)与[真实 HTTP/MCP 集成](../tests/ask-disclosure.test.ts)保留名称/Schema Hash 校验。Scope 和 Human Ask 验证活动 Run，但绕过业务 RunGuard，不计业务进展、不清除警告/恢复。外部 MCP 保持扁平列表，公开授权业务工具及 `run.begin`、`run.end`、`human.ask`，不公开 Scope。

[显式 Ask 白名单](../src/shared/agent/ask-policy.ts)由工具发现与 [Server Runtime](../src/platform/mcp-server/runtime.ts)共享，仅已兑换的 Main 启动授权可选择该策略，Caller 标签不决定权限。tools/list 与 tools/call 均排除 Profile 写入、全部 resume.*、artifact.build 和 Delete 工具，新增工具默认拒绝。Ask 提示词不列出这些写入接口，Scope 目录和模型 Schema 仅暴露授权操作。普通 Job/Application 管理、Profile 与 Knowledge 只读操作、五个 Memory 工具及 artifact.get 保持可用；桌面 Resume、Profile 导入和外部 MCP 使用各自的策略。

智能粘贴复用 Ask Run 和 RunGuard，并建立独立的认证连接。[服务端](../src/platform/mcp-server/runtime.ts) 在现有 Ask 允许列表内将发现和执行的风险上限设为 COMPUTE。智能粘贴 Run 收尾时关闭该连接。之后在同一会话中发出的普通 Ask 请求使用常规 Ask 连接。[客户端](../src/platform/mcp/first-party-client.ts) · [集成测试](../tests/smart-paste.test.ts)

### Agent Run 保护

[openAgentRun](../src/platform/mcp/first-party-client.ts)为每个已放行的 Run 绑定可取消工具视图。Main 发放有效期 30 秒的一次性授权，绑定认证连接、Run、操作及规范化参数。Ask 写入 Memory 还需来源授权。桌面 Resume 连接分别使用 Controller 和模型授权，只有 Controller 可启动、绑定、校验、发布、结算或构建。模型授权绑定 Agent Run 和 GenerationRun，开放快照读取、要点改写、Memory 读写和只读 Knowledge。Server 校验活动绑定和生成归属。外部宿主使用公开工具，并通过原会话拥有生命周期写入权限。

[Server RunGuard](../src/platform/mcp-server/run-guard/index.ts)位于授权及共享 capability 输入准备之后，保留各工具大小限制。Run 锁覆盖检查、派发和结果登记。已确认归档的重复/反向操作在 Domain 之前拒绝。有效请求（含 Guard 拒绝）计入 256 次预算；第 257 次或第二次相同违规阻断执行。不确定写入保留原错误并停止，不重试或回滚。 [Ask AI Cycle 状态机](agent-runtime.zh-CN.md)根据可信快照控制后续 Pi 请求，进展判定与能力安全仍由 MCP Server 负责。

[读取进展](../src/platform/mcp-server/run-guard/read-progress.ts)累计实体/字段证据及各空间文件版本与覆盖行范围。旧结果换序、重组或取子集，以及查询、分数、展示变化不算进展；新分页、Facts、片段和版本算进展。空结果按数据集只计一次。未知 READ 使用规范化结构结果或文本，保留未知字段和数组顺序。读取失败计为无进展；已确认的已知业务修改也贡献进展。连续两次无进展告警，三次进入恢复，之后首个仍无进展的业务结果以 NO_PROGRESS_LOOP 熔断；新证据清零连续计数。Scope 和 Human Ask 不重置该状态。

[Pi 适配器](../src/platform/agent/pi/runtime.ts)将固定告警/恢复提示与原始业务结果分开传递，压缩后也在模型系统上下文更新提示。恢复时 beforeToolCall 在 tool.started 前非致命地跳过旧批次余项，让模型重新决策；跳过调用不产生业务执行或不确定写入。Run 熔断时保留触发检测的成功结果，再停止后续调用/推理；执行前 Guard 错误不记为不确定写入。无进展的相同规范化搜索首次重复提示，再次重复停止。关闭撤销凭证、中止工作、清除 Guard 状态并等待子进程确认，失败则废弃连接。外部 MCP 现要求下述执行协议；访问其他第三方 Server 的出站保护仍为规划。[Guard 测试](../tests/mcp-run-guard.test.ts)与[进展测试](../tests/mcp-run-progress.test.ts)覆盖这些契约，诊断存储归属[数据架构](data-architecture.zh-CN.md#ask-ai-会话存储)。


### 执行身份与外部协议

**已实现：**[Main 准入](../src/platform/mcp/run-admission.ts)限制全局一个活动执行，统一分配 `executionRunId`，与持久化 `agentRunId`、`GenerationRun.id` 及单次操作 `requestId` 独立。内部可信 Grant 自动申请；Resume Controller 与模型共享同一次占用，覆盖发布和输出。关闭模型视图撤销其 Grant，Controller 直到工作流连接关闭才释放占用。

外部宿主调用 `run.begin({}) → {runId}`，每次业务调用均须提供此 UUID 作为 `executionRunId`。[Gateway](../src/platform/mcp-server/server.ts)检查归属和生命周期，剥离协议字段，再按原有严格业务 Schema 校验并调用现有 Guard/Registry/Domain 实现。内部 Schema 不变。`run.end({runId})` 在 BLOCKED 时可用且幂等；已关闭 ID 无法复用。控制操作不进入业务 Registry。不存在 `run.success`、提交、回滚、刷新或暂存协议。业务调用成功即持久化，失败不撤销之前的写入。

[准入 Broker](../src/platform/mcp/run-admission-broker.ts)使用独立的本机私有凭据和绑定连接的 Session Secret，不授予 Memory 权限。外部最多一个 MCP Session 连接 Main；End 释放 Run，但 Session 归属直到断连才释放。Begin 要求 Main 在线；离线或其他外部 Session 占用 Main 时，仍可发现工具和测试连接。启动时连接控制通道若繁忙则延后，Begin 会重试连接，占用期间仍返回 `TOOL_BUSY`。其他 Session 不能凭 UUID 接管。[外部生命周期](../src/platform/mcp/external-run.ts)将控制通道握手限制为 5 秒，建立后流连接跨工具调用和 Run 持续开放；普通控制请求仍保留 5 秒超时。在取消、断连或执行满 15 分钟时中止，等待已开始的工具安全收尾后释放占用。控制通道断开时保留占用，直到收到收尾确认或确认子进程退出。不增加 Run 状态表或业务补偿。[准入测试](../tests/run-admission.test.ts) · [连接测试](../tests/external-mcp.test.ts)

### Human Ask

[Main HumanRequests](../src/platform/mcp/human-requests.ts)管理临时问题、归属、回答和取消，不建表、不使用单例。`human.ask({question, options?})`允许省略或空选项、单选，并始终提供自由文本。提交要求选项或非空文字，返回 `{status: 'submitted', selectedOption, text}`；弹窗取消返回 `{status: 'cancelled'}`。Main/Run/窗口终止或 Session 断连会使等待失效，不返回普通回答。同一 Run 的并发问题被拒绝。

内部通过既有启动/Run 授权通道认证；外部使用受保护的准入 Session 和执行 UUID。[全局弹窗](../src/app/components/HumanAskDialog.tsx)通过可信 [IPC](../src/platform/electron/main/human-ipc.ts)交互，Renderer 不能触发业务写入。问题等待期间隐藏原生 Browser/Inbox 视图，关闭后恢复，不导航或销毁。等待保留准入，不持有 SQLite 事务或业务 Guard 锁。仅 human.ask 使用随生命周期取消的长等待，绕过内部 120 秒工具限制；外部 Run 保留原有 15 分钟期限。Codex 配置的 100 秒宿主超时及其他客户端期限可能取消等待，真实 Codex/Claude 等待行为尚未验证。[协议测试](../tests/human-mcp.test.ts)

## 三、内部与第三方 Client

[first-party runtime](../src/platform/mcp/first-party-client.ts)按流程/Ask 聊天惰性创建并复用真实 stdio 会话。每个已放行的 Ask 轮次获得上文定义的独立 Run 授权视图；关闭/取消后的视图不能替后续轮次调用。不再存在独立 Memory 会话。通过 Electron Node 模式和显式 userData 启动构建后的 Server。同一 Resume run 保留原会话，丢失会话不能回退本地服务或接管旧 Run。

[Client](../src/platform/mcp/client.ts)只允许可信组合入口传入 processEnv，userData/mcp.json 不接受任意环境变量配置。内部标识为 internal.resume、internal.job-capture、internal.application 和 internal.ask-ai。[Caller 校验](../src/platform/mcp-server/caller.ts)遵循受控 Caller 标识格式，无效值回退为 mcp-client。JOB_BROWSER_MCP_CALLER 不改变权限、schema、工具列表或语义。

第三方消费保留[审核配置](../src/platform/mcp/server-config.ts)、[Provider 筛选](../src/platform/mcp/provider.ts)和 [schema 指纹](../src/platform/mcp/tool-adapter.ts)。本地审核决定名称、描述、schema 和 READ/COMPUTE 风险，上游提示不能授予权限。缺失/变化的 schema 会被隔离；变更通知先撤销当前批次再发现。不隐式重连或重试执行。

可选 mcp.json 缺失不阻止窗口；无效配置保持原样，仅返回脱敏诊断。第三方进程使用 SDK 的有限环境继承，不接收应用凭据；这些是可信可执行程序，并非 OS 沙箱。HTTP/OAuth、MCP resources/prompts、多模态结果和远程交互输入仍为规划。

## 四、限制、错误与生命周期

对象输入使用 JSON Schema 2020-12 和本地引用，校验不转换类型或删除字段。Getter、循环引用、非 JSON 值、过深/过多节点均失败。默认输入/schema 为 64 KiB，结果 1 MiB，传输 2 MiB，深度 32，JSON 节点 16,384。职位导入/修改及评分输入允许 1 MiB，Resume 写作允许 512 KiB。发现上限为 16 页/500 工具，连接/发现各十秒；单个 Client 最多四个并发调用，共享能力层最多十六个活跃调用。

结果包含文本与 structuredContent。内部适配器只保留已知的服务端固定错误码，畸形/未知错误体会脱敏；第三方错误保持通用映射。终端诊断不包含 prompt、资料正文、模型输出、凭据或原始进程错误。

取消会通知 Server 并中止 Worker，但不能撤销已提交写入。[Receipt](data-architecture.zh-CN.md#四事务与终端诊断)保障不确定创建请求的重试安全。窗口释放停止所属任务；退出先取消/等待任务，再关闭 Client 和 Main SQLite。Server EOF 中止任务、等待调用/输出、结束 lease 后关闭连接。Resume start 结果不确定，会话被结束，由正常恢复机制标记中断。

## 五、Job Agent Browser MCP

[Node 入口](../src/platform/mcp-server/stdio.ts)要求 JOB_BROWSER_USER_DATA 指向包含现有 database.sqlite 的目录，不猜测工作空间。使用 Node >=24.10。[构建入口](../electron.vite.config.ts)生成 out/main/job-agent-mcp.js 和 out/main/resume-output-worker.js；stdout 只输出 MCP 消息。Server 不加载 AI 设置、凭据、模型或外部 MCP Client。

**已实现一键接入：**[设置页面](../src/pages/settings/ExternalMCPSettings.tsx)通过独立的[类型化 IPC](../src/shared/external-mcp.ts)和 [Main 处理器](../src/platform/electron/main/external-mcp-ipc.ts)为本机 Codex、Claude Code 和 Cursor 添加全局配置。这是用户触发的宿主操作，不属于业务 MCP 或 Agent 接口；仅可信应用文档的主框架可检查、安装、重新连接、删除、测试或复制配置。

[配置适配器](../src/platform/mcp/external-config.ts)仅更新 `~/.codex/config.toml`（或 `CODEX_HOME/config.toml`）、`~/.claude.json` 或 `~/.cursor/mcp.json` 中的 `job_agent_browser` 条目。保留其他配置值；TOML 序列化可能改变格式/注释，JSON 局部编辑保留周边文本。相同配置不写文件；不同配置需确认后替换。已有文件先保存权限受限的原文 `.bak` 备份，再原子替换，并在写入前检查文件版本。格式错误、不可访问或被并发修改的文件保持原样；已有文件符号链接保留其目标。尚不支持自定义 Claude/Cursor 目录和项目级配置。

[安装服务](../src/platform/mcp/external-install.ts)从当前运行的应用生成绝对路径，以 Electron 的 Node 模式启动，设置 `ELECTRON_RUN_AS_NODE`、当前 `JOB_BROWSER_USER_DATA`、Caller 标识 `JOB_BROWSER_MCP_CALLER`，以及输出构建使用的 `JOB_BROWSER_ELECTRON`；Codex 工具超时设为 100 秒，无需 Agent CLI。安装与连接反馈独立：测试只连接并发现工具，随后关闭 Client；窗口释放/应用退出中止待完成测试。安装后需重新加载或重启目标 Agent。其他本机 stdio 宿主提供可复制 JSON 条目。不返回或记录原配置中的凭据；Skills 单独安装。

重新连接会备份并原子重写已核对的 MCP 配置，再验证新的 stdio 连接；策略字段保留，配置写入成功与发现失败分别反馈。确认删除后会备份文件，并仅删除 `job_agent_browser`。两种操作都要求检查时的版本；删除无需可运行的服务，并会取消该目标的待完成连接检查。外部 Agent 进程由宿主管理，用户仍可能需要重新加载或重启以关闭旧连接。

**已实现 Skills 安装：**独立的[类型化 IPC](../src/shared/external-skills.ts)和[可信 Main 处理器](../src/platform/electron/main/external-skills-ipc.ts)提供检查、安装、重新连接、按项删除和打开内置目录。[安装服务](../src/platform/skills/install.ts)将六个固定 Skill 的完整双语文件夹复制到 Codex `~/.agents/skills`、Claude Code `~/.claude/skills` 或 Cursor `~/.cursor/skills`，无需 Agent CLI 或网络。用户级目录遵循官方 [Codex](https://learn.chatgpt.com/docs/build-skills)、[Claude Code](https://code.claude.com/docs/en/skills) 和 [Cursor](https://cursor.com/docs/skills) 文档。[构建](../electron.vite.config.ts)将资源放入 `out/main/skills`，运行时安装不依赖源码仓库。其他 Agent 可通过“打开 Skills 文件夹”手动复制。

检查会读取有大小限制的完整目录树，不创建文件。内容相同不写入，缺失文件夹直接安装；不同文件夹需确认后替换，**不保留备份**，其他 Skills 保留。替换根符号链接仅影响链接本身。临时暂存和版本检查拒绝资源、内容或父目录变化；失败返回已完成/待完成项及重新检查的状态。替换按顺序进行，不是事务。Skills 和 MCP 独立安装，调用工具仍需连接预期 MCP。安装后请重新加载/重启 Agent；文件安装成功不证明 Agent 已发现。尚不支持自定义目录、旧目录迁移、云端安装、自动更新或更改 Agent 启用设置。`CODEX_HOME` 影响 MCP 配置位置，不改变此 Skills 目录。

Skills 重新连接会重新安装六个内置文件夹，即使内容一致。确认删除仅接受六个固定 Skill 名称，支持单项或全部删除；其他文件夹和根符号链接的目标保留。版本检查拒绝过期确认，失败时报告实际已删除和待删除项。删除会移除完整文件夹及本地修改，不保留备份。MCP 配置、已保存的资料和职位相互独立。请重新加载或重启宿主以更新已加载的 Skills。

手动接入 MCP 时，先构建再为宿主配置绝对路径：

```toml
[mcp_servers.job_agent_browser]
command = "/absolute/path/node"
args = ["/absolute/path/job-agent-browser/out/main/job-agent-mcp.js"]
tool_timeout_sec = 100

[mcp_servers.job_agent_browser.env]
JOB_BROWSER_USER_DATA = "/absolute/path/existing-user-data"
JOB_BROWSER_MCP_CALLER = "codex"
```

以下公开契约面向独立流程与外部宿主；已认证 Ask AI 仅获得上文显式子集及 Memory：

| 公共能力 | 契约 |
| --- | --- |
| job.list, job.get, profile.list, profile.get, profile.list_facts, profile.list_items | 已保存记录、筛选和分页，保留现有结果形状 |
| profile.create, profile.update | 结构化资料创建/部分更新，requestId receipt；更新需 expectedRevision |
| profile.add_item, profile.update_item, profile.add_fact, profile.update_fact | 同资料归属、无环父级、部分更新及 expectedRevision，全部写入有 receipt |
| job.import | 仅保存结构化职位，带 requestId receipt 和可选真实网页来源 |
| job.update, job.set_archived | 部分详情变更或归档/恢复，相同值不产生变更 |
| application.get, application.set_status | 当前状态/allowedNextStatuses 与 Domain 强制的幂等转换 |
| application.list_events, application.add_note | 分页时间线，带 receipt 的备注也可写入归档职位 |
| application.schedule_event, application.reschedule_event | 本地 UTC 日程，创建 receipt、事件/Job 归属及归档校验 |
| resume.start | 原子快照/启动与同会话请求 UUID receipt，可声明 Provider/模型元数据 |
| resume.get_context, resume.list_facts, resume.list_bullets | 不可变上下文、分页 Fact 及带 rewritten 标记的当前要点分页 |
| resume.rewrite_bullet | 按要点 ID 和请求回执改写，每个运行内每条要点最多改动一次 |
| resume.publish, resume.fail, resume.cancel | 发布或以固定错误码失败/取消本运行时拥有的 run；[Resume 失败码](agent-runtime.zh-CN.md#四收尾与诊断)保留模型/工具/存储原因 |
| artifact.get, artifact.build | 内容/溯源或无需模型的 HTML/PDF 输出和本地路径 |

[资料写入工具](../src/platform/tools/profile.ts)只持久化宿主已理解的数据，不抓取或解析简历/仓库。省略更新字段保留原值，空字符串/数组明确清空；数组整体替换，metadata 按字段合并，关联字段 null 明确解除。版本、事务和 receipt 规则由[数据架构](data-architecture.zh-CN.md#二业务规则)管理。资料写入输入上限 256 KiB。Fact 输入和结果不含 `evidence`，提交此已移除字段按未知字段拒绝。蒸馏 Skills 保存简洁事实和标签，不保存来源附件，也不转存到其他字段。

[改写 schema](../src/platform/tools/resume-schema.ts)接受 runId、bulletId、text 和 requestId，返回 runId、bulletId 和 changed。要点列表返回 rewritten 标记。已退役的 expectedRevision 输入按未知字段拒绝。业务回执及单要点单次改写规则归[数据架构](data-architecture.zh-CN.md#三生成成品与删除)管理。

快照上限为 1,000 个 Fact、200 个 Item、256 KiB 上下文及每条 Fact 8 KiB。列表每次最多接受 100 条请求，要点分页可因响应大小返回更少。确认改动的 (runId, bulletId) 组合只计一次 RunGuard 进展，重复分页和无变化改写不计入。

[输出生命周期](../src/platform/resume-output/service.ts)管理受控文件与状态；构建使用可取消的 [Electron Worker](../src/platform/resume-output/worker-client.ts)，需要图形环境但不需要主应用窗口。JOB_BROWSER_ELECTRON 可指定 Electron 二进制文件。失败输出可独立于模型调用重建。artifact.get 读取当前已保存的 Artifact 版本及输出状态，artifact.build 通过与桌面输出共用的 worker 重建该版本。桌面手工修改使用类型化 IPC，其[展示文字校验](data-architecture.zh-CN.md#三生成成品与删除)同样适用于 worker 边界。

双语 [distill-resume](../skills/distill-resume/SKILL.zh-CN.md)从简历提取资料、条目和有来源事实；[distill-project](../skills/distill-project/SKILL.zh-CN.md)从项目/仓库提取实现证据，区分文档、代码、实测和用户贡献。两者均先匹配既有记录，通过相同 MCP 写入，遇到实质冲突再追问；批量导入由多次顺序调用组成，不保证整体原子性。

双语 [capture-job](../skills/capture-job/SKILL.zh-CN.md)、[manage-applications](../skills/manage-applications/SKILL.zh-CN.md)、[tailor-resume](../skills/tailor-resume/SKILL.zh-CN.md)是标准推理指南。[skill:link](../scripts/install-skills.cjs)幂等安装六个仓库链接，拒绝覆盖无关目标。运行时 Prompt 实现相同流程，不把 Skill 文本作为业务规则加载。Resume Skill 覆盖新生成及重编译既有已发布或手工修改的 Artifact。仓库链接随源码更新，构建资源在 build 时刷新，用户级安装副本需要显式更新/重连 Skills 并重新加载宿主。

## 六、验证与待交付内容

[资料写入测试](../tests/profile-writes.test.ts)覆盖部分更新、版本、跨会话 receipt、并发、归属、迁移和不可变快照；[业务工具测试](../tests/business-tools.test.ts)、[申请测试](../tests/application-agent.test.ts)、[采集测试](../tests/capture-agent.test.ts)、[Resume 一致性](../tests/resume-runtime-parity.test.ts)和 [lease 测试](../tests/runtime-leases.test.ts)覆盖真实 stdio、共享 SQLite、受限发现、归属、并发写入、receipt/重启、失败和取消。[Server smoke](../scripts/run-mcp-server-smoke.cjs)使用构建入口和真实 Electron HTML/PDF，包括重编译手工编辑的日期/链接并核对 PDF 文本。[Agent smoke](../scripts/run-agent-smoke.cjs)覆盖生产 UI。命令归属 [README](../README.zh-CN.md)。

[接入测试](../tests/external-mcp.test.ts)覆盖 MCP 配置保留、备份、冲突、发现与清理。[Skills 测试](../tests/external-skills.test.ts)覆盖独立资源、完整目录一致性、幂等、部分安装/失败、直接替换、符号链接、权限及版本冲突拒绝。[设置接入 smoke](../scripts/external-mcp-smoke.cjs)包含 [Skills smoke](../scripts/external-skills-smoke.cjs)，验证生产 IPC/UI、无备份替换与取消、文件一致性、错误及重载；整套检查在临时 Agent 目录中验证双语响应式主题。[Electron smoke](../scripts/smoke.cjs)拒绝不可信 Skills IPC。真实目标 Agent 发现/重载及 Windows/Linux 宿主兼容性仍未验证。

真实 Provider 认证、远程传输、外部日历/邮件动作及 Windows/Linux 渲染仍未验证或处于规划，测试 fixture 不代表已提供这些能力。

## 相关文档

- [代码架构](code-architecture.zh-CN.md)：依赖与进程边界。
- [数据架构](data-architecture.zh-CN.md)：存储、receipt 与终端诊断。
- [当前架构](architecture.zh-CN.md)：产品运行与限制。

## 智能笔记知识库

[Knowledge 工具](../src/platform/tools/knowledge.ts)保留 knowledge.list/read/search/retrieve/write/mkdir/move/delete 及其 Schema，供用户 UI/IPC 使用；所有 Agent 白名单仅开放 list/read/search/retrieve。Memory 仅提供 memory.list/recall/read/write/mkdir，两个命名空间均不接受 space 或物理根目录参数。路径为空间内相对路径，拒绝穿越和符号链接；更新需要当前 SHA-256 Revision（null 仅创建）。Memory 不开放 move/delete/patch。两个命名空间均受[原生保护](../src/shared/tools/policy.ts)。诊断不记录正文、查询或凭据。

[Main 启动授权](../src/platform/mcp/memory-authority.ts)认证 Ask 会话，Caller 标签不授予权限。一次性启动凭据绑定 Main 实例/会话，30 秒过期；子进程检查描述文件/父 PID，并保持可撤销控制通道。Ask Memory 写入还要求有效期 30 秒、一次性且绑定已认证会话、本轮来源消息 ID、操作和精确输入摘要的授权。授权经 MCP 请求 metadata 传递，不进入模型 Schema/参数；服务端在执行前兑换。Resume Memory 写入使用独立的一次性授权，绑定活动 AgentRun/GenerationRun，并校验 REWRITING 与运行中的 Agent。外部 Memory 调用使用既有认证 Session、执行 Run、白名单及 RunGuard，无需内部 Memory 授权。智能粘贴保持只读。

[Ask AI 策略](../src/platform/agent/ask.ts)将 Core、召回记忆及摘要作为不可信参考，Job/Profile/Fact 保持权威。唯一的 Pi Agent 决定是否保存有依据的长期信息，编辑前读取、保留无关内容，不保存凭据，也不在写入确认前声称成功。memory.recall 默认 2,048 个近似检索单位；memory.read 对缺失文件返回 TOOL_NOT_FOUND。共享[文件锁与 SHA-256 CAS](../src/platform/knowledge/filesystem.ts)跨 Session/进程串行提交；读取、模型推理及 Agent 冲突合并均在锁外完成。结果不确定时先读回核对，不盲目重试。最小 Memory 路径/Revision/结果引用在压缩后仍保留。

[Embedding Broker](../src/platform/knowledge/broker.ts)将共享查询向量生成交给 Main，stdio 不加载 ONNX，离线降级为词法检索。[构建产物验收](../src/platform/electron/package-verification.ts)通过真实 MCP 检查两个隔离索引并断言唯一模型进程。[Memory MCP 测试](../tests/memory-mcp.test.ts)覆盖权限/重放/路径/隐私及每轮授权；[确定性 Agent Fixture](../tests/memory-agent.test.ts)覆盖普通对话、Agent 保存、Core 刷新、FIFO 取消、CAS 合并及不确定写入。

[原生会话环境转发](../src/platform/mcp/native-environment.ts)仅将选定的显示会话与 Windows 系统字段传入 stdio 启动和生成的外部配置，使 Electron PDF worker 能在 Linux/Windows 初始化；仍不支持用户任意环境覆盖。

[npm 启动适配](../src/platform/npm/distribution.ts) 为持久 npm 安装生成绝对 Node + `jab.cjs mcp --data-dir` 连接；临时 npx 安装不能安装永久外部连接。CLI 要求显式绝对数据目录或 `JOB_BROWSER_USER_DATA`；stdout 只承载协议内容。Electron PDF 输出在需要时初始化官方运行时。模型管理仅通过受信任的人类 IPC 入口提供：MCP 工具不授予安装、删除或下载权限，普通 Agent 写入不会安装模型。
