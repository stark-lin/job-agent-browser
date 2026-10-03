# V1 数据架构与 API

用途：定义已实现的本地存储模型和公开业务 API。状态：SQLite 存储、事务审计、业务校验和 IPC **已实现**；AI 执行、编译及业务页面仍为**规划**。配置和密钥为**占位**。

语言：简体中文 · [English](data-architecture.md)

## 一、运行与存储

[Main](../src/main/index.ts) 在创建窗口前打开 `userData/database.sqlite`。[SQLite 初始化](../src/platform/database/sqlite.ts) 使用 Electron 内置 `node:sqlite`、Main 独占单连接、外键、WAL、完整同步持久化和 1 秒锁等待。Renderer 不获得连接或 SQL 接口。

[版本化迁移](../src/platform/database/migrations/index.ts) 在事务中创建 11 张业务表及 `schema_migrations`。校验和检测迁移被修改；较新的结构版本或校验不匹配会使启动失败，不重置数据。存储初始化失败时不打开窗口/API。UUID v4 ID 由内部生成，成功删除后禁止复用。时间使用 UTC ISO 字符串，日历日期使用 `YYYY-MM-DD`。

[共享 ER 图](diagrams/data-model.md) 描述已实现模型。具体 SQL 类型、默认值、可空性、约束及索引以[建表定义](../src/platform/database/migrations/schema.ts) 为准。JSON 使用校验后的 TEXT 列；SQL 表使用 STRICT。Applications 和 Calendar 基于 Job 与 JobEvent，不另建申请或日历表。

| 表 | 职责 |
| --- | --- |
| `companies`, `jobs`, `job_sources` | 公司身份、职位详情及保留的来源内容 |
| `job_events` | 申请生命周期、日程与备注 |
| `profiles`, `profile_items`, `facts` | 联系方式、结构化容器及可选择证据 |
| `generation_runs`, `artifacts`, `artifact_facts` | 不可变输入、生成阶段、成品与溯源 |
| `audit_logs` | 不含业务内容的成功/失败事件 |

## 二、业务规则

[职位用例](../src/domain/job/job.service.ts) 接收白名单详情。来源 URL 移除片段并排序查询参数，清洗内容计算哈希；重复匹配/合并和网页提取仍为规划。归档独立于申请状态。删除 Company 会解除 Job 关联并保留原始公司名称。

[申请用例](../src/domain/application/application.service.ts) 原子写入状态变化及时间线事件。允许的状态转换如下：

| 当前状态 | 允许的下一状态 |
| --- | --- |
| `NOT_STARTED` | `PREPARING`, `APPLIED`, `WITHDRAWN` |
| `PREPARING` | `NOT_STARTED`, `APPLIED`, `WITHDRAWN` |
| `APPLIED` | `INTERVIEW`, `OFFER`, `REJECTED`, `WITHDRAWN` |
| `INTERVIEW` | `OFFER`, `REJECTED`, `WITHDRAWN` |
| `OFFER` | `ACCEPTED`, `REJECTED`, `WITHDRAWN` |
| `ACCEPTED`, `REJECTED`, `WITHDRAWN` | 终态；不再变更状态 |

归档 Job 拒绝变更状态及安排/调整日程。`APPLIED` 设置申请时间，终态设置关闭时间。系统生成的状态事件不能单独删除。日历范围包含两端，按日程开始时间筛选。邮件同步/事件仍为规划。

[个人资料用例](../src/domain/candidate/candidate.service.ts) 保证父条目和事实引用属于同一 Profile、条目无环、日期范围有效且条目类型不可修改。条目类型为 `EXPERIENCE / PROJECT / EDUCATION`。事实类别为 `ACHIEVEMENT / RESPONSIBILITY / SKILL / AWARD / CERTIFICATION / COURSE / LANGUAGE / OTHER`。新建或修改事实为 `UNVERIFIED`，只有 `confirmFact` 将其标记为 `CONFIRMED`。

## 三、生成、成品与删除

[简历请求](../src/domain/resume/resume.service.ts) 保存版本 1 的 Job、Profile、入选 Fact、入选条目及必要祖先快照。拒绝空事实选择、跨资料证据及归档职位。未经确认的事实在快照中保留原状态。默认配置为模板 `default` 和 500 词；输入及配置不可修改。

[仅 Main 可调用的生成服务](../src/domain/resume/generation.service.ts) 持久化开始 → 评分 → 门控 → 筛选 → 初稿 → 润色 → 校验成品。它不调用 AI 或编译器。状态为 `PENDING / RUNNING / SUCCEEDED / FAILED / CANCELLED / INTERRUPTED`。门控失败停止任务。启动时将残留 `RUNNING` 任务标记为 `INTERRUPTED` 并记录 SYSTEM 审计。重试通过当前输入创建新任务。运行中的任务须先取消才能删除。

[成品校验](../src/domain/resume/resume.validation.ts) 检查内容 ID 唯一、入选快照引用、每个内容块的完整溯源及所选词数预算。每次任务最多一个 Artifact。内容与溯源原子编辑，并清空过期输出文件引用。Main 内部输出记录接受各一个相对 PDF 和 DOCX 路径；编译及文件系统一致性仍为规划。

硬删除移除来源实体，同时保留历史生成结果及不可变快照。历史仍包含业务内容，删除不等于隐私清除。`getRun`、`listRuns` 与 `getArtifact` 返回的引用包含 `ACTIVE / DELETED` 和 `deletedAt`，仅成功删除审计确立已删除状态。

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

[事务管理](../src/platform/database/transactions.ts) 与[数据库触发器](../src/platform/database/migrations/audit-triggers.ts) 为每条变更业务记录自动追加审计。调用方只提交业务参数。一次写入操作拥有一个内部事务：全部变更与成功审计一起提交或全部回滚。多记录操作共享请求和事务 ID。业务查询和审计查询均不写审计。

| 要素 | SQL 字段 | 允许内容 |
| --- | --- | --- |
| 事件 | `event_type`, `action` | 固定操作名称；`CREATE / UPDATE / DELETE` |
| 时间 | `timestamp` | 后端生成的 UTC 时间 |
| 位置 | `component`, `location` | 逻辑组件/操作标识 |
| 来源 | `source`, `request_id` | 可信入口类别和生成的请求 UUID |
| 结果 | `status`, `error` | `SUCCESS / FAILURE`；仅错误码 |
| 身份 | `actor_id`, `target_type`, `target_id` | 不透明的主体与业务对象标识 |

补充字段为 `id`、递增 `sequence` 和 `transaction_id`。ArtifactFact 目标将三个不透明主键 ID 编码为 JSON 数组字符串。USER、AI 和 SYSTEM 使用固定本地主体标识；来源为 `RENDERER / GENERATOR / STARTUP`。这是本地单用户身份方案，不是多用户认证。公开 DTO 字段使用 camelCase。

审计不保留前后值、任意元数据、业务正文、提示词、凭据、原始异常消息、堆栈、实际文件路径或网页 URL。SQL 授权器和触发器拒绝审计更新/删除及伪造插入。缺少内部上下文时拒绝业务写入。成功操作没有实际变更记录时不生成成功审计；生成门控拒绝是成功的持久化操作，任务状态变为 FAILED。

失败写入先回滚，再通过独立事务追加一条失败审计。失败记录沿用请求 ID，其事务 ID 属于失败审计事务。已知时包含校验后的目标 ID，否则为空。无效业务写入参数也会审计，但不复制输入。失败审计无法持久化时返回 `AUDIT_UNAVAILABLE`，不声称已记录。不可信/未知 IPC 请求在执行业务前拒绝。配置/密钥占位不持久化或审计凭据。

## 五、API 契约与访问

沙盒 [Preload](../src/preload/index.ts) 暴露 `window.data`。完整类型化输入/输出在 [DataContract](../src/platform/electron/data-contract.ts)；字段/枚举定义保留在所链接的 Domain 类型中。[Main IPC](../src/platform/electron/main/data-ipc.ts) 要求自有窗口、顶层 frame 及精确匹配的可信 Renderer 文档。外部网页/子 frame 无权访问数据。

每个方法接收一个输入对象，返回 `{ ok: true, value }` 或 `{ ok: false, error }`。已实现的业务接口拒绝未知字段，包括注入的审计/事务字段。详情编辑方法替换允许的详情，应用类型约定的默认值，不是任意字段 patch。列表使用 `limit`（默认 25，最大 100）及 `offset`（默认 0，最大 1000000），返回 `{ items, total }` 并稳定排序。多表读取使用一致性读事务。

可选详情文本及可选 URL 默认空字符串，数组默认空数组，可空 ID/日期/薪资默认空值，条目顺序默认 0。必填来源/联系方式链接 URL 必须使用 HTTP(S) 且不含凭据。内容须至少包含一个文本块；词数预算统计摘要/要点块中按空白分隔的词。具体结构及上限由 Domain 校验模块执行。

| 命名空间 / 方法 | 输入及结果 / 行为 |
| --- | --- |
| `jobs.saveJob` | `{ details, source? }` → Job；可原子附加来源 |
| `jobs.updateDetails` | `{ id, details }` → Job；不包含生命周期字段 |
| `jobs.attachSource` | `{ jobId, source }` → JobSource |
| `jobs.setArchived` | `{ id, archived }` → Job |
| `jobs.deleteJob`, `jobs.getJob` | `{ id }` → 删除 ID / Job |
| `jobs.listJobs` | Page + `status? / archived? / search?` → Jobs；默认未归档 |
| `jobs.listSources` | `{ jobId }` + Page → JobSources |
| `jobs.registerCompany`, `jobs.updateCompany` | 公司详情 / `{ id, details }` → Company |
| `jobs.deleteCompany`, `jobs.listCompanies` | `{ id }` / Page → 删除 ID / Companies |
| `profiles.createProfile`, `profiles.editContact` | 联系方式详情 / `{ id, details }` → Profile |
| `profiles.getProfile`, `profiles.deleteProfile`, `profiles.listProfiles` | `{ id }` / Page → Profile / 删除 ID / Profiles |
| `profiles.addItem` | `{ profileId, parentItemId?, details }` → ProfileItem |
| `profiles.editItem`, `profiles.moveItem` | `{ id, details }` / `{ id, parentItemId, sortOrder }` → ProfileItem |
| `profiles.deleteItem`, `profiles.listItems` | `{ id }` / `{ profileId }` + Page → 删除 ID / ProfileItems |
| `profiles.addFact`, `profiles.editFact` | `{ profileId, profileItemId?, details }` / `{ id, profileItemId?, details }` → Fact |
| `profiles.confirmFact`, `profiles.deleteFact`, `profiles.listFacts` | `{ id }` / `{ profileId }` + Page → Fact / 删除 ID / Facts |
| `applications.changeStatus` | `{ jobId, status }` → Job，内部记录状态事件 |
| `applications.scheduleEvent` | `{ jobId, type, title, description?, startsAt, endsAt? }` → 日程事件 |
| `applications.rescheduleEvent` | `{ id, startsAt, endsAt? }` → 日程事件 |
| `applications.addNote`, `applications.deleteEvent` | `{ jobId, text }` / `{ id }` → 事件 / 删除 ID |
| `applications.listEvents`, `applications.listCalendar` | `{ jobId }` / `{ from, to }` + Page → 事件 |
| `resumes.createRun` | `{ jobId, profileId, factIds, itemIds?, config? }` → GenerationRun |
| `resumes.cancelRun`, `resumes.deleteRun`, `resumes.getRun` | `{ id }` → 任务 / 删除 ID / `{ run, references }` |
| `resumes.listRuns` | Page + `jobId?` → `{ run, references }` 列表，包含已删除 Job 的历史 |
| `resumes.getArtifact` | `{ id }` → `{ artifact, provenance, references }` |
| `resumes.editArtifact`, `resumes.deleteArtifact` | `{ id, title, content, provenance }` / `{ id }` → Artifact / 删除 ID |
| `audit.list` | Page + `targetType? / targetId? / requestId? / transactionId? / status? / from? / to?` → 审计，序号倒序 |
| `settings.get`, `settings.savePreferences` | 明确占位；返回 `NOT_IMPLEMENTED` |
| `secrets.hasProviderKey`, `secrets.saveProviderKey`, `secrets.deleteProviderKey` | 明确占位；返回 `NOT_IMPLEMENTED` |

```ts
const saved = await window.data.jobs.saveJob({
  details: { title: 'Software Engineer', companyNameRaw: 'Example' }
})
if (saved.ok) {
  const history = await window.data.audit.list({ targetType: 'job', targetId: saved.value.id })
}
```

API 不提供原始 SQL/表 CRUD、任意筛选、事务管理、审计写入或生成阶段写入。仅 Main 通过可信服务身份持久化生成阶段。调用方应按以下错误码处理，不依赖数据库消息。变更不自动重试或保证幂等；结果不确定时先刷新状态再重试。

| 错误码 | 含义 |
| --- | --- |
| `INVALID_INPUT` | 未知字段、无效结构/值或超过输入/查询限制 |
| `NOT_FOUND` | 所请求的当前实体不存在 |
| `CONFLICT` | 关系、不可变数据、溯源或 SQL 完整性冲突 |
| `INVALID_STATE` | 不允许的生命周期转换、生成阶段或操作 |
| `STORAGE_BUSY` | 数据库锁争用超过等待上限 |
| `STORAGE_UNAVAILABLE` | 存储操作无法完成；不暴露原始错误详情 |
| `AUDIT_UNAVAILABLE` | 失败操作无法持久记录失败审计；不报告成功 |
| `NOT_IMPLEMENTED` | 配置/密钥占位尚未实现持久化 |
| `FORBIDDEN` | IPC 调用方不是可信的顶层 Renderer 文档 |

## 六、配置、密钥与待完成工作

目前应用自有存储只实现 `database.sqlite` 及 SQLite 辅助文件。配置、加密密钥和编译成品仍规划在 `userData/settings.json`、`userData/secrets.enc` 及 `userData/artifacts/`。Electron Session 单独拥有网站 Cookie/存储。普通审计不可禁用。

[配置/密钥占位](../src/platform/storage/index.ts) 不创建文件，不返回伪造成功。未来偏好配置、密钥保护和文件导出需要独立实现；秘密必须与数据库、快照和审计分离。AI 调用、提取/查重、编译、业务 UI 接入及完整隐私清除尚未实现。

- [当前架构](architecture.zh-CN.md)：运行初始化与进程边界。
- [代码架构](code-architecture.zh-CN.md)：源码归属与质量检查。
- [产品架构](product-architecture.zh-CN.md)：规划的产品范围。
- [README](../README.zh-CN.md)：验证命令与文档索引。
