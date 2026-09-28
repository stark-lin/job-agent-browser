# Job Browser — 代码架构基线

状态：已确立的目标代码组织方式，用于指导后续开发与渐进整理。仓库已建立目录与文件占位，尚未完成源码迁移或功能实现。产品范围见[产品架构基线](product-architecture.zh-CN.md)，现有进程与实现边界见[当前实现架构](architecture.md)。

> **按 Page 组织产品代码，按 Domain 沉淀业务能力，按 Platform 隔离技术实现。**

采用 **Page-first modular architecture**，不引入完整 DDD。新功能先落在对应页面，只有稳定的跨页面业务能力才进入 Domain，不为了目录形式提前抽象。

## 一、顶层职责

| 目录 | 职责 | 典型内容 |
| --- | --- | --- |
| `app/` | 应用入口与全局编排 | App、Router、Providers、Theme、Bootstrap、全局 Store、Navigation、Shared Context |
| `pages/` | 用户可见的页面与页面流程 | 页面组件、局部 hooks、局部状态、页面专属逻辑 |
| `domain/` | 稳定的跨页面业务能力 | 业务实体、规则、use case、领域 service、Repository 等能力接口 |
| `platform/` | 技术实现与外部适配 | Electron、Browser、SQLite、Filesystem、AI Provider、配置存储 |
| `shared/` | 无业务语义的公共代码 | 基础 UI、通用 hooks、工具函数、通用类型 |

产品调用流程可以概括为 **Page → Domain → Platform**，但这不表示 Domain 要导入具体 Platform 实现。Domain 定义所需接口，Platform 实现接口，应用初始化时完成组装与注入。

## 二、Pages：第一组织维度

首页之外，九个功能入口分别拥有自己的页面目录：

```text
pages/
├─ home/
├─ find-jobs/
├─ tailor-resume/
├─ interview-prep/
├─ applications/
├─ inbox/
├─ profile/
├─ browser/
├─ ai/
└─ settings/
```

每个 Page 默认拥有自己的 UI、components、hooks、state 和页面流程。例如：

```text
pages/tailor-resume/
├─ TailorResumePage.tsx
├─ components/
│  ├─ JobPanel.tsx
│  ├─ ResumePreview.tsx
│  └─ VersionSelector.tsx
├─ hooks/
│  └─ useTailorResume.ts
├─ model/
│  └─ state.ts
└─ index.ts
```

**只在一个页面使用的代码，就留在页面里。** 这些子目录按需要建立，不要求每个页面都创建完整模板。

Home 只展示九宫格并调用统一 Navigation API，不知道目标页面的内部实现：

```text
pages/home/
├─ HomePage.tsx
├─ HomeGrid.tsx
├─ HomeTile.tsx
└─ home.css
```

## 三、Domain：第二组织维度

真正跨多个 Page 的业务概念进入 Domain：

```text
domain/
├─ job/
├─ resume/
├─ candidate/
├─ application/
└─ interview/
```

`candidate` 承载产品中的 My Profile / Profile 业务概念。单个领域可以按需要组织为：

```text
domain/job/
├─ job.ts
├─ job.types.ts
├─ job.service.ts
├─ job.repository.ts
├─ job.extractor.ts
└─ index.ts
```

Domain 负责业务实体、规则、领域类型、跨页面 use case 和能力接口。例如 `createApplication(jobId)`、`tailorResume(job, resume, profile)`、`saveJobFromPage(snapshot)`。

**Domain 不知道 Page。** 它不依赖 React、Electron renderer、页面组件或路由操作。`navigate(...)` 属于页面流程或应用编排，不进入 Domain。网页输入使用普通数据快照，不把 `WebContents` 或 DOM 对象传入业务逻辑。

## 四、Platform 与 Shared

Platform 隔离具体技术实现，不依赖产品页面：

```text
platform/
├─ electron/
│  ├─ main/
│  │  ├─ index.ts
│  │  ├─ window.ts
│  │  └─ ipc.ts
│  └─ preload/
│     └─ index.ts
├─ browser/
│  ├─ browserManager.ts
│  ├─ navigationManager.ts
│  ├─ sessionManager.ts
│  └─ extractors/
├─ database/
│  ├─ sqlite.ts
│  ├─ migrations/
│  └─ repositories/
├─ filesystem/
│  └─ localFileStore.ts
├─ ai/
└─ storage/
```

其中 `database/` 管理结构化业务数据，`filesystem/` 管理文件读写，`storage/` 承载配置等存储适配，浏览器网站会话仍由 Session 管理。

Shared 只收纳无业务语义的公共能力：

```text
shared/
├─ ui/       # Button、Modal、Input、Card
├─ hooks/    # useDebounce 等
├─ utils/    # formatDate 等
└─ types/    # 无业务语义的公共契约
```

`JobCard`、`ResumePreview` 等业务 UI 留在 Page；`ApplicationStatus` 等稳定业务类型归属相应 Domain。业务组件不能因为被复用就进入 `shared/`，也不能为了归入 Domain 而让 Domain 依赖 React。

## 五、依赖边界与运行时组装

| 使用方 | 允许依赖 | 边界 |
| --- | --- | --- |
| App | Pages、Domain、Platform API | 负责入口、全局编排及依赖组装；组装遵守进程边界 |
| Page | Domain、Platform API、公共 UI 与工具 | 可以使用应用提供的导航和上下文，不导入 Main 专属实现 |
| Domain | 业务接口、无框架依赖的纯工具与类型 | 不依赖 Page、React、Electron 或具体 Platform 实现 |
| Platform | Domain 接口、通用契约与技术库 | 实现业务所需能力，不感知具体页面 |
| Shared | 对应运行环境允许的通用库 | 不反向依赖产品业务模块；Domain 不使用其中的 React UI / hooks |

Repository、AI 等能力在所属进程的初始化入口中注入；跨进程调用通过 Preload / IPC 暴露的窄接口完成。源代码目录分类不会消除 Electron 的进程边界：

```text
Page（Renderer）
       ↓ Browser API
Preload / IPC
       ↓
Platform（Main）
       ↓
WebContents / Session / SQLite / Filesystem
```

Renderer 不能因为接口位于 `platform/` 就直接导入 Electron Main、SQLite 或文件系统实现。现有的 context isolation、sandbox 和受限 IPC 边界继续保留。

## 六、应用级 Navigation 与 Shared Context

### Navigation

导航作为应用级能力集中在 `app/navigation/`，统一处理内部页面和外部网页。内部 URL 沿用产品基线中的 `app://home`、`app://resume` 等约定。

```ts
type Destination =
  | { type: 'page'; url: string }
  | { type: 'web'; url: string }

// page 分支使用 app:// URL，web 分支使用 http(s):// URL。
navigate({ type: 'page', url: 'app://resume' })
navigate({ type: 'web', url: 'https://linkedin.com' })
```

以上是接口示意；导航入口应校验 URL 与目标类型。页面目录名不决定用户可见 URL，例如 `tailor-resume/` 对应 `app://resume`。具体路由映射与混合历史栈由应用导航层处理，Domain 不参与跳转。

### Shared Context

当前工作上下文放在 `app/context/`，主要保存引用，不重复保存大量完整实体：

```ts
interface PageRef {
  url: string
}

interface AppContext {
  currentPage?: PageRef
  currentJobId?: string
  currentResumeId?: string
  currentApplicationId?: string
}
```

这是最小结构示意。职位、简历、申请与用户资料通过 Domain 获取；页面标题、内容和选中文字通过 Browser 能力按需获取，再组装成业务动作所需的上下文。产品基线中的 Shared Context 表示可用信息集合，不要求全量实体都存进全局 Store。

## 七、关键能力的接口与实现

以下类型展示边界，不是已经实现的 API 或最终数据结构。

### Repository

Domain 定义实体与存储接口，Platform 提供 SQLite 实现：

```ts
// domain/job/job.types.ts
export interface Job {
  id: string
  title: string
  company: string
  url: string
  description: string
}

// domain/job/job.repository.ts（Job 从同领域类型文件导入）
export interface JobRepository {
  findById(id: string): Promise<Job | null>
  save(job: Job): Promise<void>
}
```

`platform/database/repositories/SQLiteJobRepository` 实现 `JobRepository`。业务 use case 接收该接口，不自行创建 SQLite 连接。

### AI Provider

Domain / Page 面向抽象能力：

```ts
interface AIProvider {
  generate(request: AIRequest): Promise<AIResponse>
}
```

`AIRequest`、`AIResponse` 是待定义的应用契约，不直接暴露某家供应商的 SDK 类型。业务所需接口与请求类型由使用它的 Domain 定义；只有无业务语义的通用契约才放入 `shared/types/`。

`platform/ai/` 可提供 `OpenAIProvider`、`WebAIProvider`、`MockAIProvider`。更换 Provider 时保持业务契约稳定，Tailor Resume 页面无需随供应商 SDK 一起修改。

### Browser 与 Job Extractor

Browser 同时拥有 Page 与 Platform：

| 位置 | 职责 |
| --- | --- |
| `pages/browser/` | 地址输入、浏览器 UI、页面容器、加载与错误展示 |
| `platform/browser/` | WebContents、Session、Cookie、网页导航、URL 加载、Page snapshot |

职位提取契约属于 `domain/job/`：

```ts
interface JobExtractor {
  canHandle(url: string): boolean
  extract(page: PageSnapshot): Promise<Partial<Job>>
}
```

`PageSnapshot` 是普通数据契约，按提取需求包含 URL 与页面内容等字段，不携带 Electron 对象。具体网站适配放在 `platform/browser/extractors/`：

```text
extractors/
├─ generic.ts
├─ linkedin.ts
├─ seek.ts
├─ greenhouse.ts
└─ workday.ts
```

第一版只实现 `generic`，其余按实际需要增加。提取结果是 `Partial<Job>`，保存前由业务流程补全或校验必需信息。

## 八、九个功能入口的能力组合

下表描述工作流使用的能力，不表示 Domain 直接导入 Platform。

| Page | Domain / 上下文 | Platform 能力 |
| --- | --- | --- |
| Find Jobs | Job | Browser、职位提取 |
| Tailor Resume | Job、Resume、Candidate | AI |
| Interview Prep | Job、Candidate、Interview | AI |
| Applications | Application、Job | Database |
| Inbox | 用户配置的网页邮箱入口；初版不新增邮件 Domain | Browser、Session、Storage |
| My Profile | Candidate、Resume | Database、Filesystem |
| Browser | 当前页面上下文 | Browser |
| Ask AI | 当前页面与所选业务实体的上下文 | AI |
| Settings | 应用配置（含邮箱类型与网页 URL） | Storage、AI、Browser |

Home 只负责到这些入口的导航。跨页面的稳定业务规则进入 Domain；导航和上下文切换仍由 App / Page 编排。

Inbox 初版位于 `pages/inbox/`，内部入口为 `app://inbox`。页面读取 Settings 中用户配置的 Gmail、Outlook 等邮箱类型及网页 URL，通过统一 Navigation API 在 Browser Shell 打开网页邮箱；未配置时引导设置。登录和邮件操作复用网站本身，Session 由 `platform/browser/` 管理，入口配置通过 `platform/storage/` 保存，不保存邮箱密码。初版不新增邮件 Domain、邮件数据库或邮箱 API 适配；后续出现稳定的跨页面邮件业务需求时再抽取。

## 九、完整推荐目录

```text
src/
├─ app/
│  ├─ App.tsx
│  ├─ router.tsx
│  ├─ providers.tsx
│  ├─ navigation/
│  │  ├─ navigate.ts
│  │  ├─ destination.ts
│  │  └─ navigationStore.ts
│  └─ context/
│     ├─ appContext.ts
│     └─ contextStore.ts
├─ pages/
│  ├─ home/
│  ├─ find-jobs/
│  ├─ tailor-resume/
│  ├─ interview-prep/
│  ├─ applications/
│  ├─ inbox/
│  ├─ profile/
│  ├─ browser/
│  ├─ ai/
│  └─ settings/
├─ domain/
│  ├─ job/
│  ├─ resume/
│  ├─ candidate/
│  ├─ application/
│  └─ interview/
├─ platform/
│  ├─ electron/
│  │  ├─ main/
│  │  └─ preload/
│  ├─ browser/
│  ├─ database/
│  ├─ filesystem/
│  ├─ storage/
│  └─ ai/
└─ shared/
   ├─ ui/
   ├─ hooks/
   ├─ utils/
   └─ types/
```

这是目标目录，仓库已按此建立占位结构，并补充上文 Home、Tailor Resume、Job 及 Platform 示例中明确列出的文件。暂无具体文件的目录创建 `index.ts` 入口占位；职位提取器仅预留 `generic.ts`，网站专属适配仍按实际需要增加。每个占位文件仅用一行注释说明职责，不表示已实现组件、接口或业务逻辑。

当前运行代码仍使用 `src/main/`、`src/preload/`、`src/renderer/` 和 `src/shared/browser.ts`，占位结构尚未接入运行入口。后续随功能开发渐进整理；迁移 Electron 入口时，需要同步更新构建配置和入口路径。

## 十、项目扩大后的演进

只有页面数量和产品范围确实需要时，才在 Page 之上增加 Product Area：

```text
src/
├─ product/
│  ├─ discover/pages/
│  ├─ application/pages/
│  ├─ interview/pages/
│  └─ account/pages/
├─ app/
├─ domain/
├─ platform/
└─ shared/
```

这仍然是 Page-first：产品区域负责组织页面，Domain 和 Platform 边界继续保留，无需为了规模增长转成完整 DDD。

## 十一、开发规则

1. 新功能首先放到对应 Page。
2. 只在一个 Page 使用的逻辑，不提前抽取。
3. 跨多个 Page 的稳定业务能力，下沉到 Domain。
4. Electron / Browser / Database / Filesystem / AI 的具体实现放 Platform。
5. Shared 只放没有业务语义的公共能力。
6. Page 可以依赖 Domain 和受控的 Platform API。
7. Domain 不依赖 Page、React 或 Electron。
8. Domain 不直接依赖具体 Platform 实现，通过接口获取能力。
9. Platform 不依赖具体产品页面，并遵守 Electron 进程边界。
10. 不为了架构形式提前抽象；目录与接口随实际需求建立。

**产品结构由 Page 决定，业务结构由 Domain 决定，技术结构由 Platform 决定。**
