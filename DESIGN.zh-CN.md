# 设计纲要

用途：提供 Job Agent Browser 的视觉方向和 UI 设计入口。状态：浅色/暗色配色基础、中央 UI 基础组件、Home、Browser、Inbox、Profile 与 Settings 展示均**已实现**；其余业务功能页面为**占位**，其流程仍为**规划**。具体组件规则归属[设计规范](docs/design-system.zh-CN.md)。

语言：简体中文 · [English](DESIGN.md)

## 一、视觉方向

工作空间应安静、易读，并聚焦用户的下一项任务。浅色使用偏暖中性背景，暗色使用分层深灰表面，配合轻量边框和清晰的文字层级。主题修改颜色并保留组件尺寸及行为，具体约束归属[设计规范](docs/design-system.zh-CN.md#四语义色规则)。装饰服务于内容，不将每个卡片或导航项都处理为主要操作。当前色板与排版选择由[权威 Tokens](src/shared/ui/design-tokens.json)定义，在 [Home](src/pages/home/HomePage.tsx) 和[中央样式](src/shared/ui/components.css)中体现。

常驻左侧栏直接提供主页和全部功能入口，只高亮当前功能。所有窗口宽度均使用带无障碍名称及悬停提示的图标导航，并以短横线保留分区，详见[交互规范](docs/design-system.zh-CN.md#五交互与无障碍)；Inbox 不显示应用顶部条。一致的尺寸与几何规则让不同页面属于同一个应用。使用[布局规范](docs/design-system.zh-CN.md#三布局尺寸与排版)中的共享网格、文字基线和组件尺寸，不为新功能另建视觉体系。

语义色用于说明操作或结果，同时提供文字或图标。[颜色规范](docs/design-system.zh-CN.md#四语义色规则)管理色板和阶段映射；装饰性强调不得改变这些含义。

Ask AI V2 以对话内容为中心，使用独立会话列表、直接排版的助手正文、紧凑的可观察活动和底部输入区。沿用应用配色和控件；响应式、流式及键盘规则归属[设计规范](docs/design-system.zh-CN.md)。

## 二、交互原则

- 明确下一步操作。谨慎使用主要强调，操作名称描述用户得到的结果，而非内部实现细节。
- 保留位置与上下文。内部页面与网站处于同一工作空间，浏览器控件仅在 Browser 出现；具体导航行为归属[当前架构](docs/architecture.zh-CN.md#三展示与交互)。
- 如实表达状态。待实现页面不得暗示流程已可用，参考数据不得作为已保存的用户记录展示。规划流程归属[产品架构](docs/product-architecture.zh-CN.md)。
- 保证键盘和窄屏下的可用性。提供名称、焦点提示和可读反馈；验收要求归属[无障碍规范](docs/design-system.zh-CN.md#五交互与无障碍)。

## 三、设计依据

| 问题 | 权威依据 |
| --- | --- |
| 视觉方向与交互优先级 | 本文 |
| 必须遵循的尺寸、颜色、复用规则与审查流程 | [设计规范](docs/design-system.zh-CN.md) |
| 应用可用组件 | [中央公共入口](src/shared/ui/index.ts) |
| 实际设计值与通用应用外观 | [Tokens](src/shared/ui/design-tokens.json) 和[运行样式](src/shared/ui/components.css) |
| 视觉示例与可下载资源 | [组件展示库](docs/components/job-browser-component-library-8px.html) |
| 已实现行为与剩余限制 | [当前架构](docs/architecture.zh-CN.md) |

所有应用 UI 必须组合中央组件库；缺少基础组件或变体时先扩展中央库，页面组合与业务处理仍由页面管理。遵循[强制复用规则](docs/design-system.zh-CN.md#二必须复用中央组件库)，不得将展示示例结构直接复制到页面。展示库是参考资源，不是已实现 React 业务流程的清单。

## 四、开始 UI 变更

先阅读本纲要了解方向，再结合详细规范与公共组件入口选择已有基础组件或确定中央扩展。只有影响应用整体方向的新视觉决策才记录于本文；组件规则归详细规范，实现细节归对应源码。

交付前遵循[维护与验证流程](docs/design-system.zh-CN.md#六维护与验证)，同步更新相关文档及其翻译。验证命令和开发启动步骤仍归属 [README](README.zh-CN.md#验证与构建)。

## 五、相关文档

- [文档与 UI 约束](AGENTS.zh-CN.md)：内容归属与必须遵守的仓库规则。
- [代码架构](docs/code-architecture.zh-CN.md)：组件依赖边界和页面职责。
- [设计规范](docs/design-system.zh-CN.md)：详细规则、源码依据与验证边界。

## 智能笔记知识库

智能笔记采用左侧 Explorer 与单文件工作区；分栏始终左编辑、右预览。目录 README 是该目录正文，不自动生成子项清单。复用中央控件，冲突时保留未保存草稿和磁盘版本。
