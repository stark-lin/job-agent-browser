# Job Browser — 产品架构基线

用途：确定产品范围与交付顺序。状态：**规划**，作为后续设计与开发的产品方向。本文描述目标 MVP，不代表功能已经实现。现有能力见[当前实现架构](architecture.zh-CN.md)。

语言：简体中文 · [English](product-architecture.md)。两个版本表达同一基线，后续应同步更新。

## 一、产品定位

**一个为求职深度定制的 Browser Package。**

Job Browser 将已有招聘网站、AI 和邮箱整合进统一、精美、连续的求职工作环境，不重新实现这些工具。

> Browser 是底座，求职功能是 Package。

这里的 Package 指产品能力的组合方式，不要求 MVP 实现插件市场或扩展框架。

## 二、首页：九宫格

打开 App 后，第一屏直接展示功能入口，不做复杂 Dashboard。

| | | |
| --- | --- | --- |
| Find Jobs（找工作） | Tailor Resume（定制简历） | Interview Prep（面试准备） |
| Applications（申请管理） | Inbox（收件箱） | My Profile（个人资料） |
| Browser（浏览器） | Ask AI（询问 AI） | Settings（设置） |

三行分别对应：

- **求职动作：** Find Jobs → Tailor Resume → Interview Prep。
- **求职管理：** Applications → Inbox → My Profile。
- **基础工具：** Browser → Ask AI → Settings。

九个入口均可访问，八个业务页面目前为占位。新增能力优先放进现有入口。

### Inbox 初版

Inbox 作为求职邮件入口，初版复用用户配置的 Gmail、Outlook 等网页邮箱。用户在 Settings 选择邮箱类型并配置网页 URL；进入 `app://inbox` 后，通过统一 Navigation API 在 Browser Shell 中打开该 URL。未配置时，引导用户完成邮箱设置。

用户直接在邮箱网站登录，登录状态由 Electron Session 管理。初版只保存邮箱入口配置，不保存邮箱密码，不要求邮箱 API 接入、邮件同步、聚合收件箱或本地邮件实体。阅读和回复邮件使用邮箱网站已有功能。

## 三、Browser Shell

内部功能、外部网页与 AI 页面共享统一导航环境。Browser 是独立 React 页面，标签栏、地址栏及控件属于该页面。Home 和其他内部页面隐藏整个浏览器栏，内部 URL 对用户隐藏。

Shell 提供以下全局能力：

| 能力 | 职责 |
| --- | --- |
| Navigation | Back、Forward、Home，以及页面历史栈 |
| Browser | 打开 URL；管理网页 Session / Cookie；文件上传下载；获取网页内容；接收粘贴的 URL 或网页内容 |
| Agent | 提供常驻 Agent 按钮；将当前页面、当前职位或选中文字交给 AI |

全局 Agent 按钮用于在当前页面发起协助；首页 Ask AI 入口打开专门的 AI 页面。两者复用共享上下文和已配置的 AI 能力。

## 四、Anything is URL

内部功能与互联网网页统一通过 URL 寻址。

| 内部 URL | 页面 |
| --- | --- |
| `app://home` | Home |
| `app://find` | Find Jobs |
| `app://resume` | Tailor Resume |
| `app://interview` | Interview Prep |
| `app://applications` | Applications |
| `app://inbox` | Inbox |
| `app://profile` | My Profile |
| `app://browser` | Browser |
| `app://ai` | Ask AI |
| `app://settings` | Settings |

外部页面沿用网站已有 URL。

一次完整导航可以连续经过内部页面和外部网站：

```text
Home → Find Jobs → LinkedIn Job → Tailor Resume → Company Application
```

每个标签具有独立的内部页面/网站混合历史。Home 在当前标签新增历史，切换标签不新增历史。启动、新建或关闭最后一个标签后打开 Home。Browser 卡片打开空白工作区，访问网站前地址框为空。内部页面提供页面内 Back/Home 和键盘历史导航，只有 Browser 渲染浏览器控件。运行实现细节归当前架构管理。

## 五、Shared Context

Shared Context 通过当前页面（URL、标题、内容、选中文字）、当前 Job、Profile 和 Resume 连接九个入口。

定制简历将捕获的 Job 与 Profile、Resume 组合，再由 AI 生成定制内容。

同一份上下文继续支持其他动作：

```text
Job + Profile        → Interview Prep
Current Page + Job   → Ask AI
```

**Context 跟着用户走，而不是每个功能重新要求用户输入。** 职位保存与提取应填充同一共享模型；本基线不限定具体的提取方式。

## 六、核心数据

MVP 采用 Local First，不需要复杂后端。本地存储是起点；外部网站和已配置的 AI 服务仍可能需要联网。

[V1 数据架构](data-architecture.zh-CN.md) 负责已实现的 11 表模型、ER 图、申请状态、生成流水线、溯源、审计、配置与密钥设计。

Applications 使用 Job 生命周期数据，其日历视图使用 JobEvent。生成简历属于 Artifact，个人材料由 Profile、ProfileItem 和 Fact 表达。这些是共享记录，不是页面各自持有的副本。Calendar 和 Resume Builder 不新增首页入口。

SQLite 保存业务记录，本地文件保存配置与输出，Electron Session 管理网站会话。API Key 归入加密密钥存储。业务持久化和 Electron Session 已实现；配置、密钥和编译输出仍为规划，见[当前架构](architecture.zh-CN.md)。

## 七、功能通过能力组合实现

九个入口不等于九套独立系统。各功能组合共用能力：

| 功能 | 能力组合 |
| --- | --- |
| Find Jobs | Browser + Job Capture |
| Tailor Resume | Job Context + Profile + Resume + AI |
| Interview Prep | Job Context + Profile + AI |
| Ask AI | Current Context + Configured AI |
| Applications | Job + 申请生命周期 + JobEvent |
| Inbox | 用户配置的网页邮箱 + Browser + Session |

导航、上下文、AI 接入和文件处理应在这些工作流之间复用。

## 八、技术分层

四个逻辑层为 Electron App → Browser Shell → Services → Data。进程职责为：

- **Electron Main** 负责窗口、WebContents、Session、文件系统访问等系统能力。
- **Renderer** 负责首页九宫格、内部页面、Browser Shell UI 及其他展示逻辑。
- **Services + IPC** 隔离 UI 工作流与需要系统权限的操作。

这里是逻辑分层，不是四个独立应用，也不要求所有 Service 都运行在 Renderer 中。现有进程隔离和安全边界继续作为开发基础。

## 九、五个产品 Primitive

**URL → Page → Context → Action → Data**

| 基础概念 | 含义 |
| --- | --- |
| URL | 任何页面都可以被寻址。 |
| Page | 网页、AI 和内部功能统一存在于 Browser 环境。 |
| Context | 应用知道当前页面、职位、用户资料和简历。 |
| Action | 用户执行 Find、Tailor、Prepare、Save、Ask 等操作。 |
| Data | 通过 Profile、Job 生命周期和简历 Artifact 保存工作成果。 |

以这五个基础概念指导功能设计，避免为重叠的工作流重复建立系统。

## 十、开发顺序

第一阶段不必完整实现九个功能。

| 阶段 | 重点 | 预期结果 |
| --- | --- | --- |
| 1 | Browser Shell | 支持内部页面、外部网页以及 Back / Forward / Home 的 Electron Browser |
| 2 | 九宫格 Home | 建立全部九个入口；未完成的功能可以先使用占位页面 |
| 3 | Anything is URL | 内部页面和外部网页进入统一导航栈 |
| 4 | Profile + Resume | 建立用户求职上下文 |
| 5 | Job Context | 从网页保存或提取当前职位 |
| 6 | Tailor Resume | 结合用户简历，完成首个 Browser → Job → Profile → AI → Output 闭环 |

阶段 1 建立页面承载能力和导航控件，阶段 3 完成统一 URL 与历史行为。首个定制简历工作流完成后，再逐步完善：

**Find Jobs → Applications → Interview Prep → Inbox → Ask AI → Settings**

这是完整功能的扩展顺序。Tailor Resume 所需的最小 AI 接入与配置能力必须在阶段 6 前就绪；Inbox 所需的邮箱入口配置应随 Inbox 一同提供。

基础里程碑为：

> 先造一个漂亮、稳定、可寻址、带 Shared Context 的 Electron Browser Shell；九宫格是产品入口，求职能力逐个作为 Package 填进去。

当前基础实现已完成阶段 1–3 和仅含引用的 App Context。业务流程及完整上下文捕获仍为规划，可访问页面骨架不代表 MVP 完成。

## 十一、基线使用规则

后续产品设计、界面设计和开发规划以本文为参考。本文取代此前的产品方向，当前实现情况继续单独记录。

本基线确定产品结构和开发方向。详细页面布局、职位提取方式、AI 接入协议和后续邮箱深度集成方式仍留待实现时确定。已实现的数据模型、状态、SQL 迁移及状态转换规则归数据架构管理。如果九个入口、URL 模型、Shared Context、Local First 原则或能力组合方式发生变化，应同步更新中英文文档，再作为新的基线。

## 相关文档

- [当前架构](architecture.zh-CN.md)：已实现行为与限制。
- [代码架构](code-architecture.zh-CN.md)：目标组织与依赖边界。
- [README](../README.zh-CN.md)：启动与文档索引。
