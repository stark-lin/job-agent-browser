# 工具与 MCP 运行时

用途：定义能力注册、Agent 边界与 MCP 集成。状态：四个内部 Agent、统一 Job Agent Browser MCP 公共能力、带审计能力及第三方 stdio 消费均**已实现**。远程传输仍为**规划**。

语言：简体中文 · [English](mcp-architecture.md)

## 一、归属与调用路径

```text
Agent → MCP Client → stdio Server → ToolScope → audited capability → Domain → SQLite
UI    → typed IPC → Domain
```

[AgentTools](../src/shared/agent/index.ts) 是异步发现/调用契约，生产实现只有 [MCPAgentTools](../src/platform/mcp/first-party-client.ts)。Agent 不接收 ToolScope、Domain 服务、Repository、backend dispatch 或数据库句柄。资料读取和模型推理属于业务 MCP 外的宿主能力。[架构检查](../scripts/quality.cjs)禁止 Agent 模块直接/间接依赖特权实现，以及通过重新导出、动态导入或 ToolScope 绕过。

[Main](../src/platform/electron/main/index.ts)负责模型配置、凭据、窗口归属和只读 UI 投影。人工表单保留 typed IPC；Agent 保存、流程提交、失败、取消和输出构建必须经过 MCP。Ask AI 使用基于限定 first-party MCP 会话的持久化多会话流式 Agent 运行时；Profile 导入保留独立的审核导入流程。

## 二、注册与流程契约

唯一公共组合入口是 [createJobAgentTooling](../src/platform/tools/index.ts)。[Server](../src/platform/mcp-server/server.ts)列出受限描述符，并交由服务端 ToolScope 执行；Registry/Policy 不再是 Agent API。[能力层](../src/platform/tools/capabilities.ts)管理访问/执行审计、受限 JSON/schema 校验和取消，Domain 管理业务校验与状态转换。

[Registry 策略](../src/shared/tools/policy.ts)必须提供 allowlist，deny 优先，只支持命名空间尾部通配。公共能力风险上限为 WRITE，不包含公司写入、SQL、设置、密钥、Provider 配置、浏览器控制、邮件或外部动作。已有 Scope 不会静默加入新描述符；被移除或替换的条目会撤销。

[AgentLoop](../src/platform/agent/loop.ts)每阶段最多八轮顺序模型调用，检查完整的 assistant 调用批次并保留固定错误码。取消/审计失败立即终止。[AgentModel 适配](../src/platform/ai/agent-model.ts)支持普通及流式兼容 Chat Completions，对带点工具名进行唯一映射，并记录不含内容的请求结果审计。模型设置和凭据保留在 Main。

[Resume](../src/platform/agent/resume.ts)执行 score/gate/select/draft/polish，模型只看到绑定当前 run 的不可变快照读取工具。[职位采集](../src/platform/agent/capture.ts)在理解期间不读取 JAB 工具，审核后才保存。[申请管理](../src/platform/agent/application.ts)先读取当前 Job/状态/事件，再生成经校验的动作计划；Main 将动作绑定当前 Job 并顺序执行。缺少信息时追问，部分失败保留已完成动作和请求 ID。

[Ask Agent](../src/platform/agent/ask.ts)直接接收完整 first-party MCP 发现结果，与外部宿主使用相同的 42 个工具契约：职位导入/读取/更新/归档、资料读取/写入、申请管理、完整 Resume 流程及产物读取/构建。客户端不再通过第二份允许列表缩小范围，服务端策略仍为权限依据。[流式循环](../src/platform/agent/stream-loop.ts)为 Ask AI 提供 64 轮模型调用（其他调用者默认八轮），支持分页证据和顺序提交；共享[简历策略](../src/platform/agent/resume-policy.ts)保留证据和个人介绍规则。第三方工具及委派仍不开放。完整批次校验后顺序执行工具，普通失败成为观察结果，取消或审计失败终止 Run。展示摘要不含原始输入/结果。只有 Main 记录会话事件；记录器不是 Agent 业务 API，不能绕过 MCP 写业务数据。

## 三、内部与第三方 Client

[first-party runtime](../src/platform/mcp/first-party-client.ts)按流程惰性创建真实 stdio 会话，复用到断连/关闭。它使用 Electron 可执行文件的 Node 模式启动构建产物，显式传入 userData；同一 Resume run 始终使用原会话。会话丢失后不会回退本地服务或接管旧 run，后续新任务可创建新会话。

[Client](../src/platform/mcp/client.ts)只允许可信组合入口传入 processEnv，userData/mcp.json 不接受任意环境变量配置。内部标识为 internal.resume、internal.job-capture、internal.application 和 internal.ask-ai。[Caller 校验](../src/platform/mcp-server/caller.ts)遵循审计标识格式，无效值回退为 mcp-client。JOB_BROWSER_MCP_CALLER 不改变权限、schema、工具列表或语义。

第三方消费保留[审核配置](../src/platform/mcp/server-config.ts)、[Provider 筛选](../src/platform/mcp/provider.ts)和 [schema 指纹](../src/platform/mcp/tool-adapter.ts)。本地审核决定名称、描述、schema 和 READ/COMPUTE 风险，上游提示不能授予权限。缺失/变化的 schema 会被隔离；变更通知先撤销当前批次再发现。不隐式重连或重试执行。

可选 mcp.json 缺失不阻止窗口；无效配置保持原样，仅返回脱敏诊断。第三方进程使用 SDK 的有限环境继承，不接收应用凭据；这些是可信可执行程序，并非 OS 沙箱。HTTP/OAuth、MCP resources/prompts、多模态结果和远程交互输入仍为规划。

## 四、限制、错误与生命周期

对象输入使用 JSON Schema 2020-12 和本地引用，校验不转换类型或删除字段。Getter、循环引用、非 JSON 值、过深/过多节点均失败。默认输入/schema 为 64 KiB，结果 1 MiB，传输 2 MiB，深度 32，JSON 节点 16,384。职位导入/修改及评分输入允许 1 MiB，Resume 写作允许 512 KiB。发现上限为 16 页/500 工具，连接/发现各十秒；单个 Client 最多四个并发调用，审计能力层最多十六个活跃调用。

结果包含文本与 structuredContent。内部适配器只保留已知的服务端固定错误码，畸形/未知错误体会脱敏；第三方错误保持通用映射。能力审计不保存 prompt、资料正文、模型输出、凭据或原始进程错误。

取消会通知 Server 并中止 Worker，但不能撤销已提交写入。[Receipt](data-architecture.zh-CN.md#四审计与事务)保障不确定创建请求的重试安全。窗口释放停止所属任务；退出先取消/等待任务，再关闭 Client 和 Main SQLite。Server EOF 中止任务、等待调用/输出、结束 lease 后关闭连接。Resume start 结果不确定且审计持续失败时，会话被结束，由正常恢复机制标记中断。

## 五、Job Agent Browser MCP

[Node 入口](../src/platform/mcp-server/stdio.ts)要求 JOB_BROWSER_USER_DATA 指向包含现有 database.sqlite 的目录，不猜测工作空间。使用带 DatabaseSync.setAuthorizer 的 Node >=24.10。[构建入口](../electron.vite.config.ts)生成 out/main/job-agent-mcp.js 和 out/main/resume-output-worker.js；stdout 只输出 MCP 消息。Server 不加载 AI 设置、凭据、模型或外部 MCP Client。

**已实现一键接入：**[设置页面](../src/pages/settings/ExternalMCPSettings.tsx)通过独立的[类型化 IPC](../src/shared/external-mcp.ts)和 [Main 处理器](../src/platform/electron/main/external-mcp-ipc.ts)为本机 Codex、Claude Code 和 Cursor 添加全局配置。这是用户触发的宿主操作，不属于业务 MCP 或 Agent 接口；仅可信应用文档的主框架可检查、安装、重新连接、删除、测试或复制配置。

[配置适配器](../src/platform/mcp/external-config.ts)仅更新 `~/.codex/config.toml`（或 `CODEX_HOME/config.toml`）、`~/.claude.json` 或 `~/.cursor/mcp.json` 中的 `job_agent_browser` 条目。保留其他配置值；TOML 序列化可能改变格式/注释，JSON 局部编辑保留周边文本。相同配置不写文件；不同配置需确认后替换。已有文件先保存权限受限的原文 `.bak` 备份，再原子替换，并在写入前检查文件版本。格式错误、不可访问或被并发修改的文件保持原样；已有文件符号链接保留其目标。尚不支持自定义 Claude/Cursor 目录和项目级配置。

[安装服务](../src/platform/mcp/external-install.ts)从当前运行的应用生成绝对路径，以 Electron 的 Node 模式启动，设置 `ELECTRON_RUN_AS_NODE`、当前 `JOB_BROWSER_USER_DATA`、仅用于审计的 `JOB_BROWSER_MCP_CALLER`，以及输出构建使用的 `JOB_BROWSER_ELECTRON`；Codex 工具超时设为 100 秒，无需 Agent CLI。安装与连接反馈独立：测试只连接并发现工具，随后关闭 Client；窗口释放/应用退出中止待完成测试。安装后需重新加载或重启目标 Agent。其他本机 stdio 宿主提供可复制 JSON 条目。不返回或记录原配置中的凭据；Skills 单独安装。

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

内部 Agent、Codex 和其他外部 MCP 宿主是平等 Client，发现相同的 42 个工具：

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
| resume.get_context, resume.list_facts | 快照/进度/文档及分页事实 |
| resume.submit_scores, resume.submit_gate, resume.submit_selection | 有序阶段与相同输入重试 |
| resume.submit_draft, resume.submit_polished | 经校验的写作、应用复制的快照元数据与派生溯源 |
| resume.publish, resume.fail, resume.cancel | 发布或以固定错误码失败/取消本运行时拥有的 run |
| artifact.get, artifact.build | 内容/溯源或无需模型的 HTML/PDF 输出和本地路径 |

[资料写入工具](../src/platform/tools/profile.ts)只持久化宿主已理解的数据，不抓取或解析简历/仓库。省略更新字段保留原值，空字符串/数组明确清空；数组整体替换，metadata 按字段合并，关联字段 null 明确解除。版本、事务和 receipt 规则由[数据架构](data-architecture.zh-CN.md#二业务规则)管理。资料写入输入上限 256 KiB。

Resume 快照限制仍为 1000 个事实、200 个条目、256 KiB 上下文、每事实 8 KiB；每页最多 100 个事实。冲突/乱序提交失败，语义真实性仍需核对证据。中断生成不能由其他 Server 会话继续接管。

[输出生命周期](../src/platform/resume-output/service.ts)管理受控文件与状态；构建使用可取消的 [Electron Worker](../src/platform/resume-output/worker-client.ts)，需要图形环境但不需要主应用窗口。JOB_BROWSER_ELECTRON 可指定 Electron 二进制文件。失败输出可独立于模型调用重建。

双语 [distill-resume](../skills/distill-resume/SKILL.zh-CN.md)从简历提取资料、条目和有来源事实；[distill-project](../skills/distill-project/SKILL.zh-CN.md)从项目/仓库提取实现证据，区分文档、代码、实测和用户贡献。两者均先匹配既有记录，通过相同 MCP 写入，遇到实质冲突再追问；批量导入由多次顺序调用组成，不保证整体原子性。

双语 [capture-job](../skills/capture-job/SKILL.zh-CN.md)、[manage-applications](../skills/manage-applications/SKILL.zh-CN.md)、[tailor-resume](../skills/tailor-resume/SKILL.zh-CN.md)是标准推理指南。[skill:link](../scripts/install-skills.cjs)幂等安装六个仓库链接，拒绝覆盖无关目标。运行时 Prompt 实现相同流程，不把 Skill 文本作为业务规则加载。

## 六、验证与待交付内容

[资料写入测试](../tests/profile-writes.test.ts)覆盖部分更新、版本、跨会话 receipt、并发、归属、迁移和不可变快照；[业务工具测试](../tests/business-tools.test.ts)、[申请测试](../tests/application-agent.test.ts)、[采集测试](../tests/capture-agent.test.ts)、[Resume 一致性](../tests/resume-runtime-parity.test.ts)和 [lease 测试](../tests/runtime-leases.test.ts)覆盖真实 stdio、共享 SQLite、发现一致性、归属、并发写入、receipt/重启、失败和取消。[Server smoke](../scripts/run-mcp-server-smoke.cjs)使用构建入口和真实 Electron HTML/PDF；[Agent smoke](../scripts/run-agent-smoke.cjs)覆盖生产 UI。命令归属 [README](../README.zh-CN.md)。

[接入测试](../tests/external-mcp.test.ts)覆盖 MCP 配置保留、备份、冲突、发现与清理。[Skills 测试](../tests/external-skills.test.ts)覆盖独立资源、完整目录一致性、幂等、部分安装/失败、直接替换、符号链接、权限及版本冲突拒绝。[设置接入 smoke](../scripts/external-mcp-smoke.cjs)包含 [Skills smoke](../scripts/external-skills-smoke.cjs)，验证生产 IPC/UI、无备份替换与取消、文件一致性、错误及重载；整套检查在临时 Agent 目录中验证双语响应式主题。[Electron smoke](../scripts/smoke.cjs)拒绝不可信 Skills IPC。真实目标 Agent 发现/重载及 Windows/Linux 宿主兼容性仍未验证。

真实 Provider 认证、远程传输、外部日历/邮件动作及 Windows/Linux 渲染仍未验证或处于规划，测试 fixture 不代表已提供这些能力。

## 相关文档

- [代码架构](code-architecture.zh-CN.md)：依赖与进程边界。
- [数据架构](data-architecture.zh-CN.md)：存储、receipt 与审计。
- [当前架构](architecture.zh-CN.md)：产品运行与限制。

## 智能笔记知识库

[Knowledge 工具](../src/platform/tools/knowledge.ts)新增 knowledge.list/read/search/retrieve/write/mkdir/move/delete，提供受限 schema 与版本检查。删除是此前不公开删除策略的知识库专用例外，必须有用户意图。审计迁移 9 保留历史行并新增 opaque knowledge 目标，不记录路径、查询与正文。[面试准备](../skills/interview-prep/SKILL.zh-CN.md)使用相同工具。

现有认证 [broker](../src/platform/knowledge/broker.ts)把查询向量请求交给 Main 唯一的本地 provider。Stdio server 不初始化 ONNX；Main 不存在时保留词法检索。Agent 知识能力仍跨 MCP。[包内验收](../src/platform/electron/package-verification.ts)通过真实 stdio session 调用 broker，并断言只启动一个模型进程。

[原生会话环境转发](../src/platform/mcp/native-environment.ts)仅将选定的显示会话与 Windows 系统字段传入 stdio 启动和生成的外部配置，使 Electron PDF worker 能在 Linux/Windows 初始化；仍不支持用户任意环境覆盖。
