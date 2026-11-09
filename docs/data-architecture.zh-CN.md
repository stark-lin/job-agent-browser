# V1 数据架构与 API

用途：定义已实现的本地存储及业务 API 边界。状态：事务 SQLite、配置/密钥、个人资料编辑/导入、职位采集/申请 Agent以及包含不可变证据、HTML/PDF 输出及异步 IPC 的 Resume V3 均**已实现**。其余产品流程为**规划**。
语言：简体中文 · [English](data-architecture.md)

## 一、运行与存储

[Main](../src/platform/electron/main/index.ts)与[本地 MCP Server](../src/platform/mcp-server/runtime.ts)分别通过一个 `node:sqlite` 连接访问明确指定的 userData 数据库。[SQLite 初始化](../src/platform/database/sqlite.ts)启用外键、WAL、完整同步持久化及 1 秒锁等待。Renderer 不获得 SQL。[App Context](../src/app/context/appContext.ts)保存 Job/Profile/Artifact ID，不复制记录。

[版本化迁移](../src/platform/database/migrations/index.ts)在修改日志模式/结构之前识别数据库世代 `0x4a415632`。只接受空库或相同世代；旧库报 `INCOMPATIBLE_DATABASE_GENERATION`，不重置、删除或迁移。开发/验收必须使用独立 userData。同世代使用事务迁移及校验和；未来版本和校验不匹配使启动失败。UUID v4 由内部生成，删除后不再历史查重；时间为 UTC ISO 字符串。

[共享 ER 图](diagrams/data-model.md) 描述已实现模型。具体 SQL 类型、默认值、可空性、约束及索引以[建表定义](../src/platform/database/migrations/schema.ts)及[迁移集合](../src/platform/database/migrations/index.ts)为准。JSON 使用校验后的 TEXT 列；SQL 表使用 STRICT。Applications 和 Calendar 基于 Job 与 JobEvent，不另建申请或日历表。

| 表 | 职责 |
| --- | --- |
| `companies`, `jobs`, `job_sources` | 公司身份、职位详情及保留的来源内容 |
| `job_events` | 申请生命周期、日程与备注 |
| `profiles`, `profile_items`, `facts` | 联系方式、个人简介、结构化容器及可选择证据 |
| `generation_runs`, `artifacts`, `artifact_facts` | 不可变输入、生成阶段、成品与溯源 |
| `runtime_instances`, `runtime_work`, `resume_start_receipts` | 进程/任务归属及原子启动回执；[版本 4 结构](../src/platform/database/migrations/runtime-leases.ts) |
| `operation_receipts` | 跨会话写入回执；[版本 5 迁移](../src/platform/database/migrations/operation-receipts.ts)和[版本 8 扩展](../src/platform/database/migrations/profile-writes.ts) |
| `chat_sessions`, `agent_runs`, `agent_items` | Main 自有会话/模型快照、请求回执及有序可见 Item；[迁移 19](../src/platform/database/migrations/agent-storage.ts) |
| `chat_context_checkpoints`, `chat_memory_progress` | 私有上下文检查点及停用的旧 Memory 进度；[版本 11](../src/platform/database/migrations/ask-runtime.ts)，由[版本 13](../src/platform/database/migrations/ask-serial.ts)停用 |
| `agent_model_responses`, `agent_model_requests` | Host 专属续传数据（[版本 12](../src/platform/database/migrations/chat-protocol.ts)）及可删除请求诊断（[版本 14](../src/platform/database/migrations/chat-model-requests.ts)） |
| `agent_react_cycles` | Run 下按序保存的执行状态和诊断关联，随 Run 级联删除 |

## 二、业务规则

[职位用例](../src/domain/job/job.service.ts) 接收白名单详情。来源 URL 移除片段并排序查询参数，清洗内容计算哈希；公开 URL 提取已实现，重复匹配/合并仍为规划。归档独立于申请状态。删除 Company 会解除 Job 关联并保留原始公司名称。

[新增工作](../src/pages/find-jobs/AddJobPage.tsx)的手工保存使用 typed IPC，经审核的 Agent 草稿使用 MCP job.import，二者均原子复用 jobs.saveJob。名称和公司必填，新职位为 NOT_STARTED，申请/关闭时间为空且不创建事件。URL/文本/PDF 解析不写业务表，保存时才保留可选真实网页来源；手工文本/PDF 使用 source:null。浏览器预填文本在保存时使用现有 SourceDetails 保留净化后的顶层网址、标题、主机名和最终编辑文本，即使解析返回 source:null 也不会丢失；切换来源模式会清除该绑定。持久化 receipt 见下文。

[申请用例](../src/domain/application/application.service.ts) 原子写入状态变化及时间线事件。允许的状态转换如下：

| 当前状态 | 允许的下一状态 |
| --- | --- |
| `NOT_STARTED` | `PREPARING`, `APPLIED`, `WITHDRAWN` |
| `PREPARING` | `NOT_STARTED`, `APPLIED`, `WITHDRAWN` |
| `APPLIED` | `INTERVIEW`, `OFFER`, `REJECTED`, `WITHDRAWN` |
| `INTERVIEW` | `OFFER`, `REJECTED`, `WITHDRAWN` |
| `OFFER` | `ACCEPTED`, `REJECTED`, `WITHDRAWN` |
| `ACCEPTED`, `REJECTED`, `WITHDRAWN` | 终态；不再变更状态 |

归档 Job 拒绝变更状态及安排/调整日程，但允许备注和详情编辑。同状态请求返回原数据且不重复创建事件，同值详情/归档/改期不产生变更。[申请流程](../src/domain/application/workflow.ts)统一管理状态转换与 allowedNextStatuses。APPLIED 设置申请时间，终态设置关闭时间；系统状态事件不能单独删除。日历范围包含两端，邮件同步仍为规划。

[个人资料用例](../src/domain/candidate/candidate.service.ts) 保证父条目和事实引用属于同一 Profile、条目无环、日期范围有效且条目类型不可修改。条目类型为 `EXPERIENCE / PROJECT / EDUCATION`。事实类别为 `ACHIEVEMENT / RESPONSIBILITY / SKILL / AWARD / CERTIFICATION / COURSE / LANGUAGE / OTHER`。全部已保存 Fact 均可参与生成，不存在确认状态、数据库列或确认操作。

- `Profile.introduction` 保存可选个人简介（最多 2,000 字符），与简历的纯联系方式 basics 和条目背景简介分开。[版本 7 迁移](../src/platform/database/migrations/profile-introduction.ts)添加默认空值，不修改历史快照。[资料编辑](../src/domain/candidate/candidate.service.ts)在字段省略时保留原简介，显式空值用于清空；[导入审核](../src/platform/profile-import/draft.ts)保留原文，缺失或空白简介默认忽略，审核后才替换已有内容。
- [内部简历解析](../src/platform/profile-import/draft.ts)、[MCP 事实工具指引](../src/platform/tools/profile.ts)和[简历导入 Skill](../skills/distill-resume/SKILL.zh-CN.md)要求模型将原文每个技能类别/分组保留为一条 SKILL Fact，包含类别名和完整技术列表。组内分隔符及 PDF 换行不拆分；不同类别/独立陈述分别保存，不重复生成单项技术 Fact。条目级和资料级技能均适用。这是模型指引，不是服务端语义强制校验，也不会迁移已有 Fact。

[MCP 资料命令](../src/domain/candidate/write.service.ts)提供创建及部分更新，沿用同资料引用、日期和条目类型限制；对历史导入的空值，更新无关字段时保留。新增资料/条目/事实仍要求姓名/名称/内容。`Profile.revision` 由[版本 8 迁移](../src/platform/database/migrations/profile-writes.ts)初始化为 1，数据库触发器在基本资料、条目或事实的实际变更（包括 UI、导入、删除/级联）时单调推进。MCP 更新/新增条目和事实必须提交 expectedRevision；同一 BEGIN IMMEDIATE 事务内校验版本、写业务数据及 receipt，无实际变化不推进版本。receipt 重放先于版本检查，返回原结果及历史 revision，之后应重新读取当前版本。版本只约束带 expectedRevision 的 MCP 写入，既有人工表单仍按原 IPC 语义保存。

每个 `ProfileItem` 对应零到多个可独立选择的 Fact；每个 Fact 属于一个 Profile，可选关联该 Profile 中的一个条目。`parentItemId` 表达条目之间的关系。独立技能/语言使用空 `profileItemId`，事实类别不决定归属。`summary` 保存背景，职责/成果分别保存为 Fact。[事实服务](../src/domain/candidate/fact.service.ts)校验编辑及归属。[迁移 15](../src/platform/database/migrations/remove-fact-evidence.ts)删除 `facts.evidence` 以及历史快照 Fact 和事实回执结果中的同名字段，保留其他业务值、修订号和时间；在迁移事务内恢复快照不可变及业务约束。旧请求哈希不变；升级前的新增请求重放可能冲突，应重新读取已保存记录后核对。

[条目校验](../src/domain/candidate/candidate.validation.ts)支持 `metadata.startDateText` / `endDateText`（`YYYY`、`YYYY-MM`、`YYYY-MM-DD`）及 `isCurrent`。导入/手动界面只在完整日期时写入日级列，校验范围，不补造月份/日期。新数据库世代通过 JSON metadata 保留部分日期精度。

[显式导入](../src/domain/candidate/import.service.ts)保留原有未确认的临时 Review。一次确认以同步短事务保存全部已复查且未忽略的联系方式、链接、条目和事实及首次不可变快照；快照写入失败会撤销该次确认的整份业务保存。[选择校验](../src/pages/profile/import-state.ts)拒绝未忽略的无效内容并聚焦字段，忽略父项会排除其事实。导入字段可留空，仍校验格式、日期和长度。[Main 会话](../src/platform/profile-import/service.ts)检查归属、草稿 ID 与同次保存的幂等重放；原文和 Review 为临时数据。旧的部分保存业务 API 保持兼容，界面不提供分批流程。

新 PDF 默认创建新 Profile；追加必须显式选择，且保留已有不可变快照。确认未确认的 Profile 时创建首次快照。成功后清理临时导入，下一份 PDF 使用全新目标映射。[排序](../src/domain/candidate/import.service.ts)保留来源位置，[迁移 18](../src/platform/database/migrations/resume-module.ts)保留历史事实顺序。

### 工作履历与人工确认基准

**已实现（V23–V24）：**[迁移](../src/platform/database/migrations/profile-baseline.ts) 新增独立的 Profile `title` 和 `profile_baselines`；V1–V23 的 SQL/校验和保持不变。[V24](../src/platform/database/migrations/profile-baseline-backfill.ts)兼容已执行 V23 的数据库并保留已有快照，不改写校验和。已有履历将当前结构化数据保存为初始快照。快照是否可用仅由基准是否存在推导，界面不显示 DRAFT/READY 状态。[基准服务](../src/domain/candidate/baseline.service.ts) 仅通过可信 UI IPC 冻结经过 Revision 检查的结构化快照。SQL 拒绝基准 UPDATE；删除所属 Profile 时级联清理。

复制将当前工作内容映射到新 UUID，创建 DRAFT。恢复以一次同步业务短事务仅替换指定 Profile 的工作内容，重建条目父子关系和事实关联，保留排序并重置排序计数器，返回 Trigger 实际推进后的 Revision。Generation 快照和 Artifact 内容不变；旧引用可以变为 MISSING。工作编辑即时持久化且永不更新基准。PDF 原文不是恢复来源。

## 三、生成、成品与删除

[简历启动](../src/domain/resume/resume.service.ts)在同一事务冻结已保存的 Job、Profile、Item、Fact 和配置，并复制为 [ResumeDocument](../src/domain/resume/document.ts)。联系方式和个人简介分别填入基础信息及摘要。条目元数据与顺序来自快照。含正文的 Fact 保持原有顺序，不重复的 Item 摘要置于其 Fact 之前。未关联条目的 SKILL Fact 进入技能栏，其余游离 Fact 和导入时留空的 Fact 保存在快照中。

[生成状态](../src/domain/resume/state-machine.ts)按 `CREATED → COPYING → REWRITING → VALIDATING → PUBLISHING → PUBLISHED` 前进。未发布的任务可进入 `FAILED`、`CANCELLED` 或 `INTERRUPTED`。状态变化递增 `stateVersion`。每条要点在一个 GenerationRun 内最多改动一次，原文提交不消耗机会。文档、回执和既有改写检查在同一 BEGIN IMMEDIATE 事务内提交。相同请求 ID 与内容重放原回执，对已改动要点的新请求返回冲突。[迁移 21](../src/platform/database/migrations/resume-once.ts)移除共享改写版本，保留历史回执及其哈希输入，包括同一要点曾有多次改写的记录。Fact ID 和其余字段均固定。字数目标指导改写，结构与大小校验无法证明措辞准确。[生成服务](../src/domain/resume/generation.service.ts)

发布同时提交 Artifact、Fact 溯源链接及 `PUBLISHED`。文件输出可独立失败。桌面任务在推理前绑定 Agent Run，外部宿主复用业务状态且无本地 Agent Run。[MCP 契约](mcp-architecture.zh-CN.md#五job-agent-browser-mcp)

[迁移 19](../src/platform/database/migrations/agent-storage.ts)保留聊天与 Trace 身份。[迁移 20](../src/platform/database/migrations/resume-v3.ts)将旧运行中任务标记为中断，保留已发布成品和文件，将退役字段保留为只读历史。升级前关闭应用和 MCP 宿主并备份整个 userData 目录。退回 v18 时，用对应版本的应用和 MCP 恢复备份。

[Artifact 编辑](../src/domain/resume/artifact.service.ts)按 `expectedRevision` 和输出 Lease 核对版本。[手工内容](../src/domain/resume/resume.validation.ts)接受用户填写的日期、链接和表述展示文字，包括空表述。校验对象结构、字段类型、ID 和大小范围。[PDF worker](../src/platform/resume-output/worker.ts)对桌面和 MCP 重编译使用相同的手工内容契约。手工增改表述清空来源引用，未改表述保留。[运行时 Lease](../src/platform/database/runtime-leases.ts)与内容版本一起约束编译提交，排除并发构建及过期进程写入。

[输出](../src/platform/resume-output/exporter.ts)内嵌固定版本且有许可的 [Noto 字体](../resources/fonts/version.json)，保留链接展示文字并将有效 HTTP(S) 链接设为可点击，编译转义的自包含 HTML，在隔离的 Electron world 等待字体后固定 A4 分页，并将同一 HTML 打印为 PDF。条目/bullet 优先完整分页，超长文字跨页拆分，不缩小或裁切。[文件写入](../src/platform/resume-output/files.ts)使用私有临时文件、原子替换及 `userData/artifacts/` 下的 HTML/PDF 相对路径记录。输出状态独立，中断/缺失输出可无模型调用重建。DOCX 未实现。硬删除保留快照/成品，不等于隐私清除；[历史引用](../src/platform/database/references.ts)仅按当前实体是否存在返回 `ACTIVE / MISSING`，不提供删除时间。

| 删除对象 | 结果 |
| --- | --- |
| Job | 删除来源/事件；保留生成任务和成品 |
| Profile | 删除全部条目/事实；保留生成历史 |
| ProfileItem | 删除后代子树及关联事实 |
| Fact | 删除来源事实；保留历史成品引用 |
| GenerationRun | 删除成品、Fact 溯源、改写回执及关联的 Resume Trace |
| Artifact | 删除其溯源；保留任务 |

`generation_runs.job_id` 和 `artifact_facts.fact_id` 使用稳定的逻辑引用，允许历史来源被删除。快照 ID 同样属于逻辑引用。其他归属关系使用外键。未实现完整隐私清除或磁盘文件清理 API。

## 四、事务与终端诊断

[操作回执](../src/platform/database/operation-receipts.ts)保存 `(operation, request_id)`、输入哈希、逻辑目标、首次结果 JSON 和创建时间，与业务变更在同一 Domain 事务提交。相同请求跨进程/重启返回首次结果；内容变化或目标已删除则冲突。删除目标后保留回执快照，删除不等于隐私清除。Resume start 保留独立的同运行时 receipt/lease 规则。

[Transactions](../src/platform/database/transactions.ts)实现 `write(operation)` 和 `read(operation)`，分别使用 `BEGIN IMMEDIATE` 和 `BEGIN`。多行变更原子提交；失败回滚并保留原业务错误。拒绝嵌套事务及异步/thenable 回调；事务不含身份、审计上下文或失败补写。

[迁移 V22](../src/platform/database/migrations/remove-audit.ts)在迁移事务内明确删除历史审计表、调用归属表以及审计/写入上下文/UUID 历史复用触发器。保留主键、外键、ID 不可修改、Revision、Snapshot 和 Cycle 约束。V1–V21 SQL、Checksum 和数据库 Generation 保持不变；[旧函数兼容层](../src/platform/database/migrations/legacy-functions.ts)仅服务迁移。桌面端与 MCP 均直接升级，不弹窗、不自动备份，不清空业务库。失败回滚，不创建空库替代。

业务 API、工具、Agent 终态与启动边界直接使用全局 `consola`。仅输出受控名称、状态、固定错误码与工具耗时；不输出输入/结果、正文、凭据、原始异常或堆栈。诊断异常不影响业务返回及 Trace 提交。没有 Logger 服务、日志文件、替代审计表或日志 IPC。`CONSOLA_LEVEL=4 npm run dev` 开启调试等级；进程入口禁用日志延迟节流，让 Reporter 异常留在调用边界内捕获；MCP stdio 入口将日志路由至 stderr，stdout 只传协议。实现见[后端](../src/platform/database/backend.ts)、[能力层](../src/platform/tools/capabilities.ts)、[Recorder](../src/platform/electron/agent-recorder.ts)与[入口](../src/platform/mcp-server/stdio.ts)。

### Ask AI 会话存储

[统一 Agent 存储](../src/platform/database/repositories/chats.ts)为两个定义保存有序 Item、请求回执和诊断。Ask Run 关联 Session 并复用会话序号和检查点。隔离的 Resume Run 的 Session 为空，Item 在本 Run 内排序。聊天存储仍限制每个 Session 只有一个已放行 Run，全局执行 Guard 进一步限制活动 Agent 执行最多一个。删除时级联清理私有记录。智能粘贴的来源标记保留历史并禁用通用重试。

只有 [Main 记录器](../src/platform/electron/agent-recorder.ts)追加模型/工具 Item。保存提供商返回的可读推理及来源/类型、加密块标记、工具调用 ID、完整参数/结果、固定错误码和耗时。[会话脱敏](../src/platform/electron/transcript-redaction.ts)在持久化/事件发送前清除凭据字段，普通业务正文完整保留。系统提示词、加密数据、签名和原始异常不进入 Item。先保存 Item 骨架再发事件，文字每秒 checkpoint 并在结束时保存，不逐 token 写 SQLite。崩溃可能丢失最后一次 checkpoint 后的文字。工具条目还保存经白名单解析的 Guard 计数、原因、执行标记、已确认归档效果，以及可选告警/恢复级别与固定 nextAction，不含凭证或证据指纹；诊断随聊天级联删除，不恢复 Guard 执行态。[详情视图](../src/app/components/AgentTimelineItem.tsx)展示这些字段。复用现有 JSON 存储，无需迁移，历史快照可缺少新增字段。派发前跳过的调用不创建工具 Item 或不确定写入。

提供商续传数据与普通聊天投影 IPC 分离，保存含签名/加密推理的已校验 assistant 消息，随会话删除级联清除。历史重建 assistant/tool 消息但不执行工具；切换提供商/模型后不附带续传元数据，压缩提示词也排除这些数据。旧 Item 继续可读，不补造缺失的历史详情。

**已实现请求诊断：**[迁移 14](../src/platform/database/migrations/chat-model-requests.ts)增加以 Run/ordinal 为主键的 agent_model_requests，随对话删除级联清除。[请求观察器](../src/platform/agent/pi/request-observer.ts)通过 Main 保存准备时间、Provider/模型、agent-turn/context-summary 用途、loadout 版本、预期/Pi/Provider 名称映射、规范化 SHA-256 输入 Schema 指纹、校验结果及重复激活结果；落盘失败阻止发送。准备完成不代表已发送或成功。[chats.listModelRequests](../src/platform/electron/data-contract.ts)分页读取这些记录；记录不进入模型历史、会话 Item，不含正文、完整 Schema、参数、结果及推理。现有 chats.deleteSession 在所有 Run 结束后清除诊断，保留业务数据。[测试](../tests/chat-model-requests.test.ts)覆盖迁移、持久化、分页及删除；请求 Schema 诊断 UI 仍为规划。

Run 通过 runtime_instances 记录 owner；恢复只中断失效/过期 owner，活跃 MCP 启动不能中断 Main。保留部分回答，未完成工具保持 uncertain。新输入创建新 Run，不重放旧业务写入。[上下文检查点](../src/platform/database/repositories/ask-context.ts)保存版本化摘要、单调递增的已压缩用户轮次边界及最小资源/结果引用。按 Token 构造的模型视图保留完整轮次并标注部分回答，原始会话保持完整。 [迁移 16 和 17](../src/platform/database/migrations/chat-react-cycles.ts)保存以 `(run_id, cycle_index)` 标识的 Cycle，约束单个活动 Cycle、连续编号和已结算记录不可变。模型请求 ordinal 和工具 ID 在派发前分别随其诊断和响应保存。最终 Cycle、Run 和会话内容原子结算。历史 Run 不补造记录，恢复保留最后已保存的 Cycle。

[Ask IPC](../src/platform/electron/ask-agent-contract.ts)提供 start/cancel/getRun/listActive/onEvent，校验可信 frame 和窗口归属。人工 Chat CRUD 使用 typed data IPC，Renderer 不能伪造 Run 或输出 Item。重试创建新 Run，尝试过写入的 Run 引导核对状态，不自动重放。[存储测试](../tests/chat.test.ts)覆盖约束/恢复，[投影测试](../tests/ask-store.test.ts)覆盖快照竞争/事件缺口。 [迁移 13](../src/platform/database/migrations/ask-serial.ts)保留旧 Memory 进度供导出，并停用其执行生命周期。

### Copy Debug JSON

**已实现：**`data.chats.copyDebugJson({ sessionId })` 经现有白名单 [Data Bridge](../src/platform/electron/preload/data-bridge.ts)、可信 `DATA_CALL` Handler 及 backend dispatcher 返回 `Result<null, ErrorCode>`。独立 [Domain 用例](../src/domain/chat/chat-debug.service.ts)先校验参数再读取；缺少可选宿主输出时返回 `NOT_IMPLEMENTED`，不读取数据。

[Repository](../src/platform/database/repositories/chat-debug-export.ts)在一个显式快照事务中读取当前 Session 的全部八张聊天表，不分页、不截断。Run 按 `created_at,id`、Item 按 `sequence`、请求/响应按 `ordinal`、Memory Progress 按 `sequence,message_id` 升序排列。保留原始列名、ID、数值标记、null 和 `*_json` 字符串；缺少检查点输出 `null`，空集合输出 `[]`。运行中/Pending 及终态 Run 均只包含持久化记录：不刷新流缓存、不恢复任务、不调用 MCP、不写业务数据、不重建内容，也不二次脱敏。

[v2 Schema](../src/domain/chat/chat-debug.v2.schema.json)在每个 Run 条目加入按 `cycle_index` 升序排列的 `cycles` 和最新状态 `cycleStatus`。零 Cycle 输出 `[]` 和 `null`。[v1 Schema](../src/domain/chat/chat-debug.v1.schema.json)继续描述旧导出，读取端通过 `schemaVersion` 识别版本。[Main 输出](../src/platform/electron/main/chat-debug-output.ts)等待剪贴板写入并精确回读。导出包含 Electron 版本、平台及可空的构建时 commit。Renderer 只接收成功/null 或固定错误。导出包含私有会话与 Provider 数据，继续显示分享前隐私提醒。验证见[导出测试](../tests/chat-debug-export.test.ts)及 [Electron smoke](../scripts/chat-debug-smoke.cjs)。

## 五、API 契约与访问

沙盒 [Preload](../src/platform/electron/preload/index.ts) 暴露 `window.data`。完整类型化输入/输出在 [DataContract](../src/platform/electron/data-contract.ts)；字段/枚举定义保留在所链接的 Domain 类型中。[Main IPC](../src/platform/electron/main/data-ipc.ts) 要求自有窗口、顶层 frame 及精确匹配的可信 Renderer 文档。外部网页/子 frame 无权访问数据。

每个方法接收一个输入对象，返回 `{ ok: true, value }` 或 `{ ok: false, error }`。已实现的业务接口拒绝未知字段，包括注入的内部事务字段。详情编辑方法替换允许的详情，应用类型约定的默认值，不是任意字段 patch。列表使用 `limit`（默认 25，最大 100）及 `offset`（默认 0，最大 1000000），返回 `{ items, total }` 并稳定排序。多表读取使用一致性读事务。

| 命名空间 | 已实现职责；完整签名归属 [DataContract](../src/platform/electron/data-contract.ts) |
| --- | --- |
| `jobs` | 职位/公司 CRUD、来源关联、归档及分页查询 |
| `profiles` | 联系方式/条目/事实 CRUD 与明确审核的导入 |
| `applications` | 合法状态变更、备注、日程及事件/日历查询 |
| `resumes` | 人工 Run/Artifact CRUD 与来源查询；Agent 阶段经过 MCP |
| `chats` | Session CRUD、分页 Item/Run/诊断及确认后的 Main 专属调试剪贴板复制 |
| `settings`, `secrets` | 校验后的文件偏好及密钥状态/保存/删除；不返回密钥 |

API 不提供原始 SQL/表 CRUD、任意筛选、事务管理或生成阶段写入。Agent 生成阶段使用独立于人工/UI IPC API 的 MCP。IPC 变更不自动重试或保证幂等，不确定时先刷新状态；MCP 创建 receipt 是第四节明确说明的例外。下方源合同拥有固定错误定义。

[固定错误码](../src/domain/common/errors.ts)覆盖非法输入、缺失或冲突状态、存储不可用、拒绝调用方、加密及 AI 失败。IPC 只传递错误码，不传递原始数据库消息。

[PDF 导入桥接](../src/platform/electron/profile-import-contract.ts)提供选择、启动、重试、取消和丢弃。解析重试保留 sessionId，产生新 taskId，并复用已提取的文本。

独立的 [AI API](../src/shared/ai.ts)保留非 Agent 流式任务。[简历 IPC](../src/platform/electron/resume-contract.ts)暴露 `window.resume.start/getTask/cancel/retryOutput/getPreview/exportPdf/onEvent`；事件携带 run ID 和递增序号，不显示隐藏推理。每个窗口只允许一个活动任务；页面导航保留任务，窗口释放取消。发布前取消终止 run，发布后只停止输出。导出打开系统保存对话框并复制已有 PDF；`PDF_EXPORT_FAILED` 保留应用内文件，允许再次另存。

[职位导入桥接](../src/platform/electron/job-import-contract.ts)的重试保留 taskId，并从缓存的来源重新解析。两条桥接均按窗口检查任务所有权。

## 六、配置、密钥与待完成工作

受控运行时共享 `database.sqlite`、SQLite 辅助文件及 `userData/artifacts/`。Main 管理 `userData/settings.json` 和 `userData/secrets.enc`；MCP Server 不加载应用凭据。Electron Session 单独拥有网站 Cookie/存储。

可选的 Main 专用 [MCP 配置](../src/platform/storage/mcp-config.ts)读取版本 1 `userData/mcp.json`，不创建或重置文件。配置包含审核后的 stdio 可执行文件/参数及工具清单，不接受环境变量/凭据字段，也不进入 Renderer 偏好。MCP 凭据/OAuth 仍为规划，命令参数不得放入 Secret。[MCP 文档](mcp-architecture.zh-CN.md#三内部与第三方-client)管理配置示例和限制。

[偏好配置](../src/platform/storage/preferences.ts) 校验版本 1、英文/简体中文、`light / dark / system` 主题及可选 Gmail/Outlook/自定义 HTTPS 网页邮箱，网址不得含登录凭据。现有版本 1 的浅色文件保持兼容，版本仍为 1，默认浅色。保存偏好（包括 `system`），不保存解析后的配色；其他部分保存保留该主题。原子替换成功后才应用保存的偏好。文件不存在时使用默认值且不写入。部分保存合并最新文件；损坏或未来版本的文件报错且不重置。[原子替换](../src/platform/storage/files.ts) 使用私有临时文件及重命名；写入失败保留原数据。智能粘贴配置保存 ID、标题和提示词。缺少配置时使用本地化默认项，保存的空列表保持为空。 可选布尔值 `onboardingCompleted` 缺失时表示未完成；部分保存会保留其值，重新初始化仅将其改为 false，不新增数据库结构事件。

[AI 偏好](../src/platform/storage/ai-preferences.ts)校验最多 20 个命名 Provider 实例、HTTPS endpoint（仅 localhost/回环允许 HTTP）、明确的密钥需求、每实例最多 100 个模型 ID 及可空的全局 Provider/模型默认值。endpoint 可保留路径前缀，不接受凭据、查询或片段。读取时忽略旧 `parallelModels` 字段，下次保存时清除。缺失的 AI 与超时设置使用默认值，移除 Provider 前需先删除密钥。

[超时设置](../src/shared/ai.ts)保存全局 `ai.timeouts.requestSeconds`、`pageSeconds` 和 `modelsSeconds`，默认分别为 120、20 和 15 秒。每项允许 1–3600 的整数秒数；无效写入保留原文件。AI 超时覆盖对话、职位/资料解析和 Resume Agent 的每次调用；网页读取及模型检测各自独立。编辑/移除 Provider 或保存其他偏好均保留这些值。[设置测试](../tests/settings.test.ts)验证旧配置读取、持久化及无效写入的原子拒绝。

[密钥](../src/platform/storage/secrets.ts)保存以 Provider 实例 ID 为键的版本 2 密文映射，由 [Main 组装](../src/platform/electron/main/index.ts)中的 Electron `safeStorage` 加密。加密不可用（包括 Linux `basic_text`）时拒绝保存；仍可删除密钥。API 返回配置/加密状态，不返回解密后的密钥。密钥不进入普通配置、SQLite、快照。版本 1 的 OpenAI 密文保持可读，在下次密钥写入时原子升级，不解密无关密钥。只有内部 AI 服务通过注入能力读取明文，公开桥接只返回状态。保存配置/密钥不调用模型；显式连接测试向已保存的 Provider/模型发送短提示词，可能产生费用。

[设置测试](../tests/settings.test.ts) 验证重启读取、全部主题值、版本 1 兼容、部分保存保留主题、校验、损坏、写入失败和加密密钥生命周期。[回退适配器](../src/platform/storage/index.ts) 缺少文件服务时返回 `NOT_IMPLEMENTED`；调试复制另需宿主输出。AI 对话通过[AI 测试](../tests/ai.test.ts)和[生产 smoke](../scripts/ai-smoke.cjs)中的本地服务验证；真实第三方兼容性及账号权限仍未验证。严格结构化输出协商、登录态网页提取/查重、其余业务 UI 和完整隐私清除尚未实现。简历 Provider 兼容性通过本地样本验证，真实 Provider 仍未验证。

## 智能笔记存储与 Memory v1

**已实现：**规范 Markdown 位于 `userData/smart-note/knowledge/` 和 `memory/`，共享唯一 `.git`，不建立 Note/Memory 业务表。Job、Profile、Fact 仍是业务事实的权威来源。独立的 `knowledge-index.sqlite` 与 `memory-index.sqlite` 缓存隔离 FTS、向量、排名和上下文扩展；[embedding identity](../src/platform/knowledge/rag/embedding-protocol.ts)决定向量兼容性。

[迁移](../src/platform/knowledge/workspace-storage.ts)先完成旧恢复日志，锁定旧库与工作区，将所有普通文件（包括未跟踪数据和 `.git`）计算哈希后复制到同文件系统 staging，再创建目录迁移提交。内容与历史验证后原子发布，保留 `knowledge-archive-v1`，将旧入口替换成旧版路径检查会拒绝的文件。符号链接、不安全名称或不可验证状态会停止迁移；日志使中断阶段可重入，不会初始化为空库。

`smart-note-runtime/` 位于 Git 之外，保存迁移/恢复日志、存储代次 1、原 HEAD、迁移提交、明确的旧提交 ID 和规范化 Remote 同意记录。旧提交整体映射至 Knowledge，包括旧有 `knowledge/`、`memory/` 子目录，不单凭路径前缀判断布局。独立 MCP 要求 Main 先完成初始化与恢复。

[备份](../src/platform/knowledge/git/backup.ts)在同一把锁下快照两个空间的 Markdown，沿用当前本地分支并同步到配置的远程分支。历史先按空间过滤再分页，返回相对路径；恢复只检查目标树 Revision，先快照两个空间，再只记录目标变更的恢复日志。内部同步使用工作区日志，UI 不提供工作区恢复。根目录不能重命名或删除；`expectedRevision:null` 仅创建，更新必须携带当前 SHA-256。Git 不保存空目录，保留已删除笔记历史。

[工作区](../src/platform/knowledge/workspace.ts)通过可信 IPC 为当前规范化 Remote 保存同步同意。升级、首次使用 Remote 和更换 Remote 均须说明记忆及其 Git 历史会上传。未同意时只本地备份，传输门禁也覆盖冲突上传。未知远程布局不能覆盖本地文件。权限归属 [MCP 架构](mcp-architecture.zh-CN.md)。

[用户模型存储](../src/platform/models/paths.ts)独立于智能笔记、两个派生索引及 `database.sqlite`：macOS 为 `~/Library/Application Support/JAB/managed-models`，Windows 为 `%LOCALAPPDATA%/JAB/Models`，Linux 为 `${XDG_DATA_HOME:-~/.local/share}/JAB/models`。`JAB_MODEL_STORE` 接受绝对路径覆盖。已验证 revision、重试 staging、心跳锁/租约及 `.installed.json` 属于文件系统资源；激活重新检查大小/SHA256。原子 `seed-preferences.json` 记录初始化 revision，移除后禁用自动 Seed 导入。npm 更新/卸载保留这些文件；权重不可用时保留 chunk/FTS/向量，但检索降级为词法搜索。[偏好加载](../src/platform/storage/knowledge-preferences.ts)仅在读取磁盘时移除旧 providerId/modelId，保留 semanticEnabled，默认 true。
