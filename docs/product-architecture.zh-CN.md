# Job Browser — 产品架构基线

状态：已确立的产品方向，用于指导后续设计与开发。本文描述目标 MVP，不代表功能已经实现。现有能力见[当前实现架构](architecture.md)。

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

新增能力时，优先放进现有入口，而不是不断增加首页按钮。

### Inbox 初版

Inbox 作为求职邮件入口，初版复用用户配置的 Gmail、Outlook 等网页邮箱。用户在 Settings 选择邮箱类型并配置网页 URL；进入 `app://inbox` 后，通过统一 Navigation API 在 Browser Shell 中打开该 URL。未配置时，引导用户完成邮箱设置。

用户直接在邮箱网站登录，登录状态由 Electron Session 管理。初版只保存邮箱入口配置，不保存邮箱密码，不要求邮箱 API 接入、邮件同步、聚合收件箱或本地邮件实体。阅读和回复邮件使用邮箱网站已有功能。

## 三、Browser Shell

整个 App 运行在统一的 Browser Shell 中。内部功能、外部网页与 AI 页面共享同一导航环境。

```text
┌─────────────────────────────────────────┐
│ Back    Forward    Home          Agent  │
├─────────────────────────────────────────┤
│                                         │
│                  PAGE                   │
│                                         │
│       Internal Page / Website / AI      │
│                                         │
└─────────────────────────────────────────┘
```

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

外部页面沿用已有 URL，例如：

```text
https://linkedin.com/...
https://seek.com.au/...
https://company.com/careers/...
https://chatgpt.com/...
```

一次完整导航可以连续经过内部页面和外部网站：

```text
Home → Find Jobs → LinkedIn Job → Tailor Resume → Company Application
```

Back / Forward 对两类页面采用一致的历史模型。内部路由和混合导航栈的具体实现留待开发确定；当前浏览器基础版本仅使用 Chromium 管理外部网页历史。

## 五、Shared Context

Shared Context 是九个入口真正共享的核心，使用户不必反复复制、粘贴或重新输入相同信息。

```text
Context
├── Current Page
│   ├── URL
│   ├── Title
│   ├── Content
│   └── Selected Text
├── Current Job
│   ├── Company
│   ├── Title
│   ├── Job Description（JD，职位描述）
│   └── URL
├── Profile
└── Resume
```

以定制简历为例：

```text
浏览 LinkedIn 职位
        ↓
从页面获取 Job Context
        ↓
打开 Tailor Resume
        ↓
Job + Profile + Resume
        ↓
AI
        ↓
Tailored Resume（定制后的简历）
```

同一份上下文继续支持其他动作：

```text
Job + Profile        → Interview Prep
Current Page + Job   → Ask AI
```

**Context 跟着用户走，而不是每个功能重新要求用户输入。** 职位保存与提取应填充同一共享模型；本基线不限定具体的提取方式。

## 六、核心数据

MVP 采用 Local First，不需要复杂后端。本地存储是起点；外部网站和已配置的 AI 服务仍可能需要联网。

以下为概念字段，不是最终数据库结构：

| 实体 | 字段 |
| --- | --- |
| Profile | 基本信息、教育经历、工作经历、项目经历、技能、偏好 |
| Job | 公司、职位名称、URL、职位描述、创建时间 |
| Application | 关联职位、状态、申请时间、备注 |
| Resume | 名称、文件、内容、创建时间 |
| Settings | Agent URL、API Key、默认招聘网站、邮箱类型与网页 URL、浏览器设置 |

Application 关联 Job。Resume 记录本地管理的简历文件及内容。Shared Context 标识当前使用的页面和职位，并关联用户资料与简历，不是把所有记录另存一份。

初期存储方案为 **SQLite + 本地文件系统 + Electron Session**：

- SQLite 保存结构化产品数据。
- 本地文件系统保存简历和生成的文件。
- Electron Session 管理 Cookie 等网站会话数据。

Settings 描述配置需求；凭据的具体存储方式在开发时确定。本基线不要求将 API Key 明文存入 SQLite。

## 七、功能通过能力组合实现

九个入口不等于九套独立系统。各功能组合共用能力：

| 功能 | 能力组合 |
| --- | --- |
| Find Jobs | Browser + Job Capture |
| Tailor Resume | Job Context + Profile + Resume + AI |
| Interview Prep | Job Context + Profile + AI |
| Ask AI | Current Context + Configured AI |
| Applications | Job + Application |
| Inbox | 用户配置的网页邮箱 + Browser + Session |

导航、上下文、AI 接入和文件处理应在这些工作流之间复用。

## 八、技术分层

整体保持四层：

```text
┌────────────────────────────────────────┐
│              Electron App              │
├────────────────────────────────────────┤
│             Browser Shell              │
│       Navigation / Agent / Page        │
├────────────────────────────────────────┤
│                Services                │
│       Context / Job / AI / Files        │
├────────────────────────────────────────┤
│                  Data                  │
│       SQLite / Files / Settings        │
└────────────────────────────────────────┘
```

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
| Data | 通过 Profile、Job、Application、Resume 保存工作成果。 |

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

仓库当前的浏览器基础实现是通向该里程碑的起点，不代表上述目标已经完成。

## 十一、基线使用规则

后续产品设计、界面设计和开发规划以本文为参考。本文取代此前的产品方向，当前实现情况继续单独记录。

本基线确定产品结构和开发方向。详细页面布局、职位提取方式、AI 接入协议、数据库结构、申请状态和后续邮箱深度集成方式仍留待实现时确定。如果九个入口、URL 模型、Shared Context、Local First 原则或能力组合方式发生变化，应同步更新中英文文档，再作为新的基线。
