# V1 数据架构

用途：定义规划中的本地单用户数据模型、生成生命周期与存储规则。状态：**规划**；ER 图是逻辑设计，不是可执行的 SQLite 建表定义。

语言：简体中文 · [English](data-architecture.md)

## 一、范围与实现状态

设计包含 Job、Profile、Generation、Artifact、Audit 五组共 11 张表，以及普通配置和加密密钥文件。各功能共享稳定的实体 ID，不分别保存职位或事实的副本。

**已实现：** Electron、TypeScript、Home 和浏览器基础，见[当前架构](architecture.zh-CN.md)。**占位：** [SQLite 连接](../src/platform/database/sqlite.ts)、[迁移](../src/platform/database/migrations/index.ts)、[AI](../src/platform/ai/index.ts) 和[配置存储](../src/platform/storage/index.ts) 仅有占位文件。[运行入口](../src/main/index.ts) 尚未接入业务数据库、生成流水线、文件编译、审计或密钥服务。

Applications 是 Job 生命周期数据的视图，不另建申请表。Calendar 是基于 JobEvent 的 Applications 规划视图，不新增首页入口。Resume Builder 对应 Tailor Resume；生成的简历属于 Artifact。Inbox 初版仍为网页邮箱；邮件事件类型不代表已实现邮件同步。

## 二、ER 图与表职责

打开[完整 Mermaid ER 图](diagrams/data-model.md)。这份语言无关的共享资源保留了所提供的全部字段、键和 12 条关系；中英文引用同一张图。`PK`、`FK`、`UK` 分别表示主键、外键和唯一键。图中类型为逻辑类型，具体 SQLite 存储类型留待迁移设计确定。

| ER 实体 / 规划表名 | 职责 |
| --- | --- |
| `COMPANY` / `companies` | 公司身份、标准化名称、域名与品牌信息 |
| `JOB` / `jobs` | 职位描述、要求与申请生命周期 |
| `JOB_SOURCE` / `job_sources` | URL、来源标识、清洗内容与查重依据 |
| `JOB_EVENT` / `job_events` | 时间线与日历事件 |
| `PROFILE` / `profiles` | 个人身份与联系方式 |
| `PROFILE_ITEM` / `profile_items` | 工作经历、项目、教育的结构化容器 |
| `FACT` / `facts` | 可独立选择和验证的个人事实 |
| `GENERATION_RUN` / `generation_runs` | 一次生成尝试、快照与中间结果 |
| `ARTIFACT` / `artifacts` | 校验后的结构化成品与编译文件引用 |
| `ARTIFACT_FACT` / `artifact_facts` | 输出内容块到事实的溯源关系 |
| `AUDIT_LOG` / `audit_logs` | 业务数据变更历史 |

每个 Job 可关联一个 Company。每条来源、事件和生成任务必须归属一个 Job。每个 ProfileItem 和 Fact 必须归属一个 Profile；Fact 可关联一个 ProfileItem，资料条目可关联一个父条目。

每次生成任务产出零或一个 Artifact；每个 Artifact 必须归属一个任务，以非空且唯一的 `generation_run_id` 保证。每条 ArtifactFact 关联一个 Artifact 和一个 Fact。AuditLog 可关联一个生成任务；`entity_type + entity_id` 是逻辑引用，不是多态数据库外键。

## 三、职位与事件规则

Job 即使未匹配 Company，也保留原始公司名称。`location_text` 保留来源文字；`locations_json` 描述原文、城市、州、国家及 `ONSITE | HYBRID | REMOTE` 工作模式。`salary_json` 保存可选的上下限、币种、原文及 `HOUR | DAY | WEEK | MONTH | YEAR` 周期。职位要求包含文本、`REQUIRED | PREFERRED | OTHER` 类型及关键词。

规划的 `application_status` 值为 `NOT_STARTED`、`PREPARING`、`APPLIED`、`INTERVIEW`、`OFFER`、`ACCEPTED`、`REJECTED`、`WITHDRAWN`。生命周期时间戳与备注保存在 Job；归档与申请状态分开。状态转换规则尚待定义。

导入先清洗页面、解析内容，再查找或创建 Job。通过标准化 URL 查找来源，以公司、职位名称、地点、外部 ID 和指纹作为匹配依据。不确定时保留独立记录。结构化字段写入 Job，清洗内容写入 JobSource 以便重新解析；这些匹配索引不代表自动唯一约束或合并规则。

规划事件类型为 `STATUS_CHANGED`、`APPLICATION_SUBMITTED`、`EMAIL_RECEIVED`、`INTERVIEW`、`DEADLINE`、`FOLLOW_UP`、`NOTE`。`occurred_at` 表示事实发生时间，`starts_at` 和 `ends_at` 用于日历日程。`external_source + external_id` 可辅助查重，唯一性策略尚待确定。

## 四、个人资料与事实规则

ProfileItem 类型为 `EXPERIENCE`、`PROJECT`、`EDUCATION`。通用字段保存标题、组织、角色、地点、日期、摘要和顺序。按类型区分的元数据可保存雇佣类型、项目技术栈与链接，或学位、专业与 GPA。

项目可嵌套在工作或教育经历下。父子条目必须属于同一个 Profile，且禁止循环引用。Fact 关联的可选 ProfileItem 必须属于其 Profile。这些属于额外完整性规则，ER 关系本身并不能保证。

Fact 保存内容、标签、证据及 `UNVERIFIED | CONFIRMED` 验证状态。规划类别包括成就、职责、技能、奖项、证书、课程、语言及其他；存储枚举的拼写尚待确定。没有 `profile_item_id` 的 Fact 属于个人全局事实。生成时可单独选择事实，无须使用容器内的全部事实。

## 五、生成任务与成品

初版生成类型为 `RESUME`。一次任务管理以下阶段，并记录配置、状态、错误和完成时间；状态枚举与重试策略尚待确定。

| 阶段 | 规划职责 / 存储结果 |
| --- | --- |
| 输入 | 在 `input_snapshot_json` 保存 Job、Profile、ProfileItem 和 Fact 快照 |
| 评分 | 在 `scores_json` 保存针对职位的条目和事实评分，不覆盖 Fact |
| 门控 | 在 `gate_json` 保存是否通过、原因和缺失要求；失败时停止 |
| 筛选 | 在 `selection_json` 保存入选条目与事实 ID、全局事实 ID 和字数预算 |
| 初稿 | 将结构化简历写入 `draft_json` |
| 润色 | 将润色内容写入 `polished_json` |
| 校验 | 检查溯源与长度；未验证文本不得自动变成已确认事实 |
| 编译 | 为通过校验的 Artifact 生成 PDF / DOCX 文件 |

Artifact 的 `content_json` 包含页头、可选摘要块，以及由条目、标题、副标题、日期范围和要点块组成的章节。内容块具有稳定 ID 和文本，条目可引用 ProfileItem。Artifact 保存模板 ID 和输出文件相对路径。多个导出文件归属于同一个 Artifact，不为同一次任务建立多个 Artifact。

`artifact_facts` 使用复合主键 `(artifact_id, block_id, fact_id)`。一个内容块可引用多个事实，同一事实可支持多份成品。`block_id` 指向 `content_json` 内的内容块，不是另一张 SQL 表；必须校验块存在，并在编辑内容时同步维护溯源关系。

输入快照保留该任务使用的材料。个人资料修改后，历史成品仍需可解释；事实删除、修订处理和快照版本规则应在实现迁移前明确。

## 六、审计与数据完整性

审计动作包括 `CREATE`、`UPDATE`、`DELETE`、`MERGE`；操作者包括 `USER`、`AI`、`SYSTEM`。记录来源、可选事务或任务 ID、前后差异和元数据。业务修改及其审计记录必须在同一个 SQLite 事务中写入。

普通操作只追加审计。应为个人数据定义访问与保留范围，并允许通过明确的数据清除流程删除。API Key、令牌和其他秘密不得写入审计或普通日志。

使用应用生成的稳定 ID、UTC ISO 8601 时间戳，并按本地时区展示。ProfileItem 日期等日历日期需使用独立的纯日期表示。启用外键约束。禁止级联删除历史 Artifact 引用的 Fact 或生成任务引用的 Job；优先归档 Job，并使用明确的清除流程。其他删除行为尚待设计；模型没有为每种实体提供归档字段。

| 对象 | 规划约束 / 索引 |
| --- | --- |
| Company | `normalized_name`、`domain` 普通索引 |
| Job | `company_id`、`application_status`、`saved_at` 索引 |
| JobSource | `normalized_url`、`fingerprint` 索引 |
| JobEvent | `job_id`、`starts_at` 索引 |
| ProfileItem | `profile_id`、`parent_item_id` 索引；父子同属一个资料且无环 |
| Fact | `profile_id`、`profile_item_id` 索引；条目同属一个资料 |
| GenerationRun | `(job_id, created_at)` 索引 |
| Artifact | 非空且唯一的 `generation_run_id` 外键 |
| ArtifactFact | `(artifact_id, block_id, fact_id)` 复合主键；`fact_id` 索引 |
| AuditLog | `(entity_type, entity_id, created_at)`、`transaction_id` 索引 |

## 七、配置、密钥与文件

规划在 Electron 应用数据目录下保存应用自有数据：

```text
userData/
├── database.sqlite
├── settings.json
├── secrets.enc
└── artifacts/
    ├── resume_001.pdf
    └── resume_001.docx
```

Electron Session 单独管理网站 Cookie 与会话数据。该目录树是目标布局，不表示应用目前已创建这些文件。

| 配置组 | 规划字段 / 建议默认值 |
| --- | --- |
| 根节点 | `schemaVersion: 1` |
| `general` | `theme: system`、`language: en`、`autoSave: true` |
| `browser` | `homeUrl: about:blank`、`searchEngine: google`、`confirmBeforeSavingJob: true` |
| `ai` | `provider: openai`、空 `model`、`temperature: 0.3` |
| `generation` | `defaultTemplate: default`、`targetWordCount: 500`、`selectionThreshold: 70`、`outputFormat: PDF`、空 `outputDirectory` |
| `privacy` | 建议 `auditEnabled: true`；禁用语义需与强制事务审计要求协调 |

这些值是设计输入，不是已经生效的配置文件。`homeUrl` 表示未来浏览器起始页偏好；应用启动仍打开 Home，通过导航支持 `about:blank` 的方式尚待设计。已有产品要求中的 Agent URL、默认招聘网站、邮箱类型与网页 URL 仍需定义配置键。空模型和输出目录需要校验与默认值解析规则。

Main 负责配置读写，先写临时文件再原子替换。加密 API Key 存入 `secrets.enc`，与 SQLite、配置、快照、审计和日志分离。仅 Main 可解密；Renderer 只获得保存、删除、检查密钥是否存在的窄接口。

目标采用基于操作系统密钥保护的 Electron `safeStorage`，使用 `isAsyncEncryptionAvailable`、`encryptStringAsync` 和 `decryptStringAsync`。已在所安装 Electron 44.4.5 的声明文件（`node_modules/electron/electron.d.ts`）中核对这些名称，版本与[依赖锁文件](../package-lock.json) 一致；运行行为和后端可用性仍未验证。

使用密钥存储前必须检查实际保护能力。在 Linux 缺少适当保护时应明确失败，不应静默接受弱保护回退。

## 八、实现决策与相关文档

编写数据库迁移前，应明确 SQL 类型、关系要求之外的可空性、默认值、JSON 结构与版本、枚举约束、外键删除策略、重复处理、跨资料校验、生成任务恢复，以及导出失败时数据库与文件的一致性。ER 图本身不实现这些规则。

提案中的 `main/domains`、独立 Jobs/Calendar/Resume 页面和服务目录表达概念职责。具体代码位置遵循现有[代码架构](code-architecture.zh-CN.md)；本次不引入目录迁移。

- [产品架构](product-architecture.zh-CN.md)：范围、入口与交付顺序。
- [当前架构](architecture.zh-CN.md)：已核实的运行行为与限制。
- [README](../README.zh-CN.md)：启动、验证与文档索引。
