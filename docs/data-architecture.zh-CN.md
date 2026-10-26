# V1 数据架构与 API

用途：定义已实现的本地存储及业务 API 边界。状态：事务 SQLite/审计、配置/密钥、个人资料编辑/导入、职位采集/申请 Agent以及包含不可变证据、HTML/PDF 输出及异步 IPC 的 Resume Agent V1 均**已实现**。其余产品流程为**规划**。

语言：简体中文 · [English](data-architecture.md)

## 一、运行与存储

[Main](../src/platform/electron/main/index.ts)与[本地 MCP Server](../src/platform/mcp-server/runtime.ts)分别通过一个 `node:sqlite` 连接访问明确指定的 userData 数据库。[SQLite 初始化](../src/platform/database/sqlite.ts)启用外键、WAL、完整同步持久化及 1 秒锁等待。Renderer 不获得 SQL。[App Context](../src/app/context/appContext.ts)保存 Job/Profile/Artifact ID，不复制记录。

[版本化迁移](../src/platform/database/migrations/index.ts)在修改日志模式/结构之前识别数据库世代 `0x4a415632`。只接受空库或相同世代；旧库报 `INCOMPATIBLE_DATABASE_GENERATION`，不重置、删除或迁移。开发/验收必须使用独立 userData。同世代使用事务迁移及校验和；未来版本和校验不匹配使启动失败。UUID v4 ID 删除后不可复用；时间为 UTC ISO 字符串。

[共享 ER 图](diagrams/data-model.md) 描述已实现模型。具体 SQL 类型、默认值、可空性、约束及索引以[建表定义](../src/platform/database/migrations/schema.ts)和[版本 2 审计迁移](../src/platform/database/migrations/ai-audit.ts)为准；后者保留原记录及 15 个审计字段，扩充固定错误码。JSON 使用校验后的 TEXT 列；SQL 表使用 STRICT。Applications 和 Calendar 基于 Job 与 JobEvent，不另建申请或日历表。

| 表 | 职责 |
| --- | --- |
| `companies`, `jobs`, `job_sources` | 公司身份、职位详情及保留的来源内容 |
| `job_events` | 申请生命周期、日程与备注 |
| `profiles`, `profile_items`, `facts` | 联系方式、个人简介、结构化容器及可选择证据 |
| `generation_runs`, `artifacts`, `artifact_facts` | 不可变输入、生成阶段、成品与溯源 |
| `audit_logs` | 不含业务内容的成功/失败事件 |
| `capability_audit` | read/write 能力管理的不含内容的访问/执行审计；[版本 3 结构](../src/platform/database/migrations/capability-audit.ts) |
| `runtime_instances`, `runtime_work`, `invocation_owners`, `resume_start_receipts` | 进程/任务归属、调用归属及原子启动回执；[版本 4 结构](../src/platform/database/migrations/runtime-leases.ts) |
| `operation_receipts` | 跨会话写入回执；[版本 5 迁移](../src/platform/database/migrations/operation-receipts.ts)和[版本 8 扩展](../src/platform/database/migrations/profile-writes.ts) |
| `chat_sessions`, `chat_runs`, `chat_items` | Main 自有会话/模型快照、请求回执及有序可见 Item；[增量版本 6 结构](../src/platform/database/migrations/chat.ts) |

## 二、业务规则

[职位用例](../src/domain/job/job.service.ts) 接收白名单详情。来源 URL 移除片段并排序查询参数，清洗内容计算哈希；公开 URL 提取已实现，重复匹配/合并仍为规划。归档独立于申请状态。删除 Company 会解除 Job 关联并保留原始公司名称。

[新增工作](../src/pages/find-jobs/AddJobPage.tsx)的手工保存使用 typed IPC，经审核的 Agent 草稿使用 MCP job.import，二者均原子复用 jobs.saveJob。名称和公司必填，新职位为 NOT_STARTED，申请/关闭时间为空且不创建事件。URL/文本/PDF 解析不写业务表，保存时才保留可选真实网页来源；无 URL 的文本/PDF 使用 source:null。持久化 receipt 见下文。

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

`Profile.introduction` 保存可选个人简介（最多 2,000 字符），与简历的纯联系方式 basics 和条目背景简介分开。[版本 7 迁移](../src/platform/database/migrations/profile-introduction.ts)添加默认空值，不修改历史快照。[资料编辑](../src/domain/candidate/candidate.service.ts)在字段省略时保留原简介，显式空值用于清空；[导入审核](../src/platform/profile-import/draft.ts)保留原文，缺失或空白简介默认忽略，审核后才替换已有内容。

[MCP 资料命令](../src/domain/candidate/write.service.ts)提供创建及部分更新，沿用同资料引用、日期和条目类型限制；对历史导入的空值，更新无关字段时保留。新增资料/条目/事实仍要求姓名/名称/内容。`Profile.revision` 由[版本 8 迁移](../src/platform/database/migrations/profile-writes.ts)初始化为 1，数据库触发器在基本资料、条目或事实的实际变更（包括 UI、导入、删除/级联）时单调推进。MCP 更新/新增条目和事实必须提交 expectedRevision；同一 BEGIN IMMEDIATE 事务内校验版本、写业务数据及 receipt，无实际变化不推进版本。receipt 重放先于版本检查，返回原结果及历史 revision，之后应重新读取当前版本。版本只约束带 expectedRevision 的 MCP 写入，既有人工表单仍按原 IPC 语义保存。

每个 `ProfileItem` 对应零到多个可独立选择的 Fact；每个 Fact 属于一个 Profile，可选关联该 Profile 中的一个条目。`parentItemId` 表达条目之间的关系。独立技能/语言使用空 `profileItemId`，事实类别不决定归属。`summary` 保存背景，职责/成果分别保存为 Fact。[事实服务](../src/domain/candidate/fact.service.ts)校验编辑及归属。

[条目校验](../src/domain/candidate/candidate.validation.ts)支持 `metadata.startDateText` / `endDateText`（`YYYY`、`YYYY-MM`、`YYYY-MM-DD`）及 `isCurrent`。导入/手动界面只在完整日期时写入日级列，校验范围，不补造月份/日期。新数据库世代通过 JSON metadata 保留部分日期精度。

[显式导入](../src/domain/candidate/import.service.ts)原子应用提交的联系方式、追加链接并插入条目/Fact。[核对选择](../src/pages/profile/import-state.ts)保存全部有效且未忽略内容；未忽略的无效条目阻止提交并聚焦具体无效字段。忽略父项会排除其事实。导入允许姓名、名称、事实内容和链接名称/URL 留空或省略；已填值仍校验格式、日期范围和长度。手动创建资料仍需要姓名。[Main 会话](../src/platform/profile-import/service.ts)强制校验归属、草稿 ID、父项映射、已消费条目及相同批次回执。部分保存保留父项供剩余事实使用。重复上传明确创建新会话；重放回执仅存内存，随窗口/会话清理。

导入为每条变更记录生成 `PROFILE_IMPORT` 审计，使用共享请求/事务；失败回滚全部业务行及成功审计。会话/窗口归属/重放校验发生在业务分发前，不生成业务审计；已接受的事务失败使用普通失败审计。[PDF 解析](../src/platform/profile-import/draft.ts)接受含 `kind`、可选 `content` 及可选 `tags` 的事实，拒绝已移除的 `source.page`/`source.quote`，不做引用匹配。空的可选字段可省略，由本地补齐默认值。导入事实的 `evidence` 为空；已有/手工证据和生成表述到 Fact 的关联继续支持。PDF 字节、完整文字、草稿及重试缓存只存内存。AI 审计继续只表示请求启动。

## 三、生成、成品与删除

[简历请求](../src/domain/resume/resume.service.ts)原子快照 Job、Profile、全部 Fact 和相关条目；空事实资料及归档职位失败。配置固定模板/预算和 Server 运行时类型，可选 Provider/模型是调用方声明的溯源元数据，不构成权限或凭据。历史配置继续可读。[MCP 能力](mcp-architecture.zh-CN.md#五job-agent-browser-mcp)服务内部与外部 Agent，[Resume 推理](../src/platform/agent/resume.ts)位于 Domain 持久化层之外。

[内置提示词](../src/platform/agent/resume.ts)和[外部技能](../skills/tailor-resume/SKILL.zh-CN.md)要求将已填简介作为 summary，仅作局部小修，保留原意、表达、重点和语言。选材预留相关证据与预算；冲突应在 Gate 拒绝，不能悄悄改写。[校验](../src/domain/resume/resume.validation.ts)拒绝删除该 summary，继续执行 Fact 溯源检查。语义保留属于模型指令，并非确定性保证；缺失该字段的历史快照沿用原流程。

可信 [GenerationService](../src/domain/resume/generation.service.ts)持久化 `PENDING / RUNNING / SUCCEEDED / FAILED / CANCELLED / INTERRUPTED`。内部模型只获得读取工具；可信 controller 和 Codex 使用共享阶段能力。门控拒绝持久化缺失证据并停止。发布创建唯一 Artifact 并标记 `SUCCEEDED`；输出失败保留发布结果。启动回执及阶段 handler 支持相同重试，冲突提交失败。

[运行租约](../src/platform/database/runtime-leases.ts)每 5 秒续期，30 秒后过期，并检测已退出的本地 PID。启动及后台恢复仅中断无归属/失效实例的任务和未结束审计。Repository 阻止过期/其他实例的生成写入；输出使用独立尝试 Token 及独立目录，排斥并发编辑/构建，并隔离文件替换。[共享输出服务](../src/platform/resume-output/service.ts)记录文件前校验 Token/内容。UI 查询只读并轮询外部活动；其他会话不能接管中断生成。

[ResumeDocument](../src/domain/resume/resume.types.ts)是 draft/polished/Artifact 唯一结构：语言、应用复制的基本信息及条目元数据、summary、experience/projects/education bullet 及 skills。每条生成表述包含稳定 UUID、文字和非空 `factIds`。[校验](../src/domain/resume/resume.validation.ts)强制唯一 ID、入选快照引用、条目归属、基本信息不变及语言感知预算；中日韩字符逐字计数。导入条目的标题可以在简历中保持为空；元数据仍须与冻结快照完全一致，不得补造占位文本。润色不能新增表述 ID、条目或扩大草稿表述的引用。`artifact_facts` 从表述派生，调用方不再提交独立溯源。引用合法不代表语义真实；[人工核对样本](../tests/fixtures/resume-evidence.json)明确将虚构数字及扩张职责标为无证据支持。

[输出](../src/platform/resume-output/exporter.ts)内嵌固定版本且有许可的 [Noto 字体](../resources/fonts/version.json)，编译转义的自包含 HTML，在隔离的 Electron world 等待字体后固定 A4 分页，并将同一 HTML 打印为 PDF。条目/bullet 优先完整分页，超长文字跨页拆分，不缩小或裁切。[文件写入](../src/platform/resume-output/files.ts)使用私有临时文件、原子替换及 `userData/artifacts/` 下的 HTML/PDF 相对路径记录。输出状态独立，中断/缺失输出可无模型调用重建。DOCX 未实现。硬删除保留快照/成品，不等于隐私清除；历史引用根据删除审计返回 `ACTIVE / DELETED`。

| 删除对象 | 结果 |
| --- | --- |
| Job | 删除来源/事件；保留生成任务和成品 |
| Profile | 删除全部条目/事实；保留生成历史 |
| ProfileItem | 删除后代子树及关联事实 |
| Fact | 删除来源事实；保留历史成品引用 |
| GenerationRun | 删除其成品及成品溯源 |
| Artifact | 删除其溯源；保留任务 |

`generation_runs.job_id` 和 `artifact_facts.fact_id` 使用稳定的逻辑引用，允许历史来源被删除。快照 ID 同样属于逻辑引用。其他归属关系使用外键。审计在所有业务删除后保留；没有实现审计清空或磁盘文件清理 API。

## 四、审计与事务

[操作回执](../src/platform/database/operation-receipts.ts)保存 (operation, request_id)、规范化输入哈希、逻辑目标、首次结果 JSON 和创建时间。job.import/application.add_note/application.schedule_event 及所有 profile 写入 在与业务行及成功审计相同的 Domain 事务内写入 receipt。跨进程/重启的相同重试返回首次结果，不同内容或已删除目标返回冲突；目标删除后仍保留 receipt 结果快照，删除并非隐私清除；不自动重建，也不嵌套服务事务。Resume start 保留独立的同运行时 receipt/lease 规则。

[事务管理](../src/platform/database/transactions.ts) 与[数据库触发器](../src/platform/database/migrations/audit-triggers.ts) 为每条变更业务记录自动追加审计。调用方只提交业务参数。一次写入操作拥有一个内部事务：全部变更与成功审计一起提交或全部回滚。多记录操作共享请求和事务 ID。普通业务/审计查询保持只读；显式能力读取会额外记录下述访问审计。

| 要素 | SQL 字段 | 允许内容 |
| --- | --- | --- |
| 事件 | `event_type`, `action` | 固定操作名称；`CREATE / UPDATE / DELETE` |
| 时间 | `timestamp` | 后端生成的 UTC 时间 |
| 位置 | `component`, `location` | 逻辑组件/操作标识 |
| 来源 | `source`, `request_id` | 可信入口类别和生成的请求 UUID |
| 结果 | `status`, `error` | `SUCCESS / FAILURE`；仅错误码 |
| 身份 | `actor_id`, `target_type`, `target_id` | 不透明的主体与业务对象标识 |

补充字段为 `id`、递增 `sequence` 和 `transaction_id`。ArtifactFact 目标将三个不透明主键 ID 编码为 JSON 数组字符串。USER、AI、SYSTEM 和 EXTERNAL 使用固定本地主体标识；来源为 `RENDERER / GENERATOR / STARTUP / AI_CLIENT / MCP_SERVER`。这是本地单用户身份方案，不是多用户认证。公开 DTO 字段使用 camelCase。

审计不保留前后值、任意元数据、业务正文、提示词、凭据、原始异常消息、堆栈、实际文件路径或网页 URL。SQL 授权器和触发器拒绝审计更新/删除及伪造插入。缺少内部上下文时拒绝业务写入。成功操作没有实际变更记录时不生成成功审计；生成门控拒绝是成功的持久化操作，任务状态变为 FAILED。

失败写入先回滚，再通过独立事务追加一条失败审计。失败记录沿用请求 ID，其事务 ID 属于失败审计事务。已知时包含校验后的目标 ID，否则为空。无效业务写入参数也会审计，但不复制输入。失败审计无法持久化时返回 `AUDIT_UNAVAILABLE`，不声称已记录。不可信/未知 IPC 请求在执行业务前拒绝。配置/密钥使用独立文件适配器，不将凭据写入 SQLite 或审计。

**已实现 AI 调用审计：**[Transactions](../src/platform/database/transactions.ts)中的 Main 内部 `recordAI` 能力写入 `AI_STREAM_START`、`CREATE`、组件 `ai`、位置 `chat.stream`、来源 `AI_CLIENT` 和主体 `local-user`。`targetType = ai_request`；目标/请求 ID 为同一个生成的不透明请求 UUID，不映射业务对象。时间、记录 ID 和事务 ID 由数据库层生成。[审计查询](../src/platform/database/audit-reader.ts)接受此逻辑目标，不将其视为业务实体/表。

每次已接受请求只尝试一次审计：首个有效 SSE 块提交 `SUCCESS` 后才转发内容；启动失败/取消提交带固定错误码的 `FAILURE`。成功仅表示流已启动，不代表输出完成。启动后的完成、失败和取消不追加调用审计。手动重试创建新请求。审计失败会停止转发/中止请求并报告 `AUDIT_UNAVAILABLE`，此时外部调用可能已经发生。不持久化 Provider/模型/URL、用量、耗时、消息、提示词、输出、业务快照或额外元数据。此旧 API 保留给连接测试/导入；Ask AI 使用下述会话存储。

**Agent 模型审计：**每次普通或流式调用通过 recordAgentModel 记录一次固定 AGENT_MODEL_RESULT 结果，组件为 ai、位置为 agent.model、来源为 GENERATOR，主体使用 Main 绑定的内部 Agent 标识。仅保存不透明请求 ID 和固定结果，不保存提示词、输出、密钥或隐藏推理；审计失败终止执行。

**已实现审计浏览：**只读 [Settings 查看器](../src/pages/settings/AuditViewerSection.tsx)使用 `audit.list`，不更改数据库结构或 IPC。默认每页 25 条，按序号倒序排列。类型/状态、目标/请求/事务 ID 精确匹配及包含边界的时间范围组合现有筛选。[筛选转换](../src/pages/settings/audit-filters.ts)校验 ID/范围，并将本地日期时间转换为规范 UTC；详情同时显示本地化时间和存储的 UTC 值。刷新/重置/应用筛选均回到第一页。分页使用 offset，新增写入可能移动后续页记录，应刷新获取最新顺序。不提供导出、自动轮询、日志修改或业务内容重建。设置/密钥写入仍不进入审计，AI 成功仍仅表示启动。

**已实现能力审计：**[read/write 封装](../src/platform/tools/capabilities.ts)校验参数并提交 `START`，然后调用 Domain Service 或 MCP Client，最后提交唯一的 `END`，包含成功/固定错误和耗时。工具绑定不自行写审计。原生写入复用现有业务事务，每个变更行只产生一次业务变更审计，另有独立的能力访问/结果记录；外部网络等待不占用 SQLite 事务。

[受控运行时写入器](../src/platform/database/capability-audit.ts)向只追加的 `capability_audit` 表记录调用 ID、阶段、UTC 时间、运行时绑定的 Agent/run ID、审核后的工具名称/模式、可选 Server/原始名称、已校验的原生目标类型/UUID、耗时、状态和错误。不记录输入、输出、提示词、URL、命令、凭据或原始异常。执行前被参数校验拒绝的请求不产生访问记录。SQL 保护和 authorizer 拒绝伪造插入、更新及删除。

开始审计失败时不执行；结束审计失败返回 `TOOL_AUDIT_UNAVAILABLE`，不重试，也不声称已回滚，此时外部操作或本地提交可能已完成。仅为失效实例缺少结束记录的调用追加 `INTERRUPTED`，保留存活调用。现有 `audit.list`/Settings 查看器仍只读取业务/AI `audit_logs`，能力诊断仅运行时内部可见。[测试](../tests/capability-audit.test.ts)覆盖隐私、失败、回滚及不可变记录；执行策略/生命周期归属 [MCP 架构](mcp-architecture.zh-CN.md)。

### Ask AI 会话存储

[Chat Repository](../src/platform/database/repositories/chats.ts)在首次发送时原子创建 Session/Run/User Item，以请求 UUID 及输入哈希作为回执。部分唯一索引保证每 Session 一个运行中 Run，复合外键绑定 Item 所属 Run/Session。Session 保存模型选择并复制到各 Run，新会话草稿只在 Renderer 内存中。删除会话要求无活动 Run，级联移除会话记录及回执，不撤销业务修改或清除审计。

只有 [Main 记录器](../src/platform/electron/ask-agent-recorder.ts)追加模型/工具 Item。保存可见文字、明确公开的思考摘要、允许的标量工具摘要及固定错误码；不保存原始工具参数/结果、系统提示词、隐藏推理、凭据或原始异常。会话内容与不含内容的审计分开。先保存 Item 骨架再发事件，文字每秒 checkpoint 并在结束时保存，不逐 token 写 SQLite。崩溃可能丢失最后一次 checkpoint 后的文字。

Run 通过 runtime_instances 记录 owner。恢复仅中断失效/过期 owner，活跃 MCP Server 启动不能中断 Main 任务。未完成文字标记 interrupted，工具标记 uncertain，不自动续跑。事件快照包含内存片段及递增水位以支持重新订阅。历史最多取 40 个已完成 user/assistant Item、256 KiB，并从用户消息边界开始；当前 Run 工具观察另限制为 2 MiB。不重放历史工具/思考内容。

[Ask IPC](../src/platform/electron/ask-agent-contract.ts)提供 start/cancel/getRun/listActive/onEvent，校验可信 frame 和窗口归属。人工 Chat CRUD 使用 typed data IPC，Renderer 不能伪造 Run 或输出 Item。重试创建新 Run，尝试过写入的 Run 引导核对状态，不自动重放。[存储测试](../tests/chat.test.ts)覆盖约束/恢复，[投影测试](../tests/ask-store.test.ts)覆盖快照竞争/事件缺口。

## 五、API 契约与访问

沙盒 [Preload](../src/platform/electron/preload/index.ts) 暴露 `window.data`。完整类型化输入/输出在 [DataContract](../src/platform/electron/data-contract.ts)；字段/枚举定义保留在所链接的 Domain 类型中。[Main IPC](../src/platform/electron/main/data-ipc.ts) 要求自有窗口、顶层 frame 及精确匹配的可信 Renderer 文档。外部网页/子 frame 无权访问数据。

每个方法接收一个输入对象，返回 `{ ok: true, value }` 或 `{ ok: false, error }`。已实现的业务接口拒绝未知字段，包括注入的审计/事务字段。详情编辑方法替换允许的详情，应用类型约定的默认值，不是任意字段 patch。列表使用 `limit`（默认 25，最大 100）及 `offset`（默认 0，最大 1000000），返回 `{ items, total }` 并稳定排序。多表读取使用一致性读事务。

可选详情文本及可选 URL 默认空字符串，数组默认空数组，可空 ID/日期/薪资默认空值，条目顺序默认 0。必填来源/联系方式链接 URL 必须使用 HTTP(S) 且不含凭据。ResumeDocument 至少包含一条有来源表述；预算使用统一的语言感知计数函数。具体结构及上限由 Domain 校验模块执行。

| 命名空间 | 已实现职责；完整签名归属 [DataContract](../src/platform/electron/data-contract.ts) |
| --- | --- |
| `jobs` | 职位/公司 CRUD、来源关联、归档及分页查询 |
| `profiles` | 联系方式/条目/事实 CRUD 与明确审核的导入 |
| `applications` | 合法状态变更、备注、日程及事件/日历查询 |
| `resumes` | 人工 Run/Artifact CRUD 与来源查询；Agent 阶段经过 MCP |
| `chats` | Session 列表/读取/重命名/模型/删除、Item 与 Run 分页；不能创建模型输出 |
| `audit` | 只读且不含业务内容的审计查看 |
| `settings`, `secrets` | 校验后的文件偏好及密钥状态/保存/删除；不返回密钥 |

API 不提供原始 SQL/表 CRUD、任意筛选、事务管理、审计写入或生成阶段写入。Agent 生成阶段使用独立于人工/UI IPC API 的 MCP。IPC 变更不自动重试或保证幂等，不确定时先刷新状态；MCP 创建 receipt 是第四节明确说明的例外。使用以下固定错误码，不依赖数据库消息。

| 错误码 | 含义 |
| --- | --- |
| `INVALID_INPUT` | 未知字段、无效结构/值或超过输入/查询限制 |
| `NOT_FOUND` | 所请求的当前实体不存在 |
| `CONFLICT` | 关系、不可变数据、溯源或 SQL 完整性冲突 |
| `INVALID_STATE` | 不允许的生命周期转换、生成阶段或操作 |
| `STORAGE_BUSY` | 数据库锁争用超过等待上限 |
| `STORAGE_UNAVAILABLE` | 存储操作无法完成；不暴露原始错误详情 |
| `AUDIT_UNAVAILABLE` | 必需的业务/调用审计无法提交；操作报告失败 |
| `NOT_IMPLEMENTED` | 非生产后端未提供存储适配器 |
| `ENCRYPTION_UNAVAILABLE` | 操作系统加密不可用；拒绝保存密钥 |
| `FORBIDDEN` | IPC 调用方不是可信的顶层 Renderer 文档或请求所有者 |
| `AI_NOT_CONFIGURED`, `AI_AUTH_FAILED`, `AI_RATE_LIMITED` | 缺少 Provider/模型/密钥、身份验证被拒或限流 |
| `AI_PROVIDER_FAILED`, `AI_PROTOCOL_ERROR`, `AI_CONNECT_FAILED`, `AI_TIMEOUT`, `AI_CANCELLED` | 服务商、流格式、网络、超时或取消结果 |

[PDF 导入桥接](../src/platform/electron/profile-import-contract.ts)暴露 `window.profileImport.selectPdf/start/retry/cancel/discard/onEvent`，不提供路径读取。两种导入的 `start` 均接受可选 `mode`（默认 `single`）；事件包含携带分组状态及 `queueMs`/`elapsedMs` 的 `progress.groups`，`failed.retryable` 表示可用缓存重试失败组。PDF 的 `retry({sessionId})` 保留会话并返回新 `taskId`。文件/网络操作与同步业务事务分离。

独立的 [AI API](../src/shared/ai.ts)保留非 Agent 流式任务。[简历 IPC](../src/platform/electron/resume-contract.ts)暴露 `window.resume.start/getTask/cancel/retryOutput/getPreview/exportPdf/onEvent`；事件携带 run ID 和递增序号，不显示隐藏推理。每个窗口只允许一个活动任务；页面导航保留任务，窗口释放取消。发布前取消终止 run，发布后只停止输出。导出打开系统保存对话框并复制已有 PDF；`PDF_EXPORT_FAILED` 保留应用内文件，允许再次另存。

[职位导入桥接](../src/platform/electron/job-import-contract.ts) 暴露 `window.jobImport.start/retry/cancel/onEvent`，与同步业务分发分离。职位的 `retry({taskId})` 保留该任务 ID；两种重试均要求归属匹配且批次处于可重试失败状态。新读取/解析错误仅属于桥接。每次提交的 AI 分组分别产生启动审计；重试时缓存成功组不产生新请求/审计，内容不进入审计。

## 六、配置、密钥与待完成工作

受控运行时共享 `database.sqlite`、SQLite 辅助文件及 `userData/artifacts/`。Main 管理 `userData/settings.json` 和 `userData/secrets.enc`；MCP Server 不加载应用凭据。Electron Session 单独拥有网站 Cookie/存储。普通业务审计不可禁用。

可选的 Main 专用 [MCP 配置](../src/platform/storage/mcp-config.ts)读取版本 1 `userData/mcp.json`，不创建或重置文件。配置包含审核后的 stdio 可执行文件/参数及工具清单，不接受环境变量/凭据字段，也不进入 Renderer 偏好。MCP 凭据/OAuth 仍为规划，命令参数不得放入 Secret。[MCP 文档](mcp-architecture.zh-CN.md#三内部与第三方-client)管理配置示例和限制。

[偏好配置](../src/platform/storage/preferences.ts) 校验版本 1、英文/简体中文、`light / dark / system` 主题及可选 Gmail/Outlook/自定义 HTTPS 网页邮箱，网址不得含登录凭据。现有版本 1 的浅色文件保持兼容，版本仍为 1，默认浅色。保存偏好（包括 `system`），不保存解析后的配色；其他部分保存保留该主题。原子替换成功后才应用保存的偏好。文件不存在时使用默认值且不写入。部分保存合并最新文件；损坏或未来版本的文件报错且不重置。[原子替换](../src/platform/storage/files.ts) 使用私有临时文件及重命名；写入失败保留原数据。

[AI 偏好](../src/platform/storage/ai-preferences.ts)校验最多 20 个命名 Provider 实例、HTTPS endpoint（仅 localhost/回环允许 HTTP）、明确的密钥需求、每实例最多 100 个模型 ID 及可空的全局 Provider/模型默认值。每个 Provider 可选的 `parallelModels` 只能包含其 `models` 内不重复的 ID；缺省/空列表表示关闭，无效写入原子拒绝。保存其他偏好保留该列表；在设置中移除模型 ID 时同步移除其许可。Endpoint 保留路径前缀，拒绝凭据、查询参数和片段。旧版本 1 文件在内存中补齐缺少的 AI/超时默认值，保存前不改写。移除 Provider 前须先删除其密钥。模型检测、导入模式选择及任务生命周期归属[当前架构](architecture.zh-CN.md)。

[超时设置](../src/shared/ai.ts)保存全局 `ai.timeouts.requestSeconds`、`pageSeconds` 和 `modelsSeconds`，默认分别为 120、20 和 15 秒。每项允许 1–3600 的整数秒数；无效写入保留原文件。AI 超时覆盖对话、职位/资料解析和 Resume Agent 的每次调用；网页读取及模型检测各自独立。编辑/移除 Provider 或保存其他偏好均保留这些值。[设置测试](../tests/settings.test.ts)验证旧配置读取、持久化及无效写入的原子拒绝。

[密钥](../src/platform/storage/secrets.ts)保存以 Provider 实例 ID 为键的版本 2 密文映射，由 [Main 组装](../src/platform/electron/main/index.ts)中的 Electron `safeStorage` 加密。加密不可用（包括 Linux `basic_text`）时拒绝保存；仍可删除密钥。API 返回配置/加密状态，不返回解密后的密钥。密钥不进入普通配置、SQLite、快照或审计；文件偏好/密钥操作不追加业务审计。版本 1 的 OpenAI 密文保持可读，在下次密钥写入时原子升级，不解密无关密钥。只有内部 AI 服务通过注入能力读取明文，公开桥接只返回状态。保存配置/密钥不调用模型；显式连接测试向已保存的 Provider/模型发送短提示词，可能产生费用。

[设置测试](../tests/settings.test.ts) 验证重启读取、全部主题值、版本 1 兼容、部分保存保留主题、校验、损坏、写入失败和加密密钥生命周期。[回退适配器](../src/platform/storage/index.ts) 仅在后端未组装文件服务时返回 `NOT_IMPLEMENTED`。AI 对话通过[AI 测试](../tests/ai.test.ts)和[生产 smoke](../scripts/ai-smoke.cjs)中的本地服务验证；真实第三方兼容性及账号权限仍未验证。严格结构化输出协商、登录态网页提取/查重、其余业务 UI 和完整隐私清除尚未实现。简历 Provider 兼容性通过本地样本验证，真实 Provider 仍未验证。

- [当前架构](architecture.zh-CN.md)：运行初始化与进程边界。
- [代码架构](code-architecture.zh-CN.md)：源码归属与质量检查。
- [产品架构](product-architecture.zh-CN.md)：规划的产品范围。
- [README](../README.zh-CN.md)：验证命令与文档索引。

## 智能笔记知识库

Files are truth：userData/knowledge 保存规范 Markdown，不建 Note 表；knowledge-index.sqlite 是独立于 database.sqlite 的可重建缓存。[备份](../src/platform/knowledge/git/backup.ts)只保存 Markdown；恢复前先快照当前文件，多文件替换使用恢复日志，版本检查拒绝过期写入。删除保留 Git 历史，Git 不保存空目录。

[Embedding identity](../src/platform/knowledge/rag/embedding-protocol.ts)包含模型 revision、dtype、维度、pooling、归一化、token 上限及前缀版本。索引重建缺失、变更或不兼容的向量，检索排除其他 identity。原始 Markdown 仍是事实源。[偏好加载](../src/platform/storage/knowledge-preferences.ts)仅在读取磁盘时移除旧 providerId/modelId，保留 semanticEnabled（包括 false），新安装默认 true；新写入拒绝旧字段。
