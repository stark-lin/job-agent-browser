# 代码架构

用途：定义源码职责、依赖边界和后续交付约束。状态：React 组装/路由、混合导航、Platform 运行入口及分层业务存储**已实现**。业务页面流程和 AI/文件集成仍为**占位 / 规划**。已验证行为由[当前架构](architecture.zh-CN.md)管理。

语言：简体中文 · [English](code-architecture.md)

## 一、组织原则与活动入口

按 Page 组织产品代码，按 Domain 沉淀业务规则，按 Platform 隔离技术适配。采用页面优先模块，不引入完整 DDD；需要时抽取稳定的跨页面能力。

| 层 | 职责 | 现有依据 |
| --- | --- | --- |
| App | React 组装、路由、Provider、导航投影与上下文 | [App](../src/app/App.tsx)、[Provider](../src/app/providers.tsx) |
| Pages | UI、局部组件/hooks/状态与页面流程 | [Home](../src/pages/home/HomePage.tsx)、[Browser](../src/pages/browser/BrowserPage.tsx) |
| Domain | 实体、校验、用例与能力/Repository 接口 | [Job 用例](../src/domain/job/job.service.ts) |
| Platform | Electron、浏览器、数据库、文件系统、AI 与配置适配 | [浏览器管理](../src/platform/browser/browserManager.ts)、[SQLite](../src/platform/database/sqlite.ts) |
| Shared | 无框架契约及不含业务语义的 UI/工具/hooks | [导航契约](../src/shared/navigation.ts)、[占位布局](../src/shared/ui/PlaceholderPage.tsx) |

[构建配置](../electron.vite.config.ts) 现在从 `src/platform/electron/` 启动 Main/Preload。`src/renderer/` 保留 HTML、React 挂载、环境类型和全局样式。唯一根组件位于 `src/app/`，旧 Main/Preload/Renderer App 实现已移除。构建产物和包入口保持稳定。

## 二、目录边界

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
├── renderer/
└── shared/
    ├── ui/
    ├── hooks/
    ├── utils/
    └── types/
```

Home 和 Browser 为已实现页面。其余八个入口渲染明确占位；页面流程仍为占位，包括 Tailor Resume 的 model/components/hooks。局部模块按需创建，目录或文件存在不代表功能实现。

## 三、依赖与进程组装

| 使用方 | 允许依赖 | 边界 |
| --- | --- | --- |
| App | Pages、通用契约、Domain 类型及受限桥接 | 组装 Renderer 服务，不导入特权实现 |
| Page | App 导航/Provider、Domain 类型、公共 UI/工具 | 调用注入的桥接能力，不导入 Main 实现 |
| Domain | 业务接口和无框架工具/类型 | 不依赖 Page、React、Electron 或具体 Platform |
| Platform | Domain 接口、通用契约和技术库 | 实现能力，不了解产品页面 |
| Shared | 对应运行环境允许的通用库 | 不依赖业务/Platform/App/Page，Domain 不使用 React UI/hooks |

Renderer 流程调用类型化桥接，Main 组装 Domain 服务和 Platform Repository/事务。Domain 依赖接口，由[后端组装](../src/platform/database/backend.ts)注入具体适配器。概念上的 Page → Domain → Platform 流程不允许 UI 导入服务端业务服务。

数据库访问仍只属于 Main。配置、密钥、AI 请求和编译由 Main 或受控服务执行。保留沙盒、上下文隔离、第三方页面分离，以及精确可信文档/顶层 frame 的 IPC 校验。

## 四、导航、React 状态与上下文

[App 导航](../src/app/navigation/)提供 Main 快照的订阅投影和统一导航 hook。React Context 注入依赖，`useSyncExternalStore` 读取稳定快照，不增加路由/状态库。Provider 生命周期管理订阅、初始化竞争和清理；页面局部状态仍在页面 hooks/components 中。

无框架的 [Destination](../src/shared/navigation.ts) 契约跨进程共享。[Main 浏览器管理](../src/platform/browser/browserManager.ts)拥有标签和权威混合历史；[MixedHistory](../src/platform/browser/mixedHistory.ts) 组合内部项与原生历史段，[WebSegment](../src/platform/browser/webSegment.ts) 管理视图事件、原生回放和释放。App 路由不改变可信文档 URL。

Browser 拥有标签栏/地址栏/控件；其他内部页面隐藏整个浏览器栏和全部内部 URL。只有 Browser 确认原生视图展示，携带活动标签与目标，避免旧确认覆盖内部页面。UI URL 和历史规则由产品架构管理，运行细节由当前架构管理。

[App 上下文](../src/app/context/)保存当前页面元数据及可空 Job/Profile/Artifact ID，不复制记录。业务流程实现后通过业务桥接解析实体。Applications 使用 Job ID，不另存 Application 实体。内容/选区捕获和自动填充上下文仍为规划。

Home 只发起导航。跨页面业务规则归 Domain，导航及上下文切换仍由 App/Page 管理。

## 五、数据与能力归属

[V1 数据架构](data-architecture.zh-CN.md)管理结构、API、生成阶段和存储规则。五个数据分组不要求新增五个目录或用 `main/domains` 替换现有组织。

| 职责 | 归属 |
| --- | --- |
| Company、Job 与来源 | `domain/job/` |
| 申请生命周期、事件和日历 | `domain/application/`，UI 在 `pages/applications/` |
| Profile、ProfileItem 与 Fact | `domain/candidate/`，UI 在 `pages/profile/` |
| GenerationRun、Artifact 与溯源 | `domain/resume/`，UI 在 `pages/tailor-resume/` |
| SQLite、迁移、Repository 与审计持久化 | Main 侧 `platform/database/` |
| AI、配置、加密密钥和输出文件 | `platform/ai/`、`platform/storage/`、`platform/filesystem/`，实现仍为规划 |

Domain 定义 Repository/提取接口。具体 SQLite Repository 和占位[通用提取器](../src/platform/browser/extractors/generic.ts)归 Platform。网页快照必须是普通数据，不传 DOM/Electron 对象。网站专属提取延后；保存部分数据前校验 Job 必需字段。

AI 契约不向页面暴露供应商 SDK 类型。业务专属契约归使用方 Domain，通用契约归 Shared。ResumePreview 等业务 UI 即使复用仍在 Pages；Shared 占位布局不含业务语义。

## 六、质量与后续交付

[质量检查](../scripts/quality.cjs)约束 App/Page/Renderer 特权导入、Domain/Shared 依赖、运行导入环、数据边界类型/模块长度及双语文档结构/链接/篇幅。TypeScript 检查未使用声明/参数和大小写。纯导航/store 测试补充 Electron SQLite 集成与生产窗口 smoke。命令归 README 管理。

公开业务能力保留在 [DataContract](../src/platform/electron/data-contract.ts)，Repository、事务上下文、审计写入及生成阶段持久化仍为私有实现。存储模块分离迁移、事务/审计控制、映射和领域适配；Domain 服务管理业务校验。

Calendar 仍是 Applications 视图，Resume Builder 属于 Tailor Resume。初版 Inbox 将复用配置的网页邮箱，不建立邮件数据库。AI 执行、编译、配置/密钥持久化和业务表单为后续工作，不因页面骨架可访问就视为完成。历史恢复/淘汰同样延后。

行为、接口、目录或配置变化时同步更新所属文档和两种语言。未来迁移保留构建产物、SQLite/审计行为和 Session 分区。规模需要时再引入 Product Areas；不要求完整 DDD。

## 七、相关文档

- [产品架构](product-architecture.zh-CN.md)：产品规则和能力组合。
- [当前架构](architecture.zh-CN.md)：运行、行为与安全。
- [V1 数据架构与 API](data-architecture.zh-CN.md)：持久化语义和能力。
- [README](../README.zh-CN.md)：启动、验证及文档索引。
