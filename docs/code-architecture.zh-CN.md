# 目标代码架构

用途：确定代码职责、依赖关系与渐进迁移方式。状态：Home 和分层业务存储**已实现**；页面导航及其他目标模块仍为**占位 / 规划**。运行依据见[当前架构](architecture.zh-CN.md)。

语言：简体中文 · [English](code-architecture.md)

## 一、组织原则与现状

按 Page 组织产品代码，按 Domain 沉淀共享业务规则，按 Platform 隔离技术适配。采用页面优先的模块化架构，不引入完整 DDD。新功能先放对应页面，需要时再抽取稳定的跨页面能力。

| 层 | 职责 | 现有依据 |
| --- | --- | --- |
| App | 组装、路由、Provider、导航与上下文 | [App 占位](../src/app/App.tsx) |
| Pages | UI、局部组件/hooks/状态和页面流程 | [已实现 Home](../src/pages/home/HomePage.tsx)、[Tailor Resume 占位](../src/pages/tailor-resume/TailorResumePage.tsx) |
| Domain | 实体、规则、用例、Repository 与能力接口 | [Job 业务用例](../src/domain/job/job.service.ts) |
| Platform | Electron、浏览器、数据库、文件系统、AI 与配置适配 | [SQLite 适配](../src/platform/database/sqlite.ts) |
| Shared | 不含业务语义的工具、类型、hooks 与 UI | [公共 UI 占位](../src/shared/ui/index.ts) |

当前构建仍从 `src/main/`、`src/preload/`、`src/renderer/` 启动，以 [electron.vite.config.ts](../electron.vite.config.ts) 为准。Home 由 [Renderer App](../src/renderer/App.tsx) 导入；目标入口在迁移完成前不替换现有入口。

## 二、目标目录边界

```text
src/
├── app/
│   ├── navigation/
│   └── context/
├── pages/
│   ├── home/
│   ├── find-jobs/
│   ├── tailor-resume/
│   ├── interview-prep/
│   ├── applications/
│   ├── inbox/
│   ├── profile/
│   ├── browser/
│   ├── ai/
│   └── settings/
├── domain/
│   ├── job/
│   ├── resume/
│   ├── candidate/
│   ├── application/
│   ├── interview/
│   └── common/
├── platform/
│   ├── electron/
│   │   ├── main/
│   │   └── preload/
│   ├── browser/
│   │   └── extractors/
│   ├── database/
│   │   ├── migrations/
│   │   └── repositories/
│   ├── filesystem/
│   ├── storage/
│   └── ai/
└── shared/
    ├── ui/
    ├── hooks/
    ├── utils/
    └── types/
```

目标组织与原始运行入口并存，存储实现已填充其中的 Domain 与 Platform 边界。页面局部组件、hooks、model 按需创建；[Tailor Resume 目录](../src/pages/tailor-resume/) 提供了占位。[Home 目录](../src/pages/home/) 保存已实现页面。未明确文件的模块使用 `index.ts` 占位；文件存在不代表功能已经实现。

## 三、依赖关系与进程组装

| 使用方 | 允许依赖 | 边界 |
| --- | --- | --- |
| App | Pages、Domain、Platform API | 在正确进程中组装并注入依赖 |
| Page | Domain、受控 Platform API、公共 UI/工具 | 使用导航与上下文，不导入 Main 专属实现 |
| Domain | 业务接口、无框架依赖的工具与类型 | 不依赖 Page、React、Electron 或具体 Platform |
| Platform | Domain 接口、通用契约、技术库 | 实现能力，不感知产品页面 |
| Shared | 对应运行环境允许的通用库 | 不反向依赖业务模块；Domain 不使用 React UI/hooks |

逻辑调用流程为 Page → Domain → Platform；Domain 依赖接口，Platform 实现接口。Repository 与 AI 能力在应用初始化时注入。跨进程调用通过窄 Preload/IPC 操作完成；源码目录不会消除 Electron 进程边界。

数据库访问归 Main；配置、密钥解密、AI 请求与文件编译同样保留给 Main 或受控服务。Renderer 不得导入 SQLite、文件系统或 Electron Main 实现。保留沙盒、上下文隔离和第三方网页隔离，并校验特权 IPC 的发送方与输入。

## 四、导航与共享上下文

导航位于 [app/navigation](../src/app/navigation/)，不进入 Domain。未来通过校验 URL 与类型的统一 API 处理内部 `app://` 页面和 HTTP(S) 网站。目录名不决定公开 URL：`tailor-resume/` 对应 `app://resume`。内部路由与混合历史仍待实现。

[app/context](../src/app/context/) 应保存当前页面、Job 和简历 Artifact 的引用，不复制完整记录。通过 Domain 获取 Profile 与业务实体，需要时通过浏览器能力获取标题、内容和选中文字。旧示例中的 `currentApplicationId` 在 V1 模型中不对应独立持久化实体；Applications 使用 Job ID。

Home 只调用功能入口导航。跨页面业务规则属于 Domain；导航与上下文切换仍由 App/Page 负责。

## 五、数据模型与能力归属

[V1 数据架构](data-architecture.zh-CN.md) 负责结构、流水线阶段与存储规则。五组数据不要求新增五个源码目录。提案中的 `main/domains` 目录树不替换现有页面优先基线。

| 职责 | 现有边界中的归属 |
| --- | --- |
| Company、Job 与来源 | `domain/job/`；事件及申请/日历用例位于 `domain/application/` |
| Profile、ProfileItem、Fact | `domain/candidate/`，对应 My Profile |
| GenerationRun、Artifact、溯源 | `domain/resume/` 中的简历用例；确有复用需要时再抽取 |
| 申请生命周期与日历 | `domain/application/` 基于 Job 和 JobEvent 的流程；UI 位于 `pages/applications/` |
| SQLite、迁移、Repository、审计持久化 | Main 侧 `platform/database/`；审计策略仍是业务规则 |
| AI Provider、配置、加密密钥、输出文件 | `platform/ai/`、`platform/storage/`、`platform/filesystem/` 适配；编译器和服务文件仍待设计 |

Domain 定义 Repository 与提取接口，具体 SQLite Repository 和[通用提取器](../src/platform/browser/extractors/generic.ts) 归 Platform。页面快照使用普通数据，不传入 Electron 或 DOM 对象。当前只占位通用提取器，网站专属适配仍延后。保存提取的部分数据前需校验 Job 必需字段。

AI 契约不向页面暴露供应商 SDK 类型。业务专属契约归使用它的 Domain，只有通用契约进入 Shared。具体 Provider 和编译适配仍为规划。

`JobCard`、`ResumePreview` 即使复用也保留在 Pages；`ApplicationStatus` 等业务类型属于 Domain。Shared 不承载业务 UI 或实体。

## 六、实现与质量规则

1. 替代实现可用前保持现有构建入口；迁移时同步更新[构建配置](../electron.vite.config.ts) 和[包入口](../package.json)。
2. 新功能先放对应 Page，页面专属逻辑留在页面，不提前创建所有可能的子目录。
3. 工作流需要时再引入共享业务接口，注入 Platform 实现，避免反向依赖。
4. 公开业务能力放在类型化[数据契约](../src/platform/electron/data-contract.ts)；Platform Repository、事务上下文及 Main 内部生成持久化属于私有实现细节。
5. 保留[产品入口](product-architecture.zh-CN.md)。Calendar 属于 Applications 视图，Resume Builder 使用 Tailor Resume。Inbox 初版复用配置的网页邮箱，不新增邮件数据库或 API 适配。
6. 实现变化时同步更新所属文档及中英文版本。运行检查与命令统一由 README 索引。

存储按迁移、事务/审计控制、行映射及各领域 Repository 适配拆分。Domain 服务负责校验和业务规则；可复用的无框架解析器/错误/能力契约位于 `domain/common/`。资料条目/事实及简历成品/生成按职责拆分。注释解释原子性、隐私、历史引用和恢复规则。

[质量检查](../scripts/quality.cjs) 校验 Domain/Shared/UI 依赖，拒绝运行时循环依赖及数据模块中的 `any`，限制数据模块为 250 行，并检查双语文档链接、示例和篇幅。TypeScript 检查未使用声明/参数及大小写一致性。集成测试使用 Electron SQLite；冒烟测试运行构建后的 Main/Preload。命令由 README 负责。

只有规模需要时才在 Page 之上增加 Product Area；这不改变 Domain/Platform 边界，也不要求完整 DDD。

## 七、相关文档

- [产品架构](product-architecture.zh-CN.md)：范围、URL 与功能组合。
- [当前架构](architecture.zh-CN.md)：运行入口、行为与安全检查。
- [V1 数据架构与 API](data-architecture.zh-CN.md)：已实现存储语义和公开能力。
- [README](../README.zh-CN.md)：启动、验证与文档索引。
